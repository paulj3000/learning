"""Encoding and strict decoding of contract messages (contracts/codec.py)."""

from __future__ import annotations

import json
from typing import Any

import pytest
from lai_processing.contracts import (
    DEFAULT_MAX_MESSAGE_BYTES,
    CompletionEvent,
    ProcessingJobRequest,
    ProcessingJobResult,
    decode,
    decode_event,
    decode_request,
    decode_result,
    encode,
    load_json,
)
from lai_processing.core.canonical import canonical_json
from lai_processing.core.errors import ErrorCode, ProcessingError
from processing_samples import FIXTURES, VALID_BUILDERS, VALID_DECODERS

VALID = sorted(VALID_BUILDERS)
DECODERS = {"request": decode_request, "result": decode_result, "event": decode_event}
TYPES = {"request": ProcessingJobRequest, "result": ProcessingJobResult, "event": CompletionEvent}


def _pretty(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


def _code(data: Any, decoder: Any = decode, **kwargs: Any) -> ErrorCode:
    with pytest.raises(ProcessingError) as err:
        decoder(data, **kwargs)
    return err.value.code


@pytest.mark.parametrize("name", VALID)
def test_round_trip_is_canonical_and_stable(name: str) -> None:
    pretty = _pretty(name)
    message = decode(pretty)
    assert isinstance(message, TYPES[VALID_DECODERS[name]])
    canonical = encode(message)
    assert canonical == canonical_json(json.loads(pretty))
    assert encode(decode(canonical)) == canonical
    assert decode(canonical) == message
    assert DECODERS[VALID_DECODERS[name]](pretty) == message


@pytest.mark.parametrize("name", VALID)
def test_encoding_is_compact_ascii(name: str) -> None:
    encoded = encode(decode(_pretty(name)))
    assert encoded.isascii()
    assert b"\n" not in encoded and b": " not in encoded


@pytest.mark.parametrize("name", VALID)
def test_built_contract_equals_decoded_fixture(name: str) -> None:
    built = VALID_BUILDERS[name]()
    assert decode(encode(built)) == built
    assert encode(built) == encode(decode(_pretty(name)))


@pytest.mark.parametrize("name", VALID)
def test_typed_decoders_refuse_other_kinds(name: str) -> None:
    own = VALID_DECODERS[name]
    for kind, decoder in DECODERS.items():
        if kind != own:
            assert _code(_pretty(name), decoder) is ErrorCode.INVALID_INPUT


def test_str_bytes_and_bytearray_inputs() -> None:
    raw = _pretty("request.reference.json")
    expected = decode(raw)
    assert decode(raw.decode()) == expected
    assert decode(bytearray(raw)) == expected


@pytest.mark.parametrize("value", [123, None, 1.5, ["x"], memoryview(b"{}")])
def test_non_text_inputs_are_refused(value: object) -> None:
    assert _code(value) is ErrorCode.INVALID_INPUT


def test_size_limit_is_checked_first_and_inclusive() -> None:
    raw = encode(decode(_pretty("request.reference.json")))
    assert decode(raw, max_bytes=len(raw)) is not None
    assert _code(raw, max_bytes=len(raw) - 1) is ErrorCode.MESSAGE_TOO_LARGE
    garbage = b"\xff" * 100
    assert _code(garbage, max_bytes=10) is ErrorCode.MESSAGE_TOO_LARGE


def test_oversized_message_over_default_limit() -> None:
    raw = encode(decode(_pretty("request.reference.json")))
    padded = raw[:-1] + b" " * (DEFAULT_MAX_MESSAGE_BYTES - len(raw) + 1) + b"}"
    assert len(padded) == DEFAULT_MAX_MESSAGE_BYTES + 1
    for decoder in (decode, decode_request, decode_result, decode_event):
        assert _code(padded, decoder) is ErrorCode.MESSAGE_TOO_LARGE
    assert _code(padded.decode()) is ErrorCode.MESSAGE_TOO_LARGE
    within = raw[:-1] + b" " * (DEFAULT_MAX_MESSAGE_BYTES - len(raw)) + b"}"
    assert isinstance(decode(within), ProcessingJobRequest)


def test_multibyte_str_size_is_measured_in_utf8_bytes() -> None:
    text = '"' + "é" * 60 + '"'
    assert len(text) < 100 < len(text.encode())
    assert _code(text, load_json, max_bytes=100) is ErrorCode.MESSAGE_TOO_LARGE


@pytest.mark.parametrize(
    "raw",
    [b'{"kind": "\xff"}', b"\xc3\x28", b"\xed\xa0\x80", b'{"a":"\xe2\x82"}', b"\xef\xbb\xbf{}"],
)
def test_invalid_utf8_and_bom_are_refused(raw: bytes) -> None:
    assert _code(raw) is ErrorCode.INVALID_INPUT


@pytest.mark.xfail(
    strict=True,
    raises=UnicodeEncodeError,
    reason="FOUNDATION DEFECT contracts/codec.py load_json: a str containing a lone surrogate "
    "makes data.encode('utf-8') raise UnicodeEncodeError instead of ProcessingError "
    "(INVALID_INPUT); wrap the encode in try/except UnicodeEncodeError.",
)
def test_lone_surrogate_str_is_invalid_input() -> None:
    assert _code('{"kind": "\ud800"}') is ErrorCode.INVALID_INPUT


@pytest.mark.parametrize(
    "text",
    [
        "",
        "   ",
        "{",
        "{'a': 1}",
        '{"a": 1,}',
        "NaN",
        '{"a": NaN}',
        '{"a": Infinity}',
        '{"a": -Infinity}',
        '{"a": [1, 2, {"b": NaN}]}',
        '{"a": 1, "a": 2}',
        '{"x": {"a": 1, "a": 1}}',
        '{"x": [{"k": 1, "k": 2}]}',
        '{"a": ' + "1" * 5000 + "}",
        '{"a": 1} {"b": 2}',
    ],
)
def test_malformed_json_is_invalid_input(text: str) -> None:
    assert _code(text, load_json) is ErrorCode.INVALID_INPUT
    assert _code(text) is ErrorCode.INVALID_INPUT


@pytest.mark.parametrize("depth", [33, 100, 10_000])
def test_deep_nesting_is_refused_before_parsing(depth: int) -> None:
    assert _code("[" * depth + "]" * depth, load_json) is ErrorCode.INVALID_INPUT
    assert _code('{"a":' * depth + "1" + "}" * depth, load_json) is ErrorCode.INVALID_INPUT


def test_moderate_nesting_and_brackets_in_strings_are_fine() -> None:
    assert load_json("[" * 32 + "]" * 32) is not None
    assert load_json(json.dumps({"s": "[[[[[[" * 20, "e": '\\"[{'})) is not None


@pytest.mark.parametrize("text", ["[]", '"x"', "1", "null", "true"])
def test_non_object_messages_are_refused(text: str) -> None:
    assert _code(text) is ErrorCode.INVALID_INPUT
    assert _code(text, decode_request) is ErrorCode.INVALID_INPUT


@pytest.mark.parametrize("kind", [None, "", "lai.processing.job_deleted", 1, "JOB_REQUEST"])
def test_unknown_kinds_are_refused(kind: object) -> None:
    data = json.loads(_pretty("request.reference.json"))
    data["kind"] = kind
    assert _code(json.dumps(data)) is ErrorCode.INVALID_INPUT


@pytest.mark.parametrize("version", [0, 2, 99, -1])
def test_unsupported_integer_versions(version: int) -> None:
    for name in VALID:
        data = json.loads(_pretty(name))
        data["schema_version"] = version
        assert _code(json.dumps(data)) is ErrorCode.UNSUPPORTED_SCHEMA_VERSION
        assert (
            _code(json.dumps(data), DECODERS[VALID_DECODERS[name]])
            is ErrorCode.UNSUPPORTED_SCHEMA_VERSION
        )


@pytest.mark.parametrize("version", ["1", 1.0, True, None, [1]])
def test_non_integer_versions_are_invalid(version: object) -> None:
    data = json.loads(_pretty("result.succeeded.json"))
    data["schema_version"] = version
    assert _code(json.dumps(data)) is ErrorCode.INVALID_INPUT


def test_unsupported_version_is_reported_before_unknown_fields() -> None:
    data = json.loads(_pretty("event.inline.json"))
    data["schema_version"] = 2
    data["new_v2_field"] = {"anything": True}
    del data["result_sha256"]
    assert _code(json.dumps(data)) is ErrorCode.UNSUPPORTED_SCHEMA_VERSION


def test_errors_never_echo_message_content() -> None:
    data = json.loads(_pretty("request.reference.json"))
    data["secret_field_AKIA"] = "child-name-Ana"
    with pytest.raises(ProcessingError) as err:
        decode(json.dumps(data))
    rendered = f"{err.value} {err.value!r}"
    assert "Ana" not in rendered
    data = json.loads(_pretty("request.reference.json"))
    data["correlation_id"] = "Ana lives at 1 Main St"
    with pytest.raises(ProcessingError) as err:
        decode(json.dumps(data))
    assert "Ana" not in f"{err.value} {err.value!r}"
    assert err.value.details == {"field": "correlation_id"}


def test_encode_refuses_non_messages() -> None:
    with pytest.raises(AttributeError):
        encode({"kind": "x"})  # type: ignore[arg-type]
