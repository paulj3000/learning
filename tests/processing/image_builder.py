"""Synthetic PNG, JPEG and WebP bytes with chosen metadata, built in the test (no binaries)."""

from __future__ import annotations

import struct
import zlib


def tiff_exif(*, orientation=None, gps="none", order="<") -> bytes:
    """A TIFF block. gps: 'none', 'position' (lat and long), 'version' (one tag), 'bad'."""
    u16 = lambda v: struct.pack(order + "H", v)  # noqa: E731
    u32 = lambda v: struct.pack(order + "I", v)  # noqa: E731
    entries = []
    if orientation is not None:
        entries.append(u16(0x0112) + u16(3) + u32(1) + u16(orientation) + b"\x00\x00")
    gps_ifd_at = 8 + 2 + 12 * (len(entries) + (1 if gps != "none" else 0)) + 4
    if gps != "none":
        pointer = gps_ifd_at if gps != "bad" else 0xFFFFFF
        entries.append(u16(0x8825) + u16(4) + u32(1) + u32(pointer))
    block = b"II*\x00" if order == "<" else b"MM\x00*"
    block += u32(8) + u16(len(entries)) + b"".join(entries) + u32(0)
    if gps in ("position", "version"):
        tags = [(0x0000, 1, 4, b"\x02\x03\x00\x00")]
        if gps == "position":
            tags += [(0x0002, 5, 3, u32(0)), (0x0004, 5, 3, u32(0))]
        block += u16(len(tags))
        for tag, kind, items, value in tags:
            block += u16(tag) + u16(kind) + u32(items) + value
        block += u32(0)
    return block


def _segment(marker: int, body: bytes) -> bytes:
    return b"\xff" + bytes([marker]) + struct.pack(">H", len(body) + 2) + body


def jpeg(*segments: bytes) -> bytes:
    frame = struct.pack(">BHHB", 8, 8, 8, 1) + b"\x01\x11\x00"
    scan = b"\x01\x01\x00\x00\x3f\x00"
    return (
        b"\xff\xd8"
        + b"".join(segments)
        + _segment(0xC0, frame)
        + _segment(0xDA, scan)
        + b"\x12\x34\xff\xd9"
    )


def jpeg_app1_exif(tiff: bytes) -> bytes:
    return _segment(0xE1, b"Exif\x00\x00" + tiff)


def jpeg_app1_xmp(packet: bytes) -> bytes:
    return _segment(0xE1, b"http://ns.adobe.com/xap/1.0/\x00" + packet)


def jpeg_app2_icc() -> bytes:
    return _segment(0xE2, b"ICC_PROFILE\x00\x01\x01" + b"\x00" * 16)


def jpeg_comment(text: bytes = b"hello") -> bytes:
    return _segment(0xFE, text)


def jpeg_iptc() -> bytes:
    return _segment(0xED, b"Photoshop 3.0\x00" + b"8BIM" + b"\x00" * 8)


def _png_chunk(kind: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + kind
        + data
        + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    )


def png(*extra_chunks: tuple[bytes, bytes], after_idat: tuple[tuple[bytes, bytes], ...] = ()):
    header = struct.pack(">IIBBBBB", 4, 4, 8, 2, 0, 0, 0)
    rows = b"".join(b"\x00" + b"\x7f\x20\x40" * 4 for _ in range(4))
    body = _png_chunk(b"IHDR", header)
    body += b"".join(_png_chunk(k, d) for k, d in extra_chunks)
    body += _png_chunk(b"IDAT", zlib.compress(rows))
    body += b"".join(_png_chunk(k, d) for k, d in after_idat)
    return b"\x89PNG\r\n\x1a\n" + body + _png_chunk(b"IEND", b"")


def png_itxt_xmp(packet: bytes) -> tuple[bytes, bytes]:
    return b"iTXt", b"XML:com.adobe.xmp\x00\x00\x00\x00\x00" + packet


def webp(*chunks: tuple[bytes, bytes]) -> bytes:
    """A lossless WebP with optional extra RIFF chunks placed after the image chunk."""
    bits = 3 | (3 << 14)
    payload = b"\x2f" + struct.pack("<I", bits) + b"\x00" * 7
    body = b"WEBP" + b"VP8L" + struct.pack("<I", len(payload)) + payload
    for kind, data in chunks:
        body += kind + struct.pack("<I", len(data)) + data + (b"\x00" if len(data) & 1 else b"")
    return b"RIFF" + struct.pack("<I", len(body)) + body


def tiff_tags(ifd0=(), exif=(), thumbnail=(), *, order="<") -> bytes:
    """A TIFF block whose IFD0, Exif IFD and IFD1 hold the given tag numbers. Every value is an
    inline LONG 0: only tag presence matters to the scanner (it never reads text values)."""
    u16 = lambda v: struct.pack(order + "H", v)  # noqa: E731
    u32 = lambda v: struct.pack(order + "I", v)  # noqa: E731

    def entry(tag, value=0):
        return u16(tag) + u16(4) + u32(1) + u32(value)

    ifd0_tags = list(ifd0)
    size0 = 2 + 12 * (len(ifd0_tags) + (1 if exif else 0)) + 4
    exif_at = 8 + size0
    size_exif = 2 + 12 * len(exif) + 4
    thumb_at = exif_at + (size_exif if exif else 0)
    entries = [entry(t) for t in ifd0_tags]
    if exif:
        entries.append(entry(0x8769, exif_at))
    block = b"II*\x00" if order == "<" else b"MM\x00*"
    block += u32(8) + u16(len(entries)) + b"".join(entries) + u32(thumb_at if thumbnail else 0)
    if exif:
        block += u16(len(exif)) + b"".join(entry(t) for t in exif) + u32(0)
    if thumbnail:
        block += u16(len(thumbnail)) + b"".join(entry(t) for t in thumbnail) + u32(0)
    return block
