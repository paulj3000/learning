"""Synthetic KTX2 containers for the KHR_texture_basisu tests (ADR-070), built in code.

`ktx2(...)` writes a structurally complete KTX 2.0 file: header, level index, a 44-byte basic
Data Format Descriptor (colour model, primaries, transfer function), key/value data with
`KTXorientation`, BasisLZ global data when the scheme is BasisLZ, and one payload per level.
Payload bytes are zeros: nothing here is a decodable texture, and the validators never decode.
"""

from __future__ import annotations

import struct

IDENTIFIER = b"\xabKTX 20\xbb\r\n\x1a\n"
ETC1S, UASTC = 163, 166
LINEAR, SRGB = 1, 2
NONE, BASISLZ, ZSTD = 0, 1, 2


def _blocks(width: int, height: int) -> int:
    return (-(-max(1, width) // 4)) * (-(-max(1, height) // 4)) * 16


def ktx2(
    width: int = 64,
    height: int = 64,
    *,
    scheme: int = BASISLZ,
    model: int | None = None,
    transfer: int = SRGB,
    levels: int | None = None,
    vk_format: int = 0,
    depth: int = 0,
    layers: int = 0,
    faces: int = 1,
    orientation: bytes | None = b"rd",
    sgd: bytes | None = None,
    level_patch: dict[int, tuple[int, int, int]] | None = None,
) -> bytes:
    model = model if model is not None else (ETC1S if scheme == BASISLZ else UASTC)
    if levels is None:
        levels = max(width, height).bit_length()
    index_end = 80 + max(1, levels) * 24
    dfd = struct.pack("<I", 44) + struct.pack("<II", 0, (2 << 16) | 40)
    dfd += bytes([model, 1, transfer, 0]) + bytes(32)
    kvd = b""
    if orientation is not None:
        entry = b"KTXorientation\x00" + orientation + b"\x00"
        kvd = struct.pack("<I", len(entry)) + entry + bytes(-len(entry) % 4)
    if sgd is None:
        sgd = bytes(32) if scheme == BASISLZ else b""
    dfd_offset = index_end
    kvd_offset = dfd_offset + len(dfd)
    sgd_offset = kvd_offset + len(kvd)
    sgd_offset += -sgd_offset % 8
    position = sgd_offset + len(sgd)
    entries = []
    payload = bytearray()
    w, h = width, height
    for _level in range(max(1, levels)):
        blocks = _blocks(w, h)
        length = blocks if scheme in (NONE,) else max(16, blocks // 4)
        uncompressed = blocks if scheme == ZSTD else 0
        entries.append((position + len(payload), length, uncompressed))
        payload += bytes(length)
        w, h = max(1, w // 2), max(1, h // 2)
    if level_patch:
        for level, values in level_patch.items():
            entries[level] = values
    header = IDENTIFIER + struct.pack(
        "<9I4I2Q",
        vk_format,
        1,
        width,
        height,
        depth,
        layers,
        faces,
        levels,
        scheme,
        dfd_offset,
        len(dfd),
        kvd_offset if kvd else 0,
        len(kvd),
        sgd_offset if sgd else 0,
        len(sgd),
    )
    index = b"".join(struct.pack("<3Q", *e) for e in entries)
    body = header + index + dfd + kvd
    body += bytes(sgd_offset - len(body)) + sgd
    return body + bytes(payload)
