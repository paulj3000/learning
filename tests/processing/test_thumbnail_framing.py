"""Unit tests for the GLB thumbnail camera framing (design tooling, not wired into the worker)."""

from __future__ import annotations

import importlib.util
import math
import sys
from pathlib import Path

import pytest
from glb_builder import glb, static_model

PATH = Path(__file__).resolve().parents[2] / "scripts/processing/bench/thumbnail_framing.py"
spec = importlib.util.spec_from_file_location("thumbnail_framing", PATH)
assert spec and spec.loader
tf = importlib.util.module_from_spec(spec)
sys.modules["thumbnail_framing"] = tf
spec.loader.exec_module(tf)


def test_unit_cube_distance_matches_formula() -> None:
    cam = tf.frame((-0.5, -0.5, -0.5), (0.5, 0.5, 0.5))
    radius = math.sqrt(3) / 2
    assert cam.radius == pytest.approx(radius)
    assert cam.distance == pytest.approx(1.25 * radius / math.sin(math.radians(22.5)))
    assert cam.target == (0.0, 0.0, 0.0)
    assert math.dist(cam.position, cam.target) == pytest.approx(cam.distance)


def test_direction_is_unit_with_spec_angles() -> None:
    x, y, z = tf.direction()
    assert math.sqrt(x * x + y * y + z * z) == pytest.approx(1.0)
    assert math.degrees(math.asin(y)) == pytest.approx(20.0)
    assert math.degrees(math.atan2(x, z)) == pytest.approx(35.0)
    assert x > 0 and z > 0 and y > 0


def test_scale_invariance_and_clip_planes() -> None:
    small = tf.frame((0, 0, 0), (0.001, 0.002, 0.001))
    big = tf.frame((0, 0, 0), (1000.0, 2000.0, 1000.0))
    assert big.distance / small.distance == pytest.approx(1_000_000)
    for cam in (small, big):
        assert 0 < cam.near < cam.distance - cam.radius < cam.distance + cam.radius < cam.far


def test_sphere_is_inside_the_frustum_for_non_square_aspect() -> None:
    cam = tf.frame((-1, 0, -1), (1, 2, 1), aspect=0.5)
    horizontal = math.atan(math.tan(math.radians(cam.fov_degrees) / 2) * 0.5)
    assert cam.radius / cam.distance <= math.sin(horizontal)


def test_degenerate_point_uses_fallback_radius() -> None:
    cam = tf.frame((1, 1, 1), (1, 1, 1))
    assert cam.degenerate and cam.radius == 1.0 and cam.target == (1.0, 1.0, 1.0)


def test_flat_plane_is_not_degenerate() -> None:
    cam = tf.frame((-1, 0, -1), (1, 0, 1))
    assert not cam.degenerate and cam.radius == pytest.approx(math.sqrt(2))


@pytest.mark.parametrize(
    "low,high",
    [((0, 0, 0), (math.nan, 1, 1)), ((0, 0, 0), (math.inf, 1, 1)), ((1, 0, 0), (0, 1, 1))],
)
def test_bad_bounds_are_rejected(low: tuple, high: tuple) -> None:
    with pytest.raises(tf.FramingError):
        tf.frame(low, high)


def test_bad_fov_or_aspect_rejected() -> None:
    with pytest.raises(tf.FramingError):
        tf.frame((0, 0, 0), (1, 1, 1), fov=0)
    with pytest.raises(tf.FramingError):
        tf.frame((0, 0, 0), (1, 1, 1), aspect=0)


def test_deterministic() -> None:
    assert tf.frame((0, 0, 0), (1, 2, 3)) == tf.frame((0, 0, 0), (1, 2, 3))


def test_view_projection_puts_target_at_origin_and_sphere_in_view() -> None:
    cam = tf.frame((-1, 0, -1), (1, 2, 1))
    m = tf.view_projection(cam)

    def project(point: tuple[float, float, float]) -> tuple[float, float, float]:
        x, y, z = point
        clip = [m[0 + r] * x + m[4 + r] * y + m[8 + r] * z + m[12 + r] for r in range(4)]
        return clip[0] / clip[3], clip[1] / clip[3], clip[2] / clip[3]

    nx, ny, nz = project(cam.target)
    assert (nx, ny) == (pytest.approx(0, abs=1e-9), pytest.approx(0, abs=1e-9))
    assert -1 < nz < 1
    for corner in ((-1, 0, -1), (1, 2, 1), (-1, 2, 1), (1, 0, -1)):
        px, py, pz = project(corner)
        assert abs(px) < 1 and abs(py) < 1 and -1 < pz < 1


def test_bounds_from_glb_uses_the_existing_parser(tmp_path: Path) -> None:
    document, binary = static_model()
    path = tmp_path / "quad.glb"
    path.write_bytes(glb(document, binary))
    low, high = tf.bounds_from_glb(path)
    assert low == pytest.approx((-0.5, 1.0, -0.5)) and high == pytest.approx((0.5, 1.0, 0.5))
    cam = tf.frame(low, high)
    assert cam.target == pytest.approx((0.0, 1.0, 0.0))


def test_bounds_from_invalid_glb_raises(tmp_path: Path) -> None:
    path = tmp_path / "bad.glb"
    path.write_bytes(b"not a glb")
    with pytest.raises(tf.FramingError):
        tf.bounds_from_glb(path)


def test_bench_synthetic_glb_parses_and_page_formats(tmp_path: Path) -> None:
    bench_path = PATH.with_name("thumbnail_bench.py")
    bench_spec = importlib.util.spec_from_file_location("thumbnail_bench", bench_path)
    assert bench_spec and bench_spec.loader
    bench = importlib.util.module_from_spec(bench_spec)
    sys.modules["thumbnail_bench"] = bench
    bench_spec.loader.exec_module(bench)
    path = tmp_path / "sphere.glb"
    path.write_bytes(bench.synthetic_glb(2000))
    low, high = tf.bounds_from_glb(path)
    assert low == pytest.approx((-1, -1, -1)) and high == pytest.approx((1, 1, 1))
    camera = bench.camera_for(path)
    page = bench.PAGE.format(side=512, triangles=2000, vp=tf.view_projection(camera))
    assert "uniformMatrix4fv" in page and "{" in page
    # No renderer is launched here: the bench skips cleanly when none is installed.
    assert bench.main(["--run", "--chromium", str(tmp_path / "missing")]) == 0
