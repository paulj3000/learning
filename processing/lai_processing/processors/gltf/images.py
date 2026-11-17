"""Embedded texture signatures and dimensions, read from image headers only.

Nothing is decoded: PNG dimensions come from the IHDR chunk, JPEG dimensions from the first
start-of-frame marker (walking at most `MAX_JPEG_SEGMENTS` segments inside the image's own byte
range), WebP dimensions from the VP8, VP8L or VP8X header. A header that cannot be read gives
`None`, never an exception. Reads go through a bounded `read(offset, length)` callback that
cannot leave the image's byte range.
"""

from __future__ import annotations

import struct
from collections.abc import Callable
from typing import Final

__all__ = [
    "IMAGE_SIGNATURES",
    "MAX_JPEG_SEGMENTS",
    "image_dimensions",
    "sniff_image",
]

PNG: Final = "image/png"
JPEG: Final = "image/jpeg"
WEBP: Final = "image/webp"
IMAGE_SIGNATURES: Final = {PNG: b"\x89PNG\r\n\x1a\n", JPEG: b"\xff\xd8\xff"}
MAX_JPEG_SEGMENTS: Final = 256
HEAD_BYTES: Final = 32
# Start-of-frame markers that carry dimensions (not DHT C4, JPG C8 or DAC CC).
_SOF: Final = frozenset(
    {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}
)
_STANDALONE: Final = frozenset({0x01, *range(0xD0, 0xD8)})

Reader = Callable[[int, int], bytes]


def sniff_image(head: bytes) -> str | None:
    """The image type from its leading bytes, or None."""
    for mime, signature in IMAGE_SIGNATURES.items():
        if head.startswith(signature):
            return mime
    if len(head) >= 12 and head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return WEBP
    return None


def image_dimensions(mime: str, read: Reader, length: int) -> tuple[int, int] | None:
    """(width, height) from the header of an image of type `mime`, or None."""
    try:
        if mime == PNG:
            return _png(read(0, 24))
        if mime == JPEG:
            return _jpeg(read, length)
        if mime == WEBP:
            return _webp(read(0, 30))
    except (struct.error, IndexError):
        return None
    return None


def _positive(width: int, height: int) -> tuple[int, int] | None:
    return (width, height) if width > 0 and height > 0 else None


def _png(head: bytes) -> tuple[int, int] | None:
    if len(head) < 24 or head[12:16] != b"IHDR":
        return None
    width, height = struct.unpack(">II", head[16:24])
    return _positive(width, height)


def _jpeg(read: Reader, length: int) -> tuple[int, int] | None:
    offset = 2  # after SOI
    for _ in range(MAX_JPEG_SEGMENTS):
        if offset + 4 > length:
            return None
        marker = read(offset, 2)
        if len(marker) < 2 or marker[0] != 0xFF:
            return None
        code = marker[1]
        if code == 0xFF:  # fill byte
            offset += 1
            continue
        if code in _STANDALONE:
            offset += 2
            continue
        if code in (0xD9, 0xDA):  # end of image, or scan data before any frame header
            return None
        segment = read(offset + 2, 2)
        if len(segment) < 2:
            return None
        (size,) = struct.unpack(">H", segment)
        if size < 2:
            return None
        if code in _SOF:
            frame = read(offset + 4, 5)
            if len(frame) < 5:
                return None
            height, width = struct.unpack(">HH", frame[1:5])
            return _positive(width, height)
        offset += 2 + size
    return None


def _webp(head: bytes) -> tuple[int, int] | None:
    if len(head) < 30 or head[:4] != b"RIFF" or head[8:12] != b"WEBP":
        return None
    kind = head[12:16]
    if kind == b"VP8X":
        width = 1 + int.from_bytes(head[24:27], "little")
        height = 1 + int.from_bytes(head[27:30], "little")
        return _positive(width, height)
    if kind == b"VP8L":
        if head[20] != 0x2F:
            return None
        bits = int.from_bytes(head[21:25], "little")
        return _positive((bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1)
    if kind == b"VP8 ":
        if head[23:26] != b"\x9d\x01\x2a":
            return None
        width, height = struct.unpack("<HH", head[26:30])
        return _positive(width & 0x3FFF, height & 0x3FFF)
    return None
