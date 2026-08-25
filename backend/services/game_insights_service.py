"""Turn one game's raw attempts into something a lecturer can read at a glance.

The CSV this replaces is 43 columns wide and correct; the complaint was never the
data, it was that nothing in it says what to DO. This module does the interpretation
the lecturer was doing by eye — who never opened it, who is stuck, how the class went
about it, and the short list of runs worth asking about.

Three deliberate limits, because the alternative is a tool that accuses students:

1. **No probability.** Nothing here has ever been labelled "used AI" or "didn't", so a
   percentage would have nothing to be a percentage of. What ships is the count of
   named signals that fired, each carrying the measurement behind it.
2. **Signals must be independent.** ``first_try_accuracy >= 95%`` and
   ``wrongSubmitCount == 0`` are the SAME measurement — a round only ends once every
   pair on it is right, so a clean first submit ends the round. Counting both would
   inflate every flagged student by one. They count once, as ``flawless_run``.
3. **Help-needed is not the same question as may-have-had-help.** Those are opposite
   interventions, so ``flags`` are kept out of the band entirely: a lecturer reading a
   single merged score cannot tell which one it is asking for.

Every threshold here was set against 98 real attempts on a live game, not guessed.
The distribution that mattered most: away-time is bimodal (52% of students never hid
the tab; median 0s, p75 95s), and the students who DID leave scored *better*
(81% first-try vs 59%). That is why the away sentence always carries the class
comparator, and why the band tops out at a plain count rather than a verdict.
"""

from __future__ import annotations

import logging
import statistics
from typing import Any

from services.game_service import collect_result_pairs

logger = logging.getLogger(__name__)

# ─── Thresholds ─────────────────────────────────────────────────────────────
# Shipped to the client in `class.thresholds` so the panel can state its own rules,
# and so there is exactly one place to change them. Deliberately NOT lecturer-tunable:
# a tunable threshold is a lecturer inventing a private evidence standard.

# Three pairs' worth of the game's own clock (gameTiming allows 30s per pair).
# Absolute rather than percentile because the median IS zero — every percentile
# below p52 collapses onto the same cut and bands nothing.
LONG_ABSENCE_MS = 90_000

# A round counts as "one they were away for" only past this. The recorder has NO
# minimum: awayMs comes from `visibilitychange` alone, so a 200ms alt-tab is a full
# event. Without a floor here, "away in 4 rounds" could mean four flickers.
ROUND_ABSENCE_MS = 20_000

# Wrong submits that mean "this one is not landing". Class p90, but never below this:
# in a well-drilled class p90 can be 1, and flagging the best-behaved tail is noise.
HIGH_REWORK_FLOOR = 6

# Approach classification (docs/game-results-csv.md's own archetypes).
#
# Resubmits, NOT the gap between them. The doc's Pim archetype quotes "gaps 4-6s",
# but in 98 real attempts the trial-and-error group's median gap is 16.7s — a 6s cut
# classified one student out of ninety-eight. Resubmit count separates cleanly on the
# same data: planner 96.4% first-try accuracy, trial-and-error 29.2%, a 67-point gap.
# The gap still earns its place in the sentence (75.3s vs 16.7s), just not in the rule.
PLANNER_MAX_WRONG_SUBMITS = 2

# "This student did not know the material", as distinct from "did not finish".
STRUGGLING_FIRST_TRY_PERCENT = 50


def _secs(ms: Any) -> int | None:
    return round(ms / 1000) if isinstance(ms, (int, float)) else None


def _secs1(ms: Any) -> float | None:
    return round(ms / 1000, 1) if isinstance(ms, (int, float)) else None


def _percentile(values: list[float], fraction: float) -> float | None:
    """Nearest-rank percentile. Small n, so no interpolation and no numpy."""
    if not values:
        return None
    ordered = sorted(values)
    index = min(len(ordered) - 1, int(len(ordered) * fraction))
    return ordered[index]


def _median(values: list[float]) -> float | None:
    return statistics.median(values) if values else None


def _first_try_accuracy(rounds: list[dict[str, Any]]) -> int | None:
    """Percent right on the FIRST submit, over rounds they actually reached.

    Same arithmetic as the CSV's first_try_accuracy_percent — rounds the clock cut
    off before a single submit are excluded rather than scored zero, because never
    seeing a board is not the same as getting it wrong.
    """
    attempted = 0
    wrong = 0
    for entry in rounds:
        submissions = entry.get("submissions") or []
        if not submissions:
            continue
        attempted += int(entry.get("itemCount") or 0)
        wrong += int(submissions[0].get("wrongCount") or 0)
    return round((attempted - wrong) / attempted * 100) if attempted else None


def _submit_gaps_ms(rounds: list[dict[str, Any]]) -> list[float]:
    return [
        submission["durationMs"]
        for entry in rounds
        for submission in (entry.get("submissions") or [])
        if isinstance(submission, dict) and isinstance(submission.get("durationMs"), (int, float))
    ]


def _measures(attempt: dict[str, Any], total_questions: int) -> dict[str, Any]:
    """Every number the panel can show for one played attempt."""
    behavior = attempt.get("behavior") or {}
    rounds = [entry for entry in (behavior.get("rounds") or []) if isinstance(entry, dict)]

    play_ms = behavior.get("activePlayMs")
    away_ms = behavior.get("awayMs")
    # Clamped at zero: awayNow() folds an in-progress hidden spell into the session
    # total AFTER each round's duration was stamped, so a student hidden when the
    # clock ran out can produce a negative difference. Never observed in real data,
    # but "−12s of real work" is not a thing to show a lecturer.
    real_work_ms = (
        max(0, play_ms - away_ms)
        if isinstance(play_ms, (int, float)) and isinstance(away_ms, (int, float))
        else play_ms
    )

    wrong_pairs = behavior.get("totalWrongLinksOrPairs")
    trial_accuracy = (
        round(total_questions / (total_questions + wrong_pairs) * 100)
        if isinstance(wrong_pairs, int) and total_questions
        else None
    )

    gaps = _submit_gaps_ms(rounds)
    reviews = [v for v in (behavior.get("reviewTimesMs") or []) if isinstance(v, (int, float))]

    return {
        "firstTryAccuracyPercent": _first_try_accuracy(rounds),
        "trialAccuracyPercent": trial_accuracy,
        "medal": str(attempt.get("medalTier") or ""),
        "gameMode": str(attempt.get("chosenGameMode") or ""),
        "correctCount": attempt.get("score"),
        "submitCount": behavior.get("submitCount"),
        "wrongSubmitCount": behavior.get("wrongSubmitCount"),
        "wrongPairs": wrong_pairs,
        "realWorkSeconds": _secs(real_work_ms),
        "playSeconds": _secs(play_ms),
        "awaySeconds": _secs(away_ms),
        "awayCount": behavior.get("awayCount"),
        "wallClockSeconds": _secs(behavior.get("elapsedSinceStartMs")),
        "timeLimitSeconds": _secs(behavior.get("timeLimitMs")),
        # Board shown → first touch, on the FIRST round only. One sample; it informs
        # the approach read and is never a flag on its own.
        "planningSeconds": _secs1(behavior.get("firstActionDelayMs")),
        # Median, never mean: a round's gaps include any time the tab was hidden
        # during it, so one three-minute absence drags a mean straight into "planner".
        "medianSubmitGapSeconds": _secs1(_median(gaps)),
        "medianReviewSeconds": _secs1(_median(reviews)),
        "timedOut": bool(behavior.get("timedOut")),
        "roundsCompleted": behavior.get("roundsCompleted"),
        "totalRounds": behavior.get("totalRounds"),
        "completedAt": attempt.get("completedAt"),
        # `accuracy` is deliberately absent. It is 100 by construction for anyone who
        # finished, so surfacing it would make the panel read "everyone scored 100%".
        # Keeping it out of the payload is what stops it reaching the UI at all.
    }


def _round_strip(attempt: dict[str, Any]) -> list[dict[str, Any]]:
    """Per-round work-vs-away, the shape the drilldown bar renders."""
    behavior = attempt.get("behavior") or {}
    strip = []
    for entry in behavior.get("rounds") or []:
        if not isinstance(entry, dict):
            continue
        duration = entry.get("durationMs") or 0
        away = entry.get("awayMs") or 0
        strip.append(
            {
                "index": int(entry.get("roundIndex") or 0),
                "seconds": _secs(duration),
                "awaySeconds": _secs(away),
                "realWorkSeconds": _secs(max(0, duration - away)),
                "submits": entry.get("submitCount"),
                "wrongSubmits": entry.get("wrongSubmitCount"),
                "itemCount": entry.get("itemCount"),
                "completed": bool(entry.get("completed")),
            }
        )
    return strip


def _signals(
    attempt: dict[str, Any], measures: dict[str, Any], class_stats: dict[str, Any]
) -> list[dict[str, Any]]:
    """The independent signals that fired, each carrying its own evidence.

    Each signal ships the numbers behind it AND the class comparator, so the client
    writes a factual sentence rather than looking up a canned string by id.
    """
    behavior = attempt.get("behavior") or {}
    found: list[dict[str, Any]] = []

    away_ms = behavior.get("awayMs")
    if isinstance(away_ms, (int, float)) and away_ms >= LONG_ABSENCE_MS:
        rounds_away = sum(
            1
            for entry in (behavior.get("rounds") or [])
            if isinstance(entry, dict) and (entry.get("awayMs") or 0) >= ROUND_ABSENCE_MS
        )
        found.append(
            {
                "id": "long_absences",
                "awaySeconds": _secs(away_ms),
                "roundsAway": rounds_away,
                "realWorkSeconds": measures["realWorkSeconds"],
                "classMedianRealWorkSeconds": class_stats.get("medianRealWorkSeconds"),
            }
        )

    # ONE signal. first_try_accuracy >= 95% selects the identical set by construction:
    # a round ends the moment every pair on it is right, so there is no path to a
    # clean first submit with wrong submits, or the reverse. The submitCount guard
    # stops a zero-submit ghost row scoring as a perfect run.
    submits = behavior.get("submitCount")
    rounds_done = behavior.get("roundsCompleted")
    rounds_total = behavior.get("totalRounds")
    if (
        behavior.get("wrongSubmitCount") == 0
        and rounds_done is not None
        and rounds_done == rounds_total
        and isinstance(submits, int)
        and isinstance(rounds_total, int)
        and submits >= rounds_total
        and rounds_total > 0
    ):
        found.append(
            {
                "id": "flawless_run",
                "firstTryAccuracy": measures["firstTryAccuracyPercent"],
                "submits": submits,
                "rounds": rounds_total,
                "classMedianFirstTryAccuracy": class_stats.get("medianFirstTryAccuracy"),
            }
        )

    return found


def _flags(measures: dict[str, Any], class_stats: dict[str, Any]) -> list[str]:
    """Who needs HELP — kept out of the band, which is a different question."""
    flags: list[str] = []

    if measures["timedOut"] or (
        isinstance(measures["roundsCompleted"], int)
        and isinstance(measures["totalRounds"], int)
        and measures["roundsCompleted"] < measures["totalRounds"]
    ):
        flags.append("ran_out_of_time")

    wrong_submits = measures["wrongSubmitCount"]
    if isinstance(wrong_submits, int) and wrong_submits >= class_stats["highReworkSubmits"]:
        flags.append("high_rework")

    first_try = measures["firstTryAccuracyPercent"]
    if isinstance(first_try, int) and first_try < STRUGGLING_FIRST_TRY_PERCENT:
        flags.append("struggling")

    return flags


def _approach(measures: dict[str, Any], class_stats: dict[str, Any]) -> str:
    """How they went about it. Descriptive only — none of these is better.

    Note the comparison style: an explicit ``is None`` check, never ``or``. A student
    with zero wrong submits is the whole planner cohort, and ``wrong_submits or 99``
    would silently exclude every one of them — 0 is falsy.
    """
    wrong_submits = measures["wrongSubmitCount"]
    if not isinstance(wrong_submits, int):
        return "steady"

    if wrong_submits <= PLANNER_MAX_WRONG_SUBMITS:
        return "planner"

    # Class-relative, so it scales with the board: 10 resubmits means something
    # different on a 6-pair game and a 40-pair one.
    heavy = class_stats.get("heavyReworkSubmits")
    if isinstance(heavy, (int, float)) and wrong_submits >= heavy:
        return "trial_and_error"

    return "steady"


def _band(signal_count: int) -> str:
    """The band IS the count. Decided once, here — the client only maps it to a word.

    Cut at two rather than one on purpose: in the sample, one-signal fires for 21% of
    the class. A queue that size is not a queue, it is the class.
    """
    if signal_count >= 2:
        return "two"
    if signal_count == 1:
        return "one"
    return "typical"


def build_game_insights(game_id: str, lecturer_id: str) -> dict[str, Any]:
    """Interpreted results for one game.

    Raises GameNotFoundError when the game is missing or belongs to someone else —
    ownership rides on collect_result_pairs' get_game call.
    """
    game, _batch_name, total_questions, pairs = collect_result_pairs(game_id, lecturer_id)

    # Pass 1 — the numbers, per student.
    people: list[dict[str, Any]] = []
    for student, attempt in pairs:
        base = {
            # playerUid first: an attempt with no email would otherwise collide with
            # every other emailless one as a client-side key.
            "playerUid": str(
                (attempt or {}).get("playerUid") or student.get("playerUid") or ""
            ),
            "email": str(student.get("email") or (attempt or {}).get("email") or ""),
            "rosterName": str(student.get("name") or ""),
            "nickname": str((attempt or {}).get("nickname") or ""),
            "onRoster": not student.get("off_roster", False),
        }
        if not attempt:
            people.append({**base, "played": False, "band": None, "signals": [],
                           "flags": ["never_played"], "approach": None,
                           "measures": None, "rounds": []})
            continue
        people.append(
            {
                **base,
                "played": True,
                "measures": _measures(attempt, total_questions),
                "rounds": _round_strip(attempt),
                "_attempt": attempt,
            }
        )

    played = [p for p in people if p["played"]]

    # Pass 2 — the class, over played rows only. A student who never opened the game
    # must not drag the median that everyone else is compared against.
    def column(key: str) -> list[float]:
        return [p["measures"][key] for p in played if isinstance(p["measures"][key], (int, float))]

    wrong_submits = column("wrongSubmitCount")
    away_values = [v for v in column("awaySeconds") if v > 0]
    class_stats: dict[str, Any] = {
        "medianFirstTryAccuracy": _median(column("firstTryAccuracyPercent")),
        "medianRealWorkSeconds": _median(column("realWorkSeconds")),
        "medianWrongSubmits": _median(wrong_submits),
        "medianSubmitGapSeconds": _median(column("medianSubmitGapSeconds")),
        # p90 with a floor — see HIGH_REWORK_FLOOR.
        "highReworkSubmits": max(HIGH_REWORK_FLOOR, _percentile(wrong_submits, 0.9) or 0),
        # p75, the "kept resubmitting" cohort. Separate from highReworkSubmits (p90,
        # a help-needed flag): this one only names an approach, so it casts wider.
        "heavyReworkSubmits": max(
            PLANNER_MAX_WRONG_SUBMITS + 1, _percentile(wrong_submits, 0.75) or 0
        ),
        # Away-time is bimodal, so a plain median reads as 0 and says nothing. The
        # count of students who never left, and the median AMONG those who did, are
        # the two numbers that actually describe it.
        "neverAwayCount": sum(1 for p in played if not p["measures"]["awaySeconds"]),
        "awayMedianSecondsAmongAway": _median(away_values),
    }

    # Pass 3 — band, flags and approach, now that the class is known.
    for person in played:
        attempt = person.pop("_attempt")
        person["signals"] = _signals(attempt, person["measures"], class_stats)
        person["band"] = _band(len(person["signals"]))
        person["flags"] = _flags(person["measures"], class_stats)
        person["approach"] = _approach(person["measures"], class_stats)

    def tally(key: str, values: list[str]) -> dict[str, int]:
        return {value: sum(1 for p in played if p.get(key) == value) for value in values}

    class_stats.update(
        {
            "rosterCount": sum(1 for p in people if p["onRoster"]),
            "playedCount": len(played),
            "neverPlayedCount": sum(1 for p in people if not p["played"]),
            "timedOutCount": sum(1 for p in played if p["measures"]["timedOut"]),
            "bands": tally("band", ["typical", "one", "two"]),
            "approaches": tally("approach", ["planner", "trial_and_error", "steady"]),
            "flags": {
                flag: sum(1 for p in people if flag in p["flags"])
                for flag in ("ran_out_of_time", "high_rework", "struggling", "never_played")
            },
            "thresholds": {
                "longAbsenceSeconds": LONG_ABSENCE_MS // 1000,
                "roundAbsenceSeconds": ROUND_ABSENCE_MS // 1000,
                "highReworkSubmits": class_stats["highReworkSubmits"],
                "strugglingFirstTryPercent": STRUGGLING_FIRST_TRY_PERCENT,
            },
        }
    )

    # Most signals first, then alphabetical; never-played last, since they are a
    # separate errand rather than the bottom of the ranking.
    band_order = {"two": 0, "one": 1, "typical": 2}
    people.sort(
        key=lambda p: (
            0 if p["played"] else 1,
            band_order.get(p["band"] or "", 3),
            (p["rosterName"] or p["email"] or "").lower(),
        )
    )

    return {
        "gameId": str(game.get("gameId") or game_id),
        "title": str(game.get("title") or ""),
        "totalQuestions": total_questions,
        "class": class_stats,
        "students": people,
    }
