"""Authoritative mastery rules and writes (LAI-0603).

A Python port of `react/src/features/mastery/{counters,status,errorPattern}.ts`, pinned by the
golden vectors (`tests/golden/mastery.json`, `tests/golden/test_mastery_python.py`). The four
pure functions take and return the vectors' camelCase counter dictionaries so a case can be
replayed unchanged; `apply_evidence` is the only function that touches the database.

Authority, in one place:

* Evidence is written by server code from a server-graded answer (`SkillEvidence`). Nothing a
  browser sends and nothing a model says reaches these counters: the AI routes only read them
  (`apps/ai/services/learner.py`).
* `SkillProgress` is derived from evidence. `apply_evidence` is called once per newly created
  evidence row and never for a replay, so a retried request cannot count twice.
* The status and error pattern stored on the row are recomputed from the counters on every
  write; the read-time review decay (`apply_review_decay`) never rewrites a row.
"""

from datetime import UTC, datetime
from typing import Any

from django.db import transaction

from .models import SkillEvidence, SkillProgress, SkillStatus

MASTERED_STREAK = 3
MASTERED_MIN_INDEPENDENT = 5
PROFICIENT_MIN_INDEPENDENT = 3
PROFICIENT_MIN_RATIO = 0.6
REVIEW_DECAY_DAYS = 21

STALL_MIN_EXPOSURES = 3
NEEDS_SUPPORT_MIN_EXPOSURES = 2
NEEDS_SUPPORT_RATIO = 0.5

_ONE_DAY_SECONDS = 24 * 60 * 60

ZERO_COUNTS: dict[str, Any] = {
    "exposureCount": 0,
    "independentSuccessCount": 0,
    "supportedSuccessCount": 0,
    "consecutiveIndependentCorrect": 0,
    "lastPracticedAt": None,
}


def _parse_instant(value: str) -> datetime:
    """An ISO-8601 instant as the vectors write it (`...Z`) or as Python writes it."""
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def next_skill_progress_counts(
    existing: dict | None, correctness: str, support_level: int, now: str
) -> dict:
    """`nextSkillProgressCounts`: the counters after one more piece of evidence."""
    base = existing or ZERO_COUNTS
    is_independent = correctness == "correct" and support_level == 0
    is_supported = correctness == "correct" and support_level > 0
    return {
        "exposureCount": base["exposureCount"] + 1,
        "independentSuccessCount": base["independentSuccessCount"] + (1 if is_independent else 0),
        "supportedSuccessCount": base["supportedSuccessCount"] + (1 if is_supported else 0),
        "consecutiveIndependentCorrect": (
            base["consecutiveIndependentCorrect"] + 1 if is_independent else 0
        ),
        "lastPracticedAt": now,
    }


def compute_skill_status(counts: dict, prerequisites_satisfied: bool) -> str:
    """`computeSkillStatus`: counts are not validated, exactly as in TypeScript."""
    exposure = counts["exposureCount"]
    independent = counts["independentSuccessCount"]
    if exposure == 0 and not prerequisites_satisfied:
        return SkillStatus.LOCKED
    if independent == 0:
        return SkillStatus.INTRODUCED
    if (
        counts["consecutiveIndependentCorrect"] >= MASTERED_STREAK
        and independent >= MASTERED_MIN_INDEPENDENT
    ):
        return SkillStatus.MASTERED
    if independent >= PROFICIENT_MIN_INDEPENDENT and independent / exposure >= PROFICIENT_MIN_RATIO:
        return SkillStatus.PROFICIENT
    return SkillStatus.DEVELOPING


def compute_error_pattern(counts: dict) -> str:
    """`computeErrorPattern`: count-derived only, most concerning first."""
    exposure = counts["exposureCount"]
    independent = counts["independentSuccessCount"]
    supported = counts["supportedSuccessCount"]
    if exposure == 0:
        return "NONE"
    if exposure >= STALL_MIN_EXPOSURES and independent == 0:
        return "STALLED"
    if exposure >= NEEDS_SUPPORT_MIN_EXPOSURES and supported / exposure >= NEEDS_SUPPORT_RATIO:
        return "NEEDS_SUPPORT"
    if independent > 0 and supported > 0:
        return "INCONSISTENT"
    return "NONE"


def apply_review_decay(status: str, last_practiced_at: str | None, now: str) -> str:
    """`applyReviewDecay`: a read-time step down for a long-unpracticed PROFICIENT or MASTERED."""
    if status not in (SkillStatus.PROFICIENT, SkillStatus.MASTERED):
        return status
    if not last_practiced_at:
        return status
    elapsed = (_parse_instant(now) - _parse_instant(last_practiced_at)).total_seconds()
    if elapsed / _ONE_DAY_SECONDS < REVIEW_DECAY_DAYS:
        return status
    return SkillStatus.PROFICIENT if status == SkillStatus.MASTERED else SkillStatus.DEVELOPING


def counts_of(progress: SkillProgress | None) -> dict:
    """The row's counters in the vectors' shape (zeros for a skill with no row)."""
    if progress is None:
        return dict(ZERO_COUNTS)
    return {
        "exposureCount": progress.exposure_count,
        "independentSuccessCount": progress.independent_success_count,
        "supportedSuccessCount": progress.supported_success_count,
        "consecutiveIndependentCorrect": progress.consecutive_independent_correct,
        "lastPracticedAt": (
            progress.last_practiced_at.astimezone(UTC).isoformat()
            if progress.last_practiced_at
            else None
        ),
    }


def apply_evidence(evidence: SkillEvidence) -> SkillProgress:
    """Folds one newly recorded evidence row into its child's `SkillProgress`.

    Call it exactly once per created evidence row, in the transaction that created the row. The
    progress row is locked for the update, so two concurrent answers to the same skill both
    count. The stored `recent_level` and `error_pattern` are recomputed from the counters.
    """
    with transaction.atomic():
        progress, _ = SkillProgress.objects.select_for_update().get_or_create(
            child=evidence.child,
            learning_objective_code=evidence.learning_objective_code,
        )
        observed = evidence.observed_at.astimezone(UTC)
        counts = next_skill_progress_counts(
            counts_of(progress if progress.exposure_count else None),
            evidence.result.lower(),
            evidence.support_level,
            observed.isoformat(),
        )
        progress.exposure_count = counts["exposureCount"]
        progress.independent_success_count = counts["independentSuccessCount"]
        progress.supported_success_count = counts["supportedSuccessCount"]
        progress.consecutive_independent_correct = counts["consecutiveIndependentCorrect"]
        # Exposure is at least one now, so prerequisites cannot lock the skill again.
        progress.recent_level = compute_skill_status(counts, True)
        progress.error_pattern = compute_error_pattern(counts)
        # Evidence can arrive out of order; the newest observation is the practice date.
        if progress.last_practiced_at is None or observed > progress.last_practiced_at:
            progress.last_practiced_at = observed
        progress.save()
        return progress
