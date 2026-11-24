"""What an optimization must not change, read from a GLB with the standard-library inspectors.

`model_signature(data)` builds a comparable summary of a GLB using `lai_processing` only (the GLB
container reader, the strict JSON parser and the animation inspector, LAI-LAMBDA-009). It never
decodes a compressed buffer: everything compared is in the JSON chunk or in accessor bounds, so
the same function reads a source GLB and its Meshopt output.

`compare_signatures(before, after, textures=...)` lists every difference that matters to the
game:

- node hierarchy: the same tree of node paths (names, or `#<child index>` for unnamed nodes),
  the same mesh, skin and camera attachments, the same local transforms (float tolerance);
- meshes: per mesh-bearing node, the primitive modes, attribute semantics, index presence,
  morph target count, material, vertex count and index count (no simplification);
- materials: names, alpha mode, double-sidedness, which texture slots are used and the
  material extensions;
- skins: joint paths in order, skeleton path, inverse bind matrix count;
- animations: clip names in order, start and duration (from accessor bounds), channel count,
  target paths and the set of (target node path, property) pairs;
- textures: `identical` (the Meshopt profile: image bytes unchanged, by SHA-256) or
  `ktx2` (the KTX2 profile: same texture count and slots, every image now `image/ktx2`).

Keyframe counts are reported but not compared: gltfpack collapses constant two-key tracks to
one key, which changes no pose. Vertex counts may only go down on indexed primitives (gltfpack
welds vertices that are identical after attribute quantization; index counts must not change),
and an identity `KHR_texture_transform` counts as no transform.
"""

from __future__ import annotations

import hashlib
import io
import math
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, Final, Literal

from lai_processing.processors.animation.inspect import AnimationSettings, inspect_glb
from lai_processing.processors.gltf.container import read_at, read_layout
from lai_processing.processors.gltf.images import image_dimensions
from lai_processing.processors.gltf.jsonparse import parse_document
from lai_processing.processors.gltf.report import Report, Stop

__all__ = [
    "Difference",
    "ModelSignature",
    "SignatureError",
    "compare_signatures",
    "model_signature",
]

TextureRule = Literal["identical", "ktx2"]
_TEXTURE_SLOTS: Final = (
    ("pbrMetallicRoughness", "baseColorTexture"),
    ("pbrMetallicRoughness", "metallicRoughnessTexture"),
    (None, "normalTexture"),
    (None, "occlusionTexture"),
    (None, "emissiveTexture"),
)
_REL: Final = 1e-5
_ABS: Final = 1e-6
_DURATION_ABS: Final = 1e-4
_MAX_DIFFERENCES: Final = 50


class SignatureError(ValueError):
    """The GLB cannot be read well enough to compare (the validator explains why)."""

    def __init__(self, codes: list[str]) -> None:
        super().__init__("The model could not be inspected.")
        self.codes = codes


@dataclass(frozen=True, slots=True)
class Difference:
    code: str
    path: str


@dataclass
class ModelSignature:
    nodes: list[dict[str, Any]] = field(default_factory=list)
    meshes: list[dict[str, Any]] = field(default_factory=list)
    materials: list[dict[str, Any]] = field(default_factory=list)
    skins: list[dict[str, Any]] = field(default_factory=list)
    clips: list[dict[str, Any]] = field(default_factory=list)
    textures: list[dict[str, Any]] = field(default_factory=list)
    images: list[dict[str, Any]] = field(default_factory=list)
    extensions_used: list[str] = field(default_factory=list)
    extensions_required: list[str] = field(default_factory=list)
    vertex_count: int = 0
    triangle_count: int = 0
    keyframe_count: int = 0

    def summary(self) -> dict[str, Any]:
        """Bounded facts for the optimize report."""
        return {
            "node_count": len(self.nodes),
            "mesh_node_count": len(self.meshes),
            "primitive_count": sum(len(m["primitives"]) for m in self.meshes),
            "vertex_count": self.vertex_count,
            "triangle_count": self.triangle_count,
            "material_count": len(self.materials),
            "texture_count": len(self.textures),
            "skin_count": len(self.skins),
            "joint_count": sum(len(s["joints"]) for s in self.skins),
            "animation_count": len(self.clips),
            "keyframe_count": self.keyframe_count,
            "extensions_used": self.extensions_used,
            "extensions_required": self.extensions_required,
        }


def _dict(value: object) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _list(value: object) -> list[Any]:
    return value if isinstance(value, list) else []


def _floats(values: object) -> tuple[float, ...]:
    return tuple(float(v) for v in _list(values) if isinstance(v, int | float))


def _close(a: float, b: float, absolute: float = _ABS) -> bool:
    return math.isclose(a, b, rel_tol=_REL, abs_tol=absolute)


def _node_paths(document: Mapping[str, Any]) -> tuple[list[str], dict[int, int | None]]:
    nodes = _list(document.get("nodes"))
    parent: dict[int, int | None] = {}
    for index, node in enumerate(nodes):
        for child in _list(_dict(node).get("children")):
            if isinstance(child, int) and 0 <= child < len(nodes):
                parent.setdefault(child, index)
    paths = [""] * len(nodes)

    def path_of(index: int, depth: int = 0) -> str:
        if paths[index]:
            return paths[index]
        if depth > len(nodes):
            return f"#cycle{index}"
        name = _dict(nodes[index]).get("name")
        up = parent.get(index)
        if isinstance(name, str) and name:
            label = name
        elif up is None:
            label = f"#root{_root_position(document, index)}"
        else:
            label = f"#{_list(_dict(nodes[up]).get('children')).index(index)}"
        prefix = "" if up is None else path_of(up, depth + 1)
        paths[index] = f"{prefix}/{label}"
        return paths[index]

    for index in range(len(nodes)):
        path_of(index)
    return paths, parent


def _root_position(document: Mapping[str, Any], index: int) -> int:
    for scene in _list(document.get("scenes")):
        roots = _list(_dict(scene).get("nodes"))
        if index in roots:
            return roots.index(index)
    return index


def _trs(node: Mapping[str, Any]) -> dict[str, tuple[float, ...]]:
    if "matrix" in node:
        return {"matrix": _floats(node.get("matrix"))}
    return {
        "translation": _floats(node.get("translation")) or (0.0, 0.0, 0.0),
        "rotation": _floats(node.get("rotation")) or (0.0, 0.0, 0.0, 1.0),
        "scale": _floats(node.get("scale")) or (1.0, 1.0, 1.0),
    }


def _material_name(document: Mapping[str, Any], index: object) -> str | None:
    materials = _list(document.get("materials"))
    if isinstance(index, int) and 0 <= index < len(materials):
        name = _dict(materials[index]).get("name")
        return name if isinstance(name, str) else f"#{index}"
    return None


def _accessor_count(document: Mapping[str, Any], index: object) -> int:
    accessors = _list(document.get("accessors"))
    if isinstance(index, int) and 0 <= index < len(accessors):
        count = _dict(accessors[index]).get("count")
        return count if isinstance(count, int) else 0
    return 0


def _image_bytes(
    document: Mapping[str, Any], data: bytes, bin_offset: int | None, image: Mapping[str, Any]
) -> bytes | None:
    views = _list(document.get("bufferViews"))
    index = image.get("bufferView")
    if bin_offset is None or not isinstance(index, int) or not 0 <= index < len(views):
        return None
    view = _dict(views[index])
    if view.get("buffer", 0) != 0 or "extensions" in view:
        return None
    offset = view.get("byteOffset", 0)
    length = view.get("byteLength")
    if not isinstance(offset, int) or not isinstance(length, int):
        return None
    start = bin_offset + offset
    if start < 0 or start + length > len(data):
        return None
    return data[start : start + length]


def _slot(slot: str, info: Mapping[str, Any]) -> str:
    """How a texture slot samples: UV set and effective `KHR_texture_transform`.

    An identity transform (offset 0, rotation 0, scale 1, same UV set) is the same as none, so
    an optimizer that drops one changes nothing; any other transform must survive unchanged.
    Other textureInfo extensions are listed by name.
    """
    uv = info.get("texCoord", 0)
    extensions = _dict(info.get("extensions"))
    parts = [f"{slot}:uv{uv}"]
    transform = extensions.get("KHR_texture_transform")
    if isinstance(transform, dict):
        offset = _floats(transform.get("offset")) or (0.0, 0.0)
        rotation = float(transform.get("rotation", 0.0))
        scale = _floats(transform.get("scale")) or (1.0, 1.0)
        transform_uv = transform.get("texCoord", uv)
        identity = (
            all(_close(v, 0.0) for v in offset)
            and _close(rotation, 0.0)
            and all(_close(v, 1.0) for v in scale)
        )
        if not identity or transform_uv != uv:
            rounded = [round(v, 5) for v in (*offset, rotation, *scale)]
            parts.append(f"transform{rounded}:uv{transform_uv}")
    parts.extend(sorted(name for name in extensions if name != "KHR_texture_transform"))
    return ":".join(parts)


def model_signature(data: bytes) -> ModelSignature:
    """Read `data` (a GLB) into a signature. Raises `SignatureError` when it cannot."""
    report = Report()
    handle = io.BytesIO(data)
    size = len(data)
    try:
        layout = read_layout(handle, size, report, 64 * 1024 * 1024)
        raw = read_at(handle, layout.json_offset, layout.json_length, size)
        document = parse_document(raw, report, 128, 4_000_000, lambda: None)
    except Stop:
        raise SignatureError(report.codes()) from None
    signature = ModelSignature()
    signature.extensions_used = sorted(
        v for v in _list(document.get("extensionsUsed")) if isinstance(v, str)
    )
    signature.extensions_required = sorted(
        v for v in _list(document.get("extensionsRequired")) if isinstance(v, str)
    )
    paths, parent = _node_paths(document)
    nodes = _list(document.get("nodes"))
    skins = _list(document.get("skins"))
    for index, raw_node in enumerate(nodes):
        node = _dict(raw_node)
        signature.nodes.append(
            {
                "path": paths[index],
                "parent": paths[parent[index]] if parent.get(index) is not None else None,
                "children": [
                    paths[c]
                    for c in _list(node.get("children"))
                    if isinstance(c, int) and 0 <= c < len(nodes)
                ],
                "mesh": "mesh" in node,
                "skin": "skin" in node,
                "camera": "camera" in node,
                "transform": _trs(node),
            }
        )
        if "mesh" not in node:
            continue
        mesh_index = node.get("mesh")
        meshes = _list(document.get("meshes"))
        if not isinstance(mesh_index, int) or not 0 <= mesh_index < len(meshes):
            continue
        primitives = []
        for primitive in _list(_dict(meshes[mesh_index]).get("primitives")):
            prim = _dict(primitive)
            attributes = _dict(prim.get("attributes"))
            vertices = _accessor_count(document, attributes.get("POSITION"))
            indices = _accessor_count(document, prim.get("indices")) if "indices" in prim else None
            mode = prim.get("mode", 4)
            signature.vertex_count += vertices
            if mode == 4:
                signature.triangle_count += (indices if indices is not None else vertices) // 3
            primitives.append(
                {
                    "mode": mode,
                    "attributes": sorted(attributes),
                    "indexed": indices is not None,
                    "targets": len(_list(prim.get("targets"))),
                    "material": _material_name(document, prim.get("material")),
                    "vertex_count": vertices,
                    "index_count": indices,
                }
            )
        skin_index = node.get("skin")
        signature.meshes.append(
            {
                "node": paths[index],
                "primitives": primitives,
                "skin": _dict(skins[skin_index]).get("name")
                if isinstance(skin_index, int) and 0 <= skin_index < len(skins)
                else None,
            }
        )
    for index, raw_material in enumerate(_list(document.get("materials"))):
        material = _dict(raw_material)
        slots = []
        for group, slot in _TEXTURE_SLOTS:
            holder = _dict(material.get(group)) if group else material
            if slot in holder:
                slots.append(_slot(slot, _dict(holder.get(slot))))
        name = material.get("name")
        signature.materials.append(
            {
                "name": name if isinstance(name, str) else f"#{index}",
                "alpha_mode": material.get("alphaMode", "OPAQUE"),
                "double_sided": bool(material.get("doubleSided", False)),
                "slots": slots,
                "extensions": sorted(_dict(material.get("extensions"))),
            }
        )
    for raw_skin in skins:
        skin = _dict(raw_skin)
        joints = [
            paths[j]
            for j in _list(skin.get("joints"))
            if isinstance(j, int) and 0 <= j < len(paths)
        ]
        skeleton = skin.get("skeleton")
        signature.skins.append(
            {
                "name": skin.get("name"),
                "joints": joints,
                "skeleton": paths[skeleton]
                if isinstance(skeleton, int) and 0 <= skeleton < len(paths)
                else None,
                "inverse_bind_matrices": _accessor_count(document, skin.get("inverseBindMatrices")),
            }
        )
    images = _list(document.get("images"))
    for raw_image in images:
        image = _dict(raw_image)
        payload = _image_bytes(document, data, layout.bin_offset, image)
        mime = image.get("mimeType")
        dims = None
        if payload is not None and mime in ("image/png", "image/jpeg"):
            dims = image_dimensions(
                mime, lambda offset, length, p=payload: p[offset : offset + length], len(payload)
            )
        signature.images.append(
            {
                "mime_type": mime,
                "bytes": len(payload) if payload is not None else None,
                "sha256": hashlib.sha256(payload).hexdigest() if payload is not None else None,
                "width": dims[0] if dims else None,
                "height": dims[1] if dims else None,
            }
        )
    for raw_texture in _list(document.get("textures")):
        texture = _dict(raw_texture)
        basisu = _dict(_dict(texture.get("extensions")).get("KHR_texture_basisu"))
        signature.textures.append(
            {
                "source": texture.get("source"),
                "basisu_source": basisu.get("source"),
                "sampler": texture.get("sampler"),
            }
        )
    # Animation facts come from the LAI-LAMBDA-009 inspector (accessor bounds, no decoding).
    outcome = inspect_glb(io.BytesIO(data), size, AnimationSettings(), lambda: None)
    if outcome.report.has_errors:
        raise SignatureError(outcome.report.codes())
    signature.keyframe_count = (outcome.counts or {}).get("keyframes", 0)
    animations = _list(document.get("animations"))
    for clip in outcome.clips:
        targets: set[tuple[str, str]] = set()
        index = clip.get("index")
        animation = (
            _dict(animations[index])
            if isinstance(index, int) and 0 <= index < len(animations)
            else {}
        )
        for channel in _list(animation.get("channels")):
            target = _dict(_dict(channel).get("target"))
            node = target.get("node")
            if isinstance(node, int) and 0 <= node < len(paths):
                targets.add((paths[node], str(target.get("path"))))
        signature.clips.append(
            {
                "name": clip.get("name"),
                "start_seconds": clip.get("start_seconds"),
                "duration_seconds": clip.get("duration_seconds"),
                "channel_count": clip.get("channel_count"),
                "target_paths": clip.get("target_paths"),
                "keyframe_count": clip.get("keyframe_count"),
                "targets": sorted(targets),
            }
        )
    return signature


def _compare_transform(
    a: Mapping[str, tuple[float, ...]], b: Mapping[str, tuple[float, ...]]
) -> bool:
    if set(a) != set(b):
        return False
    for key, values in a.items():
        other = b[key]
        if len(values) != len(other) or not all(
            _close(x, y) for x, y in zip(values, other, strict=True)
        ):
            return False
    return True


def compare_signatures(
    before: ModelSignature, after: ModelSignature, *, textures: TextureRule = "identical"
) -> list[Difference]:
    """Every game-relevant difference between `before` and `after` (empty when preserved)."""
    out: list[Difference] = []

    def add(code: str, path: str) -> None:
        if len(out) < _MAX_DIFFERENCES:
            out.append(Difference(code, path))

    if len(before.nodes) != len(after.nodes):
        add("node_count_changed", "nodes")
    after_nodes = {n["path"]: n for n in after.nodes}
    for node in before.nodes:
        other = after_nodes.get(node["path"])
        if other is None:
            add("node_missing", node["path"])
            continue
        for key in ("parent", "children", "mesh", "skin", "camera"):
            if node[key] != other[key]:
                add(f"node_{key}_changed", node["path"])
        if not _compare_transform(node["transform"], other["transform"]):
            add("node_transform_changed", node["path"])
    after_meshes = {m["node"]: m for m in after.meshes}
    for mesh in before.meshes:
        other = after_meshes.get(mesh["node"])
        if other is None:
            add("mesh_missing", mesh["node"])
            continue
        if mesh["skin"] != other["skin"]:
            add("mesh_skin_changed", mesh["node"])
        if len(mesh["primitives"]) != len(other["primitives"]):
            add("primitive_count_changed", mesh["node"])
            continue
        for number, (a, b) in enumerate(zip(mesh["primitives"], other["primitives"], strict=True)):
            where = f"{mesh['node']}#primitive{number}"
            for key in ("mode", "attributes", "indexed", "targets", "material", "index_count"):
                if a[key] != b[key]:
                    add(f"primitive_{key}_changed", where)
            # gltfpack welds vertices that became identical; fewer vertices with the same
            # indices draw the same triangles. More vertices would mean a split: refuse it.
            if b["vertex_count"] > a["vertex_count"] or (
                not a["indexed"] and b["vertex_count"] != a["vertex_count"]
            ):
                add("primitive_vertex_count_changed", where)
    if [m["name"] for m in before.materials] != [m["name"] for m in after.materials]:
        add("materials_changed", "materials")
    else:
        for a, b in zip(before.materials, after.materials, strict=True):
            for key in ("alpha_mode", "double_sided", "slots", "extensions"):
                if a[key] != b[key]:
                    add(f"material_{key}_changed", f"materials/{a['name']}")
    if len(before.skins) != len(after.skins):
        add("skin_count_changed", "skins")
    else:
        for number, (a, b) in enumerate(zip(before.skins, after.skins, strict=True)):
            for key in ("name", "joints", "skeleton", "inverse_bind_matrices"):
                if a[key] != b[key]:
                    add(f"skin_{key}_changed", f"skins[{number}]")
    if [c["name"] for c in before.clips] != [c["name"] for c in after.clips]:
        add("animation_names_changed", "animations")
    else:
        for a, b in zip(before.clips, after.clips, strict=True):
            where = f"animations/{a['name']}"
            for key in ("start_seconds", "duration_seconds"):
                if (a[key] is None) != (b[key] is None) or (
                    a[key] is not None and not _close(a[key], b[key], _DURATION_ABS)
                ):
                    add(f"animation_{key.removesuffix('_seconds')}_changed", where)
            for key in ("channel_count", "target_paths", "targets"):
                if a[key] != b[key]:
                    add(f"animation_{key}_changed", where)
    if len(before.textures) != len(after.textures):
        add("texture_count_changed", "textures")
    if textures == "identical":
        if [i["sha256"] for i in before.images] != [i["sha256"] for i in after.images]:
            add("images_changed", "images")
    else:
        for number, image in enumerate(after.images):
            if image["mime_type"] != "image/ktx2":
                add("image_not_ktx2", f"images[{number}]")
    return out
