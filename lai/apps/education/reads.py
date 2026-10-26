"""Mastery as clients read it (LAI-0603): one entry per objective, review decay at read time.

Shared by the mastery routes (`views.py`) and the progress summary (`game_sessions`), so both
report the same status for the same row.
"""

from django.utils import timezone

from apps.catalog.models import LearningObjective

from . import mastery
from .models import SkillProgress
from .services import counts_of


def mastery_entry(objective: LearningObjective, progress: SkillProgress | None, now) -> dict:
    """What a parent's app may show for one objective. No answers, no evidence rows."""
    if progress is None or progress.exposure_count == 0:
        return {
            "objectiveId": objective.code,
            "title": objective.title,
            "domain": objective.domain,
            "hasEvidence": False,
            # No status without evidence: LOCKED or INTRODUCED would need the curriculum's
            # prerequisite rule, which the server does not evaluate yet.
            "status": None,
            "rawStatus": None,
            "errorPattern": None,
            "exposureCount": 0,
            "independentSuccessCount": 0,
            "supportedSuccessCount": 0,
            "consecutiveIndependentCorrect": 0,
            "lastPracticedAt": None,
        }
    counts = counts_of(progress)
    raw = progress.recent_level or mastery.compute_skill_status(counts, True)
    last = progress.last_practiced_at.isoformat() if progress.last_practiced_at else None
    return {
        "objectiveId": objective.code,
        "title": objective.title,
        "domain": objective.domain,
        "hasEvidence": True,
        "status": mastery.apply_review_decay(raw, last, now.isoformat()),
        "rawStatus": raw,
        "errorPattern": progress.error_pattern or mastery.compute_error_pattern(counts),
        "exposureCount": progress.exposure_count,
        "independentSuccessCount": progress.independent_success_count,
        "supportedSuccessCount": progress.supported_success_count,
        "consecutiveIndependentCorrect": progress.consecutive_independent_correct,
        "lastPracticedAt": last,
    }


def mastery_entries(child, now=None) -> list[dict]:
    now = now or timezone.now()
    rows = list(
        SkillProgress.objects.for_child(child)
        .filter(exposure_count__gt=0)
        .order_by("-last_practiced_at", "learning_objective_code")
    )
    objectives = {
        o.code: o
        for o in LearningObjective.objects.filter(
            code__in=[row.learning_objective_code for row in rows]
        )
    }
    # A row for a code the catalog no longer holds is kept but not shown (no title to show).
    return [
        mastery_entry(objectives[row.learning_objective_code], row, now)
        for row in rows
        if row.learning_objective_code in objectives
    ]


def mastery_summaries(child, now=None) -> list[dict]:
    """Status and objective only (the Mastery Engine's `MasterySummary`), for `progress/`."""
    return [
        {"objectiveId": entry["objectiveId"], "status": entry["status"]}
        for entry in mastery_entries(child, now)
    ]
