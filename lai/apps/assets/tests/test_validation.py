"""AM-3: model validation (LAI-2200). Pure checks over synthetic files; no database needed."""

import io
import json
import struct
from types import SimpleNamespace

import pytest

from apps.assets.tests.helpers import glb_bytes, gltf_document, gltf_json_bytes
from apps.assets.validation import validate_model

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 24


def check(data: bytes, definition=None):
    return validate_model(io.BytesIO(data), size=len(data), definition=definition)


def codes(result):
    return {f.code for f in result.findings}


def definition(**fields):
    values = {"asset_id": "npc-pip", "status": "ACTIVE", "kind": "character", "clips": []}
    return SimpleNamespace(**{**values, **fields})


def test_a_valid_glb_passes_with_metadata():
    result = check(glb_bytes(clips=("Idle", "Talk"), half_size=(0.3, 0.7, 0.25)))
    assert result.passed, result.report()
    assert result.format == "glb"
    assert result.clips == ["Idle", "Talk"]
    assert result.dimensions == {"x": 0.6, "y": 1.4, "z": 0.5}
    assert result.metadata["counts"]["animations"] == 2


def test_a_self_contained_gltf_passes():
    result = check(gltf_json_bytes())
    assert result.passed, result.report()
    assert result.format == "gltf"


def test_node_transforms_are_applied_to_the_bounds():
    document, binary = gltf_document(half_size=(0.5, 0.5, 0.5))
    document["nodes"] = [
        {"children": [1], "scale": [2, 2, 2]},
        {"mesh": 0, "translation": [5, 0, 0]},
    ]
    document["scenes"] = [{"nodes": [0]}]
    document["animations"][0]["channels"][0]["target"]["node"] = 1
    result = check(glb_bytes(document, binary))
    assert result.passed, result.report()
    assert result.dimensions == {"x": 2.0, "y": 2.0, "z": 2.0}


@pytest.mark.parametrize(
    "data, code",
    [
        (b"", "empty_file"),
        (b"PK\x03\x04 a zip archive", "not_a_model"),
        (b"Kaydara FBX Binary  \x00", "not_a_model"),
        (b"BLENDER-v300", "not_a_model"),
        (b"{not json", "invalid_json"),
        (b"[1, 2, 3]", "not_a_model"),
        (b"glTF" + struct.pack("<II", 1, 12), "glb_version"),
        (b"glTF" + struct.pack("<II", 2, 9999), "glb_length"),
        (b"glTF\x02\x00", "not_glb"),
    ],
)
def test_files_that_are_not_models_are_rejected_by_content(data, code):
    result = check(data)
    assert not result.passed and code in codes(result), result.report()


def test_the_extension_does_not_decide_the_format():
    # A GLB passes whatever it is called; a zip renamed .glb fails. The name is never read.
    assert check(glb_bytes()).format == "glb"
    assert check(gltf_json_bytes()).format == "gltf"


def test_a_truncated_glb_is_rejected():
    data = glb_bytes()
    cut = data[:-20]
    cut = struct.pack("<III", 0x46546C67, 2, len(cut)) + cut[12:]
    result = check(cut)
    assert not result.passed and codes(result) & {"glb_chunks", "buffer_bounds"}, result.report()


def test_size_is_checked_before_reading(settings):
    settings.LAI_ASSET_MAX_UPLOAD_BYTES = 100

    class Exploding(io.BytesIO):
        def read(self, *args):
            raise AssertionError("must not read an oversized upload")

    result = validate_model(Exploding(b""), size=101)
    assert codes(result) == {"too_large"}


@pytest.mark.parametrize(
    "uri",
    [
        "model.bin",
        "../../etc/passwd",
        "file:///etc/passwd",
        "https://example.com/model.bin",
        "//example.com/model.bin",
    ],
)
def test_external_buffers_are_rejected_and_never_fetched(uri):
    document, _binary = gltf_document(buffer_uri=uri)
    result = check(json.dumps(document).encode())
    assert "external_resource" in codes(result) and not result.passed


def test_external_and_mislabelled_textures_are_rejected():
    document, binary = gltf_document(
        extra={"images": [{"uri": "textures/wood.png"}, {"uri": "data:image/png;base64,/9j/4AAQ"}]}
    )
    result = check(glb_bytes(document, binary))
    assert {"external_resource", "image_type"} <= codes(result)


def test_an_embedded_png_texture_passes():
    import base64

    uri = "data:image/png;base64," + base64.b64encode(PNG).decode()
    document, binary = gltf_document(extra={"images": [{"uri": uri}]})
    assert check(glb_bytes(document, binary)).passed


@pytest.mark.parametrize("extension", ["KHR_draco_mesh_compression", "EXT_meshopt_compression"])
def test_compression_that_needs_a_decoder_is_rejected(extension):
    document, binary = gltf_document(
        extra={"extensionsUsed": [extension], "extensionsRequired": [extension]}
    )
    assert "needs_decoder" in codes(check(glb_bytes(document, binary)))


def test_unknown_optional_extensions_only_warn_but_required_ones_fail():
    document, binary = gltf_document(extra={"extensionsUsed": ["VENDOR_sparkles"]})
    result = check(glb_bytes(document, binary))
    assert result.passed and "unknown_extension" in codes(result)
    document["extensionsRequired"] = ["VENDOR_sparkles"]
    assert not check(glb_bytes(document, binary)).passed


def test_buffer_views_and_accessors_must_stay_in_bounds():
    document, binary = gltf_document()
    document["bufferViews"][0]["byteLength"] = 10_000
    assert "buffer_bounds" in codes(check(glb_bytes(document, binary)))
    document, binary = gltf_document()
    document["accessors"][0]["count"] = 1000
    assert "buffer_bounds" in codes(check(glb_bytes(document, binary)))


def test_a_cyclic_scene_graph_is_rejected():
    document, binary = gltf_document()
    document["nodes"] = [{"mesh": 0, "children": [1]}, {"children": [0]}]
    assert "node_cycle" in codes(check(glb_bytes(document, binary)))


def test_a_scene_without_geometry_is_rejected():
    document, binary = gltf_document()
    document["nodes"] = [{"name": "empty"}]
    assert "no_geometry" in codes(check(glb_bytes(document, binary)))


def test_only_gltf_2_is_accepted():
    document, binary = gltf_document()
    document["asset"]["version"] = "1.0"
    assert "gltf_version" in codes(check(glb_bytes(document, binary)))


def test_deeply_nested_json_is_rejected_without_crashing():
    data = b'{"asset": ' + b"[" * 100_000 + b"]" * 100_000 + b"}"
    assert "invalid_json" in codes(check(data))


def test_oversized_json_is_refused(settings):
    from apps.assets import validation

    padding = b"x" * validation.LIMITS["json_bytes"]
    big = b'{"asset": {"version": "2.0"}, "pad": "' + padding + b'"}'
    assert "json_size" in codes(check(big))


# --- animation metadata and identity ---------------------------------------------------------


def test_duplicate_clip_names_fail_and_unknown_ones_warn():
    result = check(glb_bytes(clips=("Idle", "Idle")))
    assert "duplicate_clip" in codes(result) and not result.passed
    result = check(glb_bytes(clips=("Idle", "Moonwalk")))
    assert result.passed and "unknown_clip" in codes(result)
    assert result.clips == ["Idle", "Moonwalk"]


def test_a_new_version_must_keep_every_clip_existing_references_use():
    pip = definition(clips=["Idle", "Talk"])
    result = check(glb_bytes(clips=("Idle",)), pip)
    assert "missing_clip" in codes(result) and not result.passed
    assert check(glb_bytes(clips=("Idle", "Talk", "Wave")), pip).passed


def test_a_retired_or_malformed_definition_takes_no_new_version():
    assert "asset_retired" in codes(check(glb_bytes(), definition(status="RETIRED")))
    assert "asset_id" in codes(check(glb_bytes(), definition(asset_id="Bad Id")))


def test_findings_are_structured_for_administrators():
    result = check(glb_bytes(clips=("Idle", "Idle")))
    finding = next(f for f in result.report() if f["code"] == "duplicate_clip")
    assert set(finding) == {"code", "severity", "message", "path"}
    assert finding["severity"] == "error" and finding["path"] == "animations[1]"
