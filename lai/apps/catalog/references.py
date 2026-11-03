"""Validated references from child progress to catalog records (LAI-0309).

Child progress stores catalog ids as plain strings (`StoryProgress.story_slug`,
`NpcRelationship.npc_id`, `SkillEvidence` and `SkillProgress` objective codes). Those rows are
never rewritten and gain no foreign keys, so a catalog change cannot orphan or lose a child's
progress. Instead this module:

- answers whether an id names a catalog record (`require_*` raises `UnknownReference`), for the
  code that writes progress; and
- reports ids that no longer name a record (`find_orphans`), as counts only: no child id, name
  or answer ever appears in the report, so it is safe to run and to log.

`manage.py check_references` prints the report, and `check_content` (LAI-0814) includes it.
"""

from dataclasses import dataclass

from .models import LearningObjective, NpcDefinition, Story


class UnknownReference(LookupError):
    """An id that names no catalog record. The message never contains child data."""


def require_story(slug: str) -> str:
    if not Story.objects.filter(slug=slug).exists():
        raise UnknownReference(f"unknown story {slug!r}")
    return slug


def require_npc(npc_id: str) -> str:
    if not NpcDefinition.objects.filter(npc_id=npc_id).exists():
        raise UnknownReference(f"unknown npc {npc_id!r}")
    return npc_id


def require_objective(code: str) -> str:
    if not LearningObjective.objects.filter(code=code).exists():
        raise UnknownReference(f"unknown learning objective {code!r}")
    return code


@dataclass(frozen=True)
class Orphan:
    """A progress field value that names no catalog record, and how many rows hold it."""

    model: str
    field: str
    value: str
    rows: int


def _distinct_counts(model, field: str, known: set[str]) -> list[Orphan]:
    from django.db.models import Count

    counted = model.objects.values(field).annotate(rows=Count("pk")).order_by(field)
    return [
        Orphan(model.__name__, field, str(row[field]), row["rows"])
        for row in counted
        if row[field] not in known
    ]


def find_orphans() -> list[Orphan]:
    """Progress values with no catalog record, across every referencing field."""
    from apps.education.models import SkillEvidence, SkillProgress
    from apps.progression.models import NpcRelationship, StoryProgress

    stories = set(Story.objects.values_list("slug", flat=True))
    npcs = set(NpcDefinition.objects.values_list("npc_id", flat=True))
    objectives = set(LearningObjective.objects.values_list("code", flat=True))
    return [
        *_distinct_counts(StoryProgress, "story_slug", stories),
        *_distinct_counts(NpcRelationship, "npc_id", npcs),
        *_distinct_counts(SkillEvidence, "learning_objective_code", objectives),
        *_distinct_counts(SkillProgress, "learning_objective_code", objectives),
    ]
