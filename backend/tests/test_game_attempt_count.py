"""Counting finished attempts, for the pairs editor's warn-before-overwrite dialog.

The important behaviour here is the failure mode: a count that cannot be taken must
come back as None, not 0, because the caller treats "unknown" as a reason to warn.
"""

from __future__ import annotations

from unittest.mock import patch

from services.game_service import count_attempts, get_game_detail


class _Aggregation:
    def __init__(self, value: int):
        self._value = value

    def get(self):
        # google-cloud-firestore hands back a list of result rows, each a list of
        # aggregation results carrying .value — mirrored here so the production
        # indexing ([0][0].value) is what gets exercised.
        class _Result:
            value = self._value

        return [[_Result()]]


class _Query:
    def __init__(self, value: int):
        self._value = value

    def count(self):
        return _Aggregation(self._value)


class _Col:
    def __init__(self, value: int):
        self._value = value
        self.filtered_on: tuple | None = None

    def where(self, field, op, value):
        self.filtered_on = (field, op, value)
        return _Query(self._value)


def test_counts_attempts_for_the_game():
    col = _Col(12)
    with patch("services.game_service._attempts_col", return_value=col):
        assert count_attempts("game_abc") == 12
    assert col.filtered_on == ("assessmentId", "==", "game_abc")


def test_a_game_nobody_played_counts_zero():
    with patch("services.game_service._attempts_col", return_value=_Col(0)):
        assert count_attempts("game_abc") == 0


def test_a_failed_count_is_unknown_not_zero():
    """None and 0 mean different things to the editor: one warns, the other does not."""

    def _boom():
        raise RuntimeError("Firestore is unreachable")

    with patch("services.game_service._attempts_col", side_effect=_boom):
        assert count_attempts("game_abc") is None


def test_get_game_detail_carries_the_count_alongside_the_game():
    game = {"gameId": "game_abc", "title": "Project Management", "itemCount": 4}
    with (
        patch("services.game_service.get_game", return_value=game),
        patch("services.game_service.count_attempts", return_value=3),
    ):
        detail = get_game_detail("game_abc", "lecturer-1")

    assert detail["attemptCount"] == 3
    assert detail["title"] == "Project Management"
    assert detail["itemCount"] == 4


def test_get_game_detail_surfaces_an_unknown_count_rather_than_raising():
    game = {"gameId": "game_abc", "title": "Project Management"}
    with (
        patch("services.game_service.get_game", return_value=game),
        patch("services.game_service._attempts_col", side_effect=RuntimeError("down")),
    ):
        detail = get_game_detail("game_abc", "lecturer-1")

    assert detail["attemptCount"] is None


def test_get_game_detail_still_refuses_someone_elses_game():
    """Ownership is get_game's job; wrapping it must not open a hole."""
    from services.game_service import GameNotFoundError

    with patch(
        "services.game_service.get_game", side_effect=GameNotFoundError("denied")
    ):
        try:
            get_game_detail("game_abc", "not-the-owner")
        except GameNotFoundError:
            return
    raise AssertionError("expected GameNotFoundError")
