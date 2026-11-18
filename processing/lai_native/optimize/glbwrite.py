"""Read a GLB into (document, binary chunk) and write one back, relocating binary regions.

Used by the KTX2 step to replace image bytes. Every byte region of buffer 0 that the document
points at (plain buffer views, and the compressed ranges of `EXT_meshopt_compression` views) is
copied in its original order, 4-byte aligned, with replacements substituted; nothing else is
kept. Overlapping regions are refused (`unsupported_layout`) rather than guessed at.
"""

from __future__ import annotations

import json
import struct
from typing import Any

__all__ = ["GlbLayoutError", "read_glb", "write_glb", "repack"]

_MAGIC = 0x46546C67
_JSON = 0x4E4F534A
_BIN = 0x004E4942
_MESHOPT = "EXT_meshopt_compression"


class GlbLayoutError(ValueError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def read_glb(data: bytes) -> tuple[dict[str, Any], bytes]:
    if len(data) < 20 or struct.unpack_from("<I", data, 0)[0] != _MAGIC:
        raise GlbLayoutError("not_glb")
    json_length, json_type = struct.unpack_from("<II", data, 12)
    if json_type != _JSON or 20 + json_length > len(data):
        raise GlbLayoutError("not_glb")
    document = json.loads(data[20 : 20 + json_length])
    position = 20 + json_length
    binary = b""
    if position + 8 <= len(data):
        bin_length, bin_type = struct.unpack_from("<II", data, position)
        if bin_type == _BIN:
            binary = data[position + 8 : position + 8 + bin_length]
    return document, binary


def write_glb(document: dict[str, Any], binary: bytes) -> bytes:
    raw = json.dumps(document, separators=(",", ":"), ensure_ascii=False).encode()
    raw += b" " * (-len(raw) % 4)
    body = struct.pack("<II", len(raw), _JSON) + raw
    if binary:
        padded = binary + b"\x00" * (-len(binary) % 4)
        body += struct.pack("<II", len(padded), _BIN) + padded
    return struct.pack("<III", _MAGIC, 2, 12 + len(body)) + body


def repack(
    document: dict[str, Any], binary: bytes, replacements: dict[int, bytes]
) -> tuple[dict[str, Any], bytes]:
    """Return (document, binary) with buffer view `i`'s bytes replaced by `replacements[i]`.

    The document is modified in place and returned. A malformed view (a missing key, a wrong
    type) raises `GlbLayoutError("unsupported_layout")`, never a `KeyError`."""
    try:
        return _repack(document, binary, replacements)
    except (KeyError, IndexError, TypeError, AttributeError):
        raise GlbLayoutError("unsupported_layout") from None


def _repack(
    document: dict[str, Any], binary: bytes, replacements: dict[int, bytes]
) -> tuple[dict[str, Any], bytes]:
    regions: list[tuple[int, int, str, int]] = []  # (offset, length, kind, view index)
    for index, view in enumerate(document.get("bufferViews", [])):
        extension = (view.get("extensions") or {}).get(_MESHOPT)
        if isinstance(extension, dict) and extension.get("buffer", 0) == 0:
            regions.append(
                (extension.get("byteOffset", 0), extension["byteLength"], "meshopt", index)
            )
        if view.get("buffer", 0) == 0:
            regions.append((view.get("byteOffset", 0), view["byteLength"], "view", index))
    regions.sort()
    for (a_off, a_len, *_), (b_off, *_rest) in zip(regions, regions[1:], strict=False):
        if a_off + a_len > b_off:
            raise GlbLayoutError("unsupported_layout")
    out = bytearray()
    for offset, length, kind, index in regions:
        out += b"\x00" * (-len(out) % 4)
        view = document["bufferViews"][index]
        if kind == "view" and index in replacements:
            data = replacements[index]
        else:
            data = binary[offset : offset + length]
            if len(data) != length:
                raise GlbLayoutError("unsupported_layout")
        if kind == "meshopt":
            view["extensions"][_MESHOPT]["byteOffset"] = len(out)
        else:
            view["byteOffset"] = len(out)
            view["byteLength"] = len(data)
        out += data
    out += b"\x00" * (-len(out) % 4)
    buffers = document.setdefault("buffers", [{}])
    if buffers:
        buffers[0]["byteLength"] = len(out)
    return document, bytes(out)
