"""Behaviour profile parameters: the frozen per-type schema (LAI-NPC-019, contract v1).

The React behaviour engine (`react/src/features/npc-manager/behavior/`) consumes exactly these
fields, in these units (metres, metres per second, seconds). Every type also accepts:

    "reactions": {"<adventure event>": "<animation state>"}   (LAI-NPC-023)
    "boundsRadius": metres the NPC may stray from its placement (default 15)  (LAI-NPC-024)

Per type:

    stationary  {"facePlayer": bool}
    wander      {"radius": 0.5-20, "speed": 0.2-5, "pauseSeconds": [min, max]}
    patrol      {"waypoints": [{"x", "z", "pauseSeconds"?}] (2-32), "speed": 0.2-5, "loop": bool}
    follow      {"stopDistance": 0.5-10, "speed": 0.2-6, "giveUpDistance": 5-60}
    guide       {"waypoints": [...] (1-32), "speed": 0.2-5, "waitForPlayerDistance": 1-15}
    reactive    {} (reactions only; stands still)
    scripted    {"steps": [{"action": "moveTo", "x", "z"} | {"action": "play", "state"}
                          | {"action": "wait", "seconds"} | {"action": "face", "yaw"}] (1-32),
                 "loop": bool}

Waypoints are offsets from the placement's position, so a profile can be reused.
"""

from __future__ import annotations

from .vocabulary import ADVENTURE_EVENTS, ANIMATION_STATES, BehaviorType

MAX_WAYPOINTS = 32
DEFAULT_BOUNDS_RADIUS = 15.0

_RANGES = {
    "radius": (0.5, 20.0),
    "speed": (0.2, 6.0),
    "stopDistance": (0.5, 10.0),
    "giveUpDistance": (5.0, 60.0),
    "waitForPlayerDistance": (1.0, 15.0),
    "boundsRadius": (1.0, 100.0),
    "seconds": (0.0, 30.0),
    "pauseSeconds": (0.0, 30.0),
    "coordinate": (-500.0, 500.0),
}

_ALLOWED: dict[str, set[str]] = {
    BehaviorType.STATIONARY: {"facePlayer"},
    BehaviorType.WANDER: {"radius", "speed", "pauseSeconds"},
    BehaviorType.PATROL: {"waypoints", "speed", "loop"},
    BehaviorType.FOLLOW: {"stopDistance", "speed", "giveUpDistance"},
    BehaviorType.GUIDE: {"waypoints", "speed", "waitForPlayerDistance"},
    BehaviorType.REACTIVE: set(),
    BehaviorType.SCRIPTED: {"steps", "loop"},
}
_REQUIRED: dict[str, set[str]] = {
    BehaviorType.WANDER: {"radius", "speed"},
    BehaviorType.PATROL: {"waypoints", "speed"},
    BehaviorType.FOLLOW: {"stopDistance", "speed"},
    BehaviorType.GUIDE: {"waypoints", "speed"},
    BehaviorType.SCRIPTED: {"steps"},
}
_COMMON = {"reactions", "boundsRadius"}


def _number(value, name: str, where: str, found: list[str], key: str | None = None) -> None:
    low, high = _RANGES[key or name]
    if isinstance(value, bool) or not isinstance(value, int | float) or not low <= value <= high:
        found.append(f"{where}{name} must be a number from {low:g} to {high:g}")


def _waypoints(value, where: str, found: list[str], minimum: int) -> None:
    if not isinstance(value, list) or not minimum <= len(value) <= MAX_WAYPOINTS:
        found.append(f"{where}waypoints: list {minimum} to {MAX_WAYPOINTS} points")
        return
    for index, point in enumerate(value):
        at = f"{where}waypoints[{index}]."
        if not isinstance(point, dict) or set(point) - {"x", "z", "pauseSeconds"}:
            found.append(f"{at[:-1]}: use x, z and optional pauseSeconds")
            continue
        _number(point.get("x"), "x", at, found, "coordinate")
        _number(point.get("z"), "z", at, found, "coordinate")
        if "pauseSeconds" in point:
            _number(point["pauseSeconds"], "pauseSeconds", at, found)


def _steps(value, found: list[str]) -> None:
    if not isinstance(value, list) or not 1 <= len(value) <= MAX_WAYPOINTS:
        found.append(f"steps: list 1 to {MAX_WAYPOINTS} steps")
        return
    shapes = {"moveTo": {"x", "z"}, "play": {"state"}, "wait": {"seconds"}, "face": {"yaw"}}
    for index, step in enumerate(value):
        at = f"steps[{index}]."
        action = step.get("action") if isinstance(step, dict) else None
        if action not in shapes or set(step) != {"action"} | shapes[action]:
            found.append(
                f"steps[{index}]: one of moveTo(x,z), play(state), wait(seconds), face(yaw)"
            )
            continue
        if action == "moveTo":
            _number(step["x"], "x", at, found, "coordinate")
            _number(step["z"], "z", at, found, "coordinate")
        elif action == "play" and step["state"] not in ANIMATION_STATES:
            found.append(f"{at}state must be an animation state")
        elif action == "wait":
            _number(step["seconds"], "seconds", at, found)
        elif action == "face":
            _number(step["yaw"], "yaw", at, found, "coordinate")


def parameter_problems(behavior_type: str, parameters) -> list[str]:
    """Why these parameters do not fit the type (empty when valid)."""
    if behavior_type not in BehaviorType.values:
        return [f"unknown behaviour type {behavior_type!r}"]
    if not isinstance(parameters, dict):
        return ["parameters must be a JSON object"]
    found: list[str] = []
    allowed = _ALLOWED[behavior_type] | _COMMON
    extra = sorted(set(parameters) - allowed)
    if extra:
        found.append(f"not used by {behavior_type}: {', '.join(extra)}")
    missing = sorted(_REQUIRED.get(behavior_type, set()) - set(parameters))
    if missing:
        found.append(f"{behavior_type} needs: {', '.join(missing)}")
    for name in ("radius", "speed", "stopDistance", "giveUpDistance", "waitForPlayerDistance"):
        if name in parameters and name in allowed:
            _number(parameters[name], name, "", found)
    if "boundsRadius" in parameters:
        _number(parameters["boundsRadius"], "boundsRadius", "", found)
    for name in ("loop", "facePlayer"):
        if name in parameters and not isinstance(parameters[name], bool):
            found.append(f"{name} must be true or false")
    if "pauseSeconds" in parameters and behavior_type == BehaviorType.WANDER:
        pause = parameters["pauseSeconds"]
        if not isinstance(pause, list) or len(pause) != 2:
            found.append("pauseSeconds must be [min, max]")
        else:
            for value in pause:
                _number(value, "pauseSeconds", "", found)
            if not found and pause[0] > pause[1]:
                found.append("pauseSeconds: min must not exceed max")
    if "waypoints" in parameters and "waypoints" in allowed:
        _waypoints(parameters["waypoints"], "", found, 2 if behavior_type == "patrol" else 1)
    if "steps" in parameters and "steps" in allowed:
        _steps(parameters["steps"], found)
    reactions = parameters.get("reactions", {})
    if not isinstance(reactions, dict):
        found.append("reactions must map adventure events to animation states")
    else:
        for event, state in reactions.items():
            if event not in ADVENTURE_EVENTS:
                found.append(f"reactions: unknown adventure event {event!r}")
            elif state not in ANIMATION_STATES:
                found.append(f"reactions[{event}]: unknown animation state {state!r}")
    return found


def runtime_parameters(behavior_type: str, parameters: dict) -> dict:
    """Parameters with defaults filled, as published to the runtime."""
    result = dict(parameters)
    result.setdefault("boundsRadius", DEFAULT_BOUNDS_RADIUS)
    result.setdefault("reactions", {})
    if behavior_type == BehaviorType.STATIONARY:
        result.setdefault("facePlayer", True)
    if behavior_type in (BehaviorType.PATROL, BehaviorType.SCRIPTED):
        result.setdefault("loop", True)
    if behavior_type == BehaviorType.FOLLOW:
        result.setdefault("giveUpDistance", 25.0)
    if behavior_type == BehaviorType.GUIDE:
        result.setdefault("waitForPlayerDistance", 4.0)
    if behavior_type == BehaviorType.WANDER:
        result.setdefault("pauseSeconds", [1.0, 3.0])
    return result
