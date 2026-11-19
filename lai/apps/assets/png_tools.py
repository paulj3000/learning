"""Dependency-free PNG downscaling for asset preparation (TR-PALM-02).

The asset pipeline has no image library (CLAUDE.md section 13: no silent new dependency), and the
model packs it prepares embed oversized textures: Quaternius' palms carry two 1024 x 1024 PNGs
that are 95% of each file. This module decodes the one PNG layout those packs use (8-bit RGB or
RGBA, not interlaced), halves it with a box filter until it fits, and encodes it again.

The output is deterministic for a given input and zlib, so a re-import of the same source makes
the same bytes and the asset library skips it by checksum. Anything this module does not
understand is returned unchanged rather than guessed at (`downscale_png` returns None).

Colour is averaged weighted by alpha, so the white behind a cut-out leaf does not bleed into its
edge as a pale fringe.
"""

import struct
import zlib
from dataclasses import dataclass

SIGNATURE = b"\x89PNG\r\n\x1a\n"
# Refuse anything bigger than this before decompressing (a decompression bomb guard).
MAX_PIXELS = 4096 * 4096
_CHANNELS = {2: 3, 6: 4}  # colour type -> channels (RGB, RGBA)


class PngNotSupported(ValueError):
    """Not a PNG this module handles (palette, 16-bit, grey, interlaced, damaged)."""


@dataclass(frozen=True)
class Png:
    width: int
    height: int
    channels: int
    pixels: bytes  # rows of width * channels bytes, no filter bytes


def dimensions(data: bytes) -> tuple[int, int] | None:
    """(width, height) from the IHDR chunk, or None for anything that is not a PNG."""
    if not data.startswith(SIGNATURE) or len(data) < 24 or data[12:16] != b"IHDR":
        return None
    return struct.unpack(">II", data[16:24])


def decode(data: bytes) -> Png:
    if not data.startswith(SIGNATURE):
        raise PngNotSupported("not a PNG")
    offset = len(SIGNATURE)
    header = None
    idat = []
    while offset + 8 <= len(data):
        length, kind = struct.unpack(">I4s", data[offset : offset + 8])
        body = data[offset + 8 : offset + 8 + length]
        if len(body) != length:
            raise PngNotSupported("truncated chunk")
        if kind == b"IHDR":
            header = struct.unpack(">IIBBBBB", body)
        elif kind == b"IDAT":
            idat.append(body)
        elif kind == b"IEND":
            break
        offset += 12 + length
    if header is None:
        raise PngNotSupported("no IHDR")
    width, height, depth, colour, _compression, _filter, interlace = header
    if depth != 8 or colour not in _CHANNELS or interlace != 0:
        raise PngNotSupported("only 8-bit, non-interlaced RGB or RGBA is handled")
    if width < 1 or height < 1 or width * height > MAX_PIXELS:
        raise PngNotSupported("image size out of range")
    channels = _CHANNELS[colour]
    stride = width * channels
    decompressor = zlib.decompressobj()
    raw = decompressor.decompress(b"".join(idat), (stride + 1) * height + 1)
    if len(raw) != (stride + 1) * height:
        raise PngNotSupported("image data has the wrong length")
    return Png(width, height, channels, _unfilter(raw, stride, height, channels))


def _unfilter(raw: bytes, stride: int, height: int, bpp: int) -> bytes:
    out = bytearray(stride * height)
    previous = bytearray(stride)
    for row in range(height):
        start = row * (stride + 1)
        kind = raw[start]
        line = bytearray(raw[start + 1 : start + 1 + stride])
        if kind == 1:  # Sub
            for i in range(bpp, stride):
                line[i] = (line[i] + line[i - bpp]) & 0xFF
        elif kind == 2:  # Up
            for i in range(stride):
                line[i] = (line[i] + previous[i]) & 0xFF
        elif kind == 3:  # Average
            for i in range(stride):
                left = line[i - bpp] if i >= bpp else 0
                line[i] = (line[i] + ((left + previous[i]) >> 1)) & 0xFF
        elif kind == 4:  # Paeth
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                b = previous[i]
                c = previous[i - bpp] if i >= bpp else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                predictor = a if pa <= pb and pa <= pc else (b if pb <= pc else c)
                line[i] = (line[i] + predictor) & 0xFF
        elif kind != 0:
            raise PngNotSupported("unknown filter type")
        out[row * stride : (row + 1) * stride] = line
        previous = line
    return bytes(out)


def halve(image: Png) -> Png:
    """A 2 x 2 box filter (odd edges clamp). RGBA colour is weighted by alpha."""
    width, height, n = max(1, image.width // 2), max(1, image.height // 2), image.channels
    src, stride = image.pixels, image.width * n
    out = bytearray(width * height * n)
    for y in range(height):
        y0 = min(2 * y, image.height - 1) * stride
        y1 = min(2 * y + 1, image.height - 1) * stride
        for x in range(width):
            x0, x1 = min(2 * x, image.width - 1) * n, min(2 * x + 1, image.width - 1) * n
            corners = (y0 + x0, y0 + x1, y1 + x0, y1 + x1)
            target = (y * width + x) * n
            if n == 4:
                alphas = [src[c + 3] for c in corners]
                total = sum(alphas)
                for channel in range(3):
                    if total:
                        value = sum(src[c + channel] * a for c, a in zip(corners, alphas, strict=True))
                        out[target + channel] = (value + total // 2) // total
                    else:
                        out[target + channel] = (sum(src[c + channel] for c in corners) + 2) // 4
                out[target + 3] = (total + 2) // 4
            else:
                for channel in range(n):
                    out[target + channel] = (sum(src[c + channel] for c in corners) + 2) // 4
    return Png(width, height, n, bytes(out))


def encode(image: Png) -> bytes:
    """PNG bytes, every row Sub-filtered, zlib level 9: deterministic for a given zlib."""
    stride, n = image.width * image.channels, image.channels
    rows = bytearray()
    for row in range(image.height):
        line = image.pixels[row * stride : (row + 1) * stride]
        filtered = bytearray(line)
        for i in range(n, stride):
            filtered[i] = (line[i] - line[i - n]) & 0xFF
        rows.append(1)
        rows += filtered
    colour = 6 if n == 4 else 2
    header = struct.pack(">IIBBBBB", image.width, image.height, 8, colour, 0, 0, 0)
    return (
        SIGNATURE
        + _chunk(b"IHDR", header)
        + _chunk(b"IDAT", zlib.compress(bytes(rows), 9))
        + _chunk(b"IEND", b"")
    )


def _chunk(kind: bytes, body: bytes) -> bytes:
    return (
        struct.pack(">I", len(body))
        + kind
        + body
        + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF)
    )


def downscale_png(data: bytes, max_size: int) -> bytes | None:
    """`data` halved until both sides fit `max_size`; None when it already fits or is unsupported."""
    size = dimensions(data)
    if size is None or max(size) <= max_size:
        return None
    try:
        image = decode(data)
    except PngNotSupported:
        return None
    while max(image.width, image.height) > max_size:
        image = halve(image)
    return encode(image)
