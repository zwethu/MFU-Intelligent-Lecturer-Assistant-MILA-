"""Tester self sign-up: a Google account that is not on the lecturer allowlist
gets a single-use ticket instead of a rejection, and redeeming it adds the
address Google verified (never one the client supplies) and signs it in."""

import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi import HTTPException

import routers.auth as auth
import services.lecturer_service as lecturer_service


# --- minimal dict-backed fake firestore ---------------------------------------

class _Snap:
    def __init__(self, data):
        self._data = data
        self.exists = data is not None

    def to_dict(self):
        return dict(self._data) if self._data else {}


class _Doc:
    def __init__(self, store, path):
        self.store, self.path = store, path

    def get(self):
        return _Snap(self.store.get(self.path))

    def set(self, data, merge=False):
        cur = (self.store.get(self.path) or {}) if merge else {}
        self.store[self.path] = {**cur, **data}

    def delete(self):
        self.store.pop(self.path, None)

    def collection(self, name):
        return _Coll(self.store, f"{self.path}/{name}")


class _Coll:
    def __init__(self, store, path):
        self.store, self.path = store, path

    def document(self, doc_id):
        return _Doc(self.store, f"{self.path}/{doc_id}")


class _DB:
    def __init__(self):
        self.store = {}

    def collection(self, name):
        return _Coll(self.store, name)

    def under(self, prefix):
        return {k: v for k, v in self.store.items() if k.startswith(prefix + "/")}


EMAIL = "tester@gmail.com"
TICKET = "t" * 43


@pytest.fixture
def db(monkeypatch):
    fake = _DB()
    monkeypatch.setattr(auth, "get_firestore", lambda: fake)
    monkeypatch.setattr(lecturer_service, "get_firestore", lambda: fake)
    monkeypatch.setattr(auth, "init_firebase", lambda: None)
    return fake


@pytest.fixture
def firebase(monkeypatch):
    calls = {"created": [], "claims": {}}
    fb = auth.firebase_auth_module

    def get_user_by_email(email):
        raise fb.UserNotFoundError("no user")

    def create_user(email, **_):
        calls["created"].append(email)
        return SimpleNamespace(uid="u1")

    monkeypatch.setattr(fb, "get_user_by_email", get_user_by_email)
    monkeypatch.setattr(fb, "create_user", create_user)
    monkeypatch.setattr(fb, "set_custom_user_claims", lambda uid, c: calls["claims"].update({uid: c}))
    monkeypatch.setattr(fb, "create_custom_token", lambda uid: f"ct-{uid}".encode())
    monkeypatch.setattr(auth, "store_refresh_token", lambda db, uid, rt: None)
    return calls


def _seed_ticket(db, *, expires_in=timedelta(minutes=10)):
    db.store[f"{auth.TESTER_TICKETS_COLLECTION}/{TICKET}"] = {
        "email": EMAIL,
        "name": "Tess Tester",
        "picture": "",
        "refresh_token": "rt-1",
        "expiresAt": datetime.now(timezone.utc) + expires_in,
    }


def _run_callback(db, monkeypatch, email):
    db.store["oauth_states/s1"] = {"code_verifier": "v"}
    flow = SimpleNamespace(
        fetch_token=lambda **_: None,
        credentials=SimpleNamespace(refresh_token="rt-1", id_token="idt"),
    )
    monkeypatch.setattr(auth, "_build_flow", lambda: flow)
    monkeypatch.setattr(
        auth.google_id_token,
        "verify_oauth2_token",
        lambda *a, **k: {"email": email, "name": "Tess Tester", "picture": ""},
    )
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "cid")
    monkeypatch.setenv("FRONTEND_URL", "http://front")
    return asyncio.run(auth.google_scopes_callback(state="s1", code="c", error=None))


# --- the callback gate --------------------------------------------------------

def test_unknown_address_gets_a_ticket_not_an_account(db, firebase, monkeypatch):
    resp = _run_callback(db, monkeypatch, EMAIL)

    location = urlparse(resp.headers["location"])
    assert location.path == "/join"
    ticket = parse_qs(location.query)["ticket"][0]
    stored = db.store[f"{auth.TESTER_TICKETS_COLLECTION}/{ticket}"]
    assert stored["email"] == EMAIL
    assert stored["refresh_token"] == "rt-1"
    # Nothing is created until they opt in.
    assert firebase["created"] == []
    assert db.under("lecturers") == {}


def test_allowlisted_address_signs_in_as_before(db, firebase, monkeypatch):
    db.store[f"lecturers/{EMAIL}"] = {"email": EMAIL}
    resp = _run_callback(db, monkeypatch, EMAIL)

    location = urlparse(resp.headers["location"])
    assert location.path == "/auth/callback"
    assert parse_qs(location.query)["custom_token"] == ["ct-u1"]
    assert db.under(auth.TESTER_TICKETS_COLLECTION) == {}


# --- redeeming the ticket -----------------------------------------------------

def test_get_returns_identity_but_never_the_refresh_token(db):
    _seed_ticket(db)
    data = asyncio.run(auth.get_tester_signup(TICKET))
    assert data == {"email": EMAIL, "name": "Tess Tester"}


def test_submit_adds_tester_and_signs_in(db, firebase):
    _seed_ticket(db)
    result = asyncio.run(auth.submit_tester_signup(auth.TesterSignupRequest(ticket=TICKET)))

    assert result == {"custom_token": "ct-u1"}
    entry = db.store[f"lecturers/{EMAIL}"]
    assert entry["source"] == "tester_form"
    assert entry["name"] == "Tess Tester"
    assert firebase["claims"] == {"u1": {"role": auth.LECTURER_ROLE}}
    assert db.under(auth.TESTER_TICKETS_COLLECTION) == {}


def test_ticket_is_single_use(db, firebase):
    _seed_ticket(db)
    asyncio.run(auth.submit_tester_signup(auth.TesterSignupRequest(ticket=TICKET)))
    with pytest.raises(HTTPException) as exc:
        asyncio.run(auth.submit_tester_signup(auth.TesterSignupRequest(ticket=TICKET)))
    assert exc.value.status_code == 404


def test_expired_ticket_is_refused_and_removed(db, firebase):
    _seed_ticket(db, expires_in=timedelta(minutes=-1))
    with pytest.raises(HTTPException) as exc:
        asyncio.run(auth.submit_tester_signup(auth.TesterSignupRequest(ticket=TICKET)))
    assert exc.value.status_code == 410
    assert db.under("lecturers") == {}
    assert db.under(auth.TESTER_TICKETS_COLLECTION) == {}


@pytest.mark.parametrize("bad", ["", "short", "../lecturers/x" + "a" * 20, "a/b" * 10])
def test_malformed_ticket_never_reaches_firestore(db, bad):
    with pytest.raises(HTTPException) as exc:
        asyncio.run(auth.get_tester_signup(bad))
    assert exc.value.status_code == 404
    assert db.store == {}
