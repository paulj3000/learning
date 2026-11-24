"""Output post-condition: walk the encoded bytes and prove no metadata survived.

A small allow-list walk, independent of Pillow. PNG: only critical chunks, `tRNS`, and the sRGB
tag (`iCCP`) when the profile asked for it. JPEG: only JFIF `APP0`, an ICC `APP2` when asked,
quantisation and Huffman tables, frame and scan headers. WebP: only `VP8 `, `VP8L`, `VP8X`
(without EXIF, XMP or animation flags), `ALPH`, and `ICCP` when asked. Anything else (EXIF, GPS,
XMP, IPTC, comments, text chunks, embedded thumbnails, maker notes) is reported by name class.
Returns codes, never values.
"""

from __future__ import annotations

import struct

PNG_ALLOWED = frozenset({b"IHDR", b"PLTE", b"tRNS", b"IDAT", b"IEND"})
JPEG_NO_LENGTH = frozenset({0x01, *range(0xD0, 0xD8), 0xD8, 0xD9})
JPEG_SOF = frozenset({0xC0, 0xC1, 0xC2})
WEBP_ALLOWED = frozenset({b"VP8 ", b"VP8L", b"VP8X", b"ALPH"})
_MAX_STEPS = 100_000


def audit_output(data: bytes, file_format: str, *, icc_allowed: bool) -> list[str]:
    """Problem codes (empty means metadata free and structurally plain)."""
    walkers = {"png": _png, "jpeg": _jpeg, "webp": _webp}
    walker = walkers.get(file_format)
    if walker is None:
        return ["unknown_format"]
    try:
        return walker(bytes(data), icc_allowed)
    except (struct.error, IndexError, ValueError):
        return ["structure"]


def _png(data: bytes, icc_allowed: bool) -> list[str]:
    problems: list[str] = []
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ["signature"]
    position, steps, ended = 8, 0, False
    while position + 8 <= len(data) and steps < _MAX_STEPS:
        steps += 1
        length, kind = struct.unpack(">I4s", data[position : position + 8])
        position += 12 + length
        if position > len(data):
            problems.append("truncated")
            break
        if kind == b"iCCP":
            if not icc_allowed:
                problems.append("icc")
        elif kind in (b"eXIf",):
            problems.append("exif")
        elif kind in (b"tEXt", b"zTXt", b"iTXt"):
            problems.append("text")
        elif kind not in PNG_ALLOWED:
            problems.append("chunk")
        if kind == b"IEND":
            ended = True
            break
    if not ended:
        problems.append("no_iend")
    elif position != len(data):
        problems.append("trailing_data")
    return problems


def _jpeg(data: bytes, icc_allowed: bool) -> list[str]:
    problems: list[str] = []
    if not data.startswith(b"\xff\xd8"):
        return ["signature"]
    position, steps = 2, 0
    while position + 2 <= len(data) and steps < _MAX_STEPS:
        steps += 1
        if data[position] != 0xFF:
            return [*problems, "structure"]
        marker = data[position + 1]
        if marker == 0xFF:
            position += 1
            continue
        position += 2
        if marker == 0xD9:
            if position != len(data):
                problems.append("trailing_data")
            return problems
        if marker in JPEG_NO_LENGTH:
            continue
        (length,) = struct.unpack(">H", data[position : position + 2])
        body = data[position + 2 : position + length]
        if marker == 0xE0:
            if not body.startswith(b"JFIF\x00"):
                problems.append("app0")
        elif marker == 0xE2:
            if not (icc_allowed and body.startswith(b"ICC_PROFILE\x00")):
                problems.append("icc")
        elif marker == 0xE1:
            problems.append("exif_or_xmp")
        elif marker == 0xED:
            problems.append("iptc")
        elif marker == 0xFE:
            problems.append("comment")
        elif 0xE0 <= marker <= 0xEF:
            problems.append("app")
        elif marker not in JPEG_SOF | {0xC4, 0xDB, 0xDD, 0xDA}:
            problems.append("marker")
        position += length
        if marker == 0xDA:  # entropy-coded data until the next real marker
            while position + 1 < len(data):
                if data[position] == 0xFF and data[position + 1] not in (0x00, *range(0xD0, 0xD8)):
                    break
                position += 1
    return [*problems, "no_eoi"]


def _webp(data: bytes, icc_allowed: bool) -> list[str]:
    problems: list[str] = []
    if data[:4] != b"RIFF" or data[8:12] != b"WEBP":
        return ["signature"]
    (riff_size,) = struct.unpack("<I", data[4:8])
    if riff_size + 8 != len(data):
        problems.append("trailing_data" if riff_size + 8 < len(data) else "truncated")
    position, steps = 12, 0
    while position + 8 <= len(data) and steps < _MAX_STEPS:
        steps += 1
        kind = data[position : position + 4]
        (length,) = struct.unpack("<I", data[position + 4 : position + 8])
        body = data[position + 8 : position + 8 + length]
        if kind == b"VP8X":
            flags = body[0]
            if flags & 0x08:
                problems.append("exif")
            if flags & 0x04:
                problems.append("xmp")
            if flags & 0x02:
                problems.append("animation")
            if flags & 0x20 and not icc_allowed:
                problems.append("icc")
        elif kind == b"ICCP":
            if not icc_allowed:
                problems.append("icc")
        elif kind == b"EXIF":
            problems.append("exif")
        elif kind == b"XMP ":
            problems.append("xmp")
        elif kind not in WEBP_ALLOWED:
            problems.append("chunk")
        position += 8 + length + (length & 1)
    return problems
