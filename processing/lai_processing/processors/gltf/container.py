"""The GLB container: 12-byte header, a JSON chunk, an optional BIN chunk, nothing else.

Every length is checked against the real file size before anything is read or allocated, so
a header or chunk that lies about its length can never make the reader allocate or seek past
the file. The JSON chunk is the only part read whole (bounded by `max_json_bytes`); the BIN
chunk is never loaded, only located.

Codes match `lai/apps/assets/validation.py` (`_read_glb`) where Django has the check. Stricter
than Django: bytes after the last chunk are refused (`glb_trailing_data`), because a structure
must end where the file ends (`docs/ASSET_LIBRARY.md` section 21.3).
"""

from __future__ import annotations

import struct
from dataclasses import dataclass
from typing import BinaryIO, Final

from .report import Report, Stop

__all__ = [
    "CHUNK_BIN",
    "CHUNK_JSON",
    "GLB_MAGIC",
    "GlbLayout",
    "read_at",
    "read_layout",
]

GLB_MAGIC: Final = 0x46546C67  # "glTF"
CHUNK_JSON: Final = 0x4E4F534A
CHUNK_BIN: Final = 0x004E4942
HEADER_BYTES: Final = 12
CHUNK_HEADER_BYTES: Final = 8


@dataclass(frozen=True, slots=True)
class GlbLayout:
    """Where the chunks are. Offsets are absolute file offsets of chunk *data*."""

    file_size: int
    json_offset: int
    json_length: int
    bin_offset: int | None = None
    bin_length: int | None = None


def read_at(handle: BinaryIO, offset: int, length: int, file_size: int) -> bytes:
    """Up to `length` bytes at `offset`, never past the end of the file."""
    if offset < 0 or length <= 0 or offset >= file_size:
        return b""
    handle.seek(offset)
    return handle.read(min(length, file_size - offset))


def read_layout(handle: BinaryIO, size: int, report: Report, max_json_bytes: int) -> GlbLayout:
    """Check the header and chunk table. Records findings; raises `Stop` when unusable."""
    if size <= 0:
        report.error("empty_file", "The file is empty.")
        raise Stop
    head = read_at(handle, 0, HEADER_BYTES, size)
    if len(head) < 4 or struct.unpack_from("<I", head)[0] != GLB_MAGIC:
        if head.lstrip()[:1] == b"{":
            report.error(
                "gltf_not_supported",
                "This validator checks GLB files only; export the model as glTF Binary (.glb).",
            )
        else:
            report.error(
                "not_a_model",
                'This file is not a glTF model. Export it from Blender as "glTF Binary (.glb)".',
            )
        raise Stop
    if len(head) < HEADER_BYTES:
        report.error("not_glb", "This file is too small to be a GLB model.")
        raise Stop
    _magic, version, declared = struct.unpack("<III", head)
    if version != 2:
        report.error("glb_version", "This model uses a glTF binary version other than 2.")
        raise Stop
    if declared != size:
        report.error(
            "glb_length",
            "The file looks damaged or cut short: its header length does not match its size.",
        )
        raise Stop
    chunk = read_at(handle, HEADER_BYTES, CHUNK_HEADER_BYTES, size)
    if len(chunk) < CHUNK_HEADER_BYTES:
        report.error("glb_chunks", "The GLB has no JSON chunk.")
        raise Stop
    json_length, json_type = struct.unpack("<II", chunk)
    if json_type != CHUNK_JSON:
        report.error("glb_chunks", "The first GLB chunk must be the JSON chunk.")
        raise Stop
    json_offset = HEADER_BYTES + CHUNK_HEADER_BYTES
    if json_length > max_json_bytes or json_offset + json_length > size:
        report.error(
            "json_size", "The model's JSON chunk is too large or runs past the end of the file."
        )
        raise Stop
    if json_length % 4:
        report.warn("glb_padding", "The JSON chunk is not padded to 4 bytes.")

    offset = json_offset + json_length
    if offset == size:
        return GlbLayout(size, json_offset, json_length)
    if offset + CHUNK_HEADER_BYTES > size:
        report.error(
            "glb_trailing_data", "The file has extra bytes after its last chunk.", "chunks"
        )
        return GlbLayout(size, json_offset, json_length)
    bin_length, bin_type = struct.unpack("<II", read_at(handle, offset, CHUNK_HEADER_BYTES, size))
    if bin_type != CHUNK_BIN:
        report.error("glb_chunks", "The second GLB chunk must be the binary chunk.")
        raise Stop
    bin_offset = offset + CHUNK_HEADER_BYTES
    if bin_offset + bin_length > size:
        report.error("glb_chunks", "The binary chunk runs past the end of the file.")
        raise Stop
    if bin_length % 4:
        report.warn("glb_padding", "The binary chunk is not padded to 4 bytes.")
    if bin_offset + bin_length != size:
        report.error(
            "glb_trailing_data", "The file has extra bytes after its last chunk.", "chunks"
        )
    return GlbLayout(size, json_offset, json_length, bin_offset, bin_length)
