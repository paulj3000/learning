"""Model validation for the asset manager (LAI-2200 AM-3; `docs/ASSET_MANAGER.md` section 5).

`validate_model(stream, size=..., definition=...)` reads an untrusted upload and returns a
`ValidationResult`: the detected format, structured findings an administrator can act on, and
the metadata a published version carries (animation clips, bounding dimensions, counts).

Safety rules, all enforced here:
- The format comes from the bytes (GLB magic or a JSON document), never the file name.
- Reads are bounded: the size is checked before anything is read, the JSON is capped, and the
  binary chunk is never loaded (only a few bytes are peeked to check embedded image types).
- Nothing is fetched or opened: every `uri` must be an embedded `data:` URI. External files,
  `http(s)`, `file:` and relative paths are rejected.
- Nothing is executed. `extras` and unknown extensions are data and are never returned to
  players; extensions the loader cannot decode are rejected.
"""

import base64
import binascii
import json
import math
import re
import struct
from dataclasses import dataclass, field
from typing import IO, Any

from django.conf import settings

from .models import ModelFormat

GLB_MAGIC = 0x46546C67  # "glTF"
CHUNK_JSON = 0x4E4F534A
CHUNK_BIN = 0x004E4942

# Mirrors react/src/features/island-map/three/assets/animationVocabulary.ts.
CLIP_VOCABULARY = frozenset(
    "Idle Walk Talk Wave Point Celebrate ReactHappy ReactConcerned Open Close Activate".split()
)

# Extensions three.js's GLTFLoader handles with no extra decoder (the app configures none).
SUPPORTED_EXTENSIONS = frozenset(
    {
        "KHR_lights_punctual",
        "KHR_materials_clearcoat",
        "KHR_materials_emissive_strength",
        "KHR_materials_ior",
        "KHR_materials_iridescence",
        "KHR_materials_sheen",
        "KHR_materials_specular",
        "KHR_materials_transmission",
        "KHR_materials_unlit",
        "KHR_materials_variants",
        "KHR_materials_volume",
        "KHR_mesh_quantization",
        "KHR_texture_transform",
    }
)
NEEDS_DECODER = frozenset(
    {"KHR_draco_mesh_compression", "EXT_meshopt_compression", "KHR_texture_basisu"}
)

IMAGE_TYPES = {"image/png": b"\x89PNG\r\n\x1a\n", "image/jpeg": b"\xff\xd8\xff"}
BUFFER_URI_TYPES = ("application/octet-stream", "application/gltf-buffer")
DATA_URI = re.compile(r"^data:([a-z0-9.+/-]+)?(;[a-z0-9=.-]+)*;base64,", re.I)
BASE64 = re.compile(r"[A-Za-z0-9+/]*={0,2}")
ASSET_ID = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")

LIMITS = {
    "json_bytes": 16 * 1024 * 1024,
    "nodes": 10_000,
    "meshes": 2_000,
    "accessors": 20_000,
    "accessor_count": 10_000_000,
    "animations": 200,
    "materials": 500,
    "images": 200,
    "depth": 64,
}
COMPONENT_BYTES = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}
COUNTED = ("nodes", "meshes", "materials", "textures", "images", "animations", "skins")
TYPE_COMPONENTS = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT2": 4, "MAT3": 9, "MAT4": 16}


@dataclass(frozen=True)
class Finding:
    code: str
    severity: str  # "error" or "warning"
    message: str
    path: str = ""

    def as_dict(self) -> dict[str, str]:
        return {
            "code": self.code,
            "severity": self.severity,
            "message": self.message,
            "path": self.path,
        }


@dataclass
class ValidationResult:
    format: str | None = None
    findings: list[Finding] = field(default_factory=list)
    clips: list[str] = field(default_factory=list)
    dimensions: dict[str, float] | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    @property
    def passed(self) -> bool:
        return self.format is not None and not any(f.severity == "error" for f in self.findings)

    @property
    def errors(self) -> list[Finding]:
        return [f for f in self.findings if f.severity == "error"]

    def error(self, code, message, path=""):
        self.findings.append(Finding(code, "error", message, path))

    def warn(self, code, message, path=""):
        self.findings.append(Finding(code, "warning", message, path))

    def report(self) -> list[dict[str, str]]:
        return [f.as_dict() for f in self.findings]


class _Stop(Exception):
    """Internal: the file is unusable, stop checking."""


def max_upload_bytes() -> int:
    return int(getattr(settings, "LAI_ASSET_MAX_UPLOAD_BYTES", 50 * 1024 * 1024))


def validate_model(stream: IO[bytes], *, size: int, definition=None) -> ValidationResult:
    """Validate an untrusted model file. `stream` must be seekable; it is left at position 0."""
    result = ValidationResult()
    try:
        _check_definition(result, definition)
        if size <= 0:
            result.error("empty_file", "The file is empty.")
            raise _Stop
        if size > max_upload_bytes():
            result.error(
                "too_large",
                f"The file is {size:,} bytes; the limit is {max_upload_bytes():,} bytes. Reduce "
                "texture sizes or polygon count and export again.",
            )
            raise _Stop
        stream.seek(0)
        head = stream.read(12)
        if len(head) >= 4 and struct.unpack_from("<I", head)[0] == GLB_MAGIC:
            result.format = ModelFormat.GLB
            document, bin_info = _read_glb(result, stream, head, size)
        else:
            result.format = ModelFormat.GLTF
            document, bin_info = _read_gltf_json(result, stream, size), None
        _check_document(result, document, bin_info, stream, definition)
    except _Stop:
        if not result.errors:  # pragma: no cover - every stop records why
            result.error("unreadable", "The file could not be read as a glTF 2.0 model.")
    finally:
        stream.seek(0)
    return result


# --- reading -----------------------------------------------------------------------------------


def _check_definition(result: ValidationResult, definition) -> None:
    if definition is None:
        return
    if not ASSET_ID.fullmatch(definition.asset_id or ""):
        result.error("asset_id", "The asset id must be lowercase words joined by hyphens.")
    if getattr(definition, "status", "ACTIVE") != "ACTIVE":
        result.error("asset_retired", "This asset is retired; it cannot get new versions.")


def _read_glb(result, stream, head, size):
    if len(head) < 12:
        result.error("not_glb", "This file is too small to be a GLB model.")
        raise _Stop
    _magic, version, declared = struct.unpack("<III", head)
    if version != 2:
        result.error(
            "glb_version",
            f"This model uses glTF binary version {version}; only 2 is supported.",
        )
        raise _Stop
    if declared != size:
        result.error(
            "glb_length",
            f"The file looks damaged or cut short: its header says {declared:,} bytes but it is "
            f"{size:,} bytes.",
        )
        raise _Stop
    chunk = stream.read(8)
    if len(chunk) < 8:
        result.error("glb_chunks", "The GLB has no JSON chunk.")
        raise _Stop
    json_length, json_type = struct.unpack("<II", chunk)
    if json_type != CHUNK_JSON:
        result.error("glb_chunks", "The first GLB chunk must be the JSON chunk.")
        raise _Stop
    if json_length > LIMITS["json_bytes"] or 20 + json_length > size:
        result.error(
            "json_size",
            "The model's JSON chunk is too large or runs past the end of the file.",
        )
        raise _Stop
    if json_length % 4:
        result.warn("glb_padding", "The JSON chunk is not padded to 4 bytes.")
    document = _parse_json(result, stream.read(json_length))
    bin_info = None
    offset = 20 + json_length  # chunks are 4-byte aligned, so the next one starts here
    if offset + 8 <= size:
        stream.seek(offset)
        bin_length, bin_type = struct.unpack("<II", stream.read(8))
        if bin_type != CHUNK_BIN:
            result.error("glb_chunks", "The second GLB chunk must be the binary chunk.")
            raise _Stop
        if offset + 8 + bin_length > size:
            result.error("glb_chunks", "The binary chunk runs past the end of the file.")
            raise _Stop
        bin_info = {"offset": offset + 8, "length": bin_length}
    return document, bin_info


def _read_gltf_json(result, stream, size):
    if size > LIMITS["json_bytes"]:
        result.error(
            "json_size",
            f"A .gltf file may be at most {LIMITS['json_bytes']:,} bytes. Export a .glb instead.",
        )
        raise _Stop
    stream.seek(0)
    raw = stream.read(size)
    if raw.lstrip()[:1] != b"{":
        result.format = None
        result.error(
            "not_a_model",
            'This file is not a glTF model. Export it from Blender as "glTF Binary (.glb)". '
            "FBX, Blender, ZIP and RAR files are not accepted.",
        )
        raise _Stop
    return _parse_json(result, raw)


def _parse_json(result, raw: bytes) -> dict:
    try:
        document = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError, RecursionError):
        result.error("invalid_json", "The model's JSON is not valid.")
        raise _Stop from None
    if not isinstance(document, dict):
        result.error("invalid_json", "The model's JSON must be an object.")
        raise _Stop
    return document


# --- the document ------------------------------------------------------------------------------


def _list(document, name) -> list:
    value = document.get(name, [])
    return value if isinstance(value, list) else []


def _check_document(result, document, bin_info, stream, definition):
    asset = document.get("asset")
    if not isinstance(asset, dict) or asset.get("version") != "2.0":
        result.error("gltf_version", 'Only glTF 2.0 models are supported ("asset.version": "2.0").')
        raise _Stop

    for name, limit in (
        ("nodes", "nodes"),
        ("meshes", "meshes"),
        ("accessors", "accessors"),
        ("animations", "animations"),
        ("materials", "materials"),
        ("images", "images"),
    ):
        if len(_list(document, name)) > LIMITS[limit]:
            result.error("too_complex", f"The model has more than {LIMITS[limit]:,} {name}.", name)
            raise _Stop

    _check_extensions(result, document)
    buffer_lengths = _check_buffers(result, document, bin_info)
    _check_buffer_views_and_accessors(result, document, buffer_lengths)
    _check_images(result, document, bin_info, stream)
    dimensions = _bounds(result, document)
    clips = _check_animations(result, document, definition)

    result.clips = clips
    result.dimensions = dimensions
    result.metadata = {
        "generator": str(asset.get("generator", ""))[:100],
        "counts": {
            name: len(_list(document, name))
            for name in COUNTED
        },
        "extensionsUsed": sorted(str(e) for e in _list(document, "extensionsUsed"))[:50],
        "skinned": bool(_list(document, "skins")),
    }


def _check_extensions(result, document):
    used = {str(e) for e in _list(document, "extensionsUsed")}
    required = {str(e) for e in _list(document, "extensionsRequired")}
    for name in sorted(used | required):
        if name in NEEDS_DECODER:
            result.error(
                "needs_decoder",
                f"{name} needs a decoder the game does not load. Export without compression.",
                "extensionsUsed",
            )
        elif name not in SUPPORTED_EXTENSIONS:
            if name in required:
                result.error(
                    "unsupported_extension",
                    f"The model requires {name}, which the game does not support.",
                )
            else:
                result.warn("unknown_extension", f"{name} will be ignored by the game.")


def _data_uri_payload_length(uri: str) -> int | None:
    match = DATA_URI.match(uri)
    if not match:
        return None
    encoded = uri[match.end():]
    if len(encoded) % 4 or not BASE64.fullmatch(encoded):
        return None
    padding = len(encoded) - len(encoded.rstrip("="))
    return len(encoded) * 3 // 4 - padding


def _media_type(uri: str) -> str:
    match = DATA_URI.match(uri)
    return (match.group(1) or "").lower() if match else ""


def _check_buffers(result, document, bin_info) -> list[int]:
    lengths = []
    for index, buffer in enumerate(_list(document, "buffers")):
        path = f"buffers[{index}]"
        if not isinstance(buffer, dict):
            result.error("invalid_buffer", "A buffer entry is malformed.", path)
            lengths.append(0)
            continue
        declared = buffer.get("byteLength")
        if not isinstance(declared, int) or declared < 1:
            result.error("invalid_buffer", "A buffer has no valid byteLength.", path)
            declared = 0
        uri = buffer.get("uri")
        if uri is None:
            if index != 0 or result.format != ModelFormat.GLB or bin_info is None:
                result.error("missing_buffer", "A buffer has no data.", path)
            elif declared > bin_info["length"]:
                result.error(
                    "buffer_bounds",
                    "The buffer is longer than the GLB binary chunk.",
                    path,
                )
        elif not isinstance(uri, str) or not uri.lower().startswith("data:"):
            result.error(
                "external_resource",
                "The model refers to an external file. Embed every buffer (export as .glb).",
                path,
            )
        elif _media_type(uri) not in BUFFER_URI_TYPES:
            result.error("invalid_buffer", "An embedded buffer has an unexpected media type.", path)
        else:
            payload = _data_uri_payload_length(uri)
            if payload is None:
                result.error("invalid_buffer", "An embedded buffer is not valid base64.", path)
            elif payload < declared:
                result.error(
                    "buffer_bounds",
                    "An embedded buffer is shorter than its byteLength.",
                    path,
                )
        lengths.append(declared)
    return lengths


def _check_buffer_views_and_accessors(result, document, buffer_lengths):
    views = _list(document, "bufferViews")
    for index, view in enumerate(views):
        path = f"bufferViews[{index}]"
        if not isinstance(view, dict):
            result.error("invalid_buffer_view", "A buffer view is malformed.", path)
            continue
        buffer = view.get("buffer")
        offset = view.get("byteOffset", 0)
        length = view.get("byteLength")
        if not (isinstance(buffer, int) and 0 <= buffer < len(buffer_lengths)):
            result.error("invalid_buffer_view", "A buffer view points at a missing buffer.", path)
        elif not (_whole(offset) and _whole(length) and length > 0):
            result.error("invalid_buffer_view", "A buffer view has an invalid range.", path)
        elif offset + length > buffer_lengths[buffer]:
            result.error("buffer_bounds", "A buffer view runs past the end of its buffer.", path)
    for index, accessor in enumerate(_list(document, "accessors")):
        path = f"accessors[{index}]"
        if not isinstance(accessor, dict):
            result.error("invalid_accessor", "An accessor is malformed.", path)
            continue
        count = accessor.get("count")
        size = COMPONENT_BYTES.get(accessor.get("componentType"))
        components = TYPE_COMPONENTS.get(accessor.get("type"))
        if not isinstance(count, int) or count < 1 or size is None or components is None:
            result.error(
                "invalid_accessor",
                "An accessor has an invalid count, type or component.",
                path,
            )
            continue
        if count > LIMITS["accessor_count"]:
            result.error("too_complex", "An accessor has too many elements.", path)
            continue
        view_index = accessor.get("bufferView")
        if view_index is None:
            continue  # all zeros, or sparse: nothing to bound
        if not (isinstance(view_index, int) and 0 <= view_index < len(views)):
            result.error("invalid_accessor", "An accessor points at a missing buffer view.", path)
            continue
        view = views[view_index] if isinstance(views[view_index], dict) else {}
        element = size * components
        stride = view.get("byteStride") or element
        offset = accessor.get("byteOffset", 0)
        needed = (offset if isinstance(offset, int) else 0) + stride * (count - 1) + element
        if isinstance(view.get("byteLength"), int) and needed > view["byteLength"]:
            result.error(
                "buffer_bounds",
                "An accessor reads past the end of its buffer view.",
                path,
            )


def _check_images(result, document, bin_info, stream):
    views = _list(document, "bufferViews")
    for index, image in enumerate(_list(document, "images")):
        path = f"images[{index}]"
        if not isinstance(image, dict):
            result.error("invalid_image", "An image entry is malformed.", path)
            continue
        uri = image.get("uri")
        if uri is not None:
            if not isinstance(uri, str) or not uri.lower().startswith("data:"):
                result.error(
                    "external_resource",
                    "A texture refers to an external file. Embed textures (export as .glb).",
                    path,
                )
                continue
            media = _media_type(uri)
            if media not in IMAGE_TYPES:
                result.error("image_type", "Textures must be PNG or JPEG.", path)
                continue
            match = DATA_URI.match(uri)
            try:
                head = base64.b64decode(uri[match.end() : match.end() + 16], validate=True)
            except (binascii.Error, ValueError):
                head = b""
            if not head.startswith(IMAGE_TYPES[media]):
                result.error(
                    "image_type",
                    "An embedded texture is not the image type it claims.",
                    path,
                )
            continue
        media = str(image.get("mimeType", "")).lower()
        if media not in IMAGE_TYPES:
            result.error("image_type", "Textures must be PNG or JPEG.", path)
            continue
        view_index = image.get("bufferView")
        if not (isinstance(view_index, int) and 0 <= view_index < len(views)):
            result.error("invalid_image", "A texture points at a missing buffer view.", path)
            continue
        view = views[view_index]
        if bin_info is not None and isinstance(view, dict) and view.get("buffer") == 0:
            stream.seek(bin_info["offset"] + int(view.get("byteOffset", 0) or 0))
            if not stream.read(8).startswith(IMAGE_TYPES[media]):
                result.error("image_type", "A texture is not the image type it claims.", path)


# --- bounds ------------------------------------------------------------------------------------

Matrix = list[float]  # column-major 4x4, as glTF stores it
IDENTITY: Matrix = [1.0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 1.0]


def _multiply(a: Matrix, b: Matrix) -> Matrix:
    return [
        sum(a[k * 4 + row] * b[col * 4 + k] for k in range(4))
        for col in range(4)
        for row in range(4)
    ]


def _node_matrix(node: dict) -> Matrix:
    matrix = node.get("matrix")
    if isinstance(matrix, list) and len(matrix) == 16 and all(_finite(v) for v in matrix):
        return [float(v) for v in matrix]
    t = _vector(node.get("translation"), 3, 0.0)
    x, y, z, w = _vector(node.get("rotation"), 4, 0.0, default_last=1.0)
    sx, sy, sz = _vector(node.get("scale"), 3, 1.0)
    rotation = [
        1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
        2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
        2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0,
        0, 0, 0, 1,
    ]  # fmt: skip
    for column, factor in enumerate((sx, sy, sz)):
        for row in range(3):
            rotation[column * 4 + row] *= factor
    rotation[12:15] = t
    return rotation


def _whole(value) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def _item(items: list, index):
    """`items[index]` when it is a dict at a valid index, else None (never raises)."""
    if isinstance(index, int) and not isinstance(index, bool) and 0 <= index < len(items):
        return items[index] if isinstance(items[index], dict) else None
    return None


def _point(value) -> bool:
    return isinstance(value, list) and len(value) == 3 and all(_finite(c) for c in value)


def _finite(value) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool) and math.isfinite(value)


def _vector(value, length, fill, default_last=None):
    if isinstance(value, list) and len(value) == length and all(_finite(v) for v in value):
        return [float(v) for v in value]
    out = [fill] * length
    if default_last is not None:
        out[-1] = default_last
    return out


def _bounds(result, document) -> dict[str, float] | None:
    nodes = _list(document, "nodes")
    meshes = _list(document, "meshes")
    accessors = _list(document, "accessors")
    scenes = _list(document, "scenes")
    scene_index = document.get("scene", 0)
    if not scenes or not isinstance(scene_index, int) or not 0 <= scene_index < len(scenes):
        result.error("no_scene", "The model has no default scene.")
        return None
    roots = scenes[scene_index].get("nodes", []) if isinstance(scenes[scene_index], dict) else []
    low = [math.inf] * 3
    high = [-math.inf] * 3
    missing_bounds = False
    visited: set[int] = set()

    def walk(index, parent: Matrix, depth: int):
        nonlocal missing_bounds
        node = _item(nodes, index)
        if node is None:
            result.error("invalid_node", "The scene refers to a missing node.", f"nodes[{index}]")
            return
        if index in visited:
            result.error(
                "node_cycle",
                "A node appears twice in the scene graph.",
                f"nodes[{index}]",
            )
            return
        if depth > LIMITS["depth"]:
            result.error("too_complex", "The node hierarchy is too deep.", f"nodes[{index}]")
            return
        visited.add(index)
        world = _multiply(parent, _node_matrix(node))
        mesh_index = node.get("mesh")
        mesh = _item(meshes, mesh_index)
        if mesh is not None:
            for primitive in mesh.get("primitives", []):
                attributes = primitive.get("attributes") if isinstance(primitive, dict) else None
                position = attributes.get("POSITION") if isinstance(attributes, dict) else None
                accessor = _item(accessors, position) or {}
                box = accessor.get("min"), accessor.get("max")
                if not all(_point(v) for v in box):
                    missing_bounds = True
                    continue
                for corner in range(8):
                    point = [box[(corner >> axis) & 1][axis] for axis in range(3)]
                    for axis in range(3):
                        value = world[12 + axis] + sum(
                            world[k * 4 + axis] * point[k] for k in range(3)
                        )
                        low[axis] = min(low[axis], value)
                        high[axis] = max(high[axis], value)
        elif mesh_index is not None:
            result.error("invalid_node", "A node refers to a missing mesh.", f"nodes[{index}]")
        for child in node.get("children", []) or []:
            walk(child, world, depth + 1)

    for root in roots:
        walk(root, IDENTITY, 0)
    if low[0] == math.inf:
        result.error("no_geometry", "The default scene has no geometry with known bounds.")
        return None
    if missing_bounds:
        result.warn(
            "missing_bounds",
            "Some meshes have no POSITION min/max; the size is approximate.",
        )
    return {axis: round(high[i] - low[i], 4) for i, axis in enumerate("xyz")}


# --- animation ---------------------------------------------------------------------------------


def _check_animations(result, document, definition) -> list[str]:
    names: list[str] = []
    for index, animation in enumerate(_list(document, "animations")):
        path = f"animations[{index}]"
        name = animation.get("name") if isinstance(animation, dict) else None
        if not isinstance(name, str) or not name.strip():
            result.warn("unnamed_clip", "An animation has no name, so nothing can play it.", path)
            continue
        if len(name) > 64:
            result.error("clip_name", "An animation name is longer than 64 characters.", path)
            continue
        if name in names:
            result.error("duplicate_clip", f'Two animations are both called "{name}".', path)
            continue
        if name not in CLIP_VOCABULARY:
            result.warn(
                "unknown_clip",
                f'"{name}" is not in the clip vocabulary, so the game will not play it by name.',
                path,
            )
        names.append(name)
    if definition is not None:
        declared = [clip for clip in (definition.clips or []) if clip not in names]
        if declared:
            result.error(
                "missing_clip",
                "This asset's existing references use clips this file does not have: "
                + ", ".join(declared)
                + ".",
                "animations",
            )
        if definition.kind == "character" and not names:
            result.warn("no_clips", "A character with no animation clips will stand still.")
    return names
