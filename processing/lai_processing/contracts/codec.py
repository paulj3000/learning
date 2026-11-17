"""Encoding and strict decoding of contract messages.

Decoding order: size limit, UTF-8, JSON (refusing duplicate keys, NaN and infinity, and
excessive nesting), `kind` and `schema_version`, then the full contract validation. Every
failure is a `ProcessingError` with a field path and no echo of the message content.
"""

from __future__ import annotations

import json
from typing import Any, Final

from ..core.canonical import canonical_json
from ..core.errors import ErrorCode, ProcessingError
from . import _fields as f
from .common import SUPPORTED_SCHEMA_VERSIONS, MessageKind
from .events import CompletionEvent
from .jobs import ProcessingJobRequest
from .results import ProcessingJobResult

__all__ = [
    "DEFAULT_MAX_MESSAGE_BYTES",
    "Message",
    "decode",
    "decode_event",
    "decode_request",
    "decode_result",
    "encode",
    "load_json",
]

# SQS classic allows 256 KiB; leave headroom for attributes.
DEFAULT_MAX_MESSAGE_BYTES: Final = 240 * 1024
MAX_PARSE_DEPTH: Final = 32

Message = ProcessingJobRequest | ProcessingJobResult | CompletionEvent

_DECODERS: Final = {
    MessageKind.JOB_REQUEST: ProcessingJobRequest.from_dict,
    MessageKind.JOB_RESULT: ProcessingJobResult.from_dict,
    MessageKind.JOB_COMPLETED: CompletionEvent.from_dict,
}


def encode(message: Message) -> bytes:
    """Canonical JSON bytes of a contract message."""
    return canonical_json(message.to_dict())


def _no_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in pairs:
        if key in out:
            raise ValueError("duplicate key")
        out[key] = value
    return out


def _reject_constant(_: str) -> Any:
    raise ValueError("non-finite number")


def _depth_ok(value: Any) -> bool:
    stack: list[tuple[Any, int]] = [(value, 0)]
    while stack:
        item, depth = stack.pop()
        if depth > MAX_PARSE_DEPTH:
            return False
        if isinstance(item, dict):
            stack.extend((v, depth + 1) for v in item.values())
        elif isinstance(item, list):
            stack.extend((v, depth + 1) for v in item)
    return True


def _cheap_depth_ok(text: str) -> bool:
    """Bound bracket nesting before parsing, so hostile nesting never reaches the recursive
    parser. Brackets inside strings may over-count, which only makes the check stricter."""
    depth = 0
    in_string = False
    escaped = False
    for ch in text:
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
        elif ch in "[{":
            depth += 1
            if depth > MAX_PARSE_DEPTH:
                return False
        elif ch in "]}":
            depth -= 1
    return True


def load_json(data: bytes | str, *, max_bytes: int = DEFAULT_MAX_MESSAGE_BYTES) -> Any:
    """Parse untrusted JSON with a size bound, strict UTF-8, and no duplicate keys or NaN."""
    if isinstance(data, str):
        try:
            raw: bytes | bytearray = data.encode("utf-8")
        except UnicodeEncodeError:  # a lone surrogate is not valid Unicode text
            raise f.invalid("message") from None
    else:
        raw = data
    if not isinstance(raw, (bytes, bytearray)):
        raise f.invalid("message")
    if len(raw) > max_bytes:
        raise ProcessingError(ErrorCode.MESSAGE_TOO_LARGE, {"field": "message"})
    try:
        text = bytes(raw).decode("utf-8")
    except UnicodeDecodeError:
        raise f.invalid("message") from None
    if not _cheap_depth_ok(text):
        raise f.invalid("message")
    try:
        value = json.loads(text, object_pairs_hook=_no_duplicates, parse_constant=_reject_constant)
    except (ValueError, RecursionError):
        raise f.invalid("message") from None
    if not _depth_ok(value):
        raise f.invalid("message")
    return value


def decode(data: bytes | str, *, max_bytes: int = DEFAULT_MAX_MESSAGE_BYTES) -> Message:
    """Decode any contract message by its `kind`."""
    value = load_json(data, max_bytes=max_bytes)
    if not isinstance(value, dict):
        raise f.invalid("message")
    kind = value.get("kind")
    if kind not in MessageKind.ALL:
        raise f.invalid("kind")
    version = value.get("schema_version")
    if type(version) is int and version not in SUPPORTED_SCHEMA_VERSIONS:
        raise ProcessingError(
            ErrorCode.UNSUPPORTED_SCHEMA_VERSION, {"field": "schema_version", "version": version}
        )
    return _DECODERS[kind](value)


def _decode_kind(data: bytes | str, kind: str, max_bytes: int) -> Any:
    value = load_json(data, max_bytes=max_bytes)
    if not isinstance(value, dict):
        raise f.invalid("message")
    return _DECODERS[kind](value)


def decode_request(
    data: bytes | str, *, max_bytes: int = DEFAULT_MAX_MESSAGE_BYTES
) -> ProcessingJobRequest:
    return _decode_kind(data, MessageKind.JOB_REQUEST, max_bytes)


def decode_result(
    data: bytes | str, *, max_bytes: int = DEFAULT_MAX_MESSAGE_BYTES
) -> ProcessingJobResult:
    return _decode_kind(data, MessageKind.JOB_RESULT, max_bytes)


def decode_event(
    data: bytes | str, *, max_bytes: int = DEFAULT_MAX_MESSAGE_BYTES
) -> CompletionEvent:
    return _decode_kind(data, MessageKind.JOB_COMPLETED, max_bytes)
