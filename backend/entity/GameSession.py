from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

# Kept in sync with mila/agents/game/schemas.py — the agent validates against the same
# bounds before staging, so a payload that reaches here should already satisfy them.
# Re-validating is deliberate: the pending artifact is agent-authored input, and the
# backend is the only writer of gameSessions.
MIN_GAME_ITEMS = 4
MAX_GAME_ITEMS = 40

# Play modes a created game supports. gameModeStats is seeded with a zero counter per
# mode so the player app can increment without first creating the key. These exact
# spellings are the stored document's keys — "ropelink", not "rope_link".
GAME_MODES = ("bucket", "matching", "ropelink")

# A created game stays playable for this long unless the caller asks for a shorter life.
DEFAULT_GAME_TTL_DAYS = 30

# Grace between a lecturer's deadline and the record's own retirement, so a game is
# never swept away by its TTL while students are still allowed to play it.
TTL_GRACE_DAYS_AFTER_DEADLINE = 7


def _require_aware_future(value: datetime | None) -> datetime | None:
    """Normalise a client-supplied deadline to UTC and reject one in the past.

    A naive datetime is read as UTC: the browser sends an ISO string with an offset,
    so a missing one means a caller that never thought about zones, and guessing the
    server's local zone would silently shift the deadline by hours.
    """
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    value = value.astimezone(timezone.utc)
    if value <= datetime.now(timezone.utc):
        raise ValueError("deadline must be in the future")
    return value


class GameItemModel(BaseModel):
    """One playable card: a term and its definition."""

    term: str = Field(min_length=1, max_length=300)
    definition: str = Field(min_length=1, max_length=2000)

    @field_validator("term", "definition")
    @classmethod
    def strip_text(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("term and definition cannot be blank")
        return cleaned


def validate_item_set(items: list[GameItemModel]) -> None:
    """Enforce the two whole-board rules: how many pairs, and no repeated term.

    Shared by the agent-staged content (``GameContent``) and by a lecturer's later
    edit (``UpdateGameRequest``) so the two can never drift into disagreeing about
    what a valid board is. Per-item length and blankness are already handled by
    ``GameItemModel``.

    A repeated term is rejected case-insensitively because the matching modes key
    on the term: two cards reading "Scope creep" and "scope creep" are one question
    with two right answers, which is unplayable rather than merely untidy.
    """
    if not MIN_GAME_ITEMS <= len(items) <= MAX_GAME_ITEMS:
        raise ValueError(
            f"a game needs between {MIN_GAME_ITEMS} and {MAX_GAME_ITEMS} pairs"
        )
    seen: set[str] = set()
    for item in items:
        key = item.term.lower()
        if key in seen:
            raise ValueError(f"duplicate term: {item.term!r}")
        seen.add(key)


class GameContent(BaseModel):
    """The agent-authored game content carried on the pending artifact."""

    title: str = Field(min_length=1, max_length=300)
    items: list[GameItemModel] = Field(min_length=MIN_GAME_ITEMS, max_length=MAX_GAME_ITEMS)

    @field_validator("title")
    @classmethod
    def strip_title(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("title cannot be blank")
        return cleaned

    @model_validator(mode="after")
    def validate_unique_terms(self) -> "GameContent":
        # The Field(min_length=…, max_length=…) above already covers the count for
        # this model; validate_item_set re-checks it harmlessly and is the single
        # place the rule lives for the edit path, which cannot use Field bounds.
        validate_item_set(self.items)
        return self


class CreateGameRequest(BaseModel):
    """Terminal action for game.generate: turn a staged game into a playable session.

    The content is NOT accepted from the client — it is read from the run's pending
    artifact, so the lecturer's click can only create the game the agent actually staged.
    ``content_hash`` is an optional guard so a stale button cannot create a game from a
    preview the lecturer is no longer looking at.
    """

    chat_id: str = Field(min_length=1, max_length=200)
    run_id: str = Field(min_length=1, max_length=200)
    content_hash: str = Field(default="", max_length=128)
    ttl_days: int | None = Field(default=None, ge=1, le=365)
    # When students can no longer play. Distinct from expiresAt, which retires the
    # record itself: a lecturer extending a due date should not have to think about
    # data lifetime, so the TTL follows the deadline rather than capping it.
    deadline_at: datetime | None = None

    _check_deadline = field_validator("deadline_at")(_require_aware_future)


class UpdateGameRequest(BaseModel):
    """Lecturer edits to a live game: the pairs, the deadline, or open/closed.

    Every field is optional and ``None`` means "leave alone", so clearing a deadline
    needs the explicit ``clear_deadline`` flag rather than a null that cannot be told
    apart from an omitted key.

    ``items`` is the WHOLE board in play order, not a patch of individual rows: the
    editor sends what the game should now contain, and the service replaces the array
    wholesale. Item ids are not accepted — the backend assigns them (see
    ``_with_item_ids``), so a client cannot invent or collide them.
    """

    deadline_at: datetime | None = None
    clear_deadline: bool = False
    status: Literal["open", "closed"] | None = None
    # No Field(min_length=…) here: length bounds on an ``X | None`` annotation are a
    # pydantic-v2 nullable-schema hazard, so the count is checked in the validator
    # below via the same helper the create path uses.
    items: list[GameItemModel] | None = None

    _check_deadline = field_validator("deadline_at")(_require_aware_future)

    @model_validator(mode="after")
    def validate_not_empty(self) -> "UpdateGameRequest":
        if (
            self.deadline_at is None
            and not self.clear_deadline
            and self.status is None
            and self.items is None
        ):
            raise ValueError("nothing to update")
        if self.deadline_at is not None and self.clear_deadline:
            raise ValueError("cannot set and clear the deadline at once")
        if self.items is not None:
            validate_item_set(self.items)
        return self
