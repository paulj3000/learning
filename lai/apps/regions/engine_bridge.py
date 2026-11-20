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

from .platforming import engine_platform_ids

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


def live_platform_ids(scene) -> list[str]:
    """The ids of the live platform system's platforms (`scene.platforming.platforms`)."""
    platforming = scene.get("platforming") if isinstance(scene, dict) else None
    platforms = platforming.get("platforms") if isinstance(platforming, dict) else None
    if not isinstance(platforms, list):
        return []
    return [p["id"] for p in platforms if isinstance(p, dict) and isinstance(p.get("id"), str)]


def scene_engine_bridge_problems(scene) -> list[str]:
    """The bridge problems of a whole scene; none when it declares no bridge.

    An Area may mix live and engine platforms (Firepeak's Heart, before GE-076), but one platform
    runs in one system only: an id in both would be drawn, collided and tuned twice.
    """
    if not isinstance(scene, dict) or SCENE_KEY not in scene:
        return []
    problems = engine_bridge_problems(scene[SCENE_KEY])
    both = sorted(set(live_platform_ids(scene)) & set(engine_platform_ids(scene)))
    if both:
        problems.append(
            f"{SCENE_KEY}: platform ids {', '.join(both)} are in both scene.platforming and "
            "gameplay.platforms; a platform runs in one system only"
        )
    return problems
