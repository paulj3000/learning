"""Conditions shared by spawn rules, variant availability, dialogue and choices (ADR-050).

A condition list is a JSON list of objects; every condition must hold (AND). An empty list always
holds. Conditions only *read* authoritative progress (world changes, quest progress, the NPC
relationship) and NPC-local flags; nothing here writes.

    {"type": "ALWAYS"}
    {"type": "AGE_BAND", "in": ["SPROUT", "PATHFINDER"]}
    {"type": "WORLD_CHANGE", "key": "TREASURE_COVE_QUEST_COMPLETE", "present": true}
                                              (optional "place": "<location slug>")
    {"type": "QUEST_STATUS", "quest": "pips-missing-treasure",
     "status": "NOT_STARTED" | "ACTIVE" | "COMPLETED"}
    {"type": "FIRST_VISIT"}  /  {"type": "RETURN_VISIT"}
    {"type": "LOCAL_FLAG", "flag": "heard-the-story", "equals": true}
    {"type": "RELATIONSHIP_AT_LEAST", "level": "FRIEND"}
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass, field

from apps.progression.models import RelationshipLevel
from apps.users.models import AgeBand

from .vocabulary import CONDITION_TYPES

QUEST_STATUSES = ("NOT_STARTED", "ACTIVE", "COMPLETED")
_SLUG = re.compile(r"^[A-Za-z0-9_-]{1,100}$")
_LEVEL_ORDER = list(RelationshipLevel.values)
MAX_CONDITIONS = 12


@dataclass(frozen=True)
class ConditionContext:
    """What a condition may look at. Built by `context_for` from authoritative records."""

    age_band: str
    world_changes: frozenset[tuple[str, str]] = frozenset()  # (location slug, change key)
    quest_statuses: dict[str, str] = field(default_factory=dict)
    prior_visits: int = 0
    local_flags: dict[str, bool] = field(default_factory=dict)
    relationship_level: str | None = None


def problems(conditions: object, where: str = "conditions") -> list[str]:
    """Why a condition list is malformed, in words staff can act on (empty when valid)."""
    if conditions in (None, []):
        return []
    if not isinstance(conditions, list):
        return [f"{where}: must be a list"]
    if len(conditions) > MAX_CONDITIONS:
        return [f"{where}: at most {MAX_CONDITIONS} conditions"]
    found: list[str] = []
    for index, condition in enumerate(conditions):
        found.extend(_one_problem(condition, f"{where}[{index}]"))
    return found


def _one_problem(condition: object, where: str) -> list[str]:
    if not isinstance(condition, dict):
        return [f"{where}: must be an object"]
    kind = condition.get("type")
    if kind not in CONDITION_TYPES:
        return [f"{where}: unknown type {kind!r}"]
    allowed = {"type"} | _FIELDS[kind]
    extra = set(condition) - allowed
    if extra:
        return [f"{where}: unexpected field(s) {', '.join(sorted(extra))}"]
    if kind == "AGE_BAND":
        bands = condition.get("in")
        if not isinstance(bands, list) or not bands or any(b not in AgeBand.values for b in bands):
            return [f"{where}: 'in' must list age bands ({', '.join(AgeBand.values)})"]
    elif kind == "WORLD_CHANGE":
        if not _is_slug(condition.get("key")):
            return [f"{where}: 'key' must be a world change key"]
        if not isinstance(condition.get("present", True), bool):
            return [f"{where}: 'present' must be true or false"]
        if "place" in condition and not _is_slug(condition["place"]):
            return [f"{where}: 'place' must be a place slug"]
    elif kind == "QUEST_STATUS":
        if not _is_slug(condition.get("quest")):
            return [f"{where}: 'quest' must be a quest slug"]
        if condition.get("status") not in QUEST_STATUSES:
            return [f"{where}: 'status' must be one of {', '.join(QUEST_STATUSES)}"]
    elif kind == "LOCAL_FLAG":
        if not _is_slug(condition.get("flag")):
            return [f"{where}: 'flag' must be a short slug"]
        if not isinstance(condition.get("equals", True), bool):
            return [f"{where}: 'equals' must be true or false"]
    elif kind == "RELATIONSHIP_AT_LEAST":
        if condition.get("level") not in _LEVEL_ORDER:
            return [f"{where}: 'level' must be one of {', '.join(_LEVEL_ORDER)}"]
    return []


_FIELDS: dict[str, set[str]] = {
    "ALWAYS": set(),
    "AGE_BAND": {"in"},
    "WORLD_CHANGE": {"key", "present", "place"},
    "QUEST_STATUS": {"quest", "status"},
    "FIRST_VISIT": set(),
    "RETURN_VISIT": set(),
    "LOCAL_FLAG": {"flag", "equals"},
    "RELATIONSHIP_AT_LEAST": {"level"},
}


def _is_slug(value: object) -> bool:
    return isinstance(value, str) and bool(_SLUG.match(value))


def holds(conditions: Iterable[dict] | None, context: ConditionContext) -> bool:
    """True when every condition holds. A malformed condition never holds (fail closed)."""
    for condition in conditions or ():
        if _one_problem(condition, "") or not _holds(condition, context):
            return False
    return True


def _holds(condition: dict, ctx: ConditionContext) -> bool:
    kind = condition["type"]
    if kind == "ALWAYS":
        return True
    if kind == "AGE_BAND":
        return ctx.age_band in condition["in"]
    if kind == "WORLD_CHANGE":
        key, place = condition["key"], condition.get("place")
        present = any(k == key and (place is None or p == place) for p, k in ctx.world_changes)
        return present == condition.get("present", True)
    if kind == "QUEST_STATUS":
        return ctx.quest_statuses.get(condition["quest"], "NOT_STARTED") == condition["status"]
    if kind == "FIRST_VISIT":
        return ctx.prior_visits == 0
    if kind == "RETURN_VISIT":
        return ctx.prior_visits > 0
    if kind == "LOCAL_FLAG":
        return bool(ctx.local_flags.get(condition["flag"], False)) == condition.get("equals", True)
    if kind == "RELATIONSHIP_AT_LEAST":
        if ctx.relationship_level not in _LEVEL_ORDER:
            return False
        return _LEVEL_ORDER.index(ctx.relationship_level) >= _LEVEL_ORDER.index(condition["level"])
    return False


def context_for(child, npc_id: str | None = None, *, local_flags=None, prior_visits=None):
    """The condition context for one child, read from the authoritative progress records."""
    from apps.progression.models import NpcRelationship, WorldChange
    from apps.quests.models import QuestProgress

    changes = frozenset(
        WorldChange.objects.for_child(child).values_list("location_slug", "change_key")
    )
    quests = dict(QuestProgress.objects.for_child(child).values_list("quest__slug", "status"))
    level = None
    visits = 0
    if npc_id:
        relationship = NpcRelationship.objects.for_child(child).filter(npc_id=npc_id).first()
        if relationship is not None:
            level = relationship.relationship_level
            visits = 1
    return ConditionContext(
        age_band=child.age_band,
        world_changes=changes,
        quest_statuses=quests,
        prior_visits=visits if prior_visits is None else prior_visits,
        local_flags=dict(local_flags or {}),
        relationship_level=level,
    )
