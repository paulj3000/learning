"""Discovery rules, ported from `react/src/features/discovery/discovery.ts` (LAI-0605).

Pure functions over exported discovery records and a `DiscoveryContext` (camelCase keys:
`worldChangeKeys`, `ownedItemIds`, `discoveredIds`), pinned by `tests/golden/discovery.json`.
"""


def _requirement_met(requirement: dict, context: dict) -> bool:
    kind = requirement.get("type")
    if kind == "ALWAYS":
        return True
    if kind == "WORLD_CHANGE_PRESENT":
        return requirement.get("changeKey") in context.get("worldChangeKeys", [])
    if kind == "ITEM_OWNED":
        return requirement.get("itemId") in context.get("ownedItemIds", [])
    if kind == "DISCOVERY_PRESENT":
        return requirement.get("discoveryId") in context.get("discoveredIds", [])
    return False


def is_discovery_open(definition: dict, context: dict) -> bool:
    return all(_requirement_met(r, context) for r in definition.get("requirements") or [])


def resolve_discovery(definition: dict, context: dict) -> dict:
    """FOUND_NOW, ALREADY_FOUND (checked first, same reveal message) or LOCKED."""
    base = {"discoveryId": definition["id"], "title": definition["title"]}
    if definition["id"] in context.get("discoveredIds", []):
        return {**base, "status": "ALREADY_FOUND", "message": definition["revealMessage"]}
    if not is_discovery_open(definition, context):
        return {**base, "status": "LOCKED", "message": definition["lockedMessage"]}
    return {**base, "status": "FOUND_NOW", "message": definition["revealMessage"]}
