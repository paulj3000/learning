"""Synthetic environment packs for the importer tests (TR-PALM-07, TR-ENV-08).

Built in memory from a few numbers: no real model, texture or archive is ever a test fixture.
A pack is a GLB holding several nodes side by side the way FBX exports ship them: authored Z-up,
turned -90 degrees about X, scaled 100x, translated away from the origin, with a blended,
textured material and an unused camera.
"""

import json
import math
import struct

from apps.assets import png_tools
from apps.assets.png_tools import Png

Z_UP_TO_Y_UP = [-math.sqrt(0.5), 0.0, 0.0, math.sqrt(0.5)]


def rgba_png(width: int, height: int, *, alpha_hole: bool = True) -> bytes:
    pixels = bytearray()
    for y in range(height):
        for x in range(width):
            transparent = alpha_hole and x >= width // 2
            pixels += bytes((40 + x, 160, 60 + y, 0 if transparent else 255))
    return png_tools.encode(Png(width, height, 4, bytes(pixels)))


def _box(width: float, depth: float, height: float):
    """A Z-up box standing on z = 0, centred on its own x/y: 8 vertices, 12 triangles."""
    w, d = width / 2, depth / 2
    positions = [
        (x, y, z) for z in (0.0, height) for y in (-d, d) for x in (-w, w)
    ]
    normals = [(0.0, 0.0, 1.0)] * 8
    uvs = [((i & 1) * 1.0, (i >> 1 & 1) * 1.0) for i in range(8)]
    faces = [
        (0, 1, 3), (0, 3, 2), (4, 6, 7), (4, 7, 5), (0, 4, 5), (0, 5, 1),
        (2, 3, 7), (2, 7, 6), (0, 2, 6), (0, 6, 4), (1, 5, 7), (1, 7, 3),
    ]  # fmt: skip
    return positions, normals, uvs, [i for face in faces for i in face]


def pack_glb(
    nodes: dict[str, tuple[float, float, float]],
    *,
    texture: bytes | None = None,
    scale: float = 100.0,
    rotation=Z_UP_TO_Y_UP,
    extra_document: dict | None = None,
) -> bytes:
    """A GLB with one box mesh per node: `{name: (width, depth, height)}` in Z-up metres / scale."""
    binary = bytearray()
    views, accessors, meshes, scene_nodes = [], [], [], []

    def view(data: bytes, target=None) -> int:
        binary.extend(b"\x00" * (-len(binary) % 4))
        entry = {"buffer": 0, "byteOffset": len(binary), "byteLength": len(data)}
        if target:
            entry["target"] = target
        binary.extend(data)
        views.append(entry)
        return len(views) - 1

    def accessor(values, kind, fmt, component, bounds=False) -> int:
        width = {"VEC2": 2, "VEC3": 3, "SCALAR": 1}[kind]
        rows = values if kind != "SCALAR" else [(v,) for v in values]
        data = b"".join(struct.pack("<" + fmt * width, *row) for row in rows)
        entry = {
            "bufferView": view(data, 34963 if kind == "SCALAR" else 34962),
            "componentType": component,
            "count": len(rows),
            "type": kind,
        }
        if bounds:
            entry["min"] = [min(r[i] for r in rows) for i in range(width)]
            entry["max"] = [max(r[i] for r in rows) for i in range(width)]
        accessors.append(entry)
        return len(accessors) - 1

    images = []
    if texture is not None:
        images.append({"name": "atlas.png", "bufferView": view(texture), "mimeType": "image/png"})
    for index, (name, (width, depth, height)) in enumerate(nodes.items()):
        positions, normals, uvs, indices = _box(width / scale, depth / scale, height / scale)
        primitive = {
            "attributes": {
                "POSITION": accessor(positions, "VEC3", "f", 5126, bounds=True),
                "NORMAL": accessor(normals, "VEC3", "f", 5126),
                "TEXCOORD_0": accessor(uvs, "VEC2", "f", 5126),
            },
            "indices": accessor(indices, "SCALAR", "H", 5123),
            "material": 0,
        }
        meshes.append({"name": name, "primitives": [primitive]})
        scene_nodes.append(
            {
                "name": name,
                "mesh": index,
                "translation": [100.0 + 5 * index, 0.0, 0.0],
                "rotation": rotation,
                "scale": [scale, scale, scale],
            }
        )
    material = {
        "name": "Leaves",
        "alphaMode": "BLEND",
        "extras": {"fromFBX": {"shadingModel": "Phong"}},
        "pbrMetallicRoughness": {"metallicFactor": 0.4, "roughnessFactor": 0.3},
    }
    if texture is not None:
        material["pbrMetallicRoughness"]["baseColorTexture"] = {"index": 0}
    document = {
        "asset": {"version": "2.0", "generator": "FBX2glTF test"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [
            {"name": "RootNode", "children": list(range(1, len(scene_nodes) + 1))},
            *scene_nodes,
        ],
        "meshes": meshes,
        "accessors": accessors,
        "bufferViews": views,
        "buffers": [{"byteLength": len(binary) + (-len(binary) % 4)}],
        "materials": [material],
        "cameras": [{"type": "perspective", "perspective": {"yfov": 1, "znear": 0.1}}],
    }
    if texture is not None:
        document["images"] = images
        document["textures"] = [{"source": 0, "sampler": 0}]
        document["samplers"] = [{"magFilter": 9729, "minFilter": 9987}]
    if extra_document:
        document.update(extra_document)
    text = json.dumps(document).encode()
    text += b" " * (-len(text) % 4)
    binary.extend(b"\x00" * (-len(binary) % 4))
    body = struct.pack("<II", len(text), 0x4E4F534A) + text
    body += struct.pack("<II", len(binary), 0x004E4942) + bytes(binary)
    return struct.pack("<III", 0x46546C67, 2, 12 + len(body)) + body
