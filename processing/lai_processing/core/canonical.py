"""Deterministic JSON, checksums, and strict UTC timestamps.

Canonical JSON matches the repository convention (`catalog/export.py`, `audio/services.py`):
sorted keys, compact separators, ASCII only, and no NaN or infinity. Equal values always encode
to equal bytes, so a hash of the encoding is a stable identity.
"""

from __future__ import annotations

import hashlib
import json
import re
from datetime import UTC, datetime
from typing import IO, Any, Final

__all__ = [
    "CHUNK_BYTES",
    "canonical_json",
    "format_timestamp",
    "parse_timestamp",
    "sha256_hex",
    "sha256_stream",
]

CHUNK_BYTES: Final = 1024 * 1024

_TIMESTAMP = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$")


def canonical_json(value: Any) -> bytes:
    """Encode `value` deterministically. Raises `ValueError` for NaN/infinity or bad types."""
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
        allow_nan=False,
    ).encode("ascii")


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_stream(stream: IO[bytes], *, max_bytes: int | None = None) -> tuple[str, int]:
    """Hex SHA-256 and size of a stream read in chunks from its current position.

    With `max_bytes`, stops and raises `OverflowError` as soon as more than `max_bytes` have been
    read, so an oversized input is never fully consumed.
    """
    digest = hashlib.sha256()
    size = 0
    while chunk := stream.read(CHUNK_BYTES):
        size += len(chunk)
        if max_bytes is not None and size > max_bytes:
            raise OverflowError("stream exceeds the byte limit")
        digest.update(chunk)
    return digest.hexdigest(), size


def format_timestamp(moment: datetime) -> str:
    """ISO 8601 UTC with microseconds and a `Z` suffix. Naive datetimes are refused."""
    if moment.tzinfo is None or moment.utcoffset() is None:
        raise ValueError("timestamps must be timezone-aware")
    return moment.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def parse_timestamp(text: str) -> datetime:
    """Parse the strict `YYYY-MM-DDTHH:MM:SS[.ffffff]Z` form into an aware UTC datetime."""
    if not isinstance(text, str) or not _TIMESTAMP.fullmatch(text):
        raise ValueError("timestamp must be ISO 8601 UTC ending in Z")
    return datetime.fromisoformat(text[:-1]).replace(tzinfo=UTC)
