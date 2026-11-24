"""GLB metadata: schema, exact names, bounded strings, list caps and determinism."""

from __future__ import annotations

import json
from typing import Any

from glb_builder import (
    MIXAMO_CLIP,
    Document,
    glb,
    mutated,
    png,
    skinned_glb,
    skinned_model,
    static_glb,
    static_model,
    validate,
)

from lai_processing.core.canonical import canonical_json
from lai_processing.processors.gltf.metadata import MAX_LISTED, build_metadata

TOP_LEVEL_KEYS = {
    "animations",
    "bin_chunk_bytes",
    "bounds",
    "clip_vocabulary_matches",
    "counts",
    "document_read",
    "extensions_required",
    "extensions_used",
    "file_size_bytes",
    "format",
    "generator",
    "gltf_version",
    "images",
    "json_chunk_bytes",
    "lists_truncated",
    "material_names",
    "metadata_version",
    "min_version",
    "skins",
    "triangle_count",
    "unsupported_extensions",
    "vertex_count",
}
COUNT_KEYS = {
    "accessors",
    "animations",
    "buffer_views",
    "buffers",
    "channels",
    "images",
    "joints",
    "materials",
    "meshes",
    "nodes",
    "primitives",
    "samplers",
    "scenes",
    "skins",
    "textures",
}


def metadata(data: bytes, max_bytes: int = 64 * 1024) -> dict[str, Any]:
    return build_metadata(validate(data), max_bytes)


def test_static_model_metadata_golden() -> None:
    data = static_glb(texture=png(64, 32))
    meta = metadata(data)
    assert set(meta) == TOP_LEVEL_KEYS
    assert set(meta["counts"]) == COUNT_KEYS
    assert meta == {
        "animations": [],
        "bin_chunk_bytes": meta["bin_chunk_bytes"],
        "bounds": {"max": [0.5, 1.0, 0.5], "min": [-0.5, 1.0, -0.5]},
        "clip_vocabulary_matches": [],
        "counts": {
            "accessors": 2,
            "animations": 0,
            "buffer_views": 3,
            "buffers": 1,
            "channels": 0,
            "images": 1,
            "joints": 0,
            "materials": 1,
            "meshes": 1,
            "nodes": 1,
            "primitives": 1,
            "samplers": 1,
            "scenes": 1,
            "skins": 0,
            "textures": 1,
        },
        "document_read": True,
        "extensions_required": [],
        "extensions_used": [],
        "file_size_bytes": len(data),
        "format": "glb",
        "generator": "lai-glb-builder",
        "gltf_version": "2.0",
        "images": [{"height": 32, "index": 0, "mime_type": "image/png", "width": 64}],
        "json_chunk_bytes": meta["json_chunk_bytes"],
        "lists_truncated": False,
        "material_names": ["Sand Mat"],
        "metadata_version": 1,
        "min_version": None,
        "skins": [],
        "triangle_count": 2,
        "unsupported_extensions": [],
        "vertex_count": 4,
    }
    assert meta["bin_chunk_bytes"] + meta["json_chunk_bytes"] + 28 == len(data)


def test_skinned_animated_metadata_keeps_clip_names_exactly() -> None:
    meta = metadata(skinned_glb((MIXAMO_CLIP, "Idle", "Walk")))
    assert meta["animations"] == [
        {"channel_count": 1, "duration_seconds": 1.25, "name": MIXAMO_CLIP, "sampler_count": 1},
        {"channel_count": 1, "duration_seconds": 2.5, "name": "Idle", "sampler_count": 1},
        {"channel_count": 1, "duration_seconds": 3.75, "name": "Walk", "sampler_count": 1},
    ]
    # Exact membership only; the Mixamo take is never mapped to a state.
    assert meta["clip_vocabulary_matches"] == ["Idle", "Walk"]
    assert meta["skins"] == [{"joint_count": 2, "name": "Armature"}]
    assert meta["counts"]["joints"] == 2
    assert meta["counts"]["channels"] == 3


def test_vocabulary_matches_are_case_sensitive() -> None:
    meta = metadata(skinned_glb(("idle", "IDLE", "Idle ")))
    assert meta["clip_vocabulary_matches"] == []
    assert [a["name"] for a in meta["animations"]] == ["idle", "IDLE", "Idle "]


def test_duration_is_rounded_to_six_places() -> None:
    def apply(document: Document) -> None:
        document["accessors"][5]["max"] = [1.0 / 3.0]

    meta = metadata(mutated(apply, skinned_model))
    assert meta["animations"][0]["duration_seconds"] == 0.333333


def test_names_are_cleaned_and_bounded() -> None:
    def apply(document: Document) -> None:
        document["materials"][0]["name"] = "Ev‮il\x00\x1b[31m" + "m" * 300
        document["asset"]["generator"] = "gen\r\nerator\ud800"

    outcome = validate(mutated(apply))
    meta = build_metadata(outcome, 64 * 1024)
    name = meta["material_names"][0]
    assert name.startswith("Evil[31m")
    assert len(name) == 200
    assert meta["generator"] == "generator"
    assert [w.code for w in outcome.report.warnings()] == ["metadata_text_truncated"]
    canonical_json(meta)  # encodable, no lone surrogates


def test_non_string_names_become_null() -> None:
    def apply(document: Document) -> None:
        document["materials"][0]["name"] = {"x": 1}
        document["asset"]["generator"] = 7

    meta = metadata(mutated(apply))
    assert meta["material_names"] == [None]
    assert meta["generator"] is None


def test_lists_are_capped() -> None:
    def apply(document: Document) -> None:
        document["materials"] = [{"name": f"m{i}"} for i in range(MAX_LISTED + 20)]

    outcome = validate(mutated(apply))
    meta = build_metadata(outcome, 64 * 1024)
    assert len(meta["material_names"]) == MAX_LISTED
    assert meta["counts"]["materials"] == MAX_LISTED + 20
    assert "metadata_list_truncated" in [w.code for w in outcome.report.warnings()]


def test_metadata_fits_the_job_limit() -> None:
    def apply(document: Document) -> None:
        document["materials"] = [{"name": "n" * 200} for _ in range(MAX_LISTED)]

    outcome = validate(mutated(apply))
    meta = build_metadata(outcome, 8 * 1024)
    assert len(canonical_json(meta)) <= 8 * 1024
    assert meta["lists_truncated"] is True
    assert meta["material_names"] == []
    assert meta["counts"]["materials"] == MAX_LISTED
    assert "metadata_truncated" in [w.code for w in outcome.report.warnings()]


def _astral_extension_glb() -> bytes:
    # 64 extension names of 200 astral characters: about 120 KB per list under ensure_ascii.
    names = [f"X{i:02d}" + "\U0001f600" * 199 for i in range(64)]
    document = {
        "asset": {"version": "2.0", "generator": "\U0001f600" * 300},
        "extensionsUsed": names,
        "extensionsRequired": names,
    }
    return glb(json.dumps(document).encode(), None)


def test_extension_lists_and_generator_are_dropped_to_fit() -> None:
    outcome = validate(_astral_extension_glb())
    meta = build_metadata(outcome, 64 * 1024)
    assert len(canonical_json(meta)) <= 64 * 1024
    assert set(meta) == TOP_LEVEL_KEYS
    assert meta["lists_truncated"] is True
    assert meta["extensions_used"] == meta["extensions_required"] == []
    assert meta["unsupported_extensions"] == []
    assert meta["generator"] is None
    assert "metadata_truncated" in [w.code for w in outcome.report.warnings()]


def test_minimal_fallback_when_even_the_trimmed_object_does_not_fit() -> None:
    outcome = validate(static_glb())
    full = build_metadata(outcome, 64 * 1024)
    trimmed = build_metadata(validate(static_glb()), len(canonical_json(full)) - 1)
    assert trimmed["bounds"] is not None  # emptying the lists was enough here
    limit = len(canonical_json(trimmed)) - 1
    meta = build_metadata(validate(static_glb()), limit)
    assert len(canonical_json(meta)) <= limit
    assert set(meta) == TOP_LEVEL_KEYS
    assert meta["lists_truncated"] is True
    assert meta["counts"] == full["counts"]
    assert meta["vertex_count"] == full["vertex_count"]
    assert meta["triangle_count"] == full["triangle_count"]
    assert meta["bounds"] is None
    assert meta["gltf_version"] == "2.0"


def test_metadata_for_an_unreadable_file() -> None:
    meta = metadata(b"not a model at all")
    assert set(meta) == TOP_LEVEL_KEYS
    assert meta["format"] is None
    assert meta["document_read"] is False
    assert meta["counts"] is None
    assert meta["file_size_bytes"] == 18


def test_metadata_for_a_container_that_reads_but_a_bad_document() -> None:
    meta = metadata(glb(b"{bad", None))
    assert meta["format"] == "glb"
    assert meta["document_read"] is False


def test_extensions_listed_sorted_and_unsupported_named() -> None:
    def apply(document: Document) -> None:
        document["extensionsUsed"] = [
            "KHR_texture_transform",
            "VENDOR_b",
            "KHR_draco_mesh_compression",
        ]
        document["extensionsRequired"] = ["KHR_draco_mesh_compression"]

    meta = metadata(mutated(apply))
    assert meta["extensions_used"] == [
        "KHR_draco_mesh_compression",
        "KHR_texture_transform",
        "VENDOR_b",
    ]
    assert meta["extensions_required"] == ["KHR_draco_mesh_compression"]
    assert meta["unsupported_extensions"] == ["KHR_draco_mesh_compression", "VENDOR_b"]


def test_bounds_absent_without_geometry() -> None:
    def apply(document: Document) -> None:
        del document["accessors"][0]["max"]

    assert metadata(mutated(apply))["bounds"] is None


def test_same_bytes_give_identical_metadata() -> None:
    data = skinned_glb((MIXAMO_CLIP, "Idle"))
    first = canonical_json(metadata(data))
    second = canonical_json(metadata(bytes(data)))
    assert first == second
    assert json.loads(first)["animations"][0]["name"] == MIXAMO_CLIP


def test_metadata_holds_no_findings_text_or_paths() -> None:
    document, binary = static_model()
    rendered = canonical_json(metadata(glb(document, binary))).decode()
    for forbidden in ("/tmp", "input.bin", "processing/"):  # noqa: S108 - asserted absent
        assert forbidden not in rendered
