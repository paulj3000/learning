"""Preparing one model out of a multi-model pack (TR-PALM-02, TR-ENV-02). No database."""

import io
import struct
import zlib

import pytest

from apps.assets import gltf_prep, png_tools
from apps.assets.png_tools import Png
from apps.assets.validation import validate_model

from .pack_files import pack_glb, rgba_png

NODES = {"Tall": (1.0, 0.6, 5.0), "Short": (2.0, 2.0, 1.0)}


def prepared(name="Tall", data=None, **options):
    document, binary = gltf_prep.read_glb(data or pack_glb(NODES, texture=rgba_png(16, 16)))
    return gltf_prep.extract_model(document, binary, name, **options)


def output(model):
    document, binary = gltf_prep.read_glb(model.data)
    positions = gltf_prep._read_accessor(
        document, binary, document["meshes"][0]["primitives"][0]["attributes"]["POSITION"]
    )
    return document, binary, positions


def test_one_node_becomes_a_standalone_y_up_model_standing_on_its_origin():
    model = prepared()
    document, _binary, positions = output(model)
    assert document["nodes"] == [{"name": "Tall", "mesh": 0}]  # identity transform
    assert document["scenes"] == [{"nodes": [0]}]
    assert "cameras" not in document and "animations" not in document
    assert "extras" not in json_text(model)
    ys = [p[1] for p in positions]
    assert min(ys) == pytest.approx(0.0, abs=1e-6)
    assert max(ys) == pytest.approx(5.0, abs=1e-5)  # Z-up height became Y, x100 baked in
    assert model.dimensions == {"x": 1.0, "y": 5.0, "z": 0.6}
    # The node's 100 m translation is gone: the trunk's foot stays on the vertical axis.
    xs = [p[0] for p in positions]
    assert min(xs) == pytest.approx(-0.5) and max(xs) == pytest.approx(0.5)
    assert model.triangles == 12 and model.vertices == 8


def json_text(model) -> str:
    length = struct.unpack_from("<I", model.data, 12)[0]
    return model.data[20 : 20 + length].decode()


def test_the_output_passes_the_asset_library_validation_with_its_real_bounds():
    model = prepared(target_height=4.6)
    result = validate_model(io.BytesIO(model.data), size=len(model.data))
    assert result.passed, result.report()
    assert result.dimensions["y"] == pytest.approx(4.6, abs=1e-3)


def test_fit_scales_uniformly_along_the_named_axis():
    model = prepared("Short", fit=("x", 3.0))
    assert model.dimensions == {"x": 3.0, "y": 1.5, "z": 3.0}
    assert any("x1.5000" in note for note in model.modifications)


def test_yaw_turns_a_long_axis_onto_x_and_footprints_can_be_centred():
    model = prepared("Tall", yaw_degrees=90.0, center_footprint=True)
    assert model.dimensions["x"] == pytest.approx(0.6, abs=1e-4)
    assert model.dimensions["z"] == pytest.approx(1.0, abs=1e-4)
    _document, _binary, positions = output(model)
    assert sum(p[0] for p in positions) == pytest.approx(0.0, abs=1e-5)


def test_align_axis_lays_an_icon_posed_model_down():
    # After the bake the box is 1.0 wide (X), 5.0 tall (Y), 0.6 deep (Z). Turning its tall axis
    # onto X lays it down; a quarter roll about X then swaps its height and depth.
    lying = prepared("Tall", align_axis=(0.0, 1.0, 0.0), center_footprint=True)
    assert lying.dimensions == {"x": 5.0, "y": 1.0, "z": 0.6}
    rolled = prepared("Tall", align_axis=(0.0, 1.0, 0.0), roll_degrees=90.0)
    assert rolled.dimensions == {"x": 5.0, "y": 0.6, "z": 1.0}
    assert any("Re-posed" in note for note in rolled.modifications)


def test_shortest_arc_handles_opposite_vectors():
    quaternion = gltf_prep._shortest_arc((-1.0, 0.0, 0.0), (1.0, 0.0, 0.0))
    turned = gltf_prep._apply(gltf_prep._rotation_matrix(quaternion), (-1.0, 0.0, 0.0))
    assert turned == pytest.approx((1.0, 0.0, 0.0), abs=1e-9)


def test_material_fixes_cut_out_alpha_and_drop_fbx_metalness():
    fixes = gltf_prep.MaterialFixes(
        blend_to_mask=True, double_sided_cutouts=True, metallic=0.0, roughness=1.0
    )
    document, _binary, _positions = output(prepared(fixes=fixes))
    (material,) = document["materials"]
    assert material["alphaMode"] == "MASK" and material["alphaCutoff"] == 0.5
    assert material["doubleSided"] is True
    assert material["pbrMetallicRoughness"]["metallicFactor"] == 0.0
    assert material["pbrMetallicRoughness"]["roughnessFactor"] == 1.0
    plain, _b, _p = output(prepared())
    assert plain["materials"][0]["alphaMode"] == "BLEND"  # nothing changes unless asked


def test_textures_are_embedded_and_shrunk_once_per_image():
    cache = {}
    data = pack_glb(NODES, texture=rgba_png(32, 32))
    first = prepared("Tall", data=data, max_texture_size=8, texture_cache=cache)
    second = prepared("Short", data=data, max_texture_size=8, texture_cache=cache)
    assert len(cache) == 1
    for model in (first, second):
        document, binary = gltf_prep.read_glb(model.data)
        view = document["bufferViews"][document["images"][0]["bufferView"]]
        image = binary[view["byteOffset"] : view["byteOffset"] + view["byteLength"]]
        assert png_tools.dimensions(image) == (8, 8)
        assert model.textures[0]["from"] == [32, 32] and model.textures[0]["to"] == [8, 8]


def test_preparation_is_deterministic():
    assert prepared(target_height=3.0).data == prepared(target_height=3.0).data


@pytest.mark.parametrize(
    ("data", "name", "message"),
    [
        (pack_glb(NODES), "Missing", "Expected exactly one node"),
        (b"glTF" + b"\x00" * 30, "Tall", "not a glTF 2.0 binary"),
        (b"short", "Tall", "too short"),
    ],
)
def test_refuses_what_it_cannot_prepare(data, name, message):
    with pytest.raises(gltf_prep.PrepError, match=message):
        document, binary = gltf_prep.read_glb(data)
        gltf_prep.extract_model(document, binary, name)


def test_refuses_a_non_uniform_scale():
    document, binary = gltf_prep.read_glb(pack_glb(NODES))
    document["nodes"][1]["scale"] = [100.0, 50.0, 100.0]
    with pytest.raises(gltf_prep.PrepError, match="non-uniform"):
        gltf_prep.extract_model(document, binary, "Tall")


def test_refuses_an_image_that_is_not_embedded():
    data = pack_glb(NODES, texture=rgba_png(4, 4))
    document, binary = gltf_prep.read_glb(data)
    document["images"][0] = {"uri": "https://example.invalid/leaves.png"}
    with pytest.raises(gltf_prep.PrepError, match="embedded"):
        gltf_prep.extract_model(document, binary, "Tall")


# --- PNG ----------------------------------------------------------------------------------------


def _png_with_filter(kind: int, width: int = 4, height: int = 3) -> tuple[bytes, bytes]:
    """A raw RGB PNG whose every row uses filter `kind`, and its decoded pixels."""
    pixels = bytes((x * 20 + y * 7 + c * 3) % 256 for y in range(height) for x in range(width) for c in range(3))
    stride, bpp = width * 3, 3
    raw = bytearray()
    previous = bytes(stride)
    for y in range(height):
        line = pixels[y * stride : (y + 1) * stride]
        out = bytearray(stride)
        for i in range(stride):
            a = line[i - bpp] if i >= bpp else 0
            b = previous[i]
            c = previous[i - bpp] if i >= bpp else 0
            if kind == 0:
                predictor = 0
            elif kind == 1:
                predictor = a
            elif kind == 2:
                predictor = b
            elif kind == 3:
                predictor = (a + b) >> 1
            else:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                predictor = a if pa <= pb and pa <= pc else (b if pb <= pc else c)
            out[i] = (line[i] - predictor) & 0xFF
        raw += bytes((kind,)) + out
        previous = line
    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    data = (
        png_tools.SIGNATURE
        + png_tools._chunk(b"IHDR", header)
        + png_tools._chunk(b"IDAT", zlib.compress(bytes(raw)))
        + png_tools._chunk(b"IEND", b"")
    )
    return data, pixels


@pytest.mark.parametrize("kind", [0, 1, 2, 3, 4])
def test_png_decodes_every_filter_type(kind):
    data, pixels = _png_with_filter(kind)
    image = png_tools.decode(data)
    assert (image.width, image.height, image.channels) == (4, 3, 3)
    assert image.pixels == pixels


def test_png_round_trips_and_halves_with_alpha_weighted_colour():
    # Two opaque red pixels next to two transparent white ones: no pale fringe.
    image = Png(2, 2, 4, bytes([200, 0, 0, 255, 255, 255, 255, 0] * 2))
    assert png_tools.decode(png_tools.encode(image)) == image
    half = png_tools.halve(image)
    assert (half.width, half.height) == (1, 1)
    assert half.pixels == bytes([200, 0, 0, 128])


def test_downscale_png_leaves_small_and_unsupported_images_alone():
    small = rgba_png(8, 8)
    assert png_tools.downscale_png(small, 8) is None
    assert png_tools.downscale_png(b"not a png", 8) is None
    palette = bytearray(rgba_png(16, 16))
    palette[25] = 3  # colour type: palette
    assert png_tools.downscale_png(bytes(palette), 8) is None
    shrunk = png_tools.downscale_png(rgba_png(16, 16), 8)
    assert png_tools.dimensions(shrunk) == (8, 8)
