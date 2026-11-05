"""Behaviour profile preview (LAI-NPC-025): a server-side, top-down SVG plot and its problems.

Admin-only and read-only. It draws the profile's published parameters (defaults filled) around a
placement home at the origin: the bounds circle, the wander radius, patrol/guide waypoints in
order with their pauses, and the scripted `moveTo` path. Points outside the bounds circle are drawn
in red. No JavaScript, no child data: the plot depends only on the staff-authored profile.

World axes: +x to the right, +z down the page (a top-down view looking along -y).
"""

from __future__ import annotations

import json
import math
from html import escape

from .behaviors import runtime_parameters
from .validation.behavior import behavior_problems

SIZE = 480
MARGIN = 28
COLORS = {
    "bounds": "#6b7280",
    "radius": "#2563eb",
    "path": "#047857",
    "point": "#047857",
    "outside": "#dc2626",
    "home": "#111827",
    "follow": "#7c3aed",
}


def _num(value) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return float(value) if math.isfinite(value) else None


def _points(items, *, scripted: bool = False) -> list[dict]:
    """Well-formed points (index, x, z, pause) from waypoints or scripted moveTo steps."""
    found = []
    if not isinstance(items, list):
        return found
    for index, item in enumerate(items):
        if not isinstance(item, dict):
            continue
        if scripted and item.get("action") != "moveTo":
            continue
        x, z = _num(item.get("x")), _num(item.get("z"))
        if x is None or z is None:
            continue
        pause = _num(item.get("pauseSeconds")) if not scripted else None
        found.append({"index": index, "x": x, "z": z, "pause": pause or 0.0})
    return found


def plot_parts(behavior_type: str, parameters) -> dict:
    """What the plot shows, in metres (also used by tests and the text summary)."""
    params = runtime_parameters(behavior_type, parameters) if isinstance(parameters, dict) else {}
    bounds = _num(params.get("boundsRadius")) or 15.0
    parts = {
        "bounds": bounds,
        "radius": _num(params.get("radius")) if behavior_type == "wander" else None,
        "points": [],
        "closed": False,
        "path_from_home": False,
        "follow": None,
    }
    if behavior_type in ("patrol", "guide"):
        parts["points"] = _points(params.get("waypoints"))
        parts["closed"] = behavior_type == "patrol" and params.get("loop") is not False
        parts["path_from_home"] = True
    elif behavior_type == "scripted":
        parts["points"] = _points(params.get("steps"), scripted=True)
        parts["closed"] = params.get("loop") is not False
        parts["path_from_home"] = True
    elif behavior_type == "follow":
        parts["follow"] = {
            "stop": _num(params.get("stopDistance")),
            "giveUp": _num(params.get("giveUpDistance")),
        }
    for point in parts["points"]:
        point["outside"] = math.hypot(point["x"], point["z"]) > bounds + 1e-9
    return parts


def svg_plot(behavior_type: str, parameters, title: str = "") -> str:
    """The plot as an accessible inline SVG string (every interpolated value is escaped)."""
    parts = plot_parts(behavior_type, parameters)
    bounds = parts["bounds"]
    extent = max(
        [bounds, parts["radius"] or 0.0]
        + [math.hypot(p["x"], p["z"]) for p in parts["points"]]
        + ([parts["follow"]["stop"] or 0.0] if parts["follow"] else [])
    )
    extent = max(extent, 1.0) * 1.1
    scale = (SIZE / 2 - MARGIN) / extent
    centre = SIZE / 2

    def sx(x: float) -> str:
        return f"{centre + x * scale:.1f}"

    def sz(z: float) -> str:
        return f"{centre + z * scale:.1f}"

    def r(metres: float) -> str:
        return f"{metres * scale:.1f}"

    label = title or f"{behavior_type} behaviour"
    out = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {SIZE} {SIZE}" width="{SIZE}" '
        f'height="{SIZE}" role="img" aria-labelledby="behavior-plot-title behavior-plot-desc" '
        'class="lai-behavior-plot" style="background:#f9fafb;border:1px solid #d1d5db">',
        f'<title id="behavior-plot-title">{escape(label)}</title>',
        '<desc id="behavior-plot-desc">Top-down plot around the placement home: +x to the right, '
        "+z down. Dashed circle: boundsRadius. Numbered dots: waypoints or moveTo steps in order. "
        "Red: outside the bounds.</desc>",
        # Axes through home.
        f'<line x1="{MARGIN / 2}" y1="{centre}" x2="{SIZE - MARGIN / 2}" y2="{centre}" '
        'stroke="#e5e7eb"/>',
        f'<line x1="{centre}" y1="{MARGIN / 2}" x2="{centre}" y2="{SIZE - MARGIN / 2}" '
        'stroke="#e5e7eb"/>',
        f'<text x="{SIZE - MARGIN / 2}" y="{centre - 4}" text-anchor="end" font-size="11" '
        'fill="#6b7280">+x</text>',
        f'<text x="{centre + 4}" y="{SIZE - MARGIN / 2}" font-size="11" fill="#6b7280">+z</text>',
        f'<circle cx="{centre}" cy="{centre}" r="{r(bounds)}" fill="none" '
        f'stroke="{COLORS["bounds"]}" stroke-dasharray="6 4" data-part="bounds"/>',
        f'<text x="{centre}" y="{float(sz(-bounds)) - 4:.1f}" text-anchor="middle" font-size="11" '
        f'fill="{COLORS["bounds"]}">bounds {bounds:g} m</text>',
    ]
    if parts["radius"]:
        out.append(
            f'<circle cx="{centre}" cy="{centre}" r="{r(parts["radius"])}" '
            f'fill="{COLORS["radius"]}" fill-opacity="0.12" stroke="{COLORS["radius"]}" '
            'data-part="wander-radius"/>'
        )
        out.append(
            f'<text x="{centre}" y="{float(sz(parts["radius"])) + 14:.1f}" text-anchor="middle" '
            f'font-size="11" fill="{COLORS["radius"]}">wander radius {parts["radius"]:g} m</text>'
        )
    follow = parts["follow"]
    if follow:
        for key in ("stop", "giveUp"):
            metres = follow[key]
            if metres and metres <= extent:
                out.append(
                    f'<circle cx="{centre}" cy="{centre}" r="{r(metres)}" fill="none" '
                    f'stroke="{COLORS["follow"]}" stroke-dasharray="2 3" data-part="{key}"/>'
                )
        out.append(
            f'<text x="{MARGIN}" y="{SIZE - MARGIN / 2}" font-size="11" fill="{COLORS["follow"]}">'
            f"follow: stop {follow['stop'] or 0:g} m, give up {follow['giveUp'] or 0:g} m "
            "(distances to the player)</text>"
        )
    points = parts["points"]
    if points:
        chain = ([(0.0, 0.0)] if parts["path_from_home"] else []) + [
            (p["x"], p["z"]) for p in points
        ]
        if parts["closed"] and len(points) > 1:
            chain.append((points[0]["x"], points[0]["z"]))
        coords = " ".join(f"{sx(x)},{sz(z)}" for x, z in chain)
        out.append(
            f'<polyline points="{coords}" fill="none" stroke="{COLORS["path"]}" '
            'stroke-width="2" stroke-linejoin="round" data-part="path"/>'
        )
        for order, point in enumerate(points, start=1):
            colour = COLORS["outside"] if point["outside"] else COLORS["point"]
            cx, cy = sx(point["x"]), sz(point["z"])
            note = f"{order}" + (f" (pause {point['pause']:g} s)" if point["pause"] else "")
            outside = ' data-outside="true"' if point["outside"] else ""
            out.append(
                f'<circle cx="{cx}" cy="{cy}" r="9" fill="{colour}" '
                f'data-part="point" data-index="{point["index"]}"{outside}/>'
            )
            out.append(
                f'<text x="{cx}" y="{float(cy) + 4:.1f}" text-anchor="middle" font-size="11" '
                f'fill="#ffffff">{order}</text>'
            )
            if point["pause"]:
                out.append(
                    f'<text x="{float(cx) + 12:.1f}" y="{float(cy) - 10:.1f}" font-size="11" '
                    f'fill="{colour}">{escape(note)}</text>'
                )
    out.append(
        f'<circle cx="{centre}" cy="{centre}" r="6" fill="{COLORS["home"]}" data-part="home"/>'
    )
    out.append(
        f'<text x="{centre + 9}" y="{centre + 16}" font-size="11" fill="{COLORS["home"]}">'
        "home</text>"
    )
    out.append("</svg>")
    return "".join(out)


def preview_rows(behavior_type: str, parameters) -> list[tuple[str, str]]:
    """A plain-text table of the plotted points, for screen readers and copy/paste."""
    parts = plot_parts(behavior_type, parameters)
    rows = []
    for order, point in enumerate(parts["points"], start=1):
        where = f"({point['x']:g}, {point['z']:g})"
        bits = [where]
        if point["pause"]:
            bits.append(f"pause {point['pause']:g} s")
        if point["outside"]:
            bits.append("outside the bounds")
        rows.append((f"{order}", ", ".join(bits)))
    return rows


#: Behaviour types the React controller holds still under `prefers-reduced-motion`
#: (react/src/features/npc-manager/behavior/createBehaviorController.ts, REDUCED_MOTION_STILL).
REDUCED_MOTION_STILL = ("wander", "patrol")


def reduced_motion_note(behavior_type: str) -> str:
    if behavior_type in REDUCED_MOTION_STILL:
        return (
            f"With reduced motion turned on, a {behavior_type} NPC stands still at its placement "
            "(no waypoint events); its reactions still play."
        )
    return ""


def preview(profile) -> dict:
    """Everything the preview page shows for one behaviour profile."""
    published = None
    if isinstance(profile.parameters, dict):
        published = runtime_parameters(profile.behavior_type, profile.parameters)
        problems = behavior_problems(profile.behavior_type, published)
    else:
        problems = ["parameters must be a JSON object"]
    return {
        "svg": svg_plot(profile.behavior_type, profile.parameters, title=profile.display_name),
        "rows": preview_rows(profile.behavior_type, profile.parameters),
        "problems": problems,
        "published_parameters": published,
        "published_json": json.dumps(published, indent=2, sort_keys=True) if published else "",
        "reduced_motion_note": reduced_motion_note(profile.behavior_type),
    }
