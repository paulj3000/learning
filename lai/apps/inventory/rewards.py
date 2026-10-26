"""Deterministic reward resolution, ported from TypeScript (LAI-0604, ADR-019 sub-decision 8).

A line-for-line port of `react/src/features/rewards/rewardTable.ts`, pinned by the golden
vectors in `tests/golden/rewards.json` (`tests/golden/test_rewards_python.py`). Pure functions
over the exported rule records (`{id, trigger, itemIds, message}`), no Django.

There is no randomness anywhere (ADR-011, CLAUDE.md pillar 7: no loot-box mechanics): the same
trigger grants the same items to every child, every time. Rarity is never consulted. Every
matching rule grants; there is no "one of the following".

- `triggers_match`    <- `triggersMatch`
- `resolve_rewards`   <- `resolveRewards`
- `rewarded_item_ids` <- `rewardedItemIds`
"""

from typing import Any

Trigger = dict[str, Any]
Rule = dict[str, Any]

# The key each trigger type is matched on (the closed `RewardTrigger` union).
_MATCH_KEYS: dict[str, tuple[str, ...]] = {
    "ADVENTURE_COMPLETED": ("templateSlug",),
    "STORY_COMPLETED": ("storySlug",),
    "QUEST_COMPLETED": ("questId",),
    "WORLD_CHANGE": ("changeKey",),
    "NPC_RELATIONSHIP": ("npcId", "level"),
    "DISCOVERY": ("discoveryKey",),
}


def triggers_match(a: Trigger, b: Trigger) -> bool:
    """Structural equality over the closed trigger union; an unknown type never matches."""
    if a.get("type") != b.get("type"):
        return False
    keys = _MATCH_KEYS.get(a.get("type"))
    if keys is None:
        return False
    return all(a.get(key) == b.get(key) for key in keys)


def resolve_rewards(table: list[Rule], trigger: Trigger) -> list[dict[str, Any]]:
    """Every rule matching `trigger`, in authored order."""
    return [
        {"ruleId": rule["id"], "itemIds": rule["itemIds"], "message": rule["message"]}
        for rule in table
        if triggers_match(rule["trigger"], trigger)
    ]


def rewarded_item_ids(table: list[Rule], trigger: Trigger) -> list[str]:
    """Flattened, de-duplicated item ids a trigger grants, in first-seen order."""
    return list(
        dict.fromkeys(item for grant in resolve_rewards(table, trigger) for item in grant["itemIds"])
    )
