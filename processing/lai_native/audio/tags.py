"""Verify that an encoded output carries no metadata but FFmpeg's constant encoder string.

`-map_metadata -1`, `-map_metadata:s:a -1` and the bitexact flags are meant to leave nothing from
the source, but the claim `metadata_free` must be checked on the bytes, not assumed from flags:

- Ogg Opus: the `OpusTags` packet may hold the vendor string and the one comment
  `encoder=Lavc <version> libopus` (or the plain `Lavc libopus`), nothing else.
- MP3: no ID3v2 block at the start, no ID3v1 `TAG` block at the end, and the Xing or Info frame's
  LAME encoder field (when there is one) must read `Lavf`, `Lavc` or `LAME` plus a version.

`verify(data, container)` returns a list of problem codes (empty means clean). Pure bytes in, no
side effects.
"""

from __future__ import annotations

import re
import struct
from typing import Final

__all__ = ["verify"]

_VENDOR: Final = re.compile(rb"^(ffmpeg|Lavf[0-9.]*|libopus [0-9.]+|Lavc[0-9. ]*libopus)$")
_COMMENT: Final = re.compile(rb"^encoder=Lavc[0-9.]* ?libopus$")
_LAME_ENCODER: Final = re.compile(rb"^(Lavf|Lavc|LAME)[0-9A-Za-z. ]{0,5}$")
MAX_PACKET: Final = 64 * 1024


def _ogg_packets(data: bytes, limit: int = 3) -> list[bytes]:
    """The first few logical packets of the first Ogg stream (enough for OpusHead and OpusTags)."""
    packets: list[bytes] = []
    current = b""
    offset = 0
    while offset + 27 <= len(data) and len(packets) < limit:
        if data[offset : offset + 4] != b"OggS":
            return packets
        segments = data[offset + 26]
        table = data[offset + 27 : offset + 27 + segments]
        if len(table) != segments:
            return packets
        position = offset + 27 + segments
        for size in table:
            current += data[position : position + size]
            position += size
            if len(current) > MAX_PACKET:
                return packets
            if size < 255:
                packets.append(current)
                current = b""
                if len(packets) >= limit:
                    break
        offset = position
    return packets


def _opus_problems(data: bytes) -> list[str]:
    packets = _ogg_packets(data)
    tags = next((p for p in packets if p.startswith(b"OpusTags")), None)
    if tags is None:
        return ["opus_tags_missing"]
    try:
        (vendor_length,) = struct.unpack_from("<I", tags, 8)
        vendor = tags[12 : 12 + vendor_length]
        position = 12 + vendor_length
        (count,) = struct.unpack_from("<I", tags, position)
        position += 4
        comments = []
        for _ in range(count):
            (length,) = struct.unpack_from("<I", tags, position)
            comments.append(tags[position + 4 : position + 4 + length])
            position += 4 + length
        if position != len(tags):
            return ["opus_tags_trailing_data"]
    except struct.error:
        return ["opus_tags_malformed"]
    problems = []
    if not _VENDOR.match(vendor):
        problems.append("opus_vendor_unexpected")
    if any(not _COMMENT.match(c) for c in comments) or len(comments) > 1:
        problems.append("opus_comment_unexpected")
    return problems


def _mp3_problems(data: bytes) -> list[str]:
    problems = []
    if data[:3] == b"ID3":
        problems.append("id3v2_present")
    if len(data) >= 128 and data[-128:-125] == b"TAG":
        problems.append("id3v1_present")
    head = data[:2048]
    for marker in (b"Xing", b"Info"):
        at = head.find(marker)
        if at < 0:
            continue
        if at + 8 > len(head):
            problems.append("mp3_header_truncated")
            break
        (flags,) = struct.unpack_from(">I", head, at + 4)
        size = 8 + 4 * (flags & 1) + 4 * ((flags >> 1) & 1) + 100 * ((flags >> 2) & 1)
        size += 4 * ((flags >> 3) & 1)
        encoder = head[at + size : at + size + 9]
        text = encoder.rstrip(b"\x00 ")
        if text and not _LAME_ENCODER.match(text):  # an empty field carries no text
            problems.append("mp3_encoder_field_unexpected")
        break
    return problems


def verify(data: bytes, container: str) -> list[str]:
    if container == "ogg":
        return _opus_problems(data)
    if container == "mp3":
        return _mp3_problems(data)
    return ["unknown_container"]
