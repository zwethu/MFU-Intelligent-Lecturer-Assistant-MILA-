"""Editing a live game's pairs.

The lecturer's details page sends the WHOLE board on save, not a per-row patch, so
these tests pin the three derived fields that must move with it — ids, itemCount and
contentHash — and the two that must not: deadlineAt and expiresAt.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from pydantic import ValidationError

from entity.GameSession import (
    MAX_GAME_ITEMS,
    MIN_GAME_ITEMS,
    GameItemModel,
    UpdateGameRequest,
)
from services.game_service import _hash_content, update_game


def _items(*pairs: tuple[str, str]) -> list[GameItemModel]:
    return [GameItemModel(term=t, definition=d) for t, d in pairs]


def _n_items(count: int) -> list[GameItemModel]:
    return _items(*((f"term {i}", f"definition {i}") for i in range(count)))


def _capture_update(payload: UpdateGameRequest, existing: dict | None = None) -> dict:
    """Run update_game against stubbed Firestore and return the dict it wrote."""
    updates: dict = {}

    class _Ref:
        def update(self, data):
            updates.update(data)

    class _Col:
        def document(self, _doc_id):
            return _Ref()

    existing = existing or {"gameId": "game_abc", "title": "Project Management"}
    with (
        patch("services.game_service._games_col", return_value=_Col()),
        patch("services.game_service.get_game", return_value=existing),
        patch("services.game_service.get_game_detail", return_value=existing),
    ):
        update_game("game_abc", "lecturer-1", payload)
    return updates


# ─── What an items edit writes ──────────────────────────────────────────────


def test_items_edit_renumbers_ids_positionally():
    """Ids follow position, so a reordered board renumbers rather than carrying ids.

    Safe only because nothing stores an item id outside the running game — see the
    note on _with_item_ids.
    """
    updates = _capture_update(
        UpdateGameRequest(
            items=_items(
                ("Gantt chart", "A bar chart of the schedule"),
                ("Scope creep", "Uncontrolled growth in scope"),
                ("Milestone", "A checkpoint with no duration"),
                ("Critical path", "The longest dependent sequence"),
            )
        )
    )

    assert [item["id"] for item in updates["items"]] == [
        "item_1",
        "item_2",
        "item_3",
        "item_4",
    ]
    assert updates["items"][0]["term"] == "Gantt chart"
    assert updates["items"][3]["definition"] == "The longest dependent sequence"


def test_items_edit_recomputes_the_denormalised_count():
    """Every game row in the UI reads itemCount without loading items."""
    updates = _capture_update(UpdateGameRequest(items=_n_items(7)))
    assert updates["itemCount"] == 7


def test_items_edit_recomputes_the_content_hash_without_ids():
    pairs = (
        ("Alpha", "First"),
        ("Beta", "Second"),
        ("Gamma", "Third"),
        ("Delta", "Fourth"),
    )
    updates = _capture_update(UpdateGameRequest(items=_items(*pairs)))

    expected = _hash_content(
        {
            "title": "Project Management",
            "items": [{"term": t, "definition": d} for t, d in pairs],
        }
    )
    assert updates["contentHash"] == expected


def test_reordering_the_same_pairs_changes_the_hash():
    """The board's order is content: it decides which pairs share a round."""
    pairs = [
        ("Alpha", "First"),
        ("Beta", "Second"),
        ("Gamma", "Third"),
        ("Delta", "Fourth"),
    ]
    first = _capture_update(UpdateGameRequest(items=_items(*pairs)))
    reordered = [pairs[1], pairs[0], pairs[2], pairs[3]]
    second = _capture_update(UpdateGameRequest(items=_items(*reordered)))

    assert first["contentHash"] != second["contentHash"]


def test_resaving_an_unchanged_board_leaves_the_hash_alone():
    """Renumbering must not leak into the hash, or an idle save would look like an edit."""
    pairs = [
        ("Alpha", "First"),
        ("Beta", "Second"),
        ("Gamma", "Third"),
        ("Delta", "Fourth"),
    ]
    first = _capture_update(UpdateGameRequest(items=_items(*pairs)))
    again = _capture_update(UpdateGameRequest(items=_items(*pairs)))

    assert first["contentHash"] == again["contentHash"]


def test_items_edit_leaves_the_schedule_alone():
    """Changing the questions is not a change to when the game is playable."""
    updates = _capture_update(UpdateGameRequest(items=_n_items(5)))
    assert "deadlineAt" not in updates
    assert "expiresAt" not in updates
    assert "status" not in updates


def test_deadline_only_update_does_not_touch_items():
    """Regression: the pre-existing deadline path must not start writing items."""
    deadline = datetime.now(timezone.utc) + timedelta(days=30)
    updates = _capture_update(
        UpdateGameRequest(deadline_at=deadline),
        existing={"gameId": "game_abc", "expiresAt": "2099-01-01T00:00:00+00:00"},
    )
    assert "items" not in updates
    assert "itemCount" not in updates
    assert "contentHash" not in updates
    assert updates["deadlineAt"] == deadline


def test_items_and_status_can_move_together():
    updates = _capture_update(UpdateGameRequest(items=_n_items(4), status="closed"))
    assert updates["itemCount"] == 4
    assert updates["status"] == "closed"


# ─── What the request model refuses ─────────────────────────────────────────


def test_an_items_only_update_is_not_empty():
    """Regression on validate_not_empty, which predates the items field."""
    assert UpdateGameRequest(items=_n_items(MIN_GAME_ITEMS)).items is not None


def test_below_the_minimum_is_rejected():
    with pytest.raises(ValidationError, match="between"):
        UpdateGameRequest(items=_n_items(MIN_GAME_ITEMS - 1))


def test_above_the_maximum_is_rejected():
    with pytest.raises(ValidationError, match="between"):
        UpdateGameRequest(items=_n_items(MAX_GAME_ITEMS + 1))


def test_duplicate_terms_are_rejected_case_insensitively():
    """Two cards with the same term are one question with two right answers."""
    with pytest.raises(ValidationError, match="duplicate term"):
        UpdateGameRequest(
            items=_items(
                ("Scope creep", "One"),
                ("scope CREEP", "Two"),
                ("Milestone", "Three"),
                ("Critical path", "Four"),
            )
        )


def test_a_term_that_is_only_whitespace_is_rejected():
    with pytest.raises(ValidationError):
        UpdateGameRequest(
            items=_items(
                ("   ", "One"),
                ("Beta", "Two"),
                ("Gamma", "Three"),
                ("Delta", "Four"),
            )
        )


def test_surrounding_whitespace_is_stripped_before_saving():
    updates = _capture_update(
        UpdateGameRequest(
            items=_items(
                ("  Scope creep  ", "  Uncontrolled growth  "),
                ("Beta", "Two"),
                ("Gamma", "Three"),
                ("Delta", "Four"),
            )
        )
    )
    assert updates["items"][0]["term"] == "Scope creep"
    assert updates["items"][0]["definition"] == "Uncontrolled growth"


def test_duplicate_terms_differing_only_by_whitespace_are_rejected():
    """Stripping happens first, so " Alpha " and "Alpha" collide."""
    with pytest.raises(ValidationError, match="duplicate term"):
        UpdateGameRequest(
            items=_items(
                ("Alpha", "One"),
                ("  Alpha  ", "Two"),
                ("Gamma", "Three"),
                ("Delta", "Four"),
            )
        )
