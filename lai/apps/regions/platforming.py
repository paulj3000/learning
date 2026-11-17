"""Platforming content for a 3D Area (LAI-JMP-02, LAI-JMP-04; ADR-059).

`scene["platforming"]` is seed-authored layout (ADR-033, LAI-0805): positions, sizes and paths of
platforms, pressure plates, course checkpoints, hazards and goals. `scene["platformTuning"]` is
the staff-editable part, changed in Django Admin through the 3D Area's content revision
("area-copy", ADR-047): per platform id, `enabled`, `speed`, `pauseSeconds`, `bounceHeight`,
`visibleSeconds`, `hiddenSeconds`. The client applies tuning over the layout
(`react/.../platforms/platformSpec.ts`, `applyTuning`); these limits mirror that file's
`PLATFORM_LIMITS`, so Django refuses what the client would ignore.
"""

from __future__ import annotations

import math
import re

ID = re.compile(r"^[a-z0-9][a-z0-9:_-]{0,79}$")

LIMITS = {
    "min_top": 0.8,
    "max_size": 30.0,
    "min_speed": 0.2,
    "max_speed": 4.0,
    "max_pause": 10.0,
    "max_waypoints": 16,
    "min_bounce": 0.5,
    "max_bounce": 4.0,
    "min_visible": 1.5,
    "max_cycle": 60.0,
    "max_platforms": 64,
}

TUNING_KEYS = {"enabled", "speed", "pauseSeconds", "bounceHeight", "visibleSeconds", "hiddenSeconds"}
TRIGGERS = {"ALWAYS", "PLATE", "SWITCH", "ZONE", "SIGNAL", "WORLD_STATE"}


def _number(value) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool) and math.isfinite(value)


def _within(value, low: float, high: float) -> bool:
    return _number(value) and low <= value <= high


def platform_ids(scene: dict) -> list[str]:
    platforming = scene.get("platforming") if isinstance(scene, dict) else None
    platforms = platforming.get("platforms") if isinstance(platforming, dict) else None
    if not isinstance(platforms, list):
        return []
    return [p["id"] for p in platforms if isinstance(p, dict) and isinstance(p.get("id"), str)]


def tuning_problems(scene: dict, tuning) -> list[str]:
    """Problems with a staff tuning body, as `$.platformTuning...` paths (empty when valid)."""
    if not isinstance(tuning, dict):
        return ["$.platformTuning: must be an object keyed by platform id"]
    known = set(platform_ids(scene))
    problems: list[str] = []
    for platform_id, settings in tuning.items():
        path = f"$.platformTuning.{platform_id}"
        if platform_id not in known:
            problems.append(f"{path}: no platform with this id in this 3D Area")
            continue
        if not isinstance(settings, dict):
            problems.append(f"{path}: must be an object")
            continue
        unknown = set(settings) - TUNING_KEYS
        if unknown:
            problems.append(f"{path}: unknown settings {', '.join(sorted(unknown))}")
        if "enabled" in settings and not isinstance(settings["enabled"], bool):
            problems.append(f"{path}.enabled: must be true or false")
        ranges = {
            "speed": (LIMITS["min_speed"], LIMITS["max_speed"]),
            "pauseSeconds": (0.0, LIMITS["max_pause"]),
            "bounceHeight": (LIMITS["min_bounce"], LIMITS["max_bounce"]),
            "visibleSeconds": (LIMITS["min_visible"], LIMITS["max_cycle"]),
            "hiddenSeconds": (0.5, LIMITS["max_cycle"]),
        }
        for key, (low, high) in ranges.items():
            if key in settings and not _within(settings[key], low, high):
                problems.append(f"{path}.{key}: must be a number from {low:g} to {high:g}")
    return problems


def layout_problems(platforming, *, bounds: dict | None = None) -> list[str]:
    """Structural checks on seed-authored `scene["platforming"]` (the client validates fully)."""
    if not isinstance(platforming, dict) or not isinstance(platforming.get("platforms"), list):
        return ["platforming: must be an object with a platforms list"]
    problems: list[str] = []
    platforms = platforming["platforms"]
    if len(platforms) > LIMITS["max_platforms"]:
        problems.append(f"platforming.platforms: at most {LIMITS['max_platforms']}")
    seen: set[str] = set()
    plates = {p.get("id") for p in platforming.get("pressurePlates", []) if isinstance(p, dict)}
    half_x = (bounds or {}).get("halfExtentX", math.inf)
    half_z = (bounds or {}).get("halfExtentZ", math.inf)

    def unique(value, path):
        if not isinstance(value, str) or not ID.match(value):
            problems.append(f"{path}: id must be lower-case letters, digits, - _ :")
        elif value in seen:
            problems.append(f"{path}: duplicate id {value}")
        else:
            seen.add(value)

    for index, platform in enumerate(platforms):
        path = f"platforming.platforms[{index}]"
        if not isinstance(platform, dict):
            problems.append(f"{path}: must be an object")
            continue
        unique(platform.get("id"), f"{path}.id")
        size = platform.get("size") or {}
        if not (
            _within(size.get("width"), LIMITS["min_top"], LIMITS["max_size"])
            and _within(size.get("depth"), LIMITS["min_top"], LIMITS["max_size"])
            and _within(size.get("height"), 0.05, 10)
        ):
            problems.append(f"{path}.size: width and depth {LIMITS['min_top']:g} to 30 m, height 0.05 to 10 m")
        position = platform.get("position") or {}
        if not all(_number(position.get(axis)) for axis in "xyz"):
            problems.append(f"{path}.position: must be {{x, y, z}}")
        elif abs(position["x"]) > half_x or abs(position["z"]) > half_z:
            problems.append(f"{path}.position: must be inside the 3D Area")
        motion = platform.get("motion")
        if motion is not None:
            path_points = motion.get("path") if isinstance(motion, dict) else None
            if not isinstance(path_points, list) or not 1 <= len(path_points) <= LIMITS["max_waypoints"]:
                problems.append(f"{path}.motion.path: 1 to {LIMITS['max_waypoints']} waypoints")
            if not _within((motion or {}).get("speed"), LIMITS["min_speed"], LIMITS["max_speed"]):
                problems.append(f"{path}.motion.speed: {LIMITS['min_speed']:g} to {LIMITS['max_speed']:g} m/s")
        activation = platform.get("activation")
        if isinstance(activation, dict):
            if activation.get("trigger") not in TRIGGERS:
                problems.append(f"{path}.activation.trigger: one of {', '.join(sorted(TRIGGERS))}")
            if activation.get("trigger") == "PLATE" and activation.get("source") not in plates:
                problems.append(f"{path}.activation.source: must name a pressure plate")
        vanish = platform.get("vanish")
        if isinstance(vanish, dict) and not _within(
            vanish.get("visibleSeconds"), LIMITS["min_visible"], LIMITS["max_cycle"]
        ):
            problems.append(f"{path}.vanish.visibleSeconds: at least {LIMITS['min_visible']:g} s")
    for key in ("pressurePlates", "checkpoints", "hazards", "goals"):
        for index, item in enumerate(platforming.get(key, [])):
            unique(item.get("id") if isinstance(item, dict) else None, f"platforming.{key}[{index}].id")
    if platforming.get("hazards") and not platforming.get("checkpoints"):
        problems.append("platforming.checkpoints: a course with hazards needs a checkpoint")
    return problems
