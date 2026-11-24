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

from lai_processing.processors.gltf import GlbSettings, jsonparse
from lai_processing.processors.gltf.document import COMPLEXITY_DEFAULTS
from lai_processing.processors.gltf.jsonparse import scan_structure

MAX_JSON_BYTES = COMPLEXITY_DEFAULTS["max_json_bytes"]


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


# --- the structural pre-scan (worst-case memory) ----------------------------------------------


def _full_chunk(unit: bytes) -> bytes:
    """A JSON chunk as close to `max_json_bytes` as `unit` repeats allow."""
    head, tail = b'{"asset": {"version": "2.0"}, "x": [', b"0]}"
    return head + unit * ((MAX_JSON_BYTES - len(head) - len(tail) - 4) // len(unit)) + tail


@pytest.fixture
def no_parse(monkeypatch: pytest.MonkeyPatch) -> None:
    """Fail the test if the JSON parser is ever reached."""

    def refuse(*_args: object, **_kwargs: object) -> object:
        raise AssertionError("json.loads ran on a document the pre-scan must refuse")

    monkeypatch.setattr(jsonparse.json, "loads", refuse)


@pytest.mark.parametrize("unit", [b"{},", b"[],", b"1,", b"1.5,", b'"",'])
@pytest.mark.usefixtures("no_parse")
def test_a_full_chunk_of_tiny_values_is_refused_before_parsing(unit: bytes) -> None:
    # 16 MiB of `[{},{},...]` once peaked at 870 MB in the 512 MB media function.
    raw = _full_chunk(unit)
    assert len(raw) > MAX_JSON_BYTES - 16
    outcome = validate(glb(raw, None))
    assert outcome.report.codes() == ["too_complex"]
    assert outcome.report.findings()[0].path == "json"


@pytest.mark.parametrize(
    "raw",
    [
        b'{"x": ' + b"[" * 65 + b"]" * 65 + b"}",
        b'{"x": ' + b"[" * 200_000 + b"]" * 200_000 + b"}",
        b'{"x": "never closed}',
        b'{"x": "escaped quote at the end\\"}',
    ],
    ids=["depth_65", "depth_200000", "unterminated", "unterminated_escape"],
)
@pytest.mark.usefixtures("no_parse")
def test_depth_and_unterminated_strings_are_refused_before_parsing(raw: bytes) -> None:
    assert error_codes(glb(raw, None)) == {"invalid_json"}


def test_element_limit_is_exact() -> None:
    # `{`, `[`, `,` and `:` each count: here 1 + 1 + 1 + (n - 1) commas = n + 2.
    def doc(n: int) -> bytes:
        return b'{"x": [' + b",".join(b"0" for _ in range(n)) + b"]}"

    assert scan_structure(doc(8), 64, 10) is None
    assert scan_structure(doc(9), 64, 10) == "elements"
    settings = GlbSettings(dict(COMPLEXITY_DEFAULTS, max_json_elements=10))
    assert "too_complex" not in validate(glb(doc(8), None), settings).report.codes()
    assert validate(glb(doc(9), None), settings).report.codes() == ["too_complex"]


def test_depth_limit_is_exact() -> None:
    assert scan_structure(b"[[[]]]", 3, 100) is None
    assert scan_structure(b"[[[[]]]]", 3, 100) == "depth"
    assert scan_structure(b"[[],[],[]]", 2, 100) is None


@pytest.mark.parametrize(
    "raw",
    [
        b'{"a": "[[[[[[{{{{,,,,::::"}',
        b'{"a": "\\"[[[[[[,,,,"}',  # an escaped quote does not end the string
        b'{"a": "\\\\", "b": 1}',  # an escaped backslash does
        b'{"[[[[[[": "]]]]]]"}',
        '{"a": "\\u00e9\\u0022[[[[[[ \u00e9\U0001f600"}'.encode(),  # JSON escapes, UTF-8
    ],
)
def test_brackets_and_separators_inside_strings_do_not_count(raw: bytes) -> None:
    json.loads(raw)  # each case is valid JSON
    assert scan_structure(raw, 2, 4) is None


def test_scan_counts_match_a_real_parse() -> None:
    raw = b'{"a": [1, {"b": "x,y"}, [2, 3]], "c": {"d": null}}'
    json.loads(raw)
    # Containers 5, commas 4, colons 4: 13 elements; depth 3.
    assert scan_structure(raw, 3, 13) is None
    assert scan_structure(raw, 3, 12) == "elements"
    assert scan_structure(raw, 2, 13) == "depth"


def test_junk_without_elements_stops_at_the_token_bound() -> None:
    # 1 million closers or empty strings are not valid JSON; the loop still ends early.
    assert scan_structure(b"]" * 1_000_000, 64, 1000) == "elements"
    assert scan_structure(b'""' * 1_000_000, 64, 1000) == "elements"


def test_escape_heavy_strings_scan_in_linear_time() -> None:
    # A backtracking repeat would keep one entry per escape (hundreds of MB here).
    raw = b'{"a": "' + b'\\"' * 2_000_000 + b'"}'
    assert scan_structure(raw, 64, 10) is None
    assert scan_structure(raw[:-2], 64, 10) == "unterminated"


def test_a_request_cannot_raise_the_element_limit() -> None:
    settings = GlbSettings.resolve({"max_json_elements": 10**9})
    assert settings.limit("max_json_elements") == COMPLEXITY_DEFAULTS["max_json_elements"]


def test_lying_chunk_never_reads_beyond_the_file() -> None:
    # The JSON chunk claims the whole remaining file plus one byte.
    document, binary = static_model()
    data = bytearray(glb(document, binary))
    struct.pack_into("<I", data, 12, len(data) - 20 + 1)
    assert error_codes(bytes(data)) == {"json_size"}
