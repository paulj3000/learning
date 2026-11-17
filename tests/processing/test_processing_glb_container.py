"""GLB container and JSON chunk: header, lengths, chunk table, strict JSON."""

from __future__ import annotations

import json
import struct

import pytest
from glb_builder import (
    CHUNK_BIN,
    error_codes,
    glb,
    static_glb,
    static_model,
    validate,
    warning_codes,
)

from lai_processing.processors.gltf import GlbSettings
from lai_processing.processors.gltf.document import COMPLEXITY_DEFAULTS


def test_valid_static_model_has_no_findings() -> None:
    outcome = validate(static_glb())
    assert outcome.report.findings() == ()
    assert outcome.layout is not None
    assert outcome.layout.bin_length is not None
    assert outcome.facts is not None


@pytest.mark.parametrize(
    ("data", "code"),
    [
        (b"", "empty_file"),
        (b"glTF", "not_glb"),
        (b"glTF\x02\x00\x00\x00", "not_glb"),
        (b"PK\x03\x04" + b"\x00" * 40, "not_a_model"),
        (b'  {"asset": {}}', "gltf_not_supported"),
        (b"gl", "not_a_model"),
    ],
)
def test_signature_and_size(data: bytes, code: str) -> None:
    assert error_codes(data) == {code}


def test_version_other_than_2() -> None:
    assert error_codes(glb(*static_model(), version=1)) == {"glb_version"}


@pytest.mark.parametrize("delta", [-4, 4, 2**32 - 1000])
def test_declared_length_must_equal_file_size(delta: int) -> None:
    data = glb(*static_model(), length_delta=0)
    declared = (len(data) + delta) % 2**32
    data = data[:8] + struct.pack("<I", declared) + data[12:]
    assert error_codes(data) == {"glb_length"}


def test_truncated_file_is_a_length_mismatch() -> None:
    assert error_codes(static_glb()[:-1]) == {"glb_length"}


def test_header_only_file_has_no_json_chunk() -> None:
    data = struct.pack("<III", 0x46546C67, 2, 12)
    assert error_codes(data) == {"glb_chunks"}


def test_first_chunk_must_be_json() -> None:
    assert error_codes(glb(*static_model(), json_type=CHUNK_BIN)) == {"glb_chunks"}


def test_second_chunk_must_be_bin() -> None:
    assert error_codes(glb(*static_model(), bin_type=0x4E4F534A)) == {"glb_chunks"}


@pytest.mark.parametrize("delta", [4, 2**31])
def test_bin_chunk_length_beyond_file(delta: int) -> None:
    assert error_codes(glb(*static_model(), bin_length_delta=delta)) == {"glb_chunks"}


def test_json_chunk_length_beyond_file() -> None:
    # A chunk length close to 2**32 is refused before anything is allocated.
    assert error_codes(glb(*static_model(), json_length_delta=2**32 - 2000)) == {"json_size"}


def test_json_chunk_over_max_json_bytes() -> None:
    settings = GlbSettings.resolve({"max_json_bytes": 64})
    assert error_codes(static_glb(), settings) == {"json_size"}


def test_trailing_bytes_after_bin_chunk() -> None:
    codes = error_codes(glb(*static_model(), trailing=b"\x00" * 16))
    assert codes == {"glb_trailing_data"}


def test_trailing_bytes_shorter_than_a_chunk_header() -> None:
    document, _ = static_model()
    # No BIN chunk at all, then 4 stray bytes: not a chunk header, so refused.
    codes = error_codes(glb(document, None, trailing=b"\x00" * 4))
    assert "glb_trailing_data" in codes


def test_unpadded_json_chunk_warns() -> None:
    raw = json.dumps({"asset": {"version": "2.0"}}).encode() + b"  "
    assert len(raw) % 4
    data = glb(raw, None, pad_json=False)
    assert "glb_padding" in warning_codes(data)


def test_unpadded_bin_chunk_warns() -> None:
    document, binary = static_model()
    data = glb(document, binary)
    # Shrink the BIN chunk length by 1 and drop the last byte of the file and header length.
    json_length = struct.unpack_from("<I", data, 12)[0]
    bin_header = 20 + json_length
    bin_length = struct.unpack_from("<I", data, bin_header)[0]
    data = bytearray(data[:-1])
    struct.pack_into("<I", data, bin_header, bin_length - 1)
    struct.pack_into("<I", data, 8, len(data))
    assert "glb_padding" in warning_codes(bytes(data))


@pytest.mark.parametrize(
    "raw",
    [
        b"{not json",
        b"[1, 2, 3]",
        b'"just a string"',
        b'{"asset": "\xff\xfe"}',
        b'\xef\xbb\xbf{"asset": {"version": "2.0"}}',  # a UTF-8 BOM is not allowed
        b'{"asset": {"version": "2.0"}, "asset": {"version": "2.0"}}',
        b'{"asset": {"version": "2.0"}, "x": NaN}',
        b'{"asset": {"version": "2.0"}, "x": Infinity}',
        b'{"asset": {"version": "2.0"}, "x": -Infinity}',
        b'{"asset": {"version": "2.0"}, "x": 1e400}',
        b'{"asset": {"version": "2.0"}, "x": ' + b"9" * 5000 + b"}",
        b"",
        b'{"a": 1}\x00\x00\x00',
    ],
)
def test_strict_json(raw: bytes) -> None:
    assert error_codes(glb(raw, None)) == {"invalid_json"}


def test_json_depth_limit() -> None:
    depth = COMPLEXITY_DEFAULTS["max_json_depth"]
    inside = b'{"asset": {"version": "2.0"}, "extras": ' + b"[" * (depth - 1) + b"]" * (depth - 1)
    ok = glb(inside + b"}", None)
    assert "invalid_json" not in error_codes(ok)
    deeper = b'{"asset": {"version": "2.0"}, "extras": ' + b"[" * depth + b"]" * depth + b"}"
    assert error_codes(glb(deeper, None)) == {"invalid_json"}


def test_json_nesting_beyond_the_recursion_limit_is_refused_not_crashed() -> None:
    raw = b'{"x": ' + b"[" * 200_000 + b"]" * 200_000 + b"}"
    assert error_codes(glb(raw, None)) == {"invalid_json"}


def test_lying_chunk_never_reads_beyond_the_file() -> None:
    # The JSON chunk claims the whole remaining file plus one byte.
    document, binary = static_model()
    data = bytearray(glb(document, binary))
    struct.pack_into("<I", data, 12, len(data) - 20 + 1)
    assert error_codes(bytes(data)) == {"json_size"}
