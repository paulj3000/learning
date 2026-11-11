"""Release validation: behaviour (LAI-NPC-019, LAI-NPC-025), workstream D.

Called by `apps.npcs.validation.release_problems` with the built snapshot; returns problems in
words staff can act on and never raises. It reads only the snapshot (staff-authored content), never
child data.

For every behaviour a placement uses, on its *published* parameters (defaults filled):
- the frozen per-type schema still holds (`behaviors.parameter_problems`);
- every patrol/guide waypoint and scripted `moveTo` offset lies within `boundsRadius` of the
  placement (offsets are relative to the placement, so one check covers every placement);
- a wander `radius` is no larger than `boundsRadius`;
- follow `stopDistance` is smaller than `giveUpDistance`;
- guide `waitForPlayerDistance` is no larger than the bounds circle's diameter (beyond it the guide
  could never wait for a player inside its own area).

Unknown behaviour keys are reported by `structure_problems`, not here.
"""

from __future__ import annotations

import math

from ..behaviors import parameter_problems


def _number(value) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool)


def _point_problems(points, label: str, bounds: float) -> list[str]:
    found = []
    for index, point in points:
        x, z = point.get("x"), point.get("z")
        if not (_number(x) and _number(z)):
            continue
        away = math.hypot(x, z)
        if away > bounds + 1e-9:
            found.append(
                f"{label}[{index}] ({x:g}, {z:g}) is {away:.1f} m from the placement, outside "
                f"boundsRadius {bounds:g} m"
            )
    return found


def behavior_problems(behavior_type: str, parameters) -> list[str]:
    """Why these published parameters cannot run as authored (empty when they can)."""
    found = parameter_problems(behavior_type, parameters)
    if found:
        return found  # geometry checks need well-formed parameters
    bounds = parameters.get("boundsRadius", 15.0)
    waypoints = parameters.get("waypoints") or []
    found.extend(_point_problems(enumerate(waypoints), "waypoints", bounds))
    steps = parameters.get("steps") or []
    moves = [(i, step) for i, step in enumerate(steps) if step.get("action") == "moveTo"]
    found.extend(_point_problems(moves, "steps", bounds))
    radius = parameters.get("radius")
    if behavior_type == "wander" and _number(radius) and radius > bounds:
        found.append(f"wander radius {radius:g} m is larger than boundsRadius {bounds:g} m")
    if behavior_type == "follow":
        stop, give_up = parameters.get("stopDistance"), parameters.get("giveUpDistance")
        if _number(stop) and _number(give_up) and stop >= give_up:
            found.append(
                f"follow stopDistance {stop:g} m must be smaller than giveUpDistance {give_up:g} m"
            )
    if behavior_type == "guide":
        wait = parameters.get("waitForPlayerDistance")
        if _number(wait) and wait > 2 * bounds:
            found.append(
                f"guide waitForPlayerDistance {wait:g} m is larger than the bounds circle "
                f"({2 * bounds:g} m across), so the guide would never wait"
            )
    return found


def problems(snapshot: dict) -> list[str]:
    behaviors = snapshot.get("behaviors", {})
    used: list[str] = []
    for placement in snapshot.get("placements", []):
        key = placement.get("behavior")
        if key and key not in used:
            used.append(key)
    found: list[str] = []
    for key in used:
        spec = behaviors.get(key)
        if not isinstance(spec, dict):
            continue
        for problem in behavior_problems(spec.get("type"), spec.get("parameters")):
            found.append(f"behaviour {key}: {problem}")
    return found
