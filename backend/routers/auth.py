import base64
import hashlib
import logging
import os
import re
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import RedirectResponse
from firebase_admin import auth as firebase_auth_module
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from google_auth_oauthlib.flow import Flow
from google.cloud.firestore import SERVER_TIMESTAMP
from pydantic import BaseModel

from services.google_workspace.credentials import read_refresh_token, store_refresh_token
from services.lecturer_service import LECTURER_ROLE, add_lecturer, is_lecturer_email, normalize_email
from utils.firebase_auth import CurrentUser, get_current_user, init_firebase
from utils.firestore_client import get_firestore
from utils.google_credentials import get_google_flow, GOOGLE_SCOPES

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth")

USERS_COLLECTION = "users"
OAUTH_STATES_COLLECTION = "oauth_states"
TESTER_TICKETS_COLLECTION = "tester_signup_tickets"

# How long a non-allowlisted account has to tick "become a tester" after
# Google sign-in. The ticket holds a refresh token, so it should not linger.
TESTER_TICKET_TTL = timedelta(minutes=15)
# secrets.token_urlsafe(32) output. Checked before the value is used as a
# document id, so a crafted ticket cannot address some other path.
_TICKET_RE = re.compile(r"^[A-Za-z0-9_-]{20,128}$")


def _frontend_base_url() -> str:
    return (os.getenv("FRONTEND_URL") or "http://localhost:5173").rstrip("/")


def _google_connect_url() -> str:
    return "/auth/google-scopes"


def _build_flow() -> Flow:
    """Build a Google OAuth Flow (client config, redirect URI, scopes)."""
    return get_google_flow()


# Removed: POST /init-user. Nothing called it, and it let any holder of a valid
# Firebase token — including a student signed in through the game — mint their
# own users/{uid} profile document. The OAuth callback below writes that
# document itself, only for an allowlisted lecturer.


def _complete_lecturer_sign_in(
    db: Any,
    email: str,
    name: str,
    picture: str,
    refresh_token: str,
) -> str:
    """Create or update the Firebase account for an allowlisted address and
    return a custom token for it.

    Callers MUST have checked the allowlist first (or just added the address
    to it): this stamps the lecturer role unconditionally.
    """
    try:
        user_record = firebase_auth_module.get_user_by_email(email)
        uid = user_record.uid
        firebase_auth_module.update_user(
            uid,
            display_name=name or None,
            photo_url=picture or None,
        )
    except firebase_auth_module.UserNotFoundError:
        user_record = firebase_auth_module.create_user(
            email=email,
            display_name=name or None,
            photo_url=picture or None,
        )
        uid = user_record.uid

    user_ref = db.collection(USERS_COLLECTION).document(uid)
    user_snap = user_ref.get()
    user_payload: dict = {
        "uid": uid,
        "email": email,
        "display_name": name,
        "google_scopes": GOOGLE_SCOPES,
        "google_token_status": "valid",
        "google_oauth_provider": "google",
        "google_email": email,
    }
    if picture:
        user_payload["photo_url"] = picture
    if not user_snap.exists:
        user_payload["createdAt"] = SERVER_TIMESTAMP
    user_ref.set(user_payload, merge=True)
    # The refresh token (a secret) is written to an Admin-only private subdoc,
    # never to the client-readable users/{uid} doc.
    store_refresh_token(db, uid, refresh_token)

    # Stamp the role onto the account itself, so the API, the security rules
    # and the frontend can all read it straight off the token with no extra
    # lookup. Set BEFORE the custom token is minted — claims are baked in
    # when the ID token is issued, so doing this afterwards would leave the
    # lecturer roleless until their token refreshed an hour later.
    #
    # This REPLACES the whole custom-claims object; nothing else sets claims
    # today, so there is nothing to preserve. Re-stamped on every sign-in,
    # which is also how an existing lecturer picks the claim up for the
    # first time.
    firebase_auth_module.set_custom_user_claims(uid, {"role": LECTURER_ROLE})

    return firebase_auth_module.create_custom_token(uid).decode("utf-8")


@router.get("/google-scopes")
async def google_scopes() -> RedirectResponse:
    """
    Start Google OAuth for sign-in and Workspace scopes (Drive, Docs, Forms, Gmail).
    """
    try:
        flow = _build_flow()
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        ) from exc

    code_verifier = secrets.token_urlsafe(96)
    code_challenge = base64.urlsafe_b64encode(
        hashlib.sha256(code_verifier.encode()).digest()
    ).rstrip(b"=").decode()

    authorization_url, state = flow.authorization_url(
        access_type="offline",
        prompt="consent",
        include_granted_scopes="true",
        code_challenge=code_challenge,
        code_challenge_method="S256",
    )

    db = get_firestore()
    db.collection(OAUTH_STATES_COLLECTION).document(state).set(
        {
            "createdAt": SERVER_TIMESTAMP,
            "code_verifier": code_verifier,
        }
    )

    return RedirectResponse(url=authorization_url, status_code=status.HTTP_302_FOUND)


@router.get("/google-scopes/callback")
async def google_scopes_callback(
    state: str | None = Query(None),
    code: str | None = Query(None),
    error: str | None = Query(None),
) -> RedirectResponse:
    frontend = _frontend_base_url()
    failure_url = f"{frontend}/login"

    if error or not state or not code:
        return RedirectResponse(url=failure_url, status_code=status.HTTP_302_FOUND)

    db = get_firestore()
    state_ref = db.collection(OAUTH_STATES_COLLECTION).document(state)
    state_snap = state_ref.get()

    if not state_snap.exists:
        return RedirectResponse(url=failure_url, status_code=status.HTTP_302_FOUND)

    state_data = state_snap.to_dict() or {}
    code_verifier = state_data.get("code_verifier")
    if not code_verifier:
        state_ref.delete()
        return RedirectResponse(url=failure_url, status_code=status.HTTP_302_FOUND)

    try:
        flow = _build_flow()
        flow.fetch_token(code=code, code_verifier=code_verifier)
        credentials = flow.credentials
        refresh_token = credentials.refresh_token
        google_id = credentials.id_token
    except Warning as exc:
        # oauthlib raises a bare Warning when the granted scope set differs from
        # the requested one. With include_granted_scopes=true that is routine,
        # and OAUTHLIB_RELAX_TOKEN_SCOPE (set in utils.google_credentials) stops
        # it — but log it distinctly so a future scope change is diagnosable
        # rather than presenting as a silent bounce back to /login.
        logger.exception("OAuth callback rejected the token scope: %s", exc)
        state_ref.delete()
        return RedirectResponse(url=failure_url, status_code=status.HTTP_302_FOUND)
    except Exception as exc:
        logger.exception("OAuth callback error: %s", exc)
        state_ref.delete()
        return RedirectResponse(url=failure_url, status_code=status.HTTP_302_FOUND)

    state_ref.delete()

    if not refresh_token or not google_id:
        return RedirectResponse(url=failure_url, status_code=status.HTTP_302_FOUND)

    client_id = (os.getenv("GOOGLE_CLIENT_ID") or "").strip()
    if not client_id:
        return RedirectResponse(url=failure_url, status_code=status.HTTP_302_FOUND)

    try:
        init_firebase()
        idinfo = google_id_token.verify_oauth2_token(
            google_id,
            google_requests.Request(),
            client_id,
        )
        email = idinfo.get("email")
        name = idinfo.get("name") or ""
        picture = idinfo.get("picture") or ""
        if not email:
            return RedirectResponse(url=failure_url, status_code=status.HTTP_302_FOUND)

        # The gate. Account creation lives in _complete_lecturer_sign_in, so
        # the allowlist is checked BEFORE any of it: an unknown address must
        # not become a dormant teacher account. Instead it gets a short-lived
        # ticket and is offered the tester sign-up page, which is the only way
        # onto the list from outside. The ticket carries the address Google
        # just verified, so the page can never be used to add someone else's.
        if not is_lecturer_email(email):
            ticket = secrets.token_urlsafe(32)
            db.collection(TESTER_TICKETS_COLLECTION).document(ticket).set(
                {
                    "email": normalize_email(email),
                    "name": name,
                    "picture": picture,
                    "refresh_token": refresh_token,
                    "createdAt": SERVER_TIMESTAMP,
                    "expiresAt": datetime.now(timezone.utc) + TESTER_TICKET_TTL,
                }
            )
            logger.info("Offering tester sign-up to non-lecturer address: %s", email)
            return RedirectResponse(
                url=f"{frontend}/join?{urlencode({'ticket': ticket})}",
                status_code=status.HTTP_302_FOUND,
            )

        custom_token = _complete_lecturer_sign_in(db, email, name, picture, refresh_token)
    except Warning as exc:
        # oauthlib raises a bare Warning when the granted scope set differs from
        # the requested one. With include_granted_scopes=true that is routine,
        # and OAUTHLIB_RELAX_TOKEN_SCOPE (set in utils.google_credentials) stops
        # it — but log it distinctly so a future scope change is diagnosable
        # rather than presenting as a silent bounce back to /login.
        logger.exception("OAuth callback rejected the token scope: %s", exc)
        state_ref.delete()
        return RedirectResponse(url=failure_url, status_code=status.HTTP_302_FOUND)
    except Exception as exc:
        logger.exception("OAuth callback error: %s", exc)
        return RedirectResponse(url=failure_url, status_code=status.HTTP_302_FOUND)

    success_url = f"{frontend}/auth/callback?{urlencode({'custom_token': custom_token})}"
    return RedirectResponse(url=success_url, status_code=status.HTTP_302_FOUND)


# ---------------------------------------------------------------------------
# Tester self sign-up
# ---------------------------------------------------------------------------
# A Google account that is not on the allowlist is sent to /join with a ticket
# (see the gate in google_scopes_callback). The ticket is the credential here:
# it was minted only after Google verified the address, it is single-use, and
# it expires. No Firebase token exists yet, so these routes take none.


class TesterSignupRequest(BaseModel):
    ticket: str


def _load_ticket(db: Any, ticket: str) -> tuple[Any, dict]:
    """Return the ticket's ref and data, or raise 404/410."""
    if not _TICKET_RE.match(ticket or ""):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="This sign-up link is invalid or was already used.",
        )
    ref = db.collection(TESTER_TICKETS_COLLECTION).document(ticket)
    snap = ref.get()
    if not snap.exists:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="This sign-up link is invalid or was already used.",
        )
    data = snap.to_dict() or {}
    expires_at = data.get("expiresAt")
    if not isinstance(expires_at, datetime) or expires_at <= datetime.now(timezone.utc):
        ref.delete()
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="This sign-up link has expired. Please sign in again.",
        )
    return ref, data


@router.get("/tester-signup/{ticket}")
async def get_tester_signup(ticket: str) -> dict[str, str]:
    """Who the ticket is for — name and email only, never the refresh token."""
    _, data = _load_ticket(get_firestore(), ticket)
    return {"email": data.get("email") or "", "name": data.get("name") or ""}


@router.post("/tester-signup")
async def submit_tester_signup(body: TesterSignupRequest) -> dict[str, str]:
    """Add the ticket's address to the allowlist and sign it straight in."""
    db = get_firestore()
    ref, data = _load_ticket(db, body.ticket)
    # Burn the ticket first: it is single-use even if what follows fails.
    ref.delete()

    email = data.get("email") or ""
    name = data.get("name") or ""
    refresh_token = data.get("refresh_token") or ""
    if not email or not refresh_token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This sign-up link is incomplete. Please sign in again.",
        )

    init_firebase()
    add_lecturer(email, note="self sign-up", source="tester_form", name=name)
    logger.info("Tester self sign-up added to allowlist: %s", email)

    custom_token = _complete_lecturer_sign_in(
        db, email, name, data.get("picture") or "", refresh_token
    )
    return {"custom_token": custom_token}


@router.get("/google/status")
async def google_status(
    current_user: CurrentUser = Depends(get_current_user),
) -> dict[str, Any]:
    uid = current_user["uid"]
    
    from services.google_workspace.credentials import get_user_google_record, assert_google_oauth_valid, GoogleOAuthInvalidError, GoogleOAuthRequiredError
    
    record = get_user_google_record(uid)
    has_token = bool(record.get("google_refresh_token"))
    
    if not has_token:
        return {
            "connected": False,
            "valid": False,
            "has_google_scopes": False,
            "scopes": [],
            "missing_scopes": GOOGLE_SCOPES,
            "message": "Not connected",
            "connect_url": _google_connect_url(),
        }
        
    try:
        assert_google_oauth_valid(uid)
        is_valid = True
        message = "Connected and valid"
    except (GoogleOAuthRequiredError, GoogleOAuthInvalidError):
        is_valid = False
        message = "Token invalid or expired"
        
    current_scopes = record.get("google_scopes") or []
    missing_scopes = [s for s in GOOGLE_SCOPES if s not in current_scopes]
    
    return {
        "connected": True,
        "valid": is_valid,
        "has_google_scopes": len(missing_scopes) == 0 and is_valid,
        "scopes": current_scopes,
        "missing_scopes": missing_scopes,
        "message": message,
        "connect_url": _google_connect_url(),
    }


@router.get("/check-permissions")
async def check_permissions(
    current_user: CurrentUser = Depends(get_current_user),
) -> dict[str, bool]:
    uid = current_user["uid"]
    db = get_firestore()
    # Token lives in the Admin-only private subdoc (with legacy fallback).
    token = read_refresh_token(db, uid)
    return {"has_google_scopes": bool(token)}
