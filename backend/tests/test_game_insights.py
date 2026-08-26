"""The interpreted results panel.

These tests exist mostly to stop the interpretation drifting into an accusation.
The two that matter most are the ones pinning that a flawless run counts ONCE, and
that a student who never hid the tab is never flagged for away-time.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest

from services.game_insights_service import (
    HIGH_REWORK_FLOOR,
    LONG_ABSENCE_MS,
    build_game_insights,
)
from services.game_service import GameNotFoundError

_GAME = {
    "gameId": "game_abc",
    "batchId": "b1",
    "title": "Project Management",
    "items": [{"id": f"i{n}"} for n in range(30)],
}


class _Doc:
    def __init__(self, data):
        self._data = data

    def to_dict(self):
        return self._data


def _round(index: int, items: int = 6, submits: int = 1, first_wrong: int = 0,
           seconds: int = 50, away_seconds: int = 0, wrong_submits: int = 0):
    return {
        "roundIndex": index,
        "itemCount": items,
        "durationMs": seconds * 1000,
        "awayMs": away_seconds * 1000,
        "submitCount": submits,
        "wrongSubmitCount": wrong_submits,
        "totalWrongLinksOrPairs": first_wrong,
        "completed": True,
        "submissions": [{"durationMs": 30_000, "wrongCount": first_wrong}]
        + [{"durationMs": 5_000, "wrongCount": 0}] * (submits - 1),
    }


def _attempt(email: str, *, away_seconds: int = 0, wrong_submits: int = 0,
             rounds=None, timed_out: bool = False, rounds_completed=None,
             submit_count=None, player_uid: str = "uid-1", **extra):
    rounds = rounds if rounds is not None else [_round(i) for i in range(5)]
    total_rounds = len(rounds)
    behavior = {
        "submitCount": submit_count if submit_count is not None else total_rounds,
        "wrongSubmitCount": wrong_submits,
        "totalWrongLinksOrPairs": wrong_submits * 2,
        "reviewTimesMs": [5000],
        "durationMs": 500_000,
        "elapsedSinceStartMs": 520_000,
        "activePlayMs": 500_000,
        "awayMs": away_seconds * 1000,
        "awayCount": 1 if away_seconds else 0,
        "timedOut": timed_out,
        "timeLimitMs": 900_000,
        "totalRounds": total_rounds,
        "roundsCompleted": rounds_completed if rounds_completed is not None else total_rounds,
        "rounds": rounds,
    }
    behavior.update(extra.pop("behavior", {}))
    return {
        "playerUid": player_uid,
        "assessmentId": "game_abc",
        "email": email,
        "nickname": "Speedy",
        "oauthName": "A Student",
        "medalTier": "gold",
        "score": 30,
        "accuracy": 100,
        "chosenGameMode": "matching",
        "behavior": behavior,
        **extra,
    }


def _insights(attempts, roster=None):
    """Run the panel against a stubbed Firestore, asserting the query is filtered."""
    seen: dict = {}

    class _Query:
        def where(self, field, op, value):
            # test_game_results_export's harness ignores these; a panel that read
            # every attempt in the database would pass there and leak here.
            seen["filtered_on"] = (field, op, value)
            return self

        def stream(self):
            return [_Doc(item) for item in attempts]

    class _Client:
        def collection(self, name):
            seen["collection"] = name
            return _Query()

    class _Batch:
        batch_name = "Batch 2026"
        course_name = "Software Testing"

    default_roster = [
        {"email": "a@x.ac.th", "name": "Anong"},
        {"email": "b@x.ac.th", "name": "Boonmee"},
    ]
    with (
        patch("services.game_service.get_game", return_value=_GAME),
        patch("services.batch_service.get_batch", return_value=_Batch()),
        patch("services.game_service.get_firestore", return_value=_Client()),
        patch(
            "services.batch_service.list_students",
            return_value=default_roster if roster is None else roster,
        ),
    ):
        result = build_game_insights("game_abc", "lecturer-1")
    result["_seen"] = seen
    return result


def _by_email(result, email):
    return next(s for s in result["students"] if s["email"] == email)


# ─── The band ───────────────────────────────────────────────────────────────


def test_a_flawless_run_counts_as_one_signal_not_two():
    """first-try 100% and zero wrong submits are the SAME measurement.

    A round only ends once every pair on it is right, so a clean first submit ends
    the round — there is no path to one without the other. Counting both would put
    every strong student a band higher than the evidence supports.
    """
    result = _insights([_attempt("a@x.ac.th", wrong_submits=0)])
    student = _by_email(result, "a@x.ac.th")

    assert [s["id"] for s in student["signals"]] == ["flawless_run"]
    assert student["band"] == "one"


def test_the_band_is_the_number_of_signals_that_fired():
    result = _insights([_attempt("a@x.ac.th", away_seconds=200, wrong_submits=0)])
    student = _by_email(result, "a@x.ac.th")

    assert sorted(s["id"] for s in student["signals"]) == ["flawless_run", "long_absences"]
    assert student["band"] == "two"


def test_a_student_who_never_hid_the_tab_is_not_flagged_for_away_time():
    result = _insights([_attempt("a@x.ac.th", away_seconds=0, wrong_submits=5)])
    student = _by_email(result, "a@x.ac.th")

    assert student["signals"] == []
    assert student["band"] == "typical"


def test_a_brief_absence_under_the_threshold_does_not_fire():
    """No per-event floor exists in the recorder, so the threshold is all there is."""
    just_under = LONG_ABSENCE_MS // 1000 - 1
    result = _insights([_attempt("a@x.ac.th", away_seconds=just_under, wrong_submits=5)])

    assert _by_email(result, "a@x.ac.th")["signals"] == []


def test_a_zero_submit_attempt_is_not_a_flawless_run():
    """Never touching the board is not the same as getting everything right."""
    result = _insights([
        _attempt("a@x.ac.th", wrong_submits=0, submit_count=0, rounds_completed=0)
    ])

    assert _by_email(result, "a@x.ac.th")["signals"] == []


def test_an_unfinished_run_is_not_a_flawless_run():
    result = _insights([
        _attempt("a@x.ac.th", wrong_submits=0, rounds_completed=3, timed_out=True)
    ])
    student = _by_email(result, "a@x.ac.th")

    assert [s["id"] for s in student["signals"]] == []
    assert "ran_out_of_time" in student["flags"]


def test_the_away_signal_carries_the_class_comparator():
    """Away-heavy students score BETTER in real data; without the comparison the
    sentence reads as an accusation rather than a measurement."""
    result = _insights([
        _attempt("a@x.ac.th", away_seconds=200, wrong_submits=0),
        _attempt("b@x.ac.th", away_seconds=0, wrong_submits=6, player_uid="uid-2"),
    ])
    signal = next(
        s for s in _by_email(result, "a@x.ac.th")["signals"] if s["id"] == "long_absences"
    )

    assert signal["classMedianRealWorkSeconds"] is not None
    assert signal["realWorkSeconds"] is not None


# ─── Flags, which are a different question from the band ────────────────────


def test_running_out_of_time_is_a_flag_not_a_signal():
    """Needing help and may-have-had-help are opposite interventions."""
    result = _insights([
        _attempt("a@x.ac.th", timed_out=True, rounds_completed=2, wrong_submits=3)
    ])
    student = _by_email(result, "a@x.ac.th")

    assert "ran_out_of_time" in student["flags"]
    assert student["signals"] == []


def test_high_rework_never_drops_below_the_absolute_floor():
    """In a well-drilled class p90 can be 1, and flagging the calmest tail is noise."""
    result = _insights([
        _attempt("a@x.ac.th", wrong_submits=0),
        _attempt("b@x.ac.th", wrong_submits=1, player_uid="uid-2"),
    ])

    assert result["class"]["highReworkSubmits"] >= HIGH_REWORK_FLOOR
    assert _by_email(result, "b@x.ac.th")["flags"] == []


def test_struggling_is_measured_on_first_try_accuracy_not_final_accuracy():
    """`accuracy` is 100 by construction for anyone who finished."""
    rounds = [_round(i, first_wrong=5) for i in range(5)]
    result = _insights([_attempt("a@x.ac.th", rounds=rounds, wrong_submits=8)])
    student = _by_email(result, "a@x.ac.th")

    assert "struggling" in student["flags"]
    assert student["measures"]["firstTryAccuracyPercent"] < 50


# ─── Approach ───────────────────────────────────────────────────────────────


def test_a_student_with_no_wrong_submits_reads_as_a_planner():
    """Zero is falsy: an `or` fallback here would exclude the entire planner cohort."""
    result = _insights([_attempt("a@x.ac.th", wrong_submits=0)])

    assert _by_email(result, "a@x.ac.th")["approach"] == "planner"


def test_heavy_resubmitting_reads_as_trial_and_error():
    attempts = [_attempt("a@x.ac.th", wrong_submits=0)]
    attempts += [
        _attempt(f"s{n}@x.ac.th", wrong_submits=n, player_uid=f"uid-{n}") for n in range(1, 12)
    ]
    roster = [{"email": "a@x.ac.th", "name": "Anong"}] + [
        {"email": f"s{n}@x.ac.th", "name": f"S{n}"} for n in range(1, 12)
    ]
    result = _insights(attempts, roster=roster)

    assert _by_email(result, "s11@x.ac.th")["approach"] == "trial_and_error"


# ─── The roster join ────────────────────────────────────────────────────────


def test_roster_students_with_no_attempt_come_back_as_never_played():
    result = _insights([_attempt("a@x.ac.th")])
    student = _by_email(result, "b@x.ac.th")

    assert student["played"] is False
    assert student["band"] is None
    assert student["flags"] == ["never_played"]
    assert result["class"]["neverPlayedCount"] == 1


def test_never_played_students_sort_last():
    result = _insights([_attempt("b@x.ac.th", player_uid="uid-2")])

    assert result["students"][-1]["email"] == "a@x.ac.th"
    assert result["students"][-1]["played"] is False


def test_a_player_who_left_the_roster_still_appears_with_a_usable_key():
    """Two emailless attempts would otherwise collide as one client-side key."""
    result = _insights([
        _attempt("", player_uid="uid-ghost-1"),
        _attempt("", player_uid="uid-ghost-2"),
    ])
    ghosts = [s for s in result["students"] if not s["onRoster"]]

    assert len(ghosts) == 2
    assert {g["playerUid"] for g in ghosts} == {"uid-ghost-1", "uid-ghost-2"}


def test_an_empty_roster_still_reports_the_students_who_played():
    """A stale batchId makes list_students return [] rather than raising."""
    result = _insights([_attempt("a@x.ac.th")], roster=[])

    assert result["class"]["playedCount"] == 1
    assert result["class"]["rosterCount"] == 0
    assert result["class"]["neverPlayedCount"] == 0


def test_class_medians_ignore_students_who_never_played():
    """A blank row must not drag the median everyone else is compared against."""
    result = _insights([_attempt("a@x.ac.th", wrong_submits=4)])

    assert result["class"]["playedCount"] == 1
    assert result["class"]["medianWrongSubmits"] == 4


# ─── Shape and access ───────────────────────────────────────────────────────


def test_final_accuracy_is_never_exposed():
    """It is 100 for everyone who finished; in the UI it would read as a perfect class."""
    result = _insights([_attempt("a@x.ac.th")])
    measures = _by_email(result, "a@x.ac.th")["measures"]

    assert "accuracy" not in measures
    assert "accuracyPercent" not in measures


def test_real_work_never_goes_negative():
    """awayNow() folds an in-progress hidden spell in after round durations are stamped."""
    result = _insights([
        _attempt("a@x.ac.th", behavior={"activePlayMs": 100_000, "awayMs": 400_000})
    ])

    assert _by_email(result, "a@x.ac.th")["measures"]["realWorkSeconds"] >= 0


def test_the_attempts_query_is_filtered_to_this_game():
    result = _insights([_attempt("a@x.ac.th")])

    assert result["_seen"]["collection"] == "attempts"
    assert result["_seen"]["filtered_on"] == ("assessmentId", "==", "game_abc")


def test_insights_never_reach_another_lecturers_game():
    with patch(
        "services.game_service.get_game", side_effect=GameNotFoundError("denied")
    ):
        with pytest.raises(GameNotFoundError):
            build_game_insights("game_abc", "not-the-owner")


def test_the_thresholds_ship_with_the_payload():
    """The panel states its own rules, and there is one place to change them."""
    result = _insights([_attempt("a@x.ac.th")])
    thresholds = result["class"]["thresholds"]

    assert thresholds["longAbsenceSeconds"] == LONG_ABSENCE_MS // 1000
    assert "highReworkSubmits" in thresholds


def test_review_pauses_are_counted_not_just_averaged():
    """A median is unreadable without knowing how many values it is over."""
    result = _insights([
        _attempt("a@x.ac.th", behavior={"reviewTimesMs": [4000, 6000, 8000]})
    ])
    assert _by_email(result, "a@x.ac.th")["measures"]["reviewCount"] == 3


def test_no_review_pauses_counts_zero_rather_than_unknown():
    """0 lets the panel say "no pauses recorded"; None would render an em dash,
    which means "we could not tell" — a different claim entirely."""
    result = _insights([_attempt("a@x.ac.th", behavior={"reviewTimesMs": []})])
    measures = _by_email(result, "a@x.ac.th")["measures"]

    assert measures["reviewCount"] == 0
    assert measures["medianReviewSeconds"] is None


def test_every_row_gets_an_id_even_without_a_player_uid():
    """Roster students carry no playerUid, and "" is not an identity.

    When they all fell through to the empty string, the panel matched the first
    of them on every click and painted every never-played row as selected.
    """
    result = _insights([], roster=[
        {"email": "a@x.ac.th", "name": "Anong"},
        {"email": "b@x.ac.th", "name": "Boonmee"},
    ])
    ids = [student["rowId"] for student in result["students"]]

    assert all(ids), "an empty rowId is not an identity"
    assert len(set(ids)) == len(ids), "two rows must never share an id"


def test_a_played_row_keeps_its_real_player_uid():
    """rowId is identity; playerUid stays the actual Firebase uid."""
    result = _insights([_attempt("a@x.ac.th", player_uid="uid-real")])
    student = _by_email(result, "a@x.ac.th")

    assert student["playerUid"] == "uid-real"
    assert student["rowId"] == "uid-real"


def test_a_never_played_row_has_no_player_uid_but_still_has_an_id():
    result = _insights([])
    student = _by_email(result, "a@x.ac.th")

    assert student["playerUid"] == ""
    assert student["rowId"] == "a@x.ac.th"


def test_two_emailless_attempts_do_not_collide():
    """The off-roster case: no email, so the uid has to carry the identity."""
    result = _insights([
        _attempt("", player_uid="ghost-1"),
        _attempt("", player_uid="ghost-2"),
    ])
    ghosts = [s for s in result["students"] if not s["onRoster"]]

    assert {g["rowId"] for g in ghosts} == {"ghost-1", "ghost-2"}
