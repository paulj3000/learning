"""Runtime-independent camera framing for GLB thumbnails (LAI-LAMBDA-013b design).

Implements section 3 of `docs/processing/GLB_THUMBNAIL_SPEC.md`. Standard library only, no
renderer, no I/O except `bounds_from_glb`, which reads a local file through the existing
`lai_processing` GLB validator (imported lazily, so this module also works without it).

Nothing here is wired into the worker, Django or any deployment. glTF is right-handed with +Y up
and the camera looks at the model centre from the spec's azimuth and elevation.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path
from typing import Final

SPEC_VERSION: Final = "1"
FOV_DEGREES: Final = 45.0
AZIMUTH_DEGREES: Final = 35.0  # from +Z toward +X, seen from above
ELEVATION_DEGREES: Final = 20.0
PADDING: Final = 1.25
FALLBACK_RADIUS: Final = 1.0  # a degenerate (zero size) box is framed as a unit sphere
NEAR_FLOOR_RATIO: Final = 0.01  # near is never closer than 1% of the distance
CLIP_MARGIN: Final = 2.0  # near and far sit this many radii either side of the target

Vec3 = tuple[float, float, float]


class FramingError(ValueError):
    """The bounds cannot be framed (missing, inverted or not finite)."""


@dataclass(frozen=True, slots=True)
class Camera:
    position: Vec3
    target: Vec3
    up: Vec3
    fov_degrees: float
    aspect: float
    near: float
    far: float
    distance: float
    radius: float
    degenerate: bool


def direction(azimuth: float = AZIMUTH_DEGREES, elevation: float = ELEVATION_DEGREES) -> Vec3:
    """Unit vector from the target toward the camera."""
    a, e = math.radians(azimuth), math.radians(elevation)
    return (math.cos(e) * math.sin(a), math.sin(e), math.cos(e) * math.cos(a))


def bounding_sphere(low: Vec3, high: Vec3) -> tuple[Vec3, float]:
    """Centre and radius of the sphere around a box (half of the box diagonal)."""
    values = (*low, *high)
    if not all(math.isfinite(v) for v in values):
        raise FramingError("bounds must be finite")
    if any(h < l for l, h in zip(low, high, strict=True)):
        raise FramingError("bounds are inverted")
    centre = tuple((l + h) / 2 for l, h in zip(low, high, strict=True))
    radius = math.dist(low, high) / 2
    return centre, radius  # type: ignore[return-value]


def frame(
    low: Vec3,
    high: Vec3,
    *,
    aspect: float = 1.0,
    azimuth: float = AZIMUTH_DEGREES,
    elevation: float = ELEVATION_DEGREES,
    fov: float = FOV_DEGREES,
    padding: float = PADDING,
) -> Camera:
    """The spec camera for a model whose world bounds are `low` to `high`.

    distance = padding * radius / sin(min(vertical, horizontal) half angle), the sphere fit used
    by the Admin viewer (`frameSphere` in modelPreviewViewer.ts).
    """
    if not (0 < fov < 180) or not (math.isfinite(aspect) and aspect > 0):
        raise FramingError("fov or aspect out of range")
    centre, radius = bounding_sphere(low, high)
    degenerate = not radius > 0
    if degenerate:
        radius = FALLBACK_RADIUS
    vertical = math.radians(fov) / 2
    horizontal = math.atan(math.tan(vertical) * aspect)
    distance = padding * radius / math.sin(min(vertical, horizontal))
    unit = direction(azimuth, elevation)
    position = tuple(c + u * distance for c, u in zip(centre, unit, strict=True))
    near = max(distance - CLIP_MARGIN * radius, distance * NEAR_FLOOR_RATIO)
    far = distance + CLIP_MARGIN * radius
    return Camera(
        position=position,  # type: ignore[arg-type]
        target=centre,  # type: ignore[arg-type]
        up=(0.0, 1.0, 0.0),
        fov_degrees=fov,
        aspect=aspect,
        near=near,
        far=far,
        distance=distance,
        radius=radius,
        degenerate=degenerate,
    )


def _sub(a: Vec3, b: Vec3) -> Vec3:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _cross(a: Vec3, b: Vec3) -> Vec3:
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _unit(a: Vec3) -> Vec3:
    n = math.sqrt(sum(v * v for v in a))
    return (a[0] / n, a[1] / n, a[2] / n)


def view_projection(camera: Camera) -> list[float]:
    """Column-major 4x4 (WebGL layout) projection * view for the camera. Used by the bench page."""
    forward = _unit(_sub(camera.target, camera.position))
    right = _unit(_cross(forward, camera.up))
    up = _cross(right, forward)
    p = camera.position
    view = [
        right[0], up[0], -forward[0], 0.0,
        right[1], up[1], -forward[1], 0.0,
        right[2], up[2], -forward[2], 0.0,
        -sum(right[i] * p[i] for i in range(3)),
        -sum(up[i] * p[i] for i in range(3)),
        sum(forward[i] * p[i] for i in range(3)),
        1.0,
    ]  # fmt: skip
    f = 1.0 / math.tan(math.radians(camera.fov_degrees) / 2)
    n, fa = camera.near, camera.far
    proj = [
        f / camera.aspect, 0.0, 0.0, 0.0,
        0.0, f, 0.0, 0.0,
        0.0, 0.0, (fa + n) / (n - fa), -1.0,
        0.0, 0.0, 2 * fa * n / (n - fa), 0.0,
    ]  # fmt: skip
    return [sum(proj[k * 4 + r] * view[c * 4 + k] for k in range(4)) for c in range(4) for r in range(4)]


def bounds_from_glb(path: Path) -> tuple[Vec3, Vec3]:
    """World bounds of the default scene from POSITION accessor min/max (no vertex is read).

    Uses `lai_processing`'s validator, so the same limits and checks apply; raises FramingError
    for an invalid GLB or one without bounds. Skinned deformation is not included.
    """
    from lai_processing.processors.gltf import GlbSettings  # lazy: optional dependency
    from lai_processing.processors.gltf.document import validate_glb

    size = path.stat().st_size
    with path.open("rb") as handle:
        outcome = validate_glb(handle, size, GlbSettings.resolve({}), lambda: None)
    facts = outcome.facts
    if facts is None or facts.bounds_min is None or facts.bounds_max is None:
        raise FramingError("the GLB has no usable bounds")
    return tuple(facts.bounds_min), tuple(facts.bounds_max)  # type: ignore[return-value]
