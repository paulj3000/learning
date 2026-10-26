"""NPC relationship rules, ported from `react/src/features/npc/relationship.ts` (LAI-0605).

Pure functions, no Django. The thresholds are the TypeScript ones; `relationshipLevelForPoints`
is what both the quest context and dialogue conditions read, so a quest condition and an NPC's
dialogue never disagree about how well they know a child.
"""

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
    return current_points + max(0, int(award))


def parse_memory_flags(raw) -> dict[str, bool]:
    """Only boolean entries of a JSON object; anything else is dropped (`parseMemoryFlags`)."""
    if not isinstance(raw, dict):
        return {}
    return {key: value for key, value in raw.items() if isinstance(value, bool)}


def set_memory_flags(flags: dict[str, bool], to_set) -> dict[str, bool]:
    if not to_set:
        return flags
    return {**flags, **{flag: True for flag in to_set}}
