"""EXT_meshopt_compression validation and the compression support policy (ADR-070).

Every model is synthetic (`glb_builder`, `meshopt_builder`); no binary fixtures, no child data.
The functions under test are self-contained; wiring them into the validators' extension policy
happens at integration (Workstream B's table), so these tests call them directly.
"""

from __future__ import annotations

import copy
import io
import struct
from typing import Any

import pytest
from glb_builder import glb, skinned_model, static_model
from meshopt_builder import (
    EXT,
    attribute_stream,
    compress_views,
    index_stream,
    triangle_stream,
)

from lai_processing.processors.gltf.compression import (
    KTX2_CONTROL,
    MESHOPT_CONTROL,
    SupportStatus,
    compression_allowed,
    compression_policy,
    compression_support,
    enabled_controls,
    fallback_buffer_indices,
    validate_meshopt,
)
from lai_processing.processors.gltf.compression.meshopt import (
    DEFAULT_MAX_DECODED_BYTES,
    minimum_stream_length,
    uses_meshopt,
)
from lai_processing.processors.gltf.container import read_layout
from lai_processing.processors.gltf.report import Report

# --- policy -----------------------------------------------------------------------------------


def test_policy_statuses() -> None:
    assert compression_support("EXT_meshopt_compression") is SupportStatus.SUPPORTED_WHEN_ENABLED
    assert compression_support("KHR_texture_basisu") is SupportStatus.SUPPORTED_WHEN_ENABLED
    assert compression_support("KHR_mesh_quantization") is SupportStatus.SUPPORTED
    for rejected in (
        "KHR_draco_mesh_compression",
        "KHR_meshopt_compression",
        "EXT_texture_webp",
        "EXT_texture_avif",
    ):
        assert compression_support(rejected) is SupportStatus.REJECTED
    assert compression_support("KHR_texture_transform") is SupportStatus.NOT_COMPRESSION
    assert compression_support(None) is SupportStatus.NOT_COMPRESSION


def test_policy_controls_are_named_per_the_conventions() -> None:
    assert (
        compression_policy("EXT_meshopt_compression").control
        == MESHOPT_CONTROL
        == "LAI_GLB_MESHOPT"
    )
    assert compression_policy("KHR_texture_basisu").control == KTX2_CONTROL == "LAI_GLB_KTX2"


@pytest.mark.parametrize(
    ("extension", "enabled", "allowed"),
    [
        ("EXT_meshopt_compression", frozenset(), False),  # default off: still rejected
        ("EXT_meshopt_compression", frozenset({"LAI_GLB_MESHOPT"}), True),
        ("EXT_meshopt_compression", frozenset({"LAI_GLB_KTX2"}), False),
        ("KHR_texture_basisu", frozenset(), False),
        ("KHR_texture_basisu", frozenset({"LAI_GLB_KTX2"}), True),
        ("KHR_draco_mesh_compression", frozenset({"LAI_GLB_MESHOPT", "LAI_GLB_KTX2"}), False),
        ("KHR_meshopt_compression", frozenset({"LAI_GLB_MESHOPT"}), False),
        ("KHR_mesh_quantization", frozenset(), True),
        ("KHR_texture_transform", frozenset({"LAI_GLB_MESHOPT"}), False),
    ],
)
def test_compression_allowed(extension: str, enabled: frozenset[str], allowed: bool) -> None:
    assert compression_allowed(extension, enabled) is allowed


def test_enabled_controls_reads_on_only() -> None:
    assert enabled_controls({}) == frozenset()
    assert enabled_controls({"LAI_GLB_MESHOPT": "off", "LAI_GLB_KTX2": "yes"}) == frozenset()
    assert enabled_controls({"LAI_GLB_MESHOPT": " ON ", "LAI_GLB_KTX2": True}) == {
        "LAI_GLB_MESHOPT",
        "LAI_GLB_KTX2",
    }


# --- helpers ----------------------------------------------------------------------------------


def _model(**kwargs: Any) -> tuple[dict[str, Any], bytes]:
    document, binary = static_model()
    position_view = document["accessors"][0]["bufferView"]
    return compress_views(document, binary, [position_view], **kwargs)


def _run(document: dict[str, Any], binary: bytes, **kwargs: Any) -> tuple[Report, Any]:
    data = glb(document, binary)
    report = Report()
    layout = read_layout(io.BytesIO(data), len(data), report, 1 << 20)

    def read(buffer: int, offset: int, length: int) -> bytes | None:
        if buffer != 0 or layout.bin_offset is None:
            return None
        end = min(offset + length, layout.bin_length or 0)
        return data[layout.bin_offset + offset : layout.bin_offset + end] if end > offset else None

    kwargs.setdefault("buffer_lengths", [layout.bin_length])
    kwargs.setdefault("read", read)
    facts = validate_meshopt(document, report, **kwargs)
    return report, facts


def _errors(report: Report) -> set[str]:
    return {f.code for f in report.findings() if f.severity.value == "error"}


def _ext(document: dict[str, Any], view: int = 0) -> dict[str, Any]:
    return document["bufferViews"][view]["extensions"][EXT]


def _compressed_view(document: dict[str, Any]) -> int:
    return next(i for i, v in enumerate(document["bufferViews"]) if "extensions" in v)


# --- valid models -----------------------------------------------------------------------------


def test_a_valid_compressed_model_passes_with_a_structure_only_warning() -> None:
    document, binary = _model()
    report, facts = _run(document, binary)
    assert _errors(report) == set()
    assert "meshopt_payload_not_decoded" in report.codes()
    assert facts.used and facts.required
    assert len(facts.views) == 1
    assert facts.decoded_bytes == 4 * 12
    assert facts.headers_checked == 1
    assert facts.fallback_buffers == frozenset({1})
    metadata = facts.as_metadata()
    assert metadata["payload_decoded"] is False
    assert metadata["modes"] == {"ATTRIBUTES": 1}


def test_skinned_model_with_several_compressed_views() -> None:
    document, binary = skinned_model()
    views = [
        document["accessors"][i]["bufferView"] for i in (0, 2, 3)
    ]  # positions, joints, weights
    document, binary = compress_views(document, binary, views)
    report, facts = _run(document, binary)
    assert _errors(report) == set()
    assert len(facts.views) == 3


def test_a_model_without_meshopt_reports_nothing() -> None:
    document, binary = static_model()
    report, facts = _run(document, binary)
    assert report.codes() == []
    assert not facts.used
    assert not uses_meshopt(document)


def test_header_checks_are_skipped_without_a_reader() -> None:
    document, binary = _model()
    report, facts = _run(document, binary, read=None)
    assert _errors(report) == set()
    assert facts.headers_checked == 0


# --- extension fields -------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("field", "value", "code"),
    [
        ("buffer", 7, "meshopt_invalid_buffer"),
        ("buffer", "0", "meshopt_invalid_buffer"),
        ("buffer", 1, "meshopt_fallback_source"),
        ("byteOffset", -1, "meshopt_invalid"),
        ("byteLength", 0, "meshopt_invalid"),
        ("byteStride", 0, "meshopt_invalid"),
        ("count", 0, "meshopt_invalid"),
        ("count", True, "meshopt_invalid"),
        ("mode", "STRIPS", "meshopt_mode"),
        ("mode", None, "meshopt_mode"),
        ("filter", "COLOR", "meshopt_filter"),
    ],
)
def test_invalid_extension_fields(field: str, value: Any, code: str) -> None:
    document, binary = _model()
    _ext(document, _compressed_view(document))[field] = value
    report, _facts = _run(document, binary)
    assert code in _errors(report)


def test_missing_required_fields() -> None:
    for field in ("buffer", "byteLength", "byteStride", "count", "mode"):
        document, binary = _model()
        del _ext(document, _compressed_view(document))[field]
        report, _facts = _run(document, binary)
        assert _errors(report), field


def test_malformed_extension_object() -> None:
    document, binary = _model()
    document["bufferViews"][_compressed_view(document)]["extensions"][EXT] = [1]
    report, _facts = _run(document, binary)
    assert "meshopt_invalid" in _errors(report)


def test_compressed_range_must_fit_its_buffer() -> None:
    document, binary = _model()
    ext = _ext(document, _compressed_view(document))
    ext["byteOffset"] = len(binary) - 4
    report, _facts = _run(document, binary)
    assert "meshopt_bounds" in _errors(report)


def test_container_length_wins_over_a_lying_byte_length() -> None:
    document, binary = _model()
    document["buffers"][0]["byteLength"] = 10**9
    ext = _ext(document, _compressed_view(document))
    ext["byteOffset"] = len(binary) + 64
    report, _facts = _run(document, binary)
    assert "meshopt_bounds" in _errors(report)


@pytest.mark.parametrize(
    ("mode", "filter_name", "stride", "count", "code"),
    [
        ("ATTRIBUTES", "NONE", 6, 4, "meshopt_stride"),
        ("ATTRIBUTES", "NONE", 260, 4, "meshopt_stride"),
        ("TRIANGLES", "NONE", 8, 6, "meshopt_stride"),
        ("TRIANGLES", "NONE", 2, 4, "meshopt_count"),
        ("INDICES", "NONE", 1, 4, "meshopt_stride"),
        ("INDICES", "OCTAHEDRAL", 4, 4, "meshopt_filter"),
        ("TRIANGLES", "QUATERNION", 2, 6, "meshopt_filter"),
        ("ATTRIBUTES", "OCTAHEDRAL", 12, 4, "meshopt_stride"),
        ("ATTRIBUTES", "QUATERNION", 4, 4, "meshopt_stride"),
        ("ATTRIBUTES", "EXPONENTIAL", 12, 4, None),
        ("ATTRIBUTES", "OCTAHEDRAL", 8, 4, None),
        ("ATTRIBUTES", "QUATERNION", 8, 4, None),
    ],
)
def test_mode_and_filter_rules(
    mode: str, filter_name: str, stride: int, count: int, code: str | None
) -> None:
    stream = {
        "ATTRIBUTES": lambda: (
            attribute_stream(stride, count)
            if stride % 4 == 0 and stride <= 256
            else b"\xa0" + bytes(300)
        ),
        "TRIANGLES": lambda: triangle_stream(count),
        "INDICES": lambda: index_stream(count),
    }[mode]()
    binary = stream + bytes(-len(stream) % 4)
    document = {
        "asset": {"version": "2.0"},
        "extensionsUsed": [EXT],
        "extensionsRequired": [EXT],
        "buffers": [
            {"byteLength": len(binary)},
            {"byteLength": stride * count, "extensions": {EXT: {"fallback": True}}},
        ],
        "bufferViews": [
            {
                "buffer": 1,
                "byteLength": stride * count,
                "extensions": {
                    EXT: {
                        "buffer": 0,
                        "byteLength": len(stream),
                        "byteStride": stride,
                        "count": count,
                        "mode": mode,
                        "filter": filter_name,
                    }
                },
            }
        ],
    }
    report, _facts = _run(document, binary)
    errors = _errors(report)
    if code is None:
        assert errors == set()
    else:
        assert code in errors


def test_parent_stride_and_length_must_match() -> None:
    document, binary = _model()
    index = _compressed_view(document)
    document["bufferViews"][index]["byteStride"] = 16
    report, _facts = _run(document, binary)
    assert "meshopt_stride_mismatch" in _errors(report)
    document, binary = _model()
    document["bufferViews"][index]["byteLength"] += 12
    report, _facts = _run(document, binary)
    assert "meshopt_length_mismatch" in _errors(report)


def test_decoded_size_budget() -> None:
    document, binary = _model()
    report, _facts = _run(document, binary, max_decoded_bytes=47)
    assert "meshopt_decoded_too_large" in _errors(report)
    report, _facts = _run(document, binary, max_decoded_bytes=48)
    assert _errors(report) == set()


def test_a_huge_claimed_count_is_refused_without_allocation() -> None:
    document, binary = _model()
    index = _compressed_view(document)
    ext = _ext(document, index)
    ext["count"] = 10**9
    document["bufferViews"][index]["byteLength"] = 12 * 10**9
    report, _facts = _run(document, binary)
    errors = _errors(report)
    assert "meshopt_decoded_too_large" in errors
    assert "meshopt_stream_truncated" not in errors  # a refused view's stream is never inspected
    assert DEFAULT_MAX_DECODED_BYTES < 12 * 10**9


def test_a_huge_count_costs_constant_time() -> None:
    """Security: `count` comes from the file; the minimum-length bound is closed form."""
    import time

    started = time.monotonic()
    value = minimum_stream_length("ATTRIBUTES", 10**18, 12)
    assert time.monotonic() - started < 0.05
    assert value > 10**16
    document, binary = _model()
    index = _compressed_view(document)
    _ext(document, index)["count"] = 10**18
    document["bufferViews"][index]["byteLength"] = 12 * 10**18
    started = time.monotonic()
    report, _facts = _run(document, binary, max_decoded_bytes=2**62)
    assert time.monotonic() - started < 1.0
    assert "meshopt_decoded_too_large" in _errors(report)


def _loop_minimum(count: int, stride: int) -> int:
    """The straightforward loop the closed form replaces (small counts only)."""
    max_block = min((8192 // stride) & ~15, 256)
    total, remaining = 1 + max(stride, 32), count
    while remaining > 0:
        block = min(remaining, max_block)
        total += stride * (-(-(-(-block // 16)) // 4))
        remaining -= block
    return total


@pytest.mark.parametrize("stride", [4, 8, 12, 16, 64, 128, 256])
@pytest.mark.parametrize("count", [1, 15, 16, 17, 255, 256, 257, 1000, 4096, 10_001])
def test_closed_form_matches_the_block_loop(stride: int, count: int) -> None:
    assert minimum_stream_length("ATTRIBUTES", count, stride) == _loop_minimum(count, stride)


def test_streams_of_views_with_rule_errors_are_not_inspected() -> None:
    document, binary = _model()
    ext = _ext(document, _compressed_view(document))
    ext["byteStride"] = 6
    patched = bytearray(binary)
    patched[ext["byteOffset"]] = 0x00  # would be a header error if inspected
    report, facts = _run(document, bytes(patched))
    assert "meshopt_stride" in _errors(report)
    assert "meshopt_stream_header" not in _errors(report)
    assert facts.headers_checked == 0


# --- stream headers ---------------------------------------------------------------------------


def test_wrong_stream_header_is_refused() -> None:
    document, binary = _model()
    ext = _ext(document, _compressed_view(document))
    patched = bytearray(binary)
    patched[ext["byteOffset"]] = 0xA1  # version 1 is the KHR bitstream, not EXT
    report, _facts = _run(document, bytes(patched))
    assert "meshopt_stream_header" in _errors(report)


def test_truncated_stream_is_refused() -> None:
    document, binary = _model()
    ext = _ext(document, _compressed_view(document))
    ext["byteLength"] -= 1
    report, _facts = _run(document, binary)
    assert "meshopt_stream_truncated" in _errors(report)


def test_triangle_tail_table_rules() -> None:
    stream = bytearray(triangle_stream(6))
    stream[-1] = 1  # the last two bytes must be zero
    binary = bytes(stream) + bytes(-len(stream) % 4)
    document = {
        "asset": {"version": "2.0"},
        "extensionsUsed": [EXT],
        "extensionsRequired": [EXT],
        "buffers": [
            {"byteLength": len(binary)},
            {"byteLength": 12, "extensions": {EXT: {"fallback": True}}},
        ],
        "bufferViews": [
            {
                "buffer": 1,
                "byteLength": 12,
                "extensions": {
                    EXT: {
                        "buffer": 0,
                        "byteLength": len(stream),
                        "byteStride": 2,
                        "count": 6,
                        "mode": "TRIANGLES",
                    }
                },
            }
        ],
    }
    report, _facts = _run(document, binary)
    assert "meshopt_stream_tail" in _errors(report)
    stream[-1] = 0
    stream[-3] = 0xF0  # no 0xf nibble in the table
    report, _facts = _run(document, bytes(stream) + bytes(-len(stream) % 4))
    assert "meshopt_stream_tail" in _errors(report)


def test_minimum_stream_length_matches_the_hand_written_streams() -> None:
    for stride, count in ((4, 1), (12, 3), (12, 300), (64, 200), (256, 17)):
        assert len(attribute_stream(stride, count)) == minimum_stream_length(
            "ATTRIBUTES", count, stride
        )
    assert len(triangle_stream(9)) == minimum_stream_length("TRIANGLES", 9, 2)
    assert len(index_stream(5)) == minimum_stream_length("INDICES", 5, 4)


# --- extensionsUsed / extensionsRequired / fallback buffers ----------------------------------


def test_compression_must_be_declared() -> None:
    document, binary = _model()
    document["extensionsUsed"] = []
    report, _facts = _run(document, binary)
    assert {"meshopt_not_declared", "extension_required_not_used"} <= _errors(report)


def test_fallback_buffer_without_data_requires_the_extension() -> None:
    document, binary = _model(required=False)
    report, _facts = _run(document, binary)
    assert "meshopt_fallback_requires_extension" in _errors(report)


def test_unmarked_dataless_parent_buffer_also_requires_the_extension() -> None:
    document, binary = _model(required=False)
    del document["buffers"][1]["extensions"]
    report, _facts = _run(document, binary)
    assert "meshopt_fallback_requires_extension" in _errors(report)


def test_optional_meshopt_with_real_fallback_data_is_valid() -> None:
    """extensionsUsed only, the parent view reads real uncompressed data from buffer 0."""
    document, binary = static_model()
    position = document["accessors"][0]["bufferView"]
    stream = attribute_stream(12, 4)
    padded = binary + stream + bytes(-len(stream) % 4)
    document = copy.deepcopy(document)
    document["buffers"][0]["byteLength"] = len(padded)
    document["bufferViews"][position]["byteStride"] = 12
    document["bufferViews"][position]["extensions"] = {
        EXT: {
            "buffer": 0,
            "byteOffset": len(binary),
            "byteLength": len(stream),
            "byteStride": 12,
            "count": 4,
            "mode": "ATTRIBUTES",
        }
    }
    document["extensionsUsed"] = [EXT]
    report, facts = _run(document, padded)
    assert _errors(report) == set()
    assert not facts.required


def test_uncompressed_view_must_not_read_a_fallback_buffer() -> None:
    document, binary = _model()
    document["bufferViews"].append({"buffer": 1, "byteOffset": 0, "byteLength": 4})
    report, _facts = _run(document, binary)
    assert "meshopt_fallback_reference" in _errors(report)


def test_fallback_buffer_zero_is_refused() -> None:
    document, binary = _model()
    document["buffers"][0]["extensions"] = {EXT: {"fallback": True}}
    report, _facts = _run(document, binary)
    assert "meshopt_fallback_index" in _errors(report)
    assert fallback_buffer_indices(document) == frozenset({0, 1})


def test_malformed_fallback_marker() -> None:
    document, binary = _model()
    document["buffers"][1]["extensions"][EXT] = {"fallback": "yes"}
    report, _facts = _run(document, binary)
    assert "meshopt_invalid" in _errors(report)


def test_declared_but_unused_is_a_warning() -> None:
    document, binary = static_model()
    document["extensionsUsed"] = [EXT]
    report, facts = _run(document, binary)
    assert _errors(report) == set()
    assert "meshopt_unused" in report.codes()
    assert facts.used


def test_messages_never_quote_file_content() -> None:
    document, binary = _model()
    document["nodes"][0]["name"] = "SECRET-NAME"
    _ext(document, _compressed_view(document))["mode"] = "SECRET-MODE"
    report, _facts = _run(document, binary)
    for finding in report.findings():
        assert "SECRET" not in finding.message


def test_check_is_called_per_view() -> None:
    document, binary = _model()
    calls = []
    _run(document, binary, check=lambda: calls.append(1))
    assert len(calls) >= len(document["bufferViews"])


def test_django_style_sink_works() -> None:
    """Django's ValidationResult has the same error/warn signature; any such sink works."""

    class Sink:
        def __init__(self) -> None:
            self.items: list[tuple[str, str]] = []

        def error(self, code: str, message: str, path: str = "") -> None:
            self.items.append(("error", code))

        def warn(self, code: str, message: str, path: str = "") -> None:
            self.items.append(("warn", code))

    document, _binary = _model(required=False)
    sink = Sink()
    validate_meshopt(document, sink)
    assert ("error", "meshopt_fallback_requires_extension") in sink.items


def test_stream_helper_layout() -> None:
    stream = attribute_stream(12, 3, struct.pack("<3f", 1, 2, 3))
    assert stream[0] == 0xA0
    assert stream[-12:] == struct.pack("<3f", 1, 2, 3)
    assert len(stream) == 1 + 12 + 32


def test_compression_rows_agree_with_the_validator_table() -> None:
    """`compression.policy` describes the compression rows of `extension_policy.TABLE`."""
    from lai_processing.processors.gltf import extension_policy as table

    for name, policy in __import__(
        "lai_processing.processors.gltf.compression.policy", fromlist=["x"]
    ).COMPRESSION_POLICY.items():
        for enabled in (frozenset(), frozenset({"LAI_GLB_MESHOPT", "LAI_GLB_KTX2"})):
            allowed = compression_allowed(name, enabled)
            assert allowed is (table.error_code(name, enabled) is None), (name, enabled)
        if policy.status is SupportStatus.SUPPORTED_WHEN_ENABLED:
            assert table.classify(name) is table.Support.WHEN_ENABLED
            assert table.CONTROLS[name] == policy.control
    assert table.POLICY_VERSION == 3
