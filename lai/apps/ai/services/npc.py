"""Server-owned context for NPC narration (LAI-0709).

Everything comes from Django: the published NPC row (identity, role, home Place and island, the
Place's published 3D Area), the child's own relationship and quest rows, and the child's
discoveries. Nothing is read from the request except the two identifiers that pick the node.

Child scope: every child-specific read goes through `for_child`, and the result holds closed
labels and authored titles only (no ids, counts, timestamps, nicknames or free text), so one
child's progress cannot appear in another child's prompt.

Dialogue eligibility mirrors `react/src/features/npc/conditions.ts` for the conditions Django can
judge. A condition it cannot judge (`TIME_OF_DAY`, or any type it does not know) is not met,
so enforcement fails closed. Enforcement is a setting (`LAI_AI_NPC_ENFORCE_ELIGIBILITY`).
"""

from dataclasses import dataclass

from apps.catalog.models import NpcDefinition
from apps.core.content_status import ContentStatus
from apps.progression.models import NpcRelationship, RelationshipLevel, WorldState
from apps.progression.services import world_change_keys
from apps.quests.models import QuestProgress, QuestStatus
from apps.regions.models import WorldRegion

_LEVELS = [level.value for level in RelationshipLevel]


@dataclass(frozen=True)
class ChildNpcState:
    relationship_level: str
    memory_flags: dict
    world_change_keys: frozenset[str]
    completed_quest_ids: frozenset[str]
    has_met: bool


def child_npc_state(child, npc_id: str) -> ChildNpcState:
    relationship = NpcRelationship.objects.for_child(child).filter(npc_id=npc_id).first()
    discovered = (
        WorldState.objects.for_child(child).values_list("discovered_characters", flat=True).first()
    )
    completed = (
        QuestProgress.objects.for_child(child)
        .filter(status=QuestStatus.COMPLETED)
        .values_list("quest__slug", flat=True)
    )
    flags = relationship.memory_flags if relationship and relationship.memory_flags else {}
    return ChildNpcState(
        relationship_level=relationship.relationship_level if relationship else "STRANGER",
        memory_flags=flags if isinstance(flags, dict) else {},
        world_change_keys=frozenset(world_change_keys(child)),
        completed_quest_ids=frozenset(completed),
        has_met=relationship is not None or npc_id in (discovered or []),
    )


def _rank(level: str) -> int:
    return _LEVELS.index(level) if level in _LEVELS else -1


def condition_met(condition: object, state: ChildNpcState) -> bool:
    if not isinstance(condition, dict):
        return False
    kind = condition.get("type")
    if kind == "ALWAYS":
        return True
    if kind == "MEMORY_FLAG":
        flag, equals = condition.get("flag"), condition.get("equals")
        return isinstance(flag, str) and (state.memory_flags.get(flag) or False) == equals
    if kind == "RELATIONSHIP_AT_LEAST":
        needed = _rank(str(condition.get("level")))
        return needed >= 0 and _rank(state.relationship_level) >= needed
    if kind == "WORLD_CHANGE":
        return condition.get("changeKey") in state.world_change_keys
    if kind == "QUEST_COMPLETED":
        return condition.get("questId") in state.completed_quest_ids
    return False  # TIME_OF_DAY and anything unknown: not judgeable here, so not eligible


def node_is_eligible(node: dict, state: ChildNpcState) -> bool:
    conditions = node.get("conditions")
    if conditions is None:
        return True
    return isinstance(conditions, list) and all(condition_met(c, state) for c in conditions)


def place_context(npc: NpcDefinition) -> dict:
    """Island, Place and 3D Area titles of the NPC's home, from published catalog rows only."""
    place = npc.home_location if npc.home_location and npc.home_location.active else None
    if place is None:
        return {}
    context = {"placeTitle": place.title}
    if place.world.active:
        context["islandTitle"] = place.world.title
    area = WorldRegion.objects.filter(location=place, status=ContentStatus.PUBLISHED).first()
    if area is not None:
        context["areaTitle"] = area.title
    return context
