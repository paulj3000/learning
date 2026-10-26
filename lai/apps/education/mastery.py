"""The Mastery Engine's rules, ported from TypeScript (LAI-0603, ADR-019 sub-decision 8).

A line-for-line port of `react/src/features/mastery/{counters,status,errorPattern}.ts`, pinned by
the golden vectors in `tests/golden/mastery.json` (`tests/golden/test_mastery_python.py`). Pure
functions over plain counter dicts with the TypeScript field names, no Django. No rule is
changed here, and the thresholds are the TypeScript ones. They are "initial deterministic
thresholds, not a pedagogically validated model" (`status.ts`), and retuning them is a product
decision that both ports would take together.

- `next_skill_progress_counts` <- counters.ts `nextSkillProgressCounts`
- `compute_skill_status`       <- status.ts `computeSkillStatus`
- `apply_review_decay`         <- status.ts `applyReviewDecay` (read-time only, never stored)
- `compute_error_pattern`      <- errorPattern.ts `computeErrorPattern`
"""

from datetime import datetime
from typing import Any

MASTERED_STREAK = 3
MASTERED_MIN_INDEPENDENT = 5
PROFICIENT_MIN_INDEPENDENT = 3
PROFICIENT_MIN_RATIO = 0.6
REVIEW_DECAY_DAYS = 21
STALL_MIN_EXPOSURES = 3
NEEDS_SUPPORT_MIN_EXPOSURES = 2
NEEDS_SUPPORT_RATIO = 0.5

_ONE_DAY_MS = 24 * 60 * 60 * 1000

Counts = dict[str, Any]

ZERO_COUNTS: Counts = {
    "exposureCount": 0,
    "independentSuccessCount": 0,
    "supportedSuccessCount": 0,
    "consecutiveIndependentCorrect": 0,
    "lastPracticedAt": None,
}


def next_skill_progress_counts(
    existing: Counts | None, correctness: str, support_level: int, now: str
) -> Counts:
    """The counters after one more piece of evidence.

    Only a `correct` result with no hint (`support_level == 0`) is an independent success; a
    `correct` one with a hint is a supported success. Every result is one more exposure, and
    anything but an independent success breaks the streak.
    """
    base = existing or ZERO_COUNTS
    independent = correctness == "correct" and support_level == 0
    supported = correctness == "correct" and support_level > 0
    return {
        "exposureCount": base["exposureCount"] + 1,
        "independentSuccessCount": base["independentSuccessCount"] + (1 if independent else 0),
        "supportedSuccessCount": base["supportedSuccessCount"] + (1 if supported else 0),
        "consecutiveIndependentCorrect": (
            base["consecutiveIndependentCorrect"] + 1 if independent else 0
        ),
        "lastPracticedAt": now,
    }


def compute_skill_status(counts: Counts, prerequisites_satisfied: bool) -> str:
    if counts["exposureCount"] == 0 and not prerequisites_satisfied:
        return "LOCKED"
    if counts["independentSuccessCount"] == 0:
        return "INTRODUCED"
    if (
        counts["consecutiveIndependentCorrect"] >= MASTERED_STREAK
        and counts["independentSuccessCount"] >= MASTERED_MIN_INDEPENDENT
    ):
        return "MASTERED"
    if (
        counts["independentSuccessCount"] >= PROFICIENT_MIN_INDEPENDENT
        and counts["independentSuccessCount"] / counts["exposureCount"] >= PROFICIENT_MIN_RATIO
    ):
        return "PROFICIENT"
    return "DEVELOPING"


def _epoch_ms(value: str) -> float:
    """`new Date(iso).getTime()` for the ISO-8601 UTC timestamps the vectors and the API use."""
    return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000


def apply_review_decay(status: str, last_practiced_at: str | None, now: str) -> str:
    """A PROFICIENT/MASTERED status not practised for 21 days shows one level lower."""
    if status not in ("PROFICIENT", "MASTERED"):
        return status
    if not last_practiced_at:
        return status
    days = (_epoch_ms(now) - _epoch_ms(last_practiced_at)) / _ONE_DAY_MS
    if days < REVIEW_DECAY_DAYS:
        return status
    return "PROFICIENT" if status == "MASTERED" else "DEVELOPING"


def compute_error_pattern(counts: Counts) -> str:
    exposures = counts["exposureCount"]
    if exposures == 0:
        return "NONE"
    if exposures >= STALL_MIN_EXPOSURES and counts["independentSuccessCount"] == 0:
        return "STALLED"
    if (
        exposures >= NEEDS_SUPPORT_MIN_EXPOSURES
        and counts["supportedSuccessCount"] / exposures >= NEEDS_SUPPORT_RATIO
    ):
        return "NEEDS_SUPPORT"
    if counts["independentSuccessCount"] > 0 and counts["supportedSuccessCount"] > 0:
        return "INCONSISTENT"
    return "NONE"
