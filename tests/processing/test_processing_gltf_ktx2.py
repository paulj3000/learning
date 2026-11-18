"""KHR_texture_basisu and KTX2 container validation (ADR-070).

Synthetic KTX2 files (`ktx2_builder`) and synthetic GLB documents; no binary fixtures. The module
is self-contained; the principal wires it into the validators' policy row at integration.
"""

from __future__ import annotations

import struct
from typing import Any

import pytest
from glb_builder import Builder
from ktx2_builder import BASISLZ, ETC1S, LINEAR, NONE, SRGB, UASTC, ZSTD, ktx2

from lai_processing.processors.gltf.compression import compression_support
from lai_processing.processors.gltf.compression.ktx2 import (
    KTX2_IDENTIFIER,
    ktx2_image_indices,
    parse_ktx2,
    validate_basisu,
)
from lai_processing.processors.gltf.report import Report


def _errors(report: Report) -> set[str]:
    return {f.code for f in report.findings() if f.severity.value == "error"}


def _parse(data: bytes, **kwargs: Any):  # type: ignore[no-untyped-def]
    report = Report()
    info = parse_ktx2(data, report, "images[0]", **kwargs)
    return report, info


# --- container --------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("scheme", "transfer", "codec", "space"),
    [
        (BASISLZ, SRGB, "etc1s", "srgb"),
        (ZSTD, LINEAR, "uastc", "linear"),
        (NONE, LINEAR, "uastc", "linear"),
    ],
)
def test_valid_containers(scheme: int, transfer: int, codec: str, space: str) -> None:
    report, info = _parse(ktx2(256, 128, scheme=scheme, transfer=transfer))
    assert _errors(report) == set()
    assert info is not None
    assert (info.width, info.height, info.level_count) == (256, 128, 9)
    assert info.codec == codec and info.color_space == space
    assert info.orientation == "rd"
    metadata = info.as_metadata()
    assert metadata["basis"] == "calculated"
    # 8 bpp with a full chain: 256*128 + 128*64 + ... down to 1x1
    expected = sum(max(1, 256 >> i) * max(1, 128 >> i) for i in range(9))
    assert metadata["gpu_bytes_estimate"] == expected
    assert metadata["gpu_bytes_rgba8_fallback"] == expected * 4


def test_single_level_is_valid_and_partial_chain_warns() -> None:
    report, info = _parse(ktx2(64, 64, levels=1))
    assert _errors(report) == set() and info is not None
    assert "ktx2_partial_mips" not in report.codes()
    report, info = _parse(ktx2(64, 64, levels=3))
    assert _errors(report) == set() and info is not None
    assert "ktx2_partial_mips" in report.codes()


@pytest.mark.parametrize(
    ("kwargs", "code"),
    [
        ({"vk_format": 37}, "ktx2_format"),
        ({"width": 66}, "ktx2_dimensions"),
        ({"height": 0}, "ktx2_dimensions"),
        ({"width": 8192, "height": 8192, "levels": 1}, "texture_too_large"),
        ({"depth": 4}, "ktx2_shape"),
        ({"layers": 2}, "ktx2_shape"),
        ({"faces": 6}, "ktx2_shape"),
        ({"scheme": 3}, "ktx2_supercompression"),
        ({"levels": 0}, "ktx2_levels"),
        ({"levels": 9}, "ktx2_levels"),  # 64x64 allows 7
        ({"scheme": BASISLZ, "model": UASTC}, "ktx2_color_model"),
        ({"scheme": ZSTD, "model": ETC1S}, "ktx2_color_model"),
        ({"transfer": 3}, "ktx2_transfer"),
        ({"orientation": b"ru"}, "ktx2_orientation"),
        ({"scheme": BASISLZ, "sgd": b""}, "ktx2_truncated"),
        ({"scheme": ZSTD, "sgd": bytes(16)}, "ktx2_supercompression"),
        ({"level_patch": {0: (10**9, 16, 0)}}, "ktx2_truncated"),
        ({"level_patch": {0: (200, 0, 0)}}, "ktx2_truncated"),
        ({"level_patch": {1: (10, 16, 0)}}, "ktx2_truncated"),  # inside the header and index
    ],
)
def test_container_errors(kwargs: dict[str, Any], code: str) -> None:
    params: dict[str, Any] = {"width": 64, "height": 64, **kwargs}
    report, info = _parse(ktx2(**params))
    assert code in _errors(report)
    assert info is None


def test_uastc_level_lengths_must_match_the_block_count() -> None:
    data = ktx2(64, 64, scheme=ZSTD, transfer=LINEAR)
    offset, length, _ = struct.unpack_from("<3Q", data, 80)
    patched = bytearray(data)
    struct.pack_into("<3Q", patched, 80, offset, length, 12345)
    report, _info = _parse(bytes(patched))
    assert "ktx2_levels" in _errors(report)
    raw = ktx2(64, 64, scheme=NONE, transfer=LINEAR)
    offset, length, _ = struct.unpack_from("<3Q", raw, 80)
    patched = bytearray(raw)
    struct.pack_into("<3Q", patched, 80, offset, length - 16, 0)
    report, _info = _parse(bytes(patched))
    assert "ktx2_levels" in _errors(report)
    basis = ktx2(64, 64, scheme=BASISLZ)
    offset, length, _ = struct.unpack_from("<3Q", basis, 80)
    patched = bytearray(basis)
    struct.pack_into("<3Q", patched, 80, offset, length, 7)
    report, _info = _parse(bytes(patched))
    assert "ktx2_levels" in _errors(report)


def test_not_a_ktx2_file() -> None:
    for data in (b"", b"\x89PNG\r\n\x1a\n" + bytes(100), KTX2_IDENTIFIER + bytes(10)):
        report, info = _parse(data)
        assert "ktx2_invalid" in _errors(report)
        assert info is None


def test_truncated_level_index() -> None:
    data = ktx2(64, 64)
    report, info = _parse(data[:100])
    assert _errors(report) and info is None


def test_missing_dfd() -> None:
    data = bytearray(ktx2(64, 64))
    struct.pack_into("<II", data, 48, 0, 0)
    report, info = _parse(bytes(data))
    assert "ktx2_dfd" in _errors(report) and info is None


def test_missing_orientation_is_accepted() -> None:
    report, info = _parse(ktx2(64, 64, orientation=None))
    assert _errors(report) == set()
    assert info is not None and info.orientation is None


def test_side_limit_is_configurable() -> None:
    report, _info = _parse(ktx2(1024, 1024), max_side=512)
    assert "texture_too_large" in _errors(report)


# --- glTF side --------------------------------------------------------------------------------


def basisu_model(
    images: list[bytes], slots: dict[str, int], *, required: bool = True, fallback: bool = False
) -> tuple[dict[str, Any], dict[int, bytes]]:
    builder = Builder()
    position = builder.accessor(
        "f", [0, 0, 0, 1, 0, 0, 0, 1, 0], 5126, "VEC3", min=[0, 0, 0], max=[1, 1, 0]
    )
    image_entries = [
        {"bufferView": builder.view(data), "mimeType": "image/ktx2"} for data in images
    ]
    textures: list[dict[str, Any]] = []
    for index in range(len(images)):
        texture: dict[str, Any] = {"extensions": {"KHR_texture_basisu": {"source": index}}}
        if fallback:
            texture["source"] = len(image_entries)
        textures.append(texture)
    if fallback:
        image_entries.append(
            {"bufferView": builder.view(b"\x89PNG\r\n\x1a\n" + bytes(16)), "mimeType": "image/png"}
        )
    pbr: dict[str, Any] = {}
    material: dict[str, Any] = {"name": "M", "pbrMetallicRoughness": pbr}
    for slot, texture_index in slots.items():
        target = pbr if slot in ("baseColorTexture", "metallicRoughnessTexture") else material
        target[slot] = {"index": texture_index}
    document: dict[str, Any] = {
        "asset": {"version": "2.0"},
        "extensionsUsed": ["KHR_texture_basisu"],
        "meshes": [{"primitives": [{"attributes": {"POSITION": position}, "material": 0}]}],
        "materials": [material],
        "textures": textures,
        "images": image_entries,
    }
    if required:
        document["extensionsRequired"] = ["KHR_texture_basisu"]
    document, _binary = builder.finish(document)
    return document, dict(enumerate(images))


def _validate(document: dict[str, Any], images: dict[int, bytes] | None = None):  # type: ignore[no-untyped-def]
    report = Report()
    facts = validate_basisu(
        document, report, read_image=(images or {}).get if images is not None else None
    )
    return report, facts


def test_valid_basisu_model_with_colour_and_data_textures() -> None:
    color = ktx2(512, 512, scheme=BASISLZ, transfer=SRGB)
    normal = ktx2(256, 256, scheme=ZSTD, transfer=LINEAR)
    document, images = basisu_model([color, normal], {"baseColorTexture": 0, "normalTexture": 1})
    report, facts = _validate(document, images)
    assert _errors(report) == set()
    assert "ktx2_payload_not_decoded" in report.codes()
    metadata = facts.as_metadata()
    assert metadata["texture_count"] == 2
    assert [i["codec"] for i in metadata["images"]] == ["etc1s", "uastc"]
    assert metadata["gpu_bytes_estimate"] == sum(
        i["gpu_bytes_estimate"] for i in metadata["images"]
    )
    assert ktx2_image_indices(document) == frozenset({0, 1})


@pytest.mark.parametrize(
    ("slot", "transfer"),
    [
        ("baseColorTexture", LINEAR),
        ("emissiveTexture", LINEAR),
        ("normalTexture", SRGB),
        ("occlusionTexture", SRGB),
        ("metallicRoughnessTexture", SRGB),
    ],
)
def test_colour_space_must_match_material_usage(slot: str, transfer: int) -> None:
    scheme = BASISLZ if transfer == SRGB else ZSTD
    document, images = basisu_model([ktx2(64, 64, scheme=scheme, transfer=transfer)], {slot: 0})
    report, _facts = _validate(document, images)
    assert "ktx2_color_space" in _errors(report)


def test_one_image_used_as_colour_and_data() -> None:
    document, images = basisu_model([ktx2()], {"baseColorTexture": 0, "normalTexture": 0})
    report, _facts = _validate(document, images)
    assert "ktx2_mixed_color_usage" in _errors(report)


def test_no_fallback_requires_the_extension() -> None:
    document, images = basisu_model([ktx2()], {"baseColorTexture": 0}, required=False)
    report, _facts = _validate(document, images)
    assert "ktx2_requires_extension" in _errors(report)


def test_png_fallback_is_allowed_with_a_warning() -> None:
    document, images = basisu_model(
        [ktx2()], {"baseColorTexture": 0}, required=False, fallback=True
    )
    report, facts = _validate(document, images)
    assert _errors(report) == set()
    assert "ktx2_fallback_present" in report.codes()
    assert facts.fallbacks == 1


def test_source_must_be_a_ktx2_image() -> None:
    document, images = basisu_model([ktx2()], {"baseColorTexture": 0})
    document["images"][0]["mimeType"] = "image/png"
    report, _facts = _validate(document, images)
    assert "ktx2_image_type" in _errors(report)
    document["textures"][0]["extensions"]["KHR_texture_basisu"]["source"] = 9
    report, _facts = _validate(document, images)
    assert "ktx2_invalid_source" in _errors(report)
    document["textures"][0]["extensions"]["KHR_texture_basisu"] = "x"
    report, _facts = _validate(document, images)
    assert "ktx2_invalid_source" in _errors(report)


def test_ktx2_image_through_plain_source_is_refused() -> None:
    document, images = basisu_model([ktx2()], {"baseColorTexture": 0})
    document["textures"][0] = {"source": 0}
    report, _facts = _validate(document, images)
    assert "ktx2_without_extension" in _errors(report)


def test_declarations() -> None:
    document, images = basisu_model([ktx2()], {"baseColorTexture": 0})
    document["extensionsUsed"] = []
    report, _facts = _validate(document, images)
    assert {"ktx2_not_declared", "extension_required_not_used"} <= _errors(report)


def test_container_errors_surface_through_the_document_check() -> None:
    document, _images = basisu_model([ktx2()], {"baseColorTexture": 0})
    report, facts = _validate(document, {0: ktx2(66, 64)})
    assert "ktx2_dimensions" in _errors(report)
    assert facts.images == {}


def test_without_a_reader_only_the_gltf_side_is_checked() -> None:
    document, _images = basisu_model([ktx2()], {"baseColorTexture": 0})
    report, facts = _validate(document, None)
    assert _errors(report) == set()
    assert facts.textures == 1 and facts.images == {}


def test_data_uri_ktx2_image_is_recognised() -> None:
    document, images = basisu_model([ktx2()], {"baseColorTexture": 0})
    del document["images"][0]["bufferView"]
    del document["images"][0]["mimeType"]
    document["images"][0]["uri"] = "data:image/ktx2;base64,AAAA"
    report, _facts = _validate(document, images)
    assert _errors(report) == set()


def test_policy_row_for_ktx2() -> None:
    assert compression_support("KHR_texture_basisu").value == "supported_when_enabled"
