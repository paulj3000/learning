"""Prepare one model out of a multi-model GLB pack for the engine (TR-PALM-02).

Many third-party packs ship several models side by side in one file, authored Z-up and exported
through FBX with a 100x scale on each node. The engine wants one model per asset, Y-up, in
metres, standing on its origin. `extract_model` produces exactly that from one named node:

- Only that node's mesh, materials, textures and images are kept. Cameras, lights, other nodes,
  animations and FBX `extras` are dropped.
- The node's rotation and scale are baked into the vertices (positions and normals), its
  translation is dropped, and the result is lifted so the lowest vertex sits on y = 0. The
  model's own authoring pivot (the trunk's foot, for a tree) stays on the vertical axis. The
  output node has an identity transform.
- Optional, for props that lie or stand off-pivot (TR-ENV-02): a turn about the vertical axis
  (`yaw_degrees`, so a log's length runs along X) and centring the footprint on the origin
  (`center_footprint`).
- An optional uniform scale makes the model a target size in metres along one axis (`fit`, or
  `target_height` for Y).
- Material fixes a pack declares (`MaterialFixes`): cut-out alpha instead of blended alpha (no
  sorting artefacts in instanced foliage), double-sided cut-outs, and FBX's stray metalness.
- PNG textures larger than `max_texture_size` are halved until they fit (`png_tools`).

The output is plain glTF 2.0 with every resource embedded, so `validation.validate_model`
accepts it like any upload. Pure Python and `struct`: no new dependency, nothing executed, no
URI followed. Only the accessor layouts the packs use are handled (float vectors, unsigned
indices, tightly packed or strided, no sparse accessors); anything else raises `PrepError`.
"""

import json
import math
import re
import struct
import urllib.parse
from dataclasses import dataclass, field
from pathlib import Path

from . import png_tools

GLB_MAGIC = 0x46546C67
CHUNK_JSON = 0x4E4F534A
CHUNK_BIN = 0x004E4942
GENERATOR = "Learning Adventure Island asset prep (apps.assets.gltf_prep)"

_FLOAT = 5126
_INDEX_FORMATS = {5121: "B", 5123: "H", 5125: "I"}
_WIDTH = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}
_KEPT_ATTRIBUTES = ("POSITION", "NORMAL", "TEXCOORD_0")


class PrepError(ValueError):
    """The pack cannot be prepared as declared. The message is safe to show an operator."""


@dataclass(frozen=True)
class MaterialFixes:
    blend_to_mask: bool = False
    alpha_cutoff: float = 0.5
    double_sided_cutouts: bool = False
    metallic: float | None = None
    roughness: float | None = None


@dataclass
class PreparedModel:
    node: str
    data: bytes
    triangles: int
    vertices: int
    dimensions: dict
    textures: list[dict] = field(default_factory=list)
    modifications: list[str] = field(default_factory=list)


def read_glb(data: bytes) -> tuple[dict, bytes]:
    """(JSON document, BIN chunk) of a GLB, or PrepError."""
    if len(data) < 20:
        raise PrepError("The file is too short to be a GLB.")
    magic, version, length = struct.unpack_from("<III", data)
    if magic != GLB_MAGIC or version != 2 or length != len(data):
        raise PrepError("The file is not a glTF 2.0 binary (GLB).")
    offset, document, binary = 12, None, b""
    while offset + 8 <= length:
        chunk_length, chunk_type = struct.unpack_from("<II", data, offset)
        body = data[offset + 8 : offset + 8 + chunk_length]
        if chunk_type == CHUNK_JSON and document is None:
            try:
                document = json.loads(body.decode("utf-8"))
            except (UnicodeDecodeError, ValueError):
                raise PrepError("The GLB's JSON chunk is not valid JSON.") from None
        elif chunk_type == CHUNK_BIN and not binary:
            binary = body
        offset += 8 + chunk_length
    if not isinstance(document, dict):
        raise PrepError("The GLB has no JSON chunk.")
    return document, binary


# A resource a .gltf may name: a plain file name next to it. Never a path, a scheme or a URL.
SAFE_RESOURCE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 ._()-]{0,200}$")
IMAGE_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg"}


def resource_uris(document: dict) -> list[str]:
    """The external files a .gltf names (buffers, then images), in order, `data:` URIs excluded."""
    uris = [entry.get("uri") for key in ("buffers", "images") for entry in document.get(key, [])]
    return [uri for uri in uris if isinstance(uri, str) and not uri.startswith("data:")]


def read_gltf(data: bytes, resolve) -> tuple[dict, bytes]:
    """A .gltf with its sibling .bin and images, as (document, binary) like `read_glb` returns.

    `resolve(name)` returns a sibling file's bytes or None. Every buffer is concatenated into the
    one binary chunk and every image becomes a buffer view, so the result is self-contained (TR-NAT
    packs ship as .gltf + .bin + shared textures). A name that is not a plain file name, or a file
    that is missing or the wrong length, is a PrepError: nothing is fetched from anywhere else.
    """
    try:
        document = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        raise PrepError("The .gltf is not valid JSON.") from None
    if not isinstance(document, dict) or document.get("asset", {}).get("version") != "2.0":
        raise PrepError("The file is not a glTF 2.0 document.")

    def fetch(uri: str) -> bytes:
        if uri.startswith("data:"):
            raise PrepError("Embedded data URIs inside a .gltf pack are not supported here.")
        name = urllib.parse.unquote(uri)
        if not SAFE_RESOURCE.fullmatch(name) or ".." in name:
            raise PrepError(f"The .gltf names a resource that is not a plain file name: {uri!r}.")
        content = resolve(name)
        if content is None:
            raise PrepError(f"The .gltf needs {name!r}, which is not in the source.")
        return content

    binary = bytearray()
    offsets = []
    for buffer in document.get("buffers", []):
        if "uri" not in buffer:
            raise PrepError("A .gltf buffer has no uri.")
        content = fetch(buffer["uri"])
        if len(content) < int(buffer.get("byteLength", 0)):
            raise PrepError(f"{buffer['uri']!r} is shorter than the .gltf says.")
        binary.extend(b"\x00" * (-len(binary) % 4))
        offsets.append(len(binary))
        binary.extend(content[: int(buffer["byteLength"])])
    views = document.get("bufferViews", [])
    for view in views:
        index = int(view.get("buffer", 0))
        if not 0 <= index < len(offsets):
            raise PrepError("A buffer view names a buffer that does not exist.")
        view["byteOffset"] = int(view.get("byteOffset", 0)) + offsets[index]
        view["buffer"] = 0
    for image in document.get("images", []):
        if "uri" not in image:
            continue
        content = fetch(image["uri"])
        mime = image.get("mimeType") or IMAGE_TYPES.get(Path(image["uri"]).suffix.lower())
        if mime not in IMAGE_TYPES.values():
            raise PrepError(f"Unsupported image type for {image['uri']!r}.")
        binary.extend(b"\x00" * (-len(binary) % 4))
        views.append({"buffer": 0, "byteOffset": len(binary), "byteLength": len(content)})
        binary.extend(content)
        image["bufferView"] = len(views) - 1
        image["mimeType"] = mime
        del image["uri"]
    document["bufferViews"] = views
    document["buffers"] = [{"byteLength": len(binary)}]
    return document, bytes(binary)


def node_names(document: dict) -> list[str]:
    return [str(node.get("name", "")) for node in document.get("nodes", [])]


def write_glb(document: dict, binary: bytes) -> bytes:
    text = json.dumps(document, separators=(",", ":"), sort_keys=True).encode("utf-8")
    text += b" " * (-len(text) % 4)
    binary += b"\x00" * (-len(binary) % 4)
    total = 12 + 8 + len(text) + 8 + len(binary)
    return b"".join(
        (
            struct.pack("<III", GLB_MAGIC, 2, total),
            struct.pack("<II", len(text), CHUNK_JSON),
            text,
            struct.pack("<II", len(binary), CHUNK_BIN),
            binary,
        )
    )


# --- reading accessors -------------------------------------------------------------------------


def _view_bytes(document: dict, binary: bytes, view_index: int) -> tuple[bytes, int | None]:
    views = document.get("bufferViews", [])
    if not 0 <= view_index < len(views):
        raise PrepError("A buffer view index is out of range.")
    view = views[view_index]
    if view.get("buffer", 0) != 0:
        raise PrepError("Only the GLB's own buffer is supported.")
    start = int(view.get("byteOffset", 0))
    end = start + int(view["byteLength"])
    if end > len(binary):
        raise PrepError("A buffer view runs past the end of the buffer.")
    return binary[start:end], view.get("byteStride")


def _read_accessor(document: dict, binary: bytes, index: int) -> list[tuple]:
    accessors = document.get("accessors", [])
    if not 0 <= index < len(accessors):
        raise PrepError("An accessor index is out of range.")
    accessor = accessors[index]
    if "sparse" in accessor or "bufferView" not in accessor:
        raise PrepError("Sparse or empty accessors are not supported.")
    width = _WIDTH.get(accessor.get("type"))
    component = accessor.get("componentType")
    if width is None:
        raise PrepError("Only scalar and vector accessors are supported.")
    if component == _FLOAT:
        fmt, size = "f", 4
    elif component in _INDEX_FORMATS and width == 1:
        fmt, size = _INDEX_FORMATS[component], struct.calcsize(_INDEX_FORMATS[component])
    else:
        raise PrepError("Only float vectors and unsigned integer indices are supported.")
    view, stride = _view_bytes(document, binary, accessor["bufferView"])
    element = width * size
    stride = stride or element
    offset, count = int(accessor.get("byteOffset", 0)), int(accessor["count"])
    if count and offset + stride * (count - 1) + element > len(view):
        raise PrepError("An accessor runs past the end of its buffer view.")
    layout = "<" + fmt * width
    return [struct.unpack_from(layout, view, offset + i * stride) for i in range(count)]


# --- transforms ---------------------------------------------------------------------------------


def _rotation_matrix(quaternion) -> list[list[float]]:
    x, y, z, w = (float(v) for v in quaternion)
    return [
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ]


def _apply(matrix, vector) -> tuple[float, float, float]:
    return tuple(sum(matrix[r][c] * vector[c] for c in range(3)) for r in range(3))


# --- extraction --------------------------------------------------------------------------------


class _Builder:
    """Collects the output buffer and its views, 4-byte aligned, in a fixed order."""

    def __init__(self):
        self.binary = bytearray()
        self.views: list[dict] = []
        self.accessors: list[dict] = []

    def view(self, data: bytes, target: int | None = None) -> int:
        self.binary += b"\x00" * (-len(self.binary) % 4)
        entry = {"buffer": 0, "byteOffset": len(self.binary), "byteLength": len(data)}
        if target is not None:
            entry["target"] = target
        self.binary += data
        self.views.append(entry)
        return len(self.views) - 1

    def floats(self, values: list[tuple], kind: str, with_bounds: bool = False) -> int:
        width = _WIDTH[kind]
        data = b"".join(struct.pack("<" + "f" * width, *value) for value in values)
        accessor = {
            "bufferView": self.view(data, 34962),
            "componentType": _FLOAT,
            "count": len(values),
            "type": kind,
        }
        if with_bounds and values:
            # Bounds of the float32 values actually stored, so validators agree with them.
            stored = [struct.unpack("<" + "f" * width, struct.pack("<" + "f" * width, *v)) for v in values]
            accessor["min"] = [min(v[i] for v in stored) for i in range(width)]
            accessor["max"] = [max(v[i] for v in stored) for i in range(width)]
        self.accessors.append(accessor)
        return len(self.accessors) - 1

    def indices(self, values: list[int]) -> int:
        component = 5123 if max(values, default=0) < 65535 else 5125
        fmt = _INDEX_FORMATS[component]
        data = struct.pack("<" + fmt * len(values), *values)
        self.accessors.append(
            {
                "bufferView": self.view(data, 34963),
                "componentType": component,
                "count": len(values),
                "type": "SCALAR",
            }
        )
        return len(self.accessors) - 1


def extract_model(
    document: dict,
    binary: bytes,
    node_name: str,
    *,
    target_height: float | None = None,
    fit: tuple[str, float] | None = None,
    yaw_degrees: float = 0.0,
    align_axis: tuple[float, float, float] | None = None,
    roll_degrees: float = 0.0,
    center_footprint: bool = False,
    max_texture_size: int | None = None,
    fixes: MaterialFixes = MaterialFixes(),
    asset_copyright: str = "",
    texture_cache: dict | None = None,
) -> PreparedModel:
    """The node called `node_name`, as a standalone engine-ready GLB (see the module doc)."""
    nodes = document.get("nodes", [])
    matches = [n for n in nodes if n.get("name") == node_name]
    if len(matches) != 1:
        raise PrepError(f'Expected exactly one node named "{node_name}", found {len(matches)}.')
    node = matches[0]
    if "mesh" not in node or "matrix" in node:
        raise PrepError(f'Node "{node_name}" has no mesh, or uses a matrix transform.')
    scale = [float(v) for v in node.get("scale", (1, 1, 1))]
    if max(scale) - min(scale) > 1e-6 * max(abs(v) for v in scale) or scale[0] <= 0:
        raise PrepError(f'Node "{node_name}" has a non-uniform or negative scale.')
    rotation = _rotation_matrix(node.get("rotation", (0, 0, 0, 1)))
    mesh = document["meshes"][node["mesh"]]

    # Pass 1: bake rotation and scale, collect geometry per primitive.
    primitives = []
    for primitive in mesh.get("primitives", []):
        if primitive.get("mode", 4) != 4:
            raise PrepError("Only triangle primitives are supported.")
        attributes = primitive.get("attributes", {})
        if "POSITION" not in attributes:
            raise PrepError("A primitive has no POSITION attribute.")
        positions = [
            tuple(v * scale[0] for v in _apply(rotation, p))
            for p in _read_accessor(document, binary, attributes["POSITION"])
        ]
        normals = (
            [_normalised(_apply(rotation, n)) for n in _read_accessor(document, binary, attributes["NORMAL"])]
            if "NORMAL" in attributes
            else None
        )
        uvs = (
            _read_accessor(document, binary, attributes["TEXCOORD_0"])
            if "TEXCOORD_0" in attributes
            else None
        )
        indices = (
            [i[0] for i in _read_accessor(document, binary, primitive["indices"])]
            if "indices" in primitive
            else list(range(len(positions)))
        )
        if any(i >= len(positions) for i in indices):
            raise PrepError("An index points past the end of its vertices.")
        primitives.append(
            {
                "positions": positions,
                "normals": normals,
                "uvs": uvs,
                "indices": indices,
                "material": primitive.get("material"),
            }
        )
    if not primitives:
        raise PrepError(f'Node "{node_name}" has an empty mesh.')

    # Re-posing (TR-ENV-02): a model authored at an angle (an inventory icon) is laid down by
    # turning its long axis onto +X and rolling about it; then any turn about the vertical.
    turns = []
    if align_axis is not None:
        turns.append(_shortest_arc(_normalised(align_axis), (1.0, 0.0, 0.0)))
    if roll_degrees:
        half = math.radians(roll_degrees) / 2
        turns.append((math.sin(half), 0.0, 0.0, math.cos(half)))
    if yaw_degrees:
        half = math.radians(yaw_degrees) / 2
        turns.append((0.0, math.sin(half), 0.0, math.cos(half)))
    for quaternion in turns:
        turn = _rotation_matrix(quaternion)
        for prim in primitives:
            prim["positions"] = [_apply(turn, p) for p in prim["positions"]]
            if prim["normals"] is not None:
                prim["normals"] = [_normalised(_apply(turn, n)) for n in prim["normals"]]

    # Ground it: lowest vertex on y = 0; centre the footprint if asked; then fit, uniformly.
    all_positions = [p for prim in primitives for p in prim["positions"]]
    lows = [min(p[i] for p in all_positions) for i in range(3)]
    highs = [max(p[i] for p in all_positions) for i in range(3)]
    height = highs[1] - lows[1]
    if height <= 0:
        raise PrepError(f'Node "{node_name}" has no height.')
    if target_height and fit is None:
        fit = ("y", target_height)
    factor = 1.0
    if fit is not None:
        axis = "xyz".index(fit[0])
        extent = highs[axis] - lows[axis]
        if extent <= 0:
            raise PrepError(f'Node "{node_name}" has no extent along {fit[0]}.')
        factor = fit[1] / extent
    cx = (lows[0] + highs[0]) / 2 if center_footprint else 0.0
    cz = (lows[2] + highs[2]) / 2 if center_footprint else 0.0
    for prim in primitives:
        prim["positions"] = [
            ((p[0] - cx) * factor, (p[1] - lows[1]) * factor, (p[2] - cz) * factor)
            for p in prim["positions"]
        ]

    modifications = [
        f'Extracted node "{node_name}" into its own file; other nodes, cameras, lights, '
        "animations and FBX extras removed",
        "Baked the node rotation (Z-up to Y-up) and its x{:g} scale into the vertices".format(scale[0]),
        "Origin moved to ground level (lowest vertex at y = 0), pivot kept on the vertical axis",
    ]
    if align_axis is not None:
        modifications.append(
            "Re-posed: long axis ({:.3f}, {:.3f}, {:.3f}) turned onto X".format(*align_axis)
            + (f", rolled {roll_degrees:g} degrees" if roll_degrees else "")
        )
    elif roll_degrees:
        modifications.append(f"Rolled {roll_degrees:g} degrees about X")
    if yaw_degrees:
        modifications.append(f"Turned {yaw_degrees:g} degrees about the vertical axis")
    if center_footprint:
        modifications.append("Footprint centred on the origin")
    if fit is not None:
        was = highs["xyz".index(fit[0])] - lows["xyz".index(fit[0])]
        modifications.append(
            f"Uniformly scaled x{factor:.4f} to {fit[1]:g} m along {fit[0].upper()} "
            f"(was {was:.3f} m)"
        )

    builder = _Builder()
    images_out, textures_out, samplers_out, materials_out = [], [], [], []
    image_map, texture_map, sampler_map, material_map = {}, {}, {}, {}
    texture_report = []

    def image_index(source: int) -> int:
        if source in image_map:
            return image_map[source]
        image = document["images"][source]
        if "bufferView" not in image:
            raise PrepError("Only images embedded in the GLB are supported.")
        data, _stride = _view_bytes(document, binary, image["bufferView"])
        original = png_tools.dimensions(data)
        if max_texture_size and image.get("mimeType") == "image/png":
            cache = texture_cache if texture_cache is not None else {}
            key = (bytes(data), max_texture_size)
            if key not in cache:
                cache[key] = png_tools.downscale_png(bytes(data), max_texture_size)
            smaller = cache[key]
            if smaller is not None:
                texture_report.append(
                    {
                        "name": image.get("name", ""),
                        "from": list(original or ()),
                        "to": list(png_tools.dimensions(smaller) or ()),
                        "bytesFrom": len(data),
                        "bytesTo": len(smaller),
                    }
                )
                data = smaller
        entry = {"bufferView": builder.view(bytes(data)), "mimeType": image["mimeType"]}
        if image.get("name"):
            entry["name"] = image["name"]
        images_out.append(entry)
        image_map[source] = len(images_out) - 1
        return image_map[source]

    def texture_index(source: int) -> int:
        if source in texture_map:
            return texture_map[source]
        texture = document["textures"][source]
        entry = {"source": image_index(texture["source"])}
        if "sampler" in texture:
            sampler = texture["sampler"]
            if sampler not in sampler_map:
                samplers_out.append(
                    {
                        k: v
                        for k, v in document["samplers"][sampler].items()
                        if k in ("magFilter", "minFilter", "wrapS", "wrapT")
                    }
                )
                sampler_map[sampler] = len(samplers_out) - 1
            entry["sampler"] = sampler_map[sampler]
        textures_out.append(entry)
        texture_map[source] = len(textures_out) - 1
        return texture_map[source]

    def material_index(source: int | None) -> int | None:
        if source is None:
            return None
        if source in material_map:
            return material_map[source]
        material = document["materials"][source]
        pbr_in = material.get("pbrMetallicRoughness", {})
        pbr = {k: v for k, v in pbr_in.items() if k in ("baseColorFactor", "metallicFactor", "roughnessFactor")}
        if "baseColorTexture" in pbr_in:
            pbr["baseColorTexture"] = {"index": texture_index(pbr_in["baseColorTexture"]["index"])}
        if fixes.metallic is not None:
            pbr["metallicFactor"] = fixes.metallic
        if fixes.roughness is not None:
            pbr["roughnessFactor"] = fixes.roughness
        entry = {"name": material.get("name", ""), "pbrMetallicRoughness": pbr}
        alpha = material.get("alphaMode", "OPAQUE")
        if alpha == "BLEND" and fixes.blend_to_mask:
            alpha = "MASK"
        if alpha != "OPAQUE":
            entry["alphaMode"] = alpha
        if alpha == "MASK":
            entry["alphaCutoff"] = material.get("alphaCutoff", fixes.alpha_cutoff)
        if material.get("doubleSided") or (alpha == "MASK" and fixes.double_sided_cutouts):
            entry["doubleSided"] = True
        materials_out.append(entry)
        material_map[source] = len(materials_out) - 1
        return material_map[source]

    out_primitives = []
    for prim in primitives:
        attributes = {"POSITION": builder.floats(prim["positions"], "VEC3", with_bounds=True)}
        if prim["normals"] is not None:
            attributes["NORMAL"] = builder.floats(prim["normals"], "VEC3")
        if prim["uvs"] is not None:
            attributes["TEXCOORD_0"] = builder.floats(prim["uvs"], "VEC2")
        entry = {"attributes": attributes, "indices": builder.indices(prim["indices"]), "mode": 4}
        material = material_index(prim["material"])
        if material is not None:
            entry["material"] = material
        out_primitives.append(entry)

    if fixes.blend_to_mask:
        modifications.append(
            f"Blended alpha replaced by cut-out alpha (cutoff {fixes.alpha_cutoff:g})"
            + (", double-sided" if fixes.double_sided_cutouts else "")
        )
    if fixes.metallic is not None or fixes.roughness is not None:
        modifications.append(
            "FBX-converted PBR values replaced: metallic "
            f"{fixes.metallic if fixes.metallic is not None else 'kept'}, roughness "
            f"{fixes.roughness if fixes.roughness is not None else 'kept'}"
        )
    for report in texture_report:
        modifications.append(
            "Texture {name} downscaled {a}x{b} to {c}x{d}".format(
                name=report["name"], a=report["from"][0], b=report["from"][1],
                c=report["to"][0], d=report["to"][1],
            )
        )

    asset = {"version": "2.0", "generator": GENERATOR}
    if asset_copyright:
        asset["copyright"] = asset_copyright
    out = {
        "asset": asset,
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"name": node_name, "mesh": 0}],
        "meshes": [{"name": node_name, "primitives": out_primitives}],
        "accessors": builder.accessors,
        "bufferViews": builder.views,
        "buffers": [{"byteLength": len(builder.binary) + (-len(builder.binary) % 4)}],
    }
    for key, values in (
        ("materials", materials_out),
        ("textures", textures_out),
        ("images", images_out),
        ("samplers", samplers_out),
    ):
        if values:
            out[key] = values

    final = [p for prim in primitives for p in prim["positions"]]
    dimensions = {
        axis: round(max(p[i] for p in final) - min(p[i] for p in final), 4)
        for i, axis in enumerate("xyz")
    }
    return PreparedModel(
        node=node_name,
        data=write_glb(out, bytes(builder.binary)),
        triangles=sum(len(prim["indices"]) // 3 for prim in primitives),
        vertices=len(final),
        dimensions=dimensions,
        textures=texture_report,
        modifications=modifications,
    )


def _shortest_arc(source, target) -> tuple[float, float, float, float]:
    """The unit quaternion (x, y, z, w) turning unit vector `source` onto unit vector `target`."""
    dot = sum(a * b for a, b in zip(source, target, strict=True))
    if dot < -0.999999:  # opposite: half a turn about any perpendicular axis
        axis = (0.0, 1.0, 0.0) if abs(source[0]) > 0.9 else (1.0, 0.0, 0.0)
        cross = _normalised(
            (
                source[1] * axis[2] - source[2] * axis[1],
                source[2] * axis[0] - source[0] * axis[2],
                source[0] * axis[1] - source[1] * axis[0],
            )
        )
        return (*cross, 0.0)
    cross = (
        source[1] * target[2] - source[2] * target[1],
        source[2] * target[0] - source[0] * target[2],
        source[0] * target[1] - source[1] * target[0],
    )
    w = 1.0 + dot
    length = math.sqrt(w * w + sum(c * c for c in cross))
    return (cross[0] / length, cross[1] / length, cross[2] / length, w / length)


def _normalised(vector) -> tuple[float, float, float]:
    length = math.sqrt(sum(v * v for v in vector)) or 1.0
    return tuple(v / length for v in vector)
