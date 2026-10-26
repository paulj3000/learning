"""NPC dialogue and relationship rules, ported from `react/src/features/npc/` (LAI-0605).

A line-for-line port of `conditions.ts`, `dialogue.ts`, `relationship.ts` and `memory.ts`,
pinned by `tests/golden/npc.json` (`tests/golden/test_npc_python.py`). Pure functions over the
exported NPC records, no Django. `relationship_level_for_points` is what both the quest context
and dialogue conditions read, so a quest condition and an NPC's dialogue never disagree about how
well they know a child.

The context is the TypeScript `NpcContext` (camelCase keys): `timeOfDay`, `relationshipLevel`,
`memoryFlags`, `worldChangeKeys`, `completedQuestIds`.
"""

import json
import math

RELATIONSHIP_LEVEL_ORDER = ("STRANGER", "ACQUAINTANCE", "FRIEND", "TRUSTED_FRIEND")
RELATIONSHIP_THRESHOLDS = {"STRANGER": 0, "ACQUAINTANCE": 2, "FRIEND": 6, "TRUSTED_FRIEND": 12}


def relationship_level_for_points(points: int) -> str:
    level = "STRANGER"
    for candidate in RELATIONSHIP_LEVEL_ORDER:
        if points >= RELATIONSHIP_THRESHOLDS[candidate]:
            level = candidate
    return level


def award_relationship_points(current_points: int, award) -> int:
    """`currentPoints + Math.max(0, Math.trunc(award))`: points never go down."""
    return current_points + max(0, math.trunc(award))


def parse_memory_flags(raw) -> dict[str, bool]:
    """Only boolean entries of a JSON object; anything else is dropped (`parseMemoryFlags`).
    A JSON string is decoded first, as AppSync's AWSJSON travels as one."""
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            return {}
    if not isinstance(raw, dict):
        return {}
    return {key: value for key, value in raw.items() if isinstance(value, bool)}


def set_memory_flags(flags: dict[str, bool], to_set) -> dict[str, bool]:
    if not to_set:
        return flags
    return {**flags, **{flag: True for flag in to_set}}


def _rank(level) -> int:
    return RELATIONSHIP_LEVEL_ORDER.index(level) if level in RELATIONSHIP_LEVEL_ORDER else -1


def evaluate_condition(condition: dict, context: dict) -> bool:
    kind = condition.get("type")
    if kind == "ALWAYS":
        return True
    if kind == "MEMORY_FLAG":
        # An unset flag reads as false, so `equals: false` matches a child who never set it.
        return context.get("memoryFlags", {}).get(condition.get("flag"), False) == condition.get(
            "equals"
        )
    if kind == "RELATIONSHIP_AT_LEAST":
        return _rank(context.get("relationshipLevel")) >= _rank(condition.get("level"))
    if kind == "WORLD_CHANGE":
        return condition.get("changeKey") in context.get("worldChangeKeys", [])
    if kind == "QUEST_COMPLETED":
        return condition.get("questId") in context.get("completedQuestIds", [])
    if kind == "TIME_OF_DAY":
        return context.get("timeOfDay") == condition.get("timeOfDay")
    return False


def evaluate_conditions(conditions, context: dict) -> bool:
    return all(evaluate_condition(c, context) for c in conditions or [])


def select_dialogue_node(npc: dict, context: dict) -> dict | None:
    """The entry node: the first non-follow-up node whose conditions hold, in authored order."""
    return next(
        (
            node
            for node in npc.get("dialogue", [])
            if not node.get("followUpOnly") and evaluate_conditions(node.get("conditions"), context)
        ),
        None,
    )


def find_dialogue_node(npc: dict, node_id) -> dict | None:
    return next((node for node in npc.get("dialogue", []) if node.get("id") == node_id), None)


def available_choices(node: dict, context: dict) -> list[dict]:
    return [c for c in node.get("choices", []) if evaluate_conditions(c.get("conditions"), context)]


def advance_dialogue(npc: dict, choice: dict, context: dict) -> dict | None:
    """The node a choice leads to, or None to end the conversation (no next, unknown, or locked)."""
    if not choice.get("nextNodeId"):
        return None
    following = find_dialogue_node(npc, choice["nextNodeId"])
    if following is None:
        return None
    return following if evaluate_conditions(following.get("conditions"), context) else None


def dialogue_outcome(node: dict, seen_node_ids) -> dict:
    """Showing `node`: its memory flags every time, its points only the first time."""
    already_seen = node.get("id") in seen_node_ids
    return {
        "memoryFlagsToSet": list(node.get("setsMemoryFlags") or []),
        "relationshipPointsAwarded": 0 if already_seen else node.get("awardsRelationshipPoints", 0),
    }
