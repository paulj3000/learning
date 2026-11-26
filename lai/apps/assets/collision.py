"""Collision profiles: how a 3D asset blocks movement (Asset Manager;
`docs/ASSET_COLLISION_PROFILES.md`).

Staff author a `CollisionProfile` per asset (its default) or per version (an override) in Django
Admin. This module is the one place that turns a profile into what the runtime uses: a behaviour
and a list of model-space, axis-aligned boxes. The runtime has only axis-aligned boxes (the
existing movement controller), so:

- `BOX` is one box. With no sizes it is the version's measured bounding box (automatic).
- `CYLINDER` upright is an octagon of three boxes; lying (`axis` X or Z) it is one box along the
  axis, which the client cuts into short pieces when the placement is turned.
- `CAPSULE` upright is the same octagon; lying, a box between two octagon end caps.
- `COMPOUND` is the staff-listed boxes (a building's walls), used as given.
- `NONE`, `WALKABLE` and `DECORATIVE` are no boxes at all: deliberately nothing, which the client
  must not replace with its own default.

Raised Solid parts (GE-L16): a Solid box keeps its height and leaves the space under it open only
when the gap under it is at least the avatar's collision height (`WALK_UNDER_CLEARANCE`, the
engine's standard 1.7 m) plus the location's margin; otherwise the engine blocks it down to the
ground. Elevation never makes a part jumpable. A passage piece (`PASSAGE_OPENINGS`, today only
`archway`) has its opening carved out of every box by the engine: its sides stay walls and the
part above the opening is a raised Solid lintel. `solid_clearance` reports that classification for
staff (admin preview and `manage.py collision_clearance_audit`); the engine decides at runtime,
with the placement's own elevation and the real avatar.

An asset with no profile has no `collision` in the resolver answer and the client keeps its
built-in defaults (`react/.../runtime/derivedColliders.ts`).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from django.core.exceptions import ValidationError

from .formats import KIND_FAMILY, MODEL
from .models import CollisionAxis, CollisionBehavior, CollisionProfile, CollisionShape

# Matches the client's `JUMPABLE_MAX_HEIGHT`: the default jump reaches 1.2 m.
JUMPABLE_MAX_HEIGHT = 1.2
# Mirrors the engine's standard avatar collision height (`DEFAULT_BODY_HEIGHT`, margin 0): the
# gap a raised Solid part needs before the child can walk under it. Reporting only.
WALK_UNDER_CLEARANCE = 1.7
# Mirrors the engine's `PASSAGE_OPENINGS` (`react/.../runtime/derivedColliders.ts`;
# `docs/engineering/game-engine/raised-solid-clearance.md` s. 5): pieces whose opening the engine
# carves out of every box they get, built-in or profile. Model space. Reporting only.
PASSAGE_OPENINGS = {"archway": "2 m wide and 2.6 m high"}
MAX_BOXES = 32
MAX_EXTENT = 200.0  # metres; anything larger is a typo, not a prop
_OCTAGON = math.tan(math.pi / 8)  # half-width of an octagon's flats, per unit radius
_BOX_KEYS = ("x", "y", "z", "width", "height", "depth")


@dataclass(frozen=True)
class Bounds:
    """Model-space bounding box: min and max corners (x, y, z), metres."""

    low: tuple[float, float, float]
    high: tuple[float, float, float]
    source: str  # "bounds" (measured corners) or "dimensions" (size only, ground-pivoted)

    @property
    def size(self) -> tuple[float, float, float]:
        return tuple(h - lo for lo, h in zip(self.low, self.high, strict=True))

    @property
    def centre(self) -> tuple[float, float, float]:
        return tuple((lo + h) / 2 for lo, h in zip(self.low, self.high, strict=True))


def version_bounds(version) -> Bounds | None:
    """The version's measured bounds: corners when validation recorded them, else its size
    centred on the pivot and standing on it (every kit model is ground-pivoted)."""
    if version is None:
        return None
    box = (version.metadata or {}).get("bounds")
    if isinstance(box, dict) and _corner(box.get("min")) and _corner(box.get("max")):
        return Bounds(tuple(box["min"]), tuple(box["max"]), "bounds")
    dims = version.dimensions or {}
    if all(_positive(dims.get(axis)) for axis in "xyz"):
        x, y, z = (float(dims[axis]) for axis in "xyz")
        return Bounds((-x / 2, 0.0, -z / 2), (x / 2, y, z / 2), "dimensions")
    return None


def profile_for(asset, version) -> CollisionProfile | None:
    """The profile in force for `version` of `asset`: the version's own, else the asset's
    default."""
    profiles = list(asset.collision_profiles.all())
    if version is not None:
        for profile in profiles:
            if profile.version_id == version.pk:
                return profile
    return next((profile for profile in profiles if profile.version_id is None), None)


def runtime_collision(profile: CollisionProfile | None, version) -> dict | None:
    """What the resolver sends the client for this profile, or None (client defaults apply).

    `{"behavior": "SOLID"|"JUMPABLE"|"WALKABLE"|"DECORATIVE", "shape": ..., "boxes": [...]}` with
    each box as `minX..maxZ` in model space. A profile that cannot be sized (no measured bounds
    and no manual sizes) is None too, so a half-configured asset keeps the defaults rather than
    losing its collider.
    """
    if profile is None:
        return None
    try:
        boxes = profile_boxes(profile, version_bounds(version))
    except ValidationError:
        return None
    behavior = profile.behavior
    if behavior == CollisionBehavior.AUTO:
        if not boxes:
            behavior = CollisionBehavior.DECORATIVE
        else:
            top = max(box["maxY"] for box in boxes) - min(box["minY"] for box in boxes)
            behavior = (
                CollisionBehavior.JUMPABLE
                if top <= JUMPABLE_MAX_HEIGHT
                else CollisionBehavior.SOLID
            )
    if behavior in (CollisionBehavior.WALKABLE, CollisionBehavior.DECORATIVE):
        boxes = []
    return {"behavior": str(behavior), "shape": str(profile.shape), "boxes": boxes}


def solid_clearance(runtime: dict | None) -> list[dict]:
    """Each raised part of a Solid runtime answer and how the engine treats it at ground level.

    `[{"index", "minY", "maxY", "passage"}]`, model space: `passage` is True when the gap under
    the part is at least `WALK_UNDER_CLEARANCE` (the child walks under it; it blocks from its
    underside up) and False when it is lower (it blocks at every height, down to the ground). A
    placement's elevation raises every part further, so a part that is a column on the ground can
    be a passage on a placement set higher. Parts standing on the pivot (`minY` at or below 0) are
    ordinary walls and are not listed.
    """
    if not runtime or runtime.get("behavior") != str(CollisionBehavior.SOLID):
        return []
    return [
        {
            "index": index,
            "minY": box["minY"],
            "maxY": box["maxY"],
            "passage": box["minY"] >= WALK_UNDER_CLEARANCE,
        }
        for index, box in enumerate(runtime.get("boxes") or [])
        if box["minY"] > 0
    ]


def clearance_audit(profiles) -> list[dict]:
    """Every profile in `profiles` with a raised Solid part (read-only; GE-L16 operator audit)."""
    rows = []
    for row in profiles:
        version = row.version if row.version_id else row.asset.default_version
        parts = solid_clearance(runtime_collision(row, version))
        if parts:
            rows.append(
                {
                    "asset": row.asset.asset_id,
                    "scope": f"v{row.version.number}" if row.version_id else "default",
                    "shape": str(row.shape),
                    "parts": parts,
                }
            )
    return rows


def profile_boxes(profile: CollisionProfile, bounds: Bounds | None) -> list[dict]:
    """The profile's shape as model-space boxes. Raises ValidationError when it cannot be sized."""
    if profile.shape == CollisionShape.NONE or profile.behavior in (
        CollisionBehavior.WALKABLE,
        CollisionBehavior.DECORATIVE,
    ):
        return []
    if profile.shape == CollisionShape.COMPOUND:
        return [
            _box_from_centre(**_compound_box(raw, index))
            for index, raw in enumerate(_boxes(profile))
        ]

    size = bounds.size if bounds else (None, None, None)
    centre = bounds.centre if bounds else (0.0, 0.0, 0.0)
    bottom = bounds.low[1] if bounds else 0.0
    width = _pick(profile.width, size[0], "width")
    height = _pick(profile.height, size[1], "height")
    depth = _pick(profile.depth, size[2], "depth")
    cx = profile.offset_x if profile.offset_x is not None else centre[0]
    cz = profile.offset_z if profile.offset_z is not None else centre[2]
    y = profile.offset_y if profile.offset_y is not None else bottom

    if profile.shape == CollisionShape.BOX:
        return [_box_from_centre(cx, y, cz, width, height, depth)]

    axis = profile.axis
    if axis == CollisionAxis.Y:
        radius = profile.radius or max(width, depth) / 2
        return _octagon(cx, cz, y, height, radius)
    # Lying along X or Z: the length is that axis's size, the radius the cross-section's.
    length = width if axis == CollisionAxis.X else depth
    across = depth if axis == CollisionAxis.X else width
    radius = profile.radius or max(across, height) / 2
    if profile.shape == CollisionShape.CYLINDER:
        if axis == CollisionAxis.X:
            return [_box_from_centre(cx, y, cz, length, 2 * radius, 2 * radius)]
        return [_box_from_centre(cx, y, cz, 2 * radius, 2 * radius, length)]
    # Capsule lying down: a middle box between two rounded (octagon) ends.
    middle = max(length - 2 * radius, 0.0)
    out: list[dict] = []
    for sign in (-1, 1):
        end = middle / 2 * sign
        ex, ez = (cx + end, cz) if axis == CollisionAxis.X else (cx, cz + end)
        out += _octagon(ex, ez, y, 2 * radius, radius)
    if middle > 0:
        if axis == CollisionAxis.X:
            out.insert(0, _box_from_centre(cx, y, cz, middle, 2 * radius, 2 * radius))
        else:
            out.insert(0, _box_from_centre(cx, y, cz, 2 * radius, 2 * radius, middle))
    return out


def clean_profile(profile: CollisionProfile) -> None:
    """Admin-side validation: a 3D model asset, its own version, and a shape that is buildable,
    sized and within limits."""
    errors: dict[str, str] = {}
    if profile.asset_id and KIND_FAMILY.get(profile.asset.kind) != MODEL:
        errors["asset"] = (
            "Collision profiles are for 3D models only. "
            f'"{profile.asset.asset_id}" is a {profile.asset.kind} asset.'
        )
    if profile.version_id and profile.asset_id and profile.version.asset_id != profile.asset_id:
        errors["version"] = "That version belongs to another asset."
    if profile.shape == CollisionShape.COMPOUND:
        try:
            raw = _boxes(profile)
            if not raw:
                errors["boxes"] = "A compound profile needs at least one box."
            for index, box in enumerate(raw):
                _compound_box(box, index)
        except ValidationError as error:
            errors["boxes"] = "; ".join(error.messages)
    elif profile.boxes:
        errors["boxes"] = "Boxes are used only by the compound shape; clear them or pick compound."
    for name in ("width", "height", "depth", "radius"):
        value = getattr(profile, name)
        if value is not None and not 0 < value <= MAX_EXTENT:
            errors[name] = f"Must be more than 0 and at most {MAX_EXTENT:g} m."
    if profile.radius is not None and profile.shape not in (
        CollisionShape.CYLINDER,
        CollisionShape.CAPSULE,
    ):
        errors["radius"] = "Radius is used only by cylinder and capsule shapes."
    if errors:
        raise ValidationError(errors)
    if profile.asset_id:
        version = profile.version if profile.version_id else profile.asset.default_version
        try:
            profile_boxes(profile, version_bounds(version))
        except ValidationError as error:
            raise ValidationError(
                {"shape": error.messages[0] + " Enter the sizes, or publish a measured version."}
            ) from error


# --- helpers ---------------------------------------------------------------------------------


def _octagon(cx: float, cz: float, y: float, height: float, radius: float) -> list[dict]:
    """Three axis-aligned boxes whose union is a regular octagon of `radius` (a round footprint)."""
    flat = radius * _OCTAGON
    corner = radius * math.sqrt(0.5)
    return [
        _box_from_centre(cx, y, cz, 2 * radius, height, 2 * flat),
        _box_from_centre(cx, y, cz, 2 * flat, height, 2 * radius),
        _box_from_centre(cx, y, cz, 2 * corner, height, 2 * corner),
    ]


def _box_from_centre(
    x: float, y: float, z: float, width: float, height: float, depth: float
) -> dict:
    return {
        "minX": round(x - width / 2, 4),
        "minY": round(y, 4),
        "minZ": round(z - depth / 2, 4),
        "maxX": round(x + width / 2, 4),
        "maxY": round(y + height, 4),
        "maxZ": round(z + depth / 2, 4),
    }


def _boxes(profile: CollisionProfile) -> list:
    raw = profile.boxes
    if not isinstance(raw, list):
        raise ValidationError("Boxes must be a list.")
    if len(raw) > MAX_BOXES:
        raise ValidationError(f"At most {MAX_BOXES} boxes.")
    return raw


def _compound_box(raw, index: int) -> dict:
    if not isinstance(raw, dict) or set(raw) - set(_BOX_KEYS):
        raise ValidationError(f"Box {index + 1}: use only the keys {', '.join(_BOX_KEYS)}.")
    out: dict[str, float] = {}
    for key in _BOX_KEYS:
        value = raw.get(key, 0.0 if key in "xyz" else None)
        if not _number(value):
            raise ValidationError(f"Box {index + 1}: {key} must be a number.")
        if key in ("width", "height", "depth") and not 0 < value <= MAX_EXTENT:
            raise ValidationError(
                f"Box {index + 1}: {key} must be more than 0 and at most {MAX_EXTENT:g} m."
            )
        if key in "xyz" and abs(value) > MAX_EXTENT:
            raise ValidationError(f"Box {index + 1}: {key} is too far from the model's origin.")
        out[key] = float(value)
    return out


def _pick(manual: float | None, measured: float | None, name: str) -> float:
    if manual is not None:
        return float(manual)
    if measured is not None and measured > 0:
        return float(measured)
    raise ValidationError(f"The {name} is unknown: the model has no measured bounds.")


def _number(value) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool) and math.isfinite(value)


def _positive(value) -> bool:
    return _number(value) and value > 0


def _corner(value) -> bool:
    return isinstance(value, list | tuple) and len(value) == 3 and all(_number(v) for v in value)


# Share of the measured footprint (X and Z) a single box must cover to count as "the whole model".
_WHOLE_FOOTPRINT = 0.9


def opening_check(asset_id: str, runtime: dict | None, bounds: Bounds | None) -> str | None:
    """Whether a Solid profile could seal a piece's opening (GE-247; staff warning only).

    - "carved": a passage piece (`PASSAGE_OPENINGS`); the engine keeps its opening clear whatever
      the boxes, so nothing is sealed.
    - "sealed": one Solid box stands on the ground, is at least `WALK_UNDER_CLEARANCE` tall and
      covers the whole measured footprint. If the model has an opening (a gateway, a door), the
      child cannot pass through it. Django cannot see openings, so this is a warning, never a
      refusal: a solid rock or a pillar is drawn the same way.
    - None: nothing to say (not Solid, already in parts, too low to walk through, or unmeasured).
    """
    if not runtime or runtime.get("behavior") != str(CollisionBehavior.SOLID):
        return None
    if asset_id in PASSAGE_OPENINGS:
        return "carved"
    if bounds is None:
        return None
    width, _height, depth = bounds.size
    for box in runtime.get("boxes") or []:
        if (
            box["minY"] <= bounds.low[1] + 0.01
            and box["maxY"] - max(box["minY"], 0) >= WALK_UNDER_CLEARANCE
            and box["maxX"] - box["minX"] >= _WHOLE_FOOTPRINT * width
            and box["maxZ"] - box["minZ"] >= _WHOLE_FOOTPRINT * depth
        ):
            return "sealed"
    return None
