"""Synthetic `EXT_meshopt_compression` fixtures (ADR-070), generated in code.

`attribute_stream(stride, count, baseline)` writes a valid version-0 ATTRIBUTES stream by hand
(Appendix A of the Khronos specification): header byte 0xa0, then for every attribute block one
group-header byte run per byte position, all zero (every delta zero, so no delta bytes), then the
tail: zero padding up to max(stride, 32) bytes ending with the baseline element. Every decoded
element equals the baseline. `triangle_stream(count)` writes a frame with a valid header and tail
table (the code bytes are not a meaningful triangle list; the validators never decode).

`compress_views(document, binary, views)` moves the chosen vertex buffer views into a meshopt
fallback buffer and appends their streams to the GLB binary chunk, which is what gltfpack does.
"""

from __future__ import annotations

import copy
import struct
from typing import Any

EXT = "EXT_meshopt_compression"
_COMPONENT_BYTES = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}
_COMPONENTS = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT2": 4, "MAT3": 9, "MAT4": 16}


def attribute_stream(stride: int, count: int, baseline: bytes | None = None) -> bytes:
    baseline = baseline if baseline is not None else bytes(stride)
    assert len(baseline) == stride
    max_block = min((8192 // stride) & ~15, 256)
    body = bytearray([0xA0])
    remaining = count
    while remaining > 0:
        block = min(remaining, max_block)
        groups = -(-block // 16)
        body += bytes(stride * (-(-groups // 4)))
        remaining -= block
    tail = max(stride, 32)
    body += bytes(tail - stride) + baseline
    return bytes(body)


def triangle_stream(count: int) -> bytes:
    """A TRIANGLES frame: header 0xe1, one code byte per triangle, a valid 16-byte tail."""
    return bytes([0xE1]) + bytes(count // 3) + bytes(16)


def index_stream(count: int) -> bytes:
    return bytes([0xD1]) + bytes(count) + bytes(4)


def _pad4(data: bytearray) -> None:
    while len(data) % 4:
        data.append(0)


def compress_views(
    document: dict[str, Any], binary: bytes, views: list[int], *, required: bool = True
) -> tuple[dict[str, Any], bytes]:
    """Return a copy of the model with `views` meshopt-compressed (ATTRIBUTES mode)."""
    document = copy.deepcopy(document)
    new_binary = bytearray(binary)
    fallback_length = 0
    for index in views:
        view = document["bufferViews"][index]
        accessor = next(a for a in document["accessors"] if a.get("bufferView") == index)
        stride = _COMPONENT_BYTES[accessor["componentType"]] * _COMPONENTS[accessor["type"]]
        count = view["byteLength"] // stride
        start = view.get("byteOffset", 0)
        stream = attribute_stream(stride, count, bytes(binary[start : start + stride]))
        _pad4(new_binary)
        offset = len(new_binary)
        new_binary += stream
        view.clear()
        view.update(
            {
                "buffer": 1,
                "byteOffset": fallback_length,
                "byteLength": stride * count,
                "byteStride": stride,
                "target": 34962,
                "extensions": {
                    EXT: {
                        "buffer": 0,
                        "byteOffset": offset,
                        "byteLength": len(stream),
                        "byteStride": stride,
                        "count": count,
                        "mode": "ATTRIBUTES",
                    }
                },
            }
        )
        fallback_length += stride * count
        fallback_length += -fallback_length % 4
    _pad4(new_binary)
    document["buffers"] = [
        {"byteLength": len(new_binary)},
        {"byteLength": fallback_length, "extensions": {EXT: {"fallback": True}}},
    ]
    document["extensionsUsed"] = sorted({*document.get("extensionsUsed", []), EXT})
    if required:
        document["extensionsRequired"] = sorted({*document.get("extensionsRequired", []), EXT})
    return document, bytes(new_binary)


def float_view(values: list[float]) -> bytes:
    return struct.pack(f"<{len(values)}f", *values)
