"""The learner summary a tutor turn may see, built from authoritative records (LAI-0603).

Everything here is read from Django: `SkillProgress` (written only by `education.mastery` from
server-graded evidence) and `SkillEvidence`. Nothing comes from a request, and nothing a model
says can reach these rows (the AI routes never write them). What is returned is deliberately
coarse, because a prompt is a disclosure:

* authored curriculum titles and closed labels only: no counts, timestamps, ids, nickname,
  interests, evidence rows or free text;
* the child's age band is added by the caller from the profile, as for every AI route;
* review decay is applied at read time (`mastery.apply_review_decay`), so a skill not practised
  for weeks reads one step lower, as it does for the parent dashboard.

`build_learner_context` never raises: any read failure returns None and the tutor turn goes on
with the context it had before this summary existed (and its authored fallback).
"""

import logging
from dataclasses import dataclass

from django.db import DatabaseError
from django.utils import timezone

from apps.education import mastery
from apps.education.models import SkillEvidence, SkillProgress, SkillStatus

from ..tutor_content import KNOWN_STATUSES, SKILLS, get_skill, list_prerequisites

logger = logging.getLogger("lai.ai")

MAX_TITLES = 5
RECENT_EVIDENCE = 5
_PRACTICE_PATTERNS = frozenset({"STALLED", "NEEDS_SUPPORT"})


@dataclass(frozen=True)
class SkillSnapshot:
    skill_id: str
    status: str  # after review decay
    error_pattern: str


def snapshots(child, *, now: str | None = None) -> dict[str, SkillSnapshot]:
    """This child's curriculum skills that have a progress row, by skill id."""
    now = now or timezone.now().isoformat()
    known_ids = {skill.id for skill in SKILLS}
    found = {}
    for row in SkillProgress.objects.for_child(child).filter(learning_objective_code__in=known_ids):
        if not row.recent_level:
            continue
        counts = mastery.counts_of(row)
        status = mastery.apply_review_decay(row.recent_level, counts["lastPracticedAt"], now)
        found[row.learning_objective_code] = SkillSnapshot(
            row.learning_objective_code, status, row.error_pattern
        )
    return found


def known_prerequisites(child, skill_id: str, *, now: str | None = None) -> list[dict]:
    """`[{skillId, status}]` for the skill's prerequisites the child currently knows."""
    prerequisite_ids = {skill.id for skill in list_prerequisites(skill_id)}
    if not prerequisite_ids:
        return []
    try:
        found = snapshots(child, now=now).values()
    except DatabaseError:
        # Fewer "known" titles is the safe direction; the turn still gets its authored fallback.
        logger.warning("ai.learner_context unavailable")
        return []
    return [
        {"skillId": snap.skill_id, "status": snap.status}
        for snap in found
        if snap.skill_id in prerequisite_ids and snap.status in KNOWN_STATUSES
    ]


def _recent_support(child, skill_id: str) -> str:
    results = list(
        SkillEvidence.objects.for_child(child)
        .filter(learning_objective_code=skill_id)
        .order_by("-observed_at")
        .values_list("result", "support_level")[:RECENT_EVIDENCE]
    )
    if not results:
        return "NONE"
    independent = [r == "CORRECT" and s == 0 for r, s in results]
    if all(independent):
        return "INDEPENDENT"
    if any(independent):
        return "MIXED"
    return "NEEDED_HINTS"


def _level(status: str | None) -> str:
    if status in KNOWN_STATUSES:
        return "CONFIDENT"
    if status == SkillStatus.DEVELOPING:
        return "PRACTISING"
    return "NEW"


def build_learner_context(child, skill_id: str, *, now: str | None = None) -> dict | None:
    """The `learnerProfile` block for a tutor prompt, or None when it cannot be built."""
    skill = get_skill(skill_id)
    if skill is None:
        return None
    try:
        by_skill = snapshots(child, now=now)
        current = by_skill.get(skill_id)
        prerequisites = list_prerequisites(skill_id)
        unmet = [p.title for p in prerequisites if _status(by_skill, p.id) not in KNOWN_STATUSES]
        completed = [
            s.title
            for s in SKILLS
            if _status(by_skill, s.id) in KNOWN_STATUSES and s.id != skill_id
        ]
        practice = [
            s.title
            for s in SKILLS
            if by_skill.get(s.id) and by_skill[s.id].error_pattern in _PRACTICE_PATTERNS
        ]
        return {
            "skillLevel": _level(current.status if current else None),
            "needsExtraPractice": bool(current and current.error_pattern in _PRACTICE_PATTERNS),
            "recentSupport": _recent_support(child, skill_id),
            "unmetPrerequisiteTitles": unmet[:MAX_TITLES],
            "completedSkillTitles": completed[:MAX_TITLES],
            "practiceSkillTitles": practice[:MAX_TITLES],
        }
    except DatabaseError:
        # Exception type only (ADR-025): never the message, which can carry row values.
        logger.warning("ai.learner_context unavailable")
        return None


def _status(by_skill: dict[str, SkillSnapshot], skill_id: str) -> str | None:
    snap = by_skill.get(skill_id)
    return snap.status if snap else None
