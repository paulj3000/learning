"""glTF document checks: references, bounds, policy, limits and hostile documents."""

from __future__ import annotations

import base64
import copy
import struct
from collections.abc import Callable
from typing import Any

import pytest
from glb_builder import (
    Document,
    data_uri,
    error_codes,
    glb,
    jpeg,
    mutated,
    png,
    skinned_glb,
    skinned_model,
    static_glb,
    static_model,
    validate,
    warning_codes,
    webp,
)

from lai_processing.core.errors import ErrorCode, ProcessingError
from lai_processing.processors.gltf import GlbSettings
from lai_processing.processors.gltf.document import COMPLEXITY_CEILINGS, COMPLEXITY_DEFAULTS


def change(fn: Callable[[Document], None], base: Any = static_model) -> set[str]:
    return error_codes(mutated(fn, base))


def setter(path: str, value: Any) -> Callable[[Document], None]:
    def apply(document: Document) -> None:
        target: Any = document
        keys = path.split(".")
        for key in keys[:-1]:
            target = target[int(key)] if isinstance(target, list) else target[key]
        last = keys[-1]
        if isinstance(target, list):
            target[int(last)] = value
        else:
            target[last] = value

    return apply


def test_valid_skinned_animated_model_has_no_errors() -> None:
    outcome = validate(skinned_glb())
    assert outcome.report.codes() == []


# --- asset and top level ----------------------------------------------------------------------


@pytest.mark.parametrize("asset", [None, "2.0", {}, {"version": "1.0"}, {"version": 2.0}])
def test_asset_version(asset: Any) -> None:
    assert change(setter("asset", asset)) == {"gltf_version"}


def test_min_version_newer_than_2_0() -> None:
    assert change(setter("asset.minVersion", "2.1")) == {"gltf_version"}
    outcome = validate(mutated(setter("asset.minVersion", "2.0")))
    assert outcome.report.codes() == []
    assert outcome.facts.min_version == "2.0"


def test_top_level_property_that_is_not_an_array() -> None:
    assert "invalid_structure" in change(setter("materials", {"0": {}}))


# --- extensions -------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "name", ["KHR_draco_mesh_compression", "EXT_meshopt_compression", "KHR_texture_basisu"]
)
@pytest.mark.parametrize("where", ["extensionsUsed", "extensionsRequired"])
def test_compression_extensions_need_a_decoder(name: str, where: str) -> None:
    assert change(setter(where, [name])) == {"needs_decoder"}


def test_unknown_required_extension_is_an_error_and_used_one_a_warning() -> None:
    assert change(setter("extensionsRequired", ["VENDOR_x"])) == {"unsupported_extension"}
    data = mutated(setter("extensionsUsed", ["VENDOR_x"]))
    assert error_codes(data) == set()
    assert "unknown_extension" in warning_codes(data)


def test_supported_extension_is_accepted() -> None:
    data = mutated(setter("extensionsUsed", ["KHR_texture_transform"]))
    assert validate(data).report.codes() == []


def test_non_string_extension_entry() -> None:
    assert change(setter("extensionsUsed", [{"name": "x"}])) == {"unsupported_extension"}


# --- buffers and URIs -------------------------------------------------------------------------


@pytest.mark.parametrize(
    "uri",
    [
        "https://example.invalid/model.bin",
        "http://169.254.169.254/latest/meta-data/",
        "file:///etc/passwd",
        "../../../etc/passwd",
        "model.bin",
        "s3://bucket/key",
        "//example.invalid/x",
        42,
    ],
)
def test_external_buffer_uri_is_refused_and_never_fetched(uri: Any) -> None:
    assert change(setter("buffers.0.uri", uri)) == {"external_resource"}


def test_data_uri_buffer_is_checked_without_decoding() -> None:
    document, binary = static_model()
    document = copy.deepcopy(document)
    document["buffers"].append(
        {"byteLength": 8, "uri": data_uri("application/octet-stream", b"12345678")}
    )
    assert error_codes(glb(document, binary)) == set()
    document["buffers"][1]["byteLength"] = 9
    assert error_codes(glb(document, binary)) == {"buffer_bounds"}
    document["buffers"][1]["uri"] = "data:text/html;base64,AAAA"
    assert error_codes(glb(document, binary)) == {"invalid_buffer"}
    document["buffers"][1]["uri"] = "data:application/octet-stream;base64,@@@@"
    assert error_codes(glb(document, binary)) == {"invalid_buffer"}


def test_large_data_uri_is_bounded_by_the_json_limit() -> None:
    document, binary = static_model()
    document = copy.deepcopy(document)
    blob = base64.b64encode(b"\x00" * 300_000).decode()
    document["buffers"].append(
        {"byteLength": 300_000, "uri": f"data:application/octet-stream;base64,{blob}"}
    )
    settings = GlbSettings.resolve({"max_json_bytes": 100_000})
    assert error_codes(glb(document, binary), settings) == {"json_size"}


def test_buffer_without_uri_must_be_buffer_zero_of_a_glb_with_bin() -> None:
    document, binary = static_model()
    document = copy.deepcopy(document)
    document["buffers"].append({"byteLength": 4})
    assert "missing_buffer" in error_codes(glb(document, binary))
    assert "missing_buffer" in error_codes(glb(static_model()[0], None))


@pytest.mark.parametrize("length", [0, -1, "12", 1.5, None, True])
def test_buffer_byte_length(length: Any) -> None:
    assert "invalid_buffer" in change(setter("buffers.0.byteLength", length))


def test_buffer_longer_than_bin_chunk() -> None:
    assert change(setter("buffers.0.byteLength", 10**9)) == {"buffer_bounds"}


def test_much_shorter_buffer_than_bin_warns() -> None:
    document, binary = static_model()
    data = glb(document, binary + b"\x00" * 64)
    assert "bin_chunk_unused" in warning_codes(data)


# --- buffer views -----------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("field", "value", "code"),
    [
        ("buffer", 5, "invalid_buffer_view"),
        ("buffer", "0", "invalid_buffer_view"),
        ("byteLength", 0, "invalid_buffer_view"),
        ("byteOffset", -4, "invalid_buffer_view"),
        ("byteLength", 10**6, "buffer_bounds"),
        ("byteOffset", 2**32 - 4, "buffer_bounds"),
        ("byteStride", 0, "invalid_buffer_view"),
        ("byteStride", 2, "invalid_buffer_view"),
        ("byteStride", 13, "invalid_buffer_view"),
        ("byteStride", 256, "invalid_buffer_view"),
        ("target", 1, "invalid_buffer_view"),
        ("target", [34962], "invalid_buffer_view"),
    ],
)
def test_buffer_view_checks(field: str, value: Any, code: str) -> None:
    assert code in change(setter(f"bufferViews.0.{field}", value))


def test_view_targets_are_accepted() -> None:
    data = mutated(setter("bufferViews.0.target", 34962))
    assert error_codes(data) == set()


# --- accessors --------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("field", "value", "code"),
    [
        ("count", 0, "invalid_accessor"),
        ("count", -1, "invalid_accessor"),
        ("count", "4", "invalid_accessor"),
        ("componentType", 5124, "invalid_accessor"),
        ("componentType", [5126], "invalid_accessor"),
        ("type", "VEC5", "invalid_accessor"),
        ("type", {"x": 1}, "invalid_accessor"),
        ("bufferView", 99, "invalid_accessor"),
        ("byteOffset", 2, "invalid_accessor"),  # not aligned to 4-byte floats
        ("byteOffset", -4, "invalid_accessor"),
        ("byteOffset", 2**32 - 4, "buffer_bounds"),
        ("count", 5, "buffer_bounds"),
        ("count", 10**12, "too_complex"),
        ("normalized", True, "invalid_accessor"),  # floats cannot be normalized
        ("normalized", "yes", "invalid_accessor"),
        ("min", [0, 0], "invalid_accessor"),
        ("max", [0, "x", 0], "invalid_accessor"),
    ],
)
def test_accessor_checks(field: str, value: Any, code: str) -> None:
    assert code in change(setter(f"accessors.0.{field}", value))


def test_accessor_stride_smaller_than_element() -> None:
    # A VEC3 float element is 12 bytes; a declared stride of 8 cannot hold it.
    assert "invalid_accessor" in change(setter("bufferViews.0.byteStride", 8))


def test_accessor_with_stride_reads_within_view() -> None:
    def apply(document: Document) -> None:
        document["bufferViews"][0]["byteStride"] = 12
        document["bufferViews"][0]["byteLength"] = 47  # needs 3 * 12 + 12 = 48

    assert "buffer_bounds" in change(apply)


def test_accessor_without_buffer_view_is_allowed() -> None:
    def apply(document: Document) -> None:
        document["accessors"].append({"componentType": 5126, "count": 3, "type": "VEC3"})

    assert change(apply) == set()


def test_sparse_accessor() -> None:
    def sparse(**overrides: Any) -> Callable[[Document], None]:
        def apply(document: Document) -> None:
            value: dict[str, Any] = {
                "count": 1,
                "indices": {"bufferView": 1, "componentType": 5123},
                "values": {"bufferView": 0},
            }
            value.update(overrides)
            document["accessors"][0]["sparse"] = value

        return apply

    assert change(sparse()) == set()
    assert change(sparse(count=99)) == {"invalid_accessor"}
    assert change(sparse(indices={"bufferView": 99, "componentType": 5123})) == {
        "invalid_accessor"
    }
    assert change(sparse(indices={"bufferView": 1, "componentType": 5126})) == {
        "invalid_accessor"
    }
    assert change(sparse(values={"bufferView": 1, "byteOffset": 10})) == {"buffer_bounds"}
    assert change(sparse(count=4, values={"bufferView": 1})) == {"buffer_bounds"}
    assert change(setter("accessors.0.sparse", "x")) == {"invalid_accessor"}


# --- meshes -----------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("path", "value"),
    [
        ("meshes.0.primitives", []),
        ("meshes.0.primitives.0.attributes", {}),
        ("meshes.0.primitives.0.attributes.POSITION", 99),
        ("meshes.0.primitives.0.attributes.POSITION", 1),  # the index accessor: not VEC3
        ("meshes.0.primitives.0.indices", 0),  # VEC3 float accessor as indices
        ("meshes.0.primitives.0.indices", 42),
        ("meshes.0.primitives.0.mode", 7),
        ("meshes.0.primitives.0.mode", "TRIANGLES"),
        ("meshes.0.primitives.0.material", 3),
        ("meshes.0.primitives.0.targets", [{"POSITION": 77}]),
    ],
)
def test_mesh_checks(path: str, value: Any) -> None:
    assert "invalid_mesh" in change(setter(path, value))


def test_attribute_counts_must_match() -> None:
    def apply(document: Document) -> None:
        document["meshes"][0]["primitives"][0]["attributes"]["TEXCOORD_0"] = 1

    assert "invalid_mesh" in change(apply)


def test_quantized_positions_need_the_extension() -> None:
    def apply(document: Document) -> None:
        document["accessors"][0]["componentType"] = 5122
        document["accessors"][0]["count"] = 3  # 3 * 6 bytes fit in 48

    assert "invalid_mesh" in change(apply)

    def quantized(document: Document) -> None:
        apply(document)
        document["extensionsUsed"] = ["KHR_mesh_quantization"]

    assert "invalid_mesh" not in change(quantized)


@pytest.mark.parametrize(
    ("mode", "triangles"), [(4, 2), (5, 4), (6, 4), (0, 0), (1, 0), (3, 0)]
)
def test_triangle_counts_by_mode(mode: int, triangles: int) -> None:
    outcome = validate(mutated(setter("meshes.0.primitives.0.mode", mode)))
    assert outcome.facts.triangle_count == triangles
    assert outcome.facts.vertex_count == 4


def test_non_indexed_triangle_count_uses_vertex_count() -> None:
    def apply(document: Document) -> None:
        del document["meshes"][0]["primitives"][0]["indices"]

    outcome = validate(mutated(apply))
    assert outcome.facts.triangle_count == 1  # 4 vertices // 3


# --- materials, textures, samplers, images ----------------------------------------------------


@pytest.mark.parametrize(
    ("path", "value", "code"),
    [
        ("materials.0", "x", "invalid_material"),
        ("materials.0.pbrMetallicRoughness", [], "invalid_material"),
        ("materials.0.pbrMetallicRoughness.baseColorTexture.index", 5, "invalid_material"),
        ("materials.0.normalTexture", {"index": 0, "texCoord": -1}, "invalid_material"),
        ("textures.0.source", 4, "invalid_texture"),
        ("textures.0.sampler", 4, "invalid_texture"),
        ("textures.0", 1, "invalid_texture"),
        ("samplers.0.magFilter", 9984, "invalid_sampler"),
        ("samplers.0.wrapS", 1, "invalid_sampler"),
        ("samplers.0.minFilter", [9728], "invalid_sampler"),
        ("images.0", 3, "invalid_image"),
        ("images.0.bufferView", 50, "invalid_image"),
        ("images.0.mimeType", "image/gif", "image_type"),
        ("images.0.mimeType", "image/jpeg", "image_type"),  # PNG bytes claiming JPEG
    ],
)
def test_material_texture_image_checks(path: str, value: Any, code: str) -> None:
    assert code in change(setter(path, value))


def test_image_dimensions_png_jpeg_webp() -> None:
    png_outcome = validate(static_glb(texture=png(64, 32)))
    assert png_outcome.facts.images == [
        {"index": 0, "mime_type": "image/png", "width": 64, "height": 32}
    ]
    jpeg_outcome = validate(static_glb(texture=jpeg(300, 200, app_bytes=5000), mime="image/jpeg"))
    assert jpeg_outcome.facts.images[0]["width"] == 300
    assert jpeg_outcome.facts.images[0]["height"] == 200
    webp_outcome = validate(static_glb(texture=webp(40, 20), mime="image/webp"))
    assert webp_outcome.report.codes(_error()) == ["image_type"]  # WebP is not loadable
    assert webp_outcome.facts.images[0] == {
        "index": 0,
        "mime_type": "image/webp",
        "width": 40,
        "height": 20,
    }


def _error() -> Any:
    from lai_processing.contracts import Severity

    return Severity.ERROR


def test_png_header_claiming_100000_square_is_refused_without_decoding() -> None:
    outcome = validate(static_glb(texture=png(100_000, 100_000)))
    assert outcome.report.codes(_error()) == ["texture_too_large"]
    assert outcome.facts.images[0]["width"] == 100_000


def test_max_texture_dimension_setting() -> None:
    data = static_glb(texture=png(1024, 16))
    assert error_codes(data, GlbSettings(max_texture_dimension=1024)) == set()
    assert error_codes(data, GlbSettings(max_texture_dimension=1023)) == {"texture_too_large"}


def test_unreadable_image_header_warns() -> None:
    broken = b"\x89PNG\r\n\x1a\n" + b"\x00" * 24
    data = static_glb(texture=broken)
    assert error_codes(data) == set()
    assert "image_dimensions_unknown" in warning_codes(data)


def test_jpeg_without_frame_header_warns() -> None:
    data = static_glb(texture=b"\xff\xd8\xff\xda\x00\x02" + b"\x00" * 32, mime="image/jpeg")
    assert "image_dimensions_unknown" in warning_codes(data)


def test_data_uri_images() -> None:
    good = setter("images.0", {"uri": data_uri("image/png", png(8, 8))})
    outcome = validate(mutated(good))
    assert outcome.report.codes(_error()) == []
    assert outcome.facts.images[0]["width"] == 8
    assert change(setter("images.0", {"uri": data_uri("image/png", b"GIF89a" * 4)})) == {
        "image_type"
    }
    assert change(setter("images.0", {"uri": "data:image/png;base64,!!!!"})) == {"image_type"}
    assert change(setter("images.0", {"uri": data_uri("image/svg+xml", b"<svg/>")})) == {
        "image_type"
    }
    both = setter("images.0", {"uri": data_uri("image/png", png(8, 8)), "bufferView": 2})
    assert "invalid_image" in change(both)


@pytest.mark.parametrize(
    "uri", ["https://example.invalid/t.png", "../textures/t.png", "t.png", "file:///t.png"]
)
def test_external_image_uri_is_refused(uri: str) -> None:
    assert change(setter("images.0", {"uri": uri})) == {"external_resource"}


# --- nodes, scenes and bounds -----------------------------------------------------------------


@pytest.mark.parametrize(
    ("node", "code"),
    [
        ({"mesh": 3}, "invalid_node"),
        ({"mesh": 0, "skin": 0}, "invalid_node"),
        ({"mesh": 0, "camera": 0}, "invalid_node"),
        ({"mesh": 0, "children": [5]}, "invalid_node"),
        ({"mesh": 0, "children": "1"}, "invalid_node"),
        ({"mesh": 0, "children": [0]}, "node_cycle"),
        ({"mesh": 0, "matrix": [1, 0, 0]}, "invalid_node"),
        ({"mesh": 0, "rotation": [0, 0, 0, "1"]}, "invalid_node"),
        ("node", "invalid_node"),
    ],
)
def test_node_checks(node: Any, code: str) -> None:
    assert code in change(setter("nodes.0", node))


def test_node_with_two_parents() -> None:
    nodes = [{"mesh": 0, "children": [2]}, {"children": [2]}, {}]
    assert "node_cycle" in change(setter("nodes", nodes))


def test_unreachable_cycle_is_found() -> None:
    nodes = [{"mesh": 0}, {"children": [2]}, {"children": [1]}]
    assert change(setter("nodes", nodes)) == {"node_cycle"}


def test_cycle_through_the_scene_root() -> None:
    nodes = [{"mesh": 0, "children": [1]}, {"children": [0]}]
    assert change(setter("nodes", nodes)) == {"node_cycle"}


def test_node_depth_limit() -> None:
    depth = COMPLEXITY_DEFAULTS["max_node_depth"]

    def chain(length: int) -> Callable[[Document], None]:
        def apply(document: Document) -> None:
            nodes: list[dict[str, Any]] = [{"children": [i + 1]} for i in range(length)]
            nodes.append({"mesh": 0})
            document["nodes"] = nodes

        return apply

    assert change(chain(depth)) == set()
    assert change(chain(depth + 1)) == {"too_complex"}


def test_scene_checks() -> None:
    assert change(setter("scenes", [])) == {"no_scene"}
    assert change(setter("scene", 3)) == {"no_scene"}
    assert change(setter("scenes.0.nodes", [0, 0])) == {"node_cycle"}
    assert change(setter("scenes.0", "x")) == {"invalid_scene", "no_geometry"}
    assert change(setter("scenes.0.nodes", [])) == {"no_geometry"}


def test_bounds_follow_node_transforms_like_django() -> None:
    outcome = validate(static_glb())
    # The quad spans x and z from -0.5 to 0.5 at y = 0, moved up by 1.
    assert outcome.facts.bounds_min == [-0.5, 1.0, -0.5]
    assert outcome.facts.bounds_max == [0.5, 1.0, 0.5]


def test_missing_position_bounds_warns_or_fails() -> None:
    def no_bounds(document: Document) -> None:
        del document["accessors"][0]["min"]

    assert change(no_bounds) == {"no_geometry"}

    def second_primitive(document: Document) -> None:
        document["accessors"].append(
            {"bufferView": 0, "componentType": 5126, "count": 4, "type": "VEC3"}
        )
        document["meshes"][0]["primitives"].append({"attributes": {"POSITION": 2}})

    data = mutated(second_primitive)
    assert error_codes(data) == set()
    assert "missing_bounds" in warning_codes(data)


def test_non_finite_bounds_from_huge_transforms() -> None:
    big = [1e200, 1e200, 1e200]  # each finite; their product overflows to infinity
    nodes = [{"scale": big, "children": [1]}, {"mesh": 0, "scale": big}]
    assert change(setter("nodes", nodes)) == {"invalid_node"}


# --- skins ------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("path", "value"),
    [
        ("skins.0.joints", []),
        ("skins.0.joints", [1, 99]),
        ("skins.0.joints", [1, 1]),
        ("skins.0.skeleton", 40),
        ("skins.0.inverseBindMatrices", 99),
        ("skins.0.inverseBindMatrices", 0),  # VEC3 positions are not MAT4
        ("skins.0", None),
    ],
)
def test_skin_checks(path: str, value: Any) -> None:
    assert "invalid_skin" in change(setter(path, value), skinned_model)


def test_inverse_bind_matrices_count_must_cover_joints() -> None:
    def apply(document: Document) -> None:
        document["nodes"].append({})
        document["scenes"][0]["nodes"].append(3)
        document["skins"][0]["joints"] = [1, 2, 3]

    assert change(apply, skinned_model) == {"invalid_skin"}


# --- animations -------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("path", "value"),
    [
        ("animations.0.samplers", []),
        ("animations.0.channels", []),
        ("animations.0.samplers.0.input", 99),
        ("animations.0.samplers.0.output", 99),
        ("animations.0.samplers.0.interpolation", "SMOOTH"),
        ("animations.0.samplers.0.interpolation", ["LINEAR"]),
        ("animations.0.samplers.0.input", 0),  # VEC3 positions are not keyframe times
        ("animations.0.channels.0.sampler", 4),
        ("animations.0.channels.0.target.path", "colour"),
        ("animations.0.channels.0.target.path", {"p": 1}),
        ("animations.0.channels.0.target.node", 30),
        ("animations.0.channels.0.target", None),
        ("animations.0.samplers.0.interpolation", "CUBICSPLINE"),  # needs 3 outputs per key
        ("animations.0.channels.0.target.path", "rotation"),  # VEC3 output for VEC4 rotation
        ("animations.0", 7),
    ],
)
def test_animation_checks(path: str, value: Any) -> None:
    assert "invalid_animation" in change(setter(path, value), skinned_model)


def test_negative_keyframe_times_are_refused() -> None:
    assert "invalid_animation" in change(setter("accessors.5.min", [-1.0]), skinned_model)


def test_keyframe_times_without_min_max_are_refused() -> None:
    def apply(document: Document) -> None:
        del document["accessors"][5]["max"]

    assert "invalid_animation" in change(apply, skinned_model)


def test_durations_and_exact_clip_names() -> None:
    from glb_builder import MIXAMO_CLIP

    outcome = validate(skinned_glb((MIXAMO_CLIP, "Idle", "Walk.001")))
    assert [(a["name"], a["duration_seconds"]) for a in outcome.facts.animations] == [
        (MIXAMO_CLIP, 1.25),
        ("Idle", 2.5),
        ("Walk.001", 3.75),
    ]
    warnings = outcome.report.findings()
    assert {(w.code, w.path) for w in warnings} >= {
        ("generic_clip_name", "animations[0]"),
        ("unknown_clip", "animations[0]"),
        ("unknown_clip", "animations[2]"),
    }
    assert all(MIXAMO_CLIP not in w.message for w in warnings)


def test_clip_name_rules_match_django() -> None:
    assert error_codes(skinned_glb(("Idle", "Idle"))) == {"duplicate_clip"}
    assert error_codes(skinned_glb(("x" * 65,))) == {"clip_name"}
    assert error_codes(skinned_glb(("x" * 64,))) == set()
    unnamed = mutated(setter("animations.0.name", "   "), skinned_model)
    assert "unnamed_clip" in warning_codes(unnamed)


def test_require_animations_option() -> None:
    settings = GlbSettings(require_animations=True)
    assert error_codes(static_glb(), settings) == {"animations_required"}
    assert error_codes(skinned_glb(), settings) == set()


# --- complexity limits and hostile sizes ------------------------------------------------------


@pytest.mark.parametrize(
    ("array", "limit"),
    [
        ("nodes", "max_nodes"),
        ("materials", "max_materials"),
        ("textures", "max_textures"),
        ("images", "max_images"),
        ("samplers", "max_samplers"),
        ("animations", "max_animations"),
        ("skins", "max_skins"),
        ("accessors", "max_accessors"),
        ("bufferViews", "max_buffer_views"),
        ("meshes", "max_meshes"),
        ("buffers", "max_buffers"),
        ("scenes", "max_scenes"),
    ],
)
def test_array_complexity_limits(array: str, limit: str) -> None:
    settings = GlbSettings.resolve({limit: 2})

    def apply(document: Document) -> None:
        document[array] = [{} for _ in range(3)]

    outcome = validate(mutated(apply), settings)
    assert outcome.report.codes(_error()) == ["too_complex"]
    assert outcome.report.findings()[0].path == array


def test_fifty_thousand_element_array_hits_the_default_limit() -> None:
    outcome = validate(mutated(setter("accessors", [{}] * 50_000)))
    assert outcome.report.codes(_error()) == ["too_complex"]


def test_vertex_triangle_primitive_joint_channel_limits() -> None:
    for name in ("max_vertices", "max_triangles"):
        assert error_codes(static_glb(), GlbSettings.resolve({name: 1})) == {"too_complex"}
    assert error_codes(static_glb(), GlbSettings.resolve({"max_primitives": 0 + 1})) == set()

    def two_primitives(document: Document) -> None:
        document["meshes"][0]["primitives"].append(document["meshes"][0]["primitives"][0])

    data = mutated(two_primitives)
    assert error_codes(data, GlbSettings.resolve({"max_primitives": 1})) == {"too_complex"}
    for name in ("max_joints", "max_channels", "max_animation_samplers"):
        assert error_codes(skinned_glb(), GlbSettings.resolve({name: 1})) == {"too_complex"}


def test_requested_limits_are_clamped_to_the_processor_ceilings() -> None:
    settings = GlbSettings.resolve({"max_json_bytes": 2**53, "max_nodes": 5})
    assert settings.limit("max_json_bytes") == COMPLEXITY_CEILINGS["max_json_bytes"]
    assert settings.limit("max_nodes") == 5
    assert settings.limit("max_meshes") == COMPLEXITY_DEFAULTS["max_meshes"]


def test_hostile_huge_declared_counts_do_not_allocate() -> None:
    def apply(document: Document) -> None:
        document["accessors"][0]["count"] = 9_999_999
        document["buffers"][0]["byteLength"] = 2**53
        document["bufferViews"][0]["byteLength"] = 2**53 - 1

    codes = change(apply)
    assert "buffer_bounds" in codes


def test_findings_are_bounded() -> None:
    def apply(document: Document) -> None:
        document["accessors"] = [{"count": 0}] * 5000

    outcome = validate(mutated(apply))
    findings = outcome.report.findings()
    assert len(findings) <= 201
    assert findings[-1].code == "too_many_findings"
    assert findings[-1].severity.value == "error"


# --- cancellation and deadline ----------------------------------------------------------------


def test_check_is_called_inside_document_loops() -> None:
    calls = 0

    def check() -> None:
        nonlocal calls
        calls += 1

    validate(mutated(setter("nodes", [{"mesh": 0}] + [{} for _ in range(2000)])), check=check)
    assert calls > 2000


def test_cancellation_stops_the_walk() -> None:
    calls = 0

    def check() -> None:
        nonlocal calls
        calls += 1
        if calls > 50:
            raise ProcessingError(ErrorCode.CANCELLED)

    with pytest.raises(ProcessingError) as info:
        validate(mutated(setter("nodes", [{"mesh": 0}] + [{} for _ in range(5000)])), check=check)
    assert info.value.code is ErrorCode.CANCELLED


def test_no_python_exception_escapes_for_odd_types() -> None:
    # Unhashable and mistyped values where indices, enums and objects are expected.
    oddities: list[Any] = [None, [], {}, "x", -1, 1.5, True, [[]], {"a": []}]
    document, binary = skinned_model()
    targets = [
        "scene",
        "nodes.0.mesh",
        "nodes.0.children",
        "meshes.0.primitives.0",
        "meshes.0.primitives.0.attributes",
        "meshes.0.primitives.0.indices",
        "accessors.0.sparse",
        "bufferViews.0",
        "skins.0.joints",
        "animations.0.samplers.0",
        "animations.0.channels.0.target",
        "extensionsUsed",
        "asset.minVersion",
    ]
    for target in targets:
        for odd in oddities:
            data = mutated(setter(target, odd), skinned_model)
            validate(data)  # must not raise
    del document, binary


def test_bin_offsets_are_aligned_in_builder_fixtures() -> None:
    data = static_glb()
    json_length = struct.unpack_from("<I", data, 12)[0]
    assert json_length % 4 == 0
