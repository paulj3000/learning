"""Structural checks on a 3D Area's `scene["engineBridge"]` (GE-070, GE-065).

The engine bridge runs Game Engine Core capabilities (hazards, volumes, checkpoints, puzzles,
atmosphere) inside the live location runtime. Its block is seed-authored scene data:

    {"capabilities": [{"id": "gameplay.hazards", "config": {...}}], "allowEnginePlatforms": false}

Django only checks the shape here, before publishing; the client validates every capability's
config in full (`@lai/game-engine`, `bridgeCapabilityRequests`). Movement, camera and avatar
(`movement.*`, `camera.*`, `character.*`) belong to the live runtime and are refused, as the
bridge refuses them, so a seed cannot publish a block the child's game would reject.
"""

import re

SCENE_KEY = "engineBridge"
ALLOWED_KEYS = {"capabilities", "allowEnginePlatforms"}
CAPABILITY_KEYS = {"id", "config"}
HOST_OWNED_PREFIXES = ("movement.", "camera.", "character.")
# The engine's semantic id (`SEMANTIC_ID` in `game/src/contracts/gameplayEvents.ts`).
CAPABILITY_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")


def engine_bridge_problems(block) -> list[str]:
    """Problems with an `engineBridge` block, as `engineBridge...` paths (empty when valid)."""
    if not isinstance(block, dict):
        return [f"{SCENE_KEY}: must be an object"]
    problems: list[str] = []
    unknown = set(block) - ALLOWED_KEYS
    if unknown:
        problems.append(f"{SCENE_KEY}: unknown keys {', '.join(sorted(unknown))}")
    if "allowEnginePlatforms" in block and not isinstance(block["allowEnginePlatforms"], bool):
        problems.append(f"{SCENE_KEY}.allowEnginePlatforms: must be true or false")
    capabilities = block.get("capabilities", [])
    if not isinstance(capabilities, list):
        return [*problems, f"{SCENE_KEY}.capabilities: must be a list of {{id, config}}"]
    seen: set[str] = set()
    for index, entry in enumerate(capabilities):
        path = f"{SCENE_KEY}.capabilities[{index}]"
        if not isinstance(entry, dict):
            problems.append(f"{path}: must be an object with an id")
            continue
        extra = set(entry) - CAPABILITY_KEYS
        if extra:
            problems.append(f"{path}: unknown keys {', '.join(sorted(extra))}")
        capability_id = entry.get("id")
        if not isinstance(capability_id, str) or not CAPABILITY_ID.match(capability_id):
            problems.append(f"{path}.id: must be a capability id such as gameplay.hazards")
            continue
        if capability_id.startswith(HOST_OWNED_PREFIXES):
            problems.append(
                f"{path}.id: {capability_id} is run by the location itself "
                "(movement, camera and avatar), never by the engine bridge"
            )
        if capability_id in seen:
            problems.append(f"{path}.id: {capability_id} is listed twice")
        seen.add(capability_id)
        if "config" in entry and not isinstance(entry["config"], dict):
            problems.append(f"{path}.config: must be an object")
    return problems


def scene_engine_bridge_problems(scene) -> list[str]:
    """The bridge problems of a whole scene; none when it declares no bridge."""
    if not isinstance(scene, dict) or SCENE_KEY not in scene:
        return []
    return engine_bridge_problems(scene[SCENE_KEY])
