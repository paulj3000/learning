"""Tiny valid image and audio files for the asset library tests (AM-13). Synthetic, no I/O."""

import struct
import zlib


def png_bytes(width=4, height=4) -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(
            ">I", zlib.crc32(kind + data) & 0xFFFFFFFF
        )

    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    rows = b"".join(b"\x00" + b"\x7f\x20\x40" * width for _ in range(height))
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(rows))
        + chunk(b"IEND", b"")
    )


def jpeg_bytes(width=8, height=8) -> bytes:
    frame = struct.pack(">BHHB", 8, height, width, 1) + b"\x01\x11\x00"
    scan = b"\x01\x01\x00\x00\x3f\x00"
    return (
        b"\xff\xd8"
        + b"\xff\xc0" + struct.pack(">H", 2 + len(frame)) + frame
        + b"\xff\xda" + struct.pack(">H", 2 + len(scan)) + scan
        + b"\x12\x34\x56\x78"
        + b"\xff\xd9"
    )


def webp_bytes(width=16, height=16) -> bytes:
    bits = (width - 1) | ((height - 1) << 14)
    payload = b"\x2f" + struct.pack("<I", bits) + b"\x00" * 7  # 12 bytes, even
    chunk = b"VP8L" + struct.pack("<I", len(payload)) + payload
    return b"RIFF" + struct.pack("<I", 4 + len(chunk)) + b"WEBP" + chunk


def wav_bytes(seconds=1, rate=8000, channels=1, bits=16, tag=1) -> bytes:
    block = channels * bits // 8
    data = b"\x00" * (rate * block * seconds)
    fmt = struct.pack("<HHIIHH", tag, channels, rate, rate * block, block, bits)
    body = b"WAVE" + b"fmt " + struct.pack("<I", len(fmt)) + fmt
    body += b"data" + struct.pack("<I", len(data)) + data
    return b"RIFF" + struct.pack("<I", len(body)) + body


def mp3_bytes(frames=10) -> bytes:
    frame = b"\xff\xfb\x90\x00" + b"\x00" * (417 - 4)  # MPEG-1 Layer III, 128 kbit/s, 44.1 kHz
    return frame * frames


def _ogg_page(flags, granule, sequence, body) -> bytes:
    table = bytes([len(body)])
    return (
        b"OggS\x00" + bytes([flags]) + struct.pack("<qIII", granule, 1, sequence, 0)
        + bytes([1]) + table + body
    )


def ogg_bytes(seconds=1, rate=44100, channels=2, end=True) -> bytes:
    ident = b"\x01vorbis" + struct.pack("<I", 0) + bytes([channels]) + struct.pack("<I", rate)
    ident += b"\x00" * 10
    last = _ogg_page(0x04 if end else 0, rate * seconds, 1, b"\x00" * 8)
    return _ogg_page(0x02, 0, 0, ident) + last
