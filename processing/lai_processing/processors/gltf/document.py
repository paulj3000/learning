"""glTF 2.0 document structure and reference validation, bounded and hostile-input safe.

`validate_glb(handle, size, settings, check)` is the whole validator: container, JSON, and the
document. It is pure (no Django, no settings, no network) and never fetches anything: a `uri`
is either an embedded `data:` URI, checked without decoding the buffer, or refused as
`external_resource`. Vertex data is never decoded; sizes come from accessor counts, bounds from
accessor `min`/`max`, triangle counts from index or vertex counts and the primitive mode.

Every loop over a document array calls `check()` (cancellation and deadline), and every array is
counted against its complexity limit before it is walked, so work is bounded by the limits and
not by what the file claims. Python integers do not overflow; every count that feeds a product
is capped by a limit first, and nothing is allocated from a size a file declares.

Finding codes are the Asset Library's (`lai/apps/assets/validation.py`) wherever Django has the
same check; `docs/processing/GLB_VALIDATION.md` lists every code and every stricter check.
"""

from __future__ import annotations

import base64
import binascii
import math
import re
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Any, BinaryIO, Final

from .container import GlbLayout, read_at, read_layout
from .images import JPEG, PNG, WEBP, image_dimensions, sniff_image
from .jsonparse import parse_document
from .report import Report, Stop

__all__ = [
    "CLIP_VOCABULARY",
    "COMPLEXITY_DEFAULTS",
    "GENERIC_TAKE_NAME",
    "NEEDS_DECODER",
    "SUPPORTED_EXTENSIONS",
    "AccessorInfo",
    "DocumentFacts",
    "GlbSettings",
    "ValidationOutcome",
    "validate_glb",
]

Check = Callable[[], None]

# --- shared policy (kept equal to lai/apps/assets/validation.py; a parity test compares) -------

# Mirrors react/src/features/island-map/three/assets/animationVocabulary.ts.
CLIP_VOCABULARY: Final = frozenset(
    "Idle Walk Talk Wave Point Celebrate ReactHappy ReactConcerned Open Close Activate".split()
)
# Exporter default take names (Mixamo, Blender): flagged with a warning, never interpreted.
GENERIC_TAKE_NAME: Final = re.compile(
    r"mixamo\.com|\|Layer\d+(\.\d+)?$|^(Armature)?Action(\.\d+)?$|^Take \d+$", re.IGNORECASE
)
SUPPORTED_EXTENSIONS: Final = frozenset(
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
NEEDS_DECODER: Final = frozenset(
    {"KHR_draco_mesh_compression", "EXT_meshopt_compression", "KHR_texture_basisu"}
)
# The game's loader accepts PNG and JPEG textures (Django's IMAGE_TYPES). WebP headers are read
# for dimensions, but a WebP texture is refused like any other non-PNG/JPEG type.
ALLOWED_IMAGE_TYPES: Final = frozenset({PNG, JPEG})
KNOWN_IMAGE_TYPES: Final = frozenset({PNG, JPEG, WEBP})
BUFFER_URI_TYPES: Final = ("application/octet-stream", "application/gltf-buffer")
DATA_URI: Final = re.compile(r"^data:([a-z0-9.+/-]+)?(;[a-z0-9=.-]+)*;base64,", re.IGNORECASE)
BASE64: Final = re.compile(r"[A-Za-z0-9+/]*={0,2}")
MAX_CLIP_NAME: Final = 64

# --- glTF tables ---------------------------------------------------------------------------

COMPONENT_BYTES: Final = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}
TYPE_COMPONENTS: Final = {
    "SCALAR": 1,
    "VEC2": 2,
    "VEC3": 3,
    "VEC4": 4,
    "MAT2": 4,
    "MAT3": 9,
    "MAT4": 16,
}
FLOAT: Final = 5126
UNSIGNED_INT: Final = 5125
INDEX_TYPES: Final = frozenset({5121, 5123, 5125})
QUANTIZED_POSITION_TYPES: Final = frozenset({5120, 5121, 5122, 5123, FLOAT})
VIEW_TARGETS: Final = frozenset({34962, 34963})
MAG_FILTERS: Final = frozenset({9728, 9729})
MIN_FILTERS: Final = frozenset({9728, 9729, 9984, 9985, 9986, 9987})
WRAP_MODES: Final = frozenset({33071, 33648, 10497})
INTERPOLATIONS: Final = frozenset({"LINEAR", "STEP", "CUBICSPLINE"})
TARGET_PATHS: Final = {"translation": "VEC3", "rotation": "VEC4", "scale": "VEC3", "weights": ""}
MAX_MODE: Final = 6
MAX_SAFE_INT: Final = 2**53
MAX_LISTED_EXTENSIONS: Final = 50
MATERIAL_TEXTURES: Final = (
    ("pbrMetallicRoughness", "baseColorTexture"),
    ("pbrMetallicRoughness", "metallicRoughnessTexture"),
    ("", "normalTexture"),
    ("", "occlusionTexture"),
    ("", "emissiveTexture"),
)
# Top-level arrays, with the complexity limit each is counted against.
ARRAYS: Final = (
    ("scenes", "max_scenes"),
    ("nodes", "max_nodes"),
    ("meshes", "max_meshes"),
    ("accessors", "max_accessors"),
    ("bufferViews", "max_buffer_views"),
    ("buffers", "max_buffers"),
    ("materials", "max_materials"),
    ("textures", "max_textures"),
    ("images", "max_images"),
    ("samplers", "max_samplers"),
    ("skins", "max_skins"),
    ("animations", "max_animations"),
    ("cameras", "max_nodes"),
    ("extensionsUsed", "max_extensions"),
    ("extensionsRequired", "max_extensions"),
)

# Defaults for `glb-default` v1. The counts Django also limits use Django's values (LIMITS).
COMPLEXITY_DEFAULTS: Final[Mapping[str, int]] = {
    "max_accessor_count": 10_000_000,
    "max_accessors": 20_000,
    "max_animation_samplers": 20_000,
    "max_animations": 200,
    "max_buffer_views": 20_000,
    "max_buffers": 64,
    "max_channels": 20_000,
    "max_extensions": 64,
    "max_images": 200,
    "max_joints": 10_000,
    "max_json_bytes": 16 * 1024 * 1024,
    "max_json_depth": 64,
    "max_materials": 500,
    "max_meshes": 2_000,
    "max_node_depth": 64,
    "max_nodes": 10_000,
    "max_primitives": 20_000,
    "max_samplers": 500,
    "max_scenes": 64,
    "max_skins": 200,
    "max_textures": 500,
    "max_triangles": 10_000_000,
    "max_vertices": 10_000_000,
}
# The most a request may raise any complexity limit to, whatever it asks for (the platform
# ceilings do not name processor counters, so the processor clamps them itself).
COMPLEXITY_CEILINGS: Final[Mapping[str, int]] = {
    **{name: value * 10 for name, value in COMPLEXITY_DEFAULTS.items()},
    "max_json_bytes": 64 * 1024 * 1024,
    "max_json_depth": 128,
    "max_node_depth": 256,
}


@dataclass(frozen=True, slots=True)
class GlbSettings:
    """Resolved limits and options for one validation."""

    limits: Mapping[str, int] = field(default_factory=lambda: dict(COMPLEXITY_DEFAULTS))
    max_texture_dimension: int = 8192
    require_animations: bool = False

    @classmethod
    def resolve(
        cls,
        requested: Mapping[str, int],
        *,
        max_texture_dimension: int = 8192,
        require_animations: bool = False,
    ) -> GlbSettings:
        """Requested complexity limits over the defaults, clamped to the ceilings."""
        limits = {
            name: min(requested.get(name, default), COMPLEXITY_CEILINGS[name])
            for name, default in COMPLEXITY_DEFAULTS.items()
        }
        return cls(limits, max_texture_dimension, require_animations)

    def limit(self, name: str) -> int:
        return self.limits[name]


@dataclass(frozen=True, slots=True)
class AccessorInfo:
    component_type: int
    type: str
    count: int
    normalized: bool
    minimum: tuple[float, ...] | None
    maximum: tuple[float, ...] | None


@dataclass
class DocumentFacts:
    """What the document says, gathered while validating (input to `metadata.build`)."""

    gltf_version: str | None = None
    min_version: str | None = None
    generator: object = None
    counts: dict[str, int] = field(default_factory=dict)
    vertex_count: int = 0
    triangle_count: int = 0
    material_names: list[object] = field(default_factory=list)
    images: list[dict[str, Any]] = field(default_factory=list)
    skins: list[dict[str, Any]] = field(default_factory=list)
    animations: list[dict[str, Any]] = field(default_factory=list)
    bounds_min: list[float] | None = None
    bounds_max: list[float] | None = None
    extensions_used: list[str] = field(default_factory=list)
    extensions_required: list[str] = field(default_factory=list)
    unsupported_extensions: list[str] = field(default_factory=list)


@dataclass
class ValidationOutcome:
    report: Report
    file_size: int
    layout: GlbLayout | None = None
    facts: DocumentFacts | None = None


# --- small predicates ----------------------------------------------------------------------


def _whole(value: object) -> bool:
    return type(value) is int and 0 <= value <= MAX_SAFE_INT


def _finite(value: object) -> bool:
    return type(value) in (int, float) and math.isfinite(value)  # type: ignore[arg-type]


def _numbers(value: object, length: int) -> tuple[float, ...] | None:
    if isinstance(value, list) and len(value) == length and all(_finite(v) for v in value):
        return tuple(float(v) for v in value)
    return None


def _index(value: object, items: list[Any]) -> bool:
    return _whole(value) and value < len(items)  # type: ignore[operator]


def _member(value: object, allowed: frozenset[Any] | Mapping[Any, Any]) -> bool:
    """`value in allowed` for an int or str (never raises on unhashable JSON values)."""
    return type(value) in (int, str) and value in allowed


def _dict(value: object) -> dict[str, Any] | None:
    return value if isinstance(value, dict) else None


def _element_size(component_type: int, kind: str) -> int:
    """Bytes per element, with the column padding glTF requires for small matrices."""
    size = COMPONENT_BYTES[component_type]
    if kind == "MAT2" and size == 1:
        return 8
    if kind == "MAT3" and size == 1:
        return 12
    if kind == "MAT3" and size == 2:
        return 24
    return size * TYPE_COMPONENTS[kind]


def _data_uri_payload_length(uri: str) -> int | None:
    match = DATA_URI.match(uri)
    if not match:
        return None
    encoded = uri[match.end() :]
    if len(encoded) % 4 or not BASE64.fullmatch(encoded):
        return None
    padding = len(encoded) - len(encoded.rstrip("="))
    return len(encoded) * 3 // 4 - padding


def _media_type(uri: str) -> str:
    match = DATA_URI.match(uri)
    return (match.group(1) or "").lower() if match else ""


Matrix = list[float]  # column-major 4x4, as glTF stores it
IDENTITY: Final[Matrix] = [1.0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 1.0]


def _multiply(a: Matrix, b: Matrix) -> Matrix:
    return [
        sum(a[k * 4 + row] * b[col * 4 + k] for k in range(4))
        for col in range(4)
        for row in range(4)
    ]


def _node_matrix(node: dict[str, Any]) -> Matrix:
    """The node's local matrix, computed exactly as Django's `_node_matrix` does."""
    matrix = _numbers(node.get("matrix"), 16)
    if matrix is not None:
        return list(matrix)
    t = list(_numbers(node.get("translation"), 3) or (0.0, 0.0, 0.0))
    x, y, z, w = _numbers(node.get("rotation"), 4) or (0.0, 0.0, 0.0, 1.0)
    sx, sy, sz = _numbers(node.get("scale"), 3) or (1.0, 1.0, 1.0)
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


# --- the validator -------------------------------------------------------------------------


class _Validator:
    def __init__(
        self,
        handle: BinaryIO,
        layout: GlbLayout,
        document: dict[str, Any],
        settings: GlbSettings,
        report: Report,
        check: Check,
    ) -> None:
        self.handle = handle
        self.layout = layout
        self.doc = document
        self.settings = settings
        self.report = report
        self.check = check
        self.facts = DocumentFacts()
        self.arrays: dict[str, list[Any]] = {}
        self.buffer_lengths: list[int] = []
        self.buffer_embedded: list[bool] = []
        self.views_ok: list[bool] = []
        self.accessors: list[AccessorInfo | None] = []
        self.parents: list[int | None] = []
        self.quantized = False

    # helpers

    def error(self, code: str, message: str, path: str = "") -> None:
        self.report.error(code, message, path)

    def items(self, name: str) -> list[Any]:
        return self.arrays.get(name, [])

    def accessor(self, index: object) -> AccessorInfo | None:
        if _index(index, self.accessors):
            return self.accessors[index]  # type: ignore[index]
        return None

    # entry point

    def run(self) -> DocumentFacts:
        self._asset()
        self._arrays()
        self._extensions()
        self._buffers()
        self._buffer_views()
        self._accessors()
        self._samplers()
        self._images()
        self._textures()
        self._materials()
        self._meshes()
        self._nodes()
        self._scenes_and_bounds()
        self._skins()
        self._animations()
        return self.facts

    def _asset(self) -> None:
        asset = _dict(self.doc.get("asset"))
        if asset is None or asset.get("version") != "2.0":
            self.error(
                "gltf_version", 'Only glTF 2.0 models are supported ("asset.version": "2.0").'
            )
            raise Stop
        self.facts.gltf_version = "2.0"
        self.facts.generator = asset.get("generator")
        if "minVersion" in asset:
            if asset["minVersion"] != "2.0":
                self.error(
                    "gltf_version",
                    'The model needs a glTF version newer than 2.0 ("asset.minVersion").',
                    "asset.minVersion",
                )
            else:
                self.facts.min_version = "2.0"

    def _arrays(self) -> None:
        for name, limit_name in ARRAYS:
            self.check()
            value = self.doc.get(name, [])
            if not isinstance(value, list):
                self.error("invalid_structure", "A top-level glTF property is not an array.", name)
                value = []
            limit = self.settings.limit(limit_name)
            if len(value) > limit:
                self.error("too_complex", f"The model has more than {limit:,} {name}.", name)
                raise Stop
            self.arrays[name] = value
        counts = {
            "accessors": "accessors",
            "animations": "animations",
            "buffer_views": "bufferViews",
            "buffers": "buffers",
            "images": "images",
            "materials": "materials",
            "meshes": "meshes",
            "nodes": "nodes",
            "samplers": "samplers",
            "scenes": "scenes",
            "skins": "skins",
            "textures": "textures",
        }
        self.facts.counts = {key: len(self.items(name)) for key, name in counts.items()}
        self.facts.counts.update({"primitives": 0, "joints": 0, "channels": 0})

    def _extensions(self) -> None:
        used: set[str] = set()
        required: set[str] = set()
        for name, target in (("extensionsUsed", used), ("extensionsRequired", required)):
            for index, value in enumerate(self.items(name)):
                self.check()
                if not isinstance(value, str) or not value:
                    self.error(
                        "unsupported_extension",
                        "An extension entry is not a valid extension name.",
                        f"{name}[{index}]",
                    )
                    continue
                target.add(value)
        unsupported: list[str] = []
        for name in sorted(used | required):
            self.check()
            if name in NEEDS_DECODER:
                unsupported.append(name)
                self.error(
                    "needs_decoder",
                    "The model uses a compression extension that needs a decoder the game "
                    "does not load. Export without compression.",
                    "extensionsUsed",
                )
            elif name not in SUPPORTED_EXTENSIONS:
                unsupported.append(name)
                if name in required:
                    self.error(
                        "unsupported_extension",
                        "The model requires an extension the game does not support.",
                        "extensionsRequired",
                    )
                else:
                    self.report.warn(
                        "unknown_extension",
                        "The model uses an extension the game will ignore.",
                        "extensionsUsed",
                    )
        self.quantized = "KHR_mesh_quantization" in used | required
        self.facts.extensions_used = sorted(used)[:MAX_LISTED_EXTENSIONS]
        self.facts.extensions_required = sorted(required)[:MAX_LISTED_EXTENSIONS]
        self.facts.unsupported_extensions = unsupported[:MAX_LISTED_EXTENSIONS]

    def _buffers(self) -> None:
        bin_length = self.layout.bin_length
        for index, raw in enumerate(self.items("buffers")):
            self.check()
            path = f"buffers[{index}]"
            buffer = _dict(raw)
            embedded = False
            if buffer is None:
                self.error("invalid_buffer", "A buffer entry is malformed.", path)
                self.buffer_lengths.append(0)
                self.buffer_embedded.append(False)
                continue
            declared = buffer.get("byteLength")
            if not _whole(declared) or declared < 1:  # type: ignore[operator]
                self.error("invalid_buffer", "A buffer has no valid byteLength.", path)
                declared = 0
            uri = buffer.get("uri")
            if uri is None:
                if index != 0 or bin_length is None:
                    self.error("missing_buffer", "A buffer has no data.", path)
                elif declared > bin_length:
                    self.error(
                        "buffer_bounds", "The buffer is longer than the GLB binary chunk.", path
                    )
                else:
                    embedded = True
                    if bin_length - declared > 3:
                        self.report.warn(
                            "bin_chunk_unused",
                            "The GLB binary chunk is longer than its buffer needs.",
                            path,
                        )
            elif not isinstance(uri, str) or not uri[:5].lower() == "data:":
                # Never fetched or opened: http(s), file:, relative and traversal paths alike.
                self.error(
                    "external_resource",
                    "The model refers to an external file. Embed every buffer (export as .glb).",
                    path,
                )
            elif _media_type(uri) not in BUFFER_URI_TYPES:
                self.error(
                    "invalid_buffer", "An embedded buffer has an unexpected media type.", path
                )
            else:
                payload = _data_uri_payload_length(uri)
                if payload is None:
                    self.error("invalid_buffer", "An embedded buffer is not valid base64.", path)
                elif payload < declared:
                    self.error(
                        "buffer_bounds", "An embedded buffer is shorter than its byteLength.", path
                    )
            self.buffer_lengths.append(declared)  # type: ignore[arg-type]
            self.buffer_embedded.append(embedded)

    def _buffer_views(self) -> None:
        for index, raw in enumerate(self.items("bufferViews")):
            self.check()
            path = f"bufferViews[{index}]"
            view = _dict(raw)
            ok = False
            if view is None:
                self.error("invalid_buffer_view", "A buffer view is malformed.", path)
                self.views_ok.append(False)
                continue
            buffer = view.get("buffer")
            offset = view.get("byteOffset", 0)
            length = view.get("byteLength")
            if not _index(buffer, self.buffer_lengths):
                self.error(
                    "invalid_buffer_view", "A buffer view points at a missing buffer.", path
                )
            elif not (_whole(offset) and _whole(length) and length > 0):  # type: ignore[operator]
                self.error("invalid_buffer_view", "A buffer view has an invalid range.", path)
            elif offset + length > self.buffer_lengths[buffer]:  # type: ignore[operator,index]
                self.error(
                    "buffer_bounds", "A buffer view runs past the end of its buffer.", path
                )
            else:
                ok = True
            stride = view.get("byteStride")
            if stride is not None and not (
                type(stride) is int and 4 <= stride <= 252 and stride % 4 == 0
            ):
                self.error(
                    "invalid_buffer_view",
                    "A buffer view's byteStride must be a multiple of 4 from 4 to 252.",
                    path,
                )
                ok = False
            target = view.get("target")
            if target is not None and not _member(target, VIEW_TARGETS):
                self.error("invalid_buffer_view", "A buffer view has an unknown target.", path)
                ok = False
            self.views_ok.append(ok)

    def _accessors(self) -> None:
        views = self.items("bufferViews")
        max_count = self.settings.limit("max_accessor_count")
        for index, raw in enumerate(self.items("accessors")):
            self.check()
            self.accessors.append(self._accessor(index, raw, views, max_count))

    def _accessor(
        self, index: int, raw: object, views: list[Any], max_count: int
    ) -> AccessorInfo | None:
        path = f"accessors[{index}]"
        accessor = _dict(raw)
        if accessor is None:
            self.error("invalid_accessor", "An accessor is malformed.", path)
            return None
        count = accessor.get("count")
        component_type = accessor.get("componentType")
        kind = accessor.get("type")
        if (
            not _whole(count)
            or count < 1  # type: ignore[operator]
            or not _member(component_type, COMPONENT_BYTES)
            or not _member(kind, TYPE_COMPONENTS)
        ):
            self.error(
                "invalid_accessor", "An accessor has an invalid count, type or component.", path
            )
            return None
        assert isinstance(count, int) and isinstance(kind, str)  # noqa: S101 - narrowed above
        assert isinstance(component_type, int)  # noqa: S101 - narrowed above
        if count > max_count:
            self.error("too_complex", "An accessor has too many elements.", path)
            return None
        components = TYPE_COMPONENTS[kind]
        normalized = accessor.get("normalized", False)
        if type(normalized) is not bool or (
            normalized and component_type in (FLOAT, UNSIGNED_INT)
        ):
            self.error("invalid_accessor", "An accessor has an invalid normalized flag.", path)
            normalized = False
        minimum = maximum = None
        for name in ("min", "max"):
            if name in accessor:
                values = _numbers(accessor[name], components)
                if values is None:
                    self.error(
                        "invalid_accessor",
                        "An accessor's min or max does not match its type.",
                        path,
                    )
                elif name == "min":
                    minimum = values
                else:
                    maximum = values
        # Problems below are reported, but the accessor's declared shape is still used by the
        # mesh, skin and animation checks (as Django does), so one fault is not reported twice.
        info = AccessorInfo(component_type, kind, count, bool(normalized), minimum, maximum)
        offset = accessor.get("byteOffset", 0)
        if not _whole(offset):
            self.error("invalid_accessor", "An accessor has an invalid byteOffset.", path)
            offset = 0
        assert isinstance(offset, int)  # noqa: S101 - narrowed above
        element = _element_size(component_type, kind)
        view_index = accessor.get("bufferView")
        if view_index is not None:
            if _index(view_index, views):
                view = _dict(views[view_index]) or {}  # type: ignore[index]
                self._accessor_range(view, offset, count, component_type, element, path)
            else:
                self.error(
                    "invalid_accessor", "An accessor points at a missing buffer view.", path
                )
        if "sparse" in accessor:
            self._sparse(accessor["sparse"], count, element, path)
        return info

    def _accessor_range(
        self,
        view: dict[str, Any],
        offset: int,
        count: int,
        component_type: int,
        element: int,
        path: str,
    ) -> None:
        """Alignment and `offset + stride * (count - 1) + element <= view.byteLength`."""
        component_bytes = COMPONENT_BYTES[component_type]
        stride = view.get("byteStride")
        if not (type(stride) is int and 4 <= stride <= 252 and stride % 4 == 0):
            stride = element  # an invalid stride is reported on the buffer view
        elif stride < element:
            self.error(
                "invalid_accessor",
                "An accessor's elements are larger than its buffer view's stride.",
                path,
            )
        view_offset = view.get("byteOffset", 0)
        start = view_offset + offset if _whole(view_offset) else offset  # type: ignore[operator]
        if offset % component_bytes or start % component_bytes:
            self.error(
                "invalid_accessor", "An accessor is not aligned to its component size.", path
            )
        needed = offset + stride * (count - 1) + element
        view_length = view.get("byteLength")
        if _whole(view_length) and needed > view_length:  # type: ignore[operator]
            self.error("buffer_bounds", "An accessor reads past the end of its buffer view.", path)

    def _sparse(self, raw: object, count: int, element: int, path: str) -> bool:
        views = self.items("bufferViews")
        sparse = _dict(raw)
        indices = _dict(sparse.get("indices")) if sparse else None
        values = _dict(sparse.get("values")) if sparse else None
        sparse_count = sparse.get("count") if sparse else None
        if (
            sparse is None
            or indices is None
            or values is None
            or not _whole(sparse_count)
            or not 1 <= sparse_count <= count  # type: ignore[operator]
            or not _member(indices.get("componentType"), INDEX_TYPES)
        ):
            self.error("invalid_accessor", "An accessor's sparse section is malformed.", path)
            return False
        assert isinstance(sparse_count, int)  # noqa: S101 - narrowed above
        ok = True
        for part, size in (
            (indices, COMPONENT_BYTES[indices["componentType"]]),
            (values, element),
        ):
            view_index = part.get("bufferView")
            offset = part.get("byteOffset", 0)
            if not _index(view_index, views) or not _whole(offset):
                self.error(
                    "invalid_accessor", "An accessor's sparse section has a bad reference.", path
                )
                ok = False
                continue
            view = _dict(views[view_index]) or {}  # type: ignore[index]
            length = view.get("byteLength")
            if _whole(length) and offset + sparse_count * size > length:  # type: ignore[operator]
                self.error(
                    "buffer_bounds",
                    "An accessor's sparse data runs past the end of its buffer view.",
                    path,
                )
                ok = False
        return ok

    def _samplers(self) -> None:
        for index, raw in enumerate(self.items("samplers")):
            self.check()
            sampler = _dict(raw)
            if sampler is None or not (
                _member(sampler.get("magFilter", 9729), MAG_FILTERS)
                and _member(sampler.get("minFilter", 9729), MIN_FILTERS)
                and _member(sampler.get("wrapS", 10497), WRAP_MODES)
                and _member(sampler.get("wrapT", 10497), WRAP_MODES)
            ):
                self.error(
                    "invalid_sampler",
                    "A texture sampler is malformed or uses an unknown filter or wrap mode.",
                    f"samplers[{index}]",
                )

    def _images(self) -> None:
        views = self.items("bufferViews")
        for index, raw in enumerate(self.items("images")):
            self.check()
            path = f"images[{index}]"
            image = _dict(raw)
            if image is None:
                self.error("invalid_image", "An image entry is malformed.", path)
                continue
            uri = image.get("uri")
            if uri is not None:
                self._data_uri_image(index, uri, image, path)
                continue
            declared = image.get("mimeType")
            media = declared.lower() if isinstance(declared, str) else ""
            view_index = image.get("bufferView")
            entry = {"index": index, "mime_type": media if media in KNOWN_IMAGE_TYPES else None}
            if media not in ALLOWED_IMAGE_TYPES:
                self.error("image_type", "Textures must be PNG or JPEG.", path)
                if media != WEBP:
                    continue
            if not _index(view_index, views):
                self.error("invalid_image", "A texture points at a missing buffer view.", path)
                continue
            view = _dict(views[view_index]) or {}  # type: ignore[index]
            if not (self.views_ok[view_index] and view.get("buffer") == 0):  # type: ignore[index]
                continue
            if not self.buffer_embedded or not self.buffer_embedded[0]:
                continue
            bin_offset = self.layout.bin_offset
            assert bin_offset is not None  # noqa: S101 - buffer 0 is embedded
            start = bin_offset + view.get("byteOffset", 0)
            length = view["byteLength"]
            head = read_at(self.handle, start, min(length, 32), self.layout.file_size)
            if sniff_image(head) != media:
                if media in ALLOWED_IMAGE_TYPES:
                    self.error("image_type", "A texture is not the image type it claims.", path)
                continue

            def read(offset: int, size: int, start: int = start, length: int = length) -> bytes:
                if offset < 0 or offset >= length:
                    return b""
                return read_at(
                    self.handle, start + offset, min(size, length - offset), self.layout.file_size
                )

            self._record_image(entry, media, image_dimensions(media, read, length), path)

    def _data_uri_image(self, index: int, uri: object, image: dict[str, Any], path: str) -> None:
        if not isinstance(uri, str) or not uri[:5].lower() == "data:":
            self.error(
                "external_resource",
                "A texture refers to an external file. Embed textures (export as .glb).",
                path,
            )
            return
        if "bufferView" in image:
            self.error("invalid_image", "An image has both a uri and a buffer view.", path)
        media = _media_type(uri)
        entry = {"index": index, "mime_type": media if media in KNOWN_IMAGE_TYPES else None}
        if media not in ALLOWED_IMAGE_TYPES:
            self.error("image_type", "Textures must be PNG or JPEG.", path)
            if media != WEBP:
                return
        match = DATA_URI.match(uri)
        assert match is not None  # noqa: S101 - the media type matched
        # Decode only a bounded prefix (whole base64 quanta): enough for any header we read.
        encoded = uri[match.end() : match.end() + 87_380]
        encoded = encoded[: len(encoded) - len(encoded) % 4]
        try:
            prefix = base64.b64decode(encoded, validate=True)
        except (binascii.Error, ValueError):
            prefix = b""
        if sniff_image(prefix[:32]) != media:
            if media in ALLOWED_IMAGE_TYPES:
                self.error(
                    "image_type", "An embedded texture is not the image type it claims.", path
                )
            return

        def read(offset: int, size: int) -> bytes:
            return prefix[offset : offset + size] if offset >= 0 else b""

        self._record_image(entry, media, image_dimensions(media, read, len(prefix)), path)

    def _record_image(
        self, entry: dict[str, Any], media: str, size: tuple[int, int] | None, path: str
    ) -> None:
        del media
        entry["width"], entry["height"] = size if size else (None, None)
        if size is None:
            self.report.warn(
                "image_dimensions_unknown", "A texture's dimensions could not be read.", path
            )
        elif max(size) > self.settings.max_texture_dimension:
            self.error(
                "texture_too_large",
                f"A texture is larger than {self.settings.max_texture_dimension:,} pixels on a "
                "side. Resize it and export again.",
                path,
            )
        self.facts.images.append(entry)

    def _textures(self) -> None:
        images = self.items("images")
        samplers = self.items("samplers")
        for index, raw in enumerate(self.items("textures")):
            self.check()
            texture = _dict(raw)
            if texture is None or not (
                ("source" not in texture or _index(texture["source"], images))
                and ("sampler" not in texture or _index(texture["sampler"], samplers))
            ):
                self.error(
                    "invalid_texture",
                    "A texture is malformed or refers to a missing image or sampler.",
                    f"textures[{index}]",
                )

    def _materials(self) -> None:
        textures = self.items("textures")
        for index, raw in enumerate(self.items("materials")):
            self.check()
            path = f"materials[{index}]"
            material = _dict(raw)
            if material is None:
                self.error("invalid_material", "A material is malformed.", path)
                self.facts.material_names.append(None)
                continue
            self.facts.material_names.append(material.get("name"))
            for group, slot in MATERIAL_TEXTURES:
                holder = _dict(material.get(group)) if group else material
                if holder is None:
                    if group in material:
                        self.error("invalid_material", "A material is malformed.", path)
                    continue
                if slot not in holder:
                    continue
                info = _dict(holder[slot])
                tex_coord = info.get("texCoord", 0) if info else None
                if info is None or not _index(info.get("index"), textures) or not _whole(
                    tex_coord
                ):
                    self.error(
                        "invalid_material",
                        "A material refers to a missing texture.",
                        path,
                    )

    def _meshes(self) -> None:
        materials = self.items("materials")
        max_primitives = self.settings.limit("max_primitives")
        primitives = 0
        for index, raw in enumerate(self.items("meshes")):
            self.check()
            path = f"meshes[{index}]"
            mesh = _dict(raw)
            entries = mesh.get("primitives") if mesh else None
            if not isinstance(entries, list) or not entries:
                self.error("invalid_mesh", "A mesh has no primitives.", path)
                continue
            primitives += len(entries)
            if primitives > max_primitives:
                self.error(
                    "too_complex",
                    f"The model has more than {max_primitives:,} mesh primitives.",
                    "meshes",
                )
                raise Stop
            for number, primitive in enumerate(entries):
                self.check()
                self._primitive(primitive, materials, f"{path}.primitives[{number}]")
        self.facts.counts["primitives"] = primitives
        for name, total in (
            ("max_vertices", self.facts.vertex_count),
            ("max_triangles", self.facts.triangle_count),
        ):
            limit = self.settings.limit(name)
            if total > limit:
                noun = name.removeprefix("max_")
                self.error("too_complex", f"The model has more than {limit:,} {noun}.", "meshes")
                raise Stop

    def _primitive(self, raw: object, materials: list[Any], path: str) -> None:
        primitive = _dict(raw)
        attributes = _dict(primitive.get("attributes")) if primitive else None
        if primitive is None or not attributes:
            self.error("invalid_mesh", "A mesh primitive has no attributes.", path)
            return
        counts: set[int] = set()
        broken = False
        for accessor_index in attributes.values():
            self.check()
            if not _index(accessor_index, self.accessors):
                self.error("invalid_mesh", "A mesh attribute refers to a missing accessor.", path)
                broken = True
                continue
            info = self.accessors[accessor_index]
            if info is None:
                broken = True  # already reported on the accessor
                continue
            counts.add(info.count)
        position = self.accessor(attributes.get("POSITION"))
        if "POSITION" not in attributes:
            self.error("invalid_mesh", "A mesh primitive has no POSITION attribute.", path)
        elif position is not None:
            allowed = QUANTIZED_POSITION_TYPES if self.quantized else {FLOAT}
            if position.type != "VEC3" or position.component_type not in allowed:
                self.error("invalid_mesh", "A mesh's POSITION data is not 3D vectors.", path)
        if len(counts) > 1:
            self.error(
                "invalid_mesh", "A mesh primitive's attributes have different counts.", path
            )
        mode = primitive.get("mode", 4)
        if not _whole(mode) or mode > MAX_MODE:  # type: ignore[operator]
            self.error("invalid_mesh", "A mesh primitive has an unknown drawing mode.", path)
            mode = None
        if "material" in primitive and not _index(primitive["material"], materials):
            self.error("invalid_mesh", "A mesh primitive refers to a missing material.", path)
        targets = primitive.get("targets", [])
        if not isinstance(targets, list) or not all(
            isinstance(t, dict) and all(_index(a, self.accessors) for a in t.values())
            for t in targets
        ):
            self.error(
                "invalid_mesh", "A mesh primitive's morph targets refer to missing data.", path
            )
        indices: AccessorInfo | None = None
        if "indices" in primitive:
            indices = self.accessor(primitive["indices"])
            if not _index(primitive["indices"], self.accessors):
                self.error("invalid_mesh", "A mesh's indices refer to a missing accessor.", path)
                broken = True
            elif indices is not None and (
                indices.type != "SCALAR"
                or indices.component_type not in INDEX_TYPES
                or indices.normalized
            ):
                self.error(
                    "invalid_mesh", "A mesh's indices must be unsigned integer scalars.", path
                )
        if position is None or broken:
            return
        self.facts.vertex_count += position.count
        drawn = indices.count if indices is not None else position.count
        if mode == 4:
            self.facts.triangle_count += drawn // 3
        elif mode in (5, 6):
            self.facts.triangle_count += max(drawn - 2, 0)

    def _nodes(self) -> None:
        nodes = self.items("nodes")
        meshes = self.items("meshes")
        skins = self.items("skins")
        cameras = self.items("cameras")
        self.parents = [None] * len(nodes)
        for index, raw in enumerate(nodes):
            self.check()
            path = f"nodes[{index}]"
            node = _dict(raw)
            if node is None:
                self.error("invalid_node", "A node is malformed.", path)
                continue
            for key, items, message in (
                ("mesh", meshes, "A node refers to a missing mesh."),
                ("skin", skins, "A node refers to a missing skin."),
                ("camera", cameras, "A node refers to a missing camera."),
            ):
                if key in node and not _index(node[key], items):
                    self.error("invalid_node", message, path)
            for key, length in (("matrix", 16), ("translation", 3), ("rotation", 4), ("scale", 3)):
                if key in node and _numbers(node[key], length) is None:
                    self.error("invalid_node", "A node has an invalid transform.", path)
            children = node.get("children", [])
            if not isinstance(children, list):
                self.error("invalid_node", "A node's children are not a list.", path)
                continue
            for child in children:
                self.check()
                if not _index(child, nodes):
                    self.error("invalid_node", "A node refers to a missing child node.", path)
                elif child == index or self.parents[child] is not None:
                    self.error(
                        "node_cycle", "A node has two parents or is its own ancestor.", path
                    )
                else:
                    self.parents[child] = index
        self._hierarchy(nodes)

    def _children(self, nodes: list[Any], index: int) -> list[int]:
        node = _dict(nodes[index]) or {}
        children = node.get("children", [])
        if not isinstance(children, list):
            return []
        return [c for c in children if _index(c, nodes) and self.parents[c] == index]

    def _hierarchy(self, nodes: list[Any]) -> None:
        """Depth limit, and cycles: with one parent each, a node no root reaches is in one."""
        max_depth = self.settings.limit("max_node_depth")
        reached = [False] * len(nodes)
        stack = [(i, 0) for i, parent in enumerate(self.parents) if parent is None]
        too_deep = False
        while stack:
            self.check()
            index, depth = stack.pop()
            if reached[index]:
                continue
            reached[index] = True
            too_deep = too_deep or depth > max_depth
            stack.extend((child, depth + 1) for child in self._children(nodes, index))
        if too_deep:
            self.error("too_complex", "The node hierarchy is too deep.", "nodes")
        for index, seen in enumerate(reached):
            self.check()
            if not seen:
                self.error(
                    "node_cycle", "A node is part of a cycle in the node hierarchy.",
                    f"nodes[{index}]",
                )
                break

    def _scenes_and_bounds(self) -> None:
        nodes = self.items("nodes")
        scenes = self.items("scenes")
        roots_by_scene: list[list[int]] = []
        for index, raw in enumerate(scenes):
            self.check()
            path = f"scenes[{index}]"
            scene = _dict(raw)
            roots: list[int] = []
            entries = scene.get("nodes", []) if scene else None
            if not isinstance(entries, list):
                self.error("invalid_scene", "A scene is malformed.", path)
                roots_by_scene.append(roots)
                continue
            for root in entries:
                self.check()
                if not _index(root, nodes):
                    self.error("invalid_node", "The scene refers to a missing node.", path)
                elif root in roots:
                    self.error("node_cycle", "A node appears twice in the scene graph.", path)
                else:
                    if self.parents[root] is not None:
                        self.error(
                            "node_cycle", "A scene root node also has a parent node.", path
                        )
                    roots.append(root)
            roots_by_scene.append(roots)
        default = self.doc.get("scene", 0)
        if not scenes or not _index(default, scenes):
            self.error("no_scene", "The model has no default scene.")
            return
        self._bounds(nodes, roots_by_scene[default])  # type: ignore[index]

    def _bounds(self, nodes: list[Any], roots: list[int]) -> None:
        meshes = self.items("meshes")
        low = [math.inf] * 3
        high = [-math.inf] * 3
        missing = False
        visited = [False] * len(nodes)
        stack: list[tuple[int, Matrix]] = [(root, IDENTITY) for root in reversed(roots)]
        while stack:
            self.check()
            index, parent = stack.pop()
            node = _dict(nodes[index])
            if node is None or visited[index]:
                continue
            visited[index] = True
            world = _multiply(parent, _node_matrix(node))
            mesh = _dict(meshes[node["mesh"]]) if _index(node.get("mesh"), meshes) else None
            entries = mesh.get("primitives") if mesh else None
            for primitive in entries if isinstance(entries, list) else []:
                self.check()
                attributes = _dict(primitive.get("attributes")) if _dict(primitive) else None
                info = self.accessor(attributes.get("POSITION")) if attributes else None
                if info is None or info.minimum is None or info.maximum is None or len(
                    info.minimum
                ) != 3:
                    missing = True
                    continue
                box = (info.minimum, info.maximum)
                for corner in range(8):
                    point = [box[(corner >> axis) & 1][axis] for axis in range(3)]
                    for axis in range(3):
                        value = world[12 + axis] + sum(
                            world[k * 4 + axis] * point[k] for k in range(3)
                        )
                        low[axis] = min(low[axis], value)
                        high[axis] = max(high[axis], value)
            children = self._children(nodes, index)
            stack.extend((child, world) for child in reversed(children))
        if low[0] == math.inf:
            self.error("no_geometry", "The default scene has no geometry with known bounds.")
            return
        if not all(math.isfinite(v) for v in (*low, *high)):
            self.error("invalid_node", "The scene's transforms produce non-finite bounds.")
            return
        if missing:
            self.report.warn(
                "missing_bounds", "Some meshes have no POSITION min/max; the size is approximate."
            )
        self.facts.bounds_min = low
        self.facts.bounds_max = high

    def _skins(self) -> None:
        nodes = self.items("nodes")
        max_joints = self.settings.limit("max_joints")
        total = 0
        for index, raw in enumerate(self.items("skins")):
            self.check()
            path = f"skins[{index}]"
            skin = _dict(raw)
            joints = skin.get("joints") if skin else None
            if skin is None or not isinstance(joints, list) or not joints:
                self.error("invalid_skin", "A skin has no joints.", path)
                continue
            total += len(joints)
            if total > max_joints:
                self.error(
                    "too_complex", f"The model has more than {max_joints:,} joints.", "skins"
                )
                raise Stop
            self.facts.skins.append({"name": skin.get("name"), "joint_count": len(joints)})
            seen: set[int] = set()
            for joint in joints:
                self.check()
                if not _index(joint, nodes) or joint in seen:
                    self.error(
                        "invalid_skin", "A skin's joints refer to missing or repeated nodes.", path
                    )
                    break
                seen.add(joint)
            if "skeleton" in skin and not _index(skin["skeleton"], nodes):
                self.error("invalid_skin", "A skin's skeleton refers to a missing node.", path)
            if "inverseBindMatrices" in skin:
                matrices_index = skin["inverseBindMatrices"]
                info = self.accessor(matrices_index)
                if not _index(matrices_index, self.accessors):
                    self.error(
                        "invalid_skin", "A skin's inverse bind matrices are missing.", path
                    )
                elif info is not None and (
                    info.type != "MAT4" or info.component_type != FLOAT or info.count < len(joints)
                ):
                    self.error(
                        "invalid_skin",
                        "A skin's inverse bind matrices must be one float 4x4 matrix per joint.",
                        path,
                    )
        self.facts.counts["joints"] = total

    def _animations(self) -> None:
        nodes = self.items("nodes")
        names: list[str] = []
        channels_total = 0
        samplers_total = 0
        max_channels = self.settings.limit("max_channels")
        max_samplers = self.settings.limit("max_animation_samplers")
        for index, raw in enumerate(self.items("animations")):
            self.check()
            path = f"animations[{index}]"
            animation = _dict(raw)
            if animation is None:
                self.error("invalid_animation", "An animation is malformed.", path)
                continue
            samplers = animation.get("samplers")
            channels = animation.get("channels")
            if not isinstance(samplers, list) or not samplers:
                samplers = []
                self.error("invalid_animation", "An animation has no samplers.", path)
            if not isinstance(channels, list) or not channels:
                channels = []
                self.error("invalid_animation", "An animation has no channels.", path)
            samplers_total += len(samplers)
            channels_total += len(channels)
            if channels_total > max_channels or samplers_total > max_samplers:
                self.error(
                    "too_complex", "The model has too many animation channels.", "animations"
                )
                raise Stop
            duration = self._animation_data(samplers, channels, nodes, path)
            self.facts.animations.append(
                {
                    "name": animation.get("name"),
                    "duration_seconds": duration,
                    "channel_count": len(channels),
                    "sampler_count": len(samplers),
                }
            )
            self._clip_name(animation.get("name"), names, path)
        self.facts.counts["channels"] = channels_total
        if self.settings.require_animations and not self.items("animations"):
            self.error(
                "animations_required", "This profile requires at least one animation clip."
            )

    def _animation_data(
        self, samplers: list[Any], channels: list[Any], nodes: list[Any], path: str
    ) -> float | None:
        inputs: list[tuple[AccessorInfo, AccessorInfo, str] | None] = []
        duration: float | None = None
        for raw in samplers:
            self.check()
            sampler = _dict(raw)
            source = self.accessor(sampler.get("input")) if sampler else None
            output = self.accessor(sampler.get("output")) if sampler else None
            interpolation = sampler.get("interpolation", "LINEAR") if sampler else None
            if (
                sampler is None
                or not _index(sampler.get("input"), self.accessors)
                or not _index(sampler.get("output"), self.accessors)
                or not _member(interpolation, INTERPOLATIONS)
            ):
                self.error(
                    "invalid_animation",
                    "An animation sampler is malformed or refers to missing data.",
                    path,
                )
                inputs.append(None)
                continue
            if source is None or output is None:
                inputs.append(None)  # the accessor itself was reported
                continue
            if (
                source.type != "SCALAR"
                or source.component_type != FLOAT
                or source.minimum is None
                or source.maximum is None
                or source.minimum[0] < 0
                or source.maximum[0] < source.minimum[0]
            ):
                self.error(
                    "invalid_animation",
                    "An animation's keyframe times must be non-negative float scalars with "
                    "min and max.",
                    path,
                )
                inputs.append(None)
                continue
            end = source.maximum[0]
            duration = end if duration is None else max(duration, end)
            inputs.append((source, output, str(interpolation)))
        for raw in channels:
            self.check()
            channel = _dict(raw)
            target = _dict(channel.get("target")) if channel else None
            sampler_index = channel.get("sampler") if channel else None
            target_path = target.get("path") if target else None
            if (
                channel is None
                or target is None
                or not _index(sampler_index, samplers)
                or not _member(target_path, TARGET_PATHS)
                or ("node" in target and not _index(target["node"], nodes))
            ):
                self.error(
                    "invalid_animation",
                    "An animation channel is malformed or targets something missing.",
                    path,
                )
                continue
            linked = inputs[sampler_index]  # type: ignore[index]
            if linked is None:
                continue
            source, output, interpolation = linked
            frames = source.count * (3 if interpolation == "CUBICSPLINE" else 1)
            expected_type = TARGET_PATHS[str(target_path)]
            if expected_type:
                bad = output.type != expected_type or output.count != frames
            else:
                bad = output.type != "SCALAR" or output.count % frames != 0
            if bad:
                self.error(
                    "invalid_animation",
                    "An animation's output values do not match its keyframes and target.",
                    path,
                )
        return round(duration, 6) if duration is not None else None

    def _clip_name(self, name: object, names: list[str], path: str) -> None:
        """Django's clip-name rules, with messages that never quote the name."""
        if not isinstance(name, str) or not name.strip():
            self.report.warn(
                "unnamed_clip", "An animation has no name, so nothing can play it.", path
            )
            return
        if len(name) > MAX_CLIP_NAME:
            self.error(
                "clip_name", f"An animation name is longer than {MAX_CLIP_NAME} characters.", path
            )
            return
        if name in names:
            self.error("duplicate_clip", "Two animations have the same name.", path)
            return
        if name not in CLIP_VOCABULARY:
            self.report.warn(
                "unknown_clip",
                "An animation name is not in the clip vocabulary, so the game will not play it "
                "by name.",
                path,
            )
        if GENERIC_TAKE_NAME.search(name):
            self.report.warn(
                "generic_clip_name",
                "An animation has an exporter's default take name: it does not say what the "
                "motion is, and nothing here will guess. Rename each action in Blender to what "
                "it shows (Idle, Walk, Talk, Wave, ...) and export again.",
                path,
            )
        names.append(name)


def validate_glb(
    handle: BinaryIO, size: int, settings: GlbSettings, check: Check
) -> ValidationOutcome:
    """Validate the GLB in `handle` (`size` bytes). Never raises for a bad file; raises only
    what `check()` raises (cancellation, deadline)."""
    report = Report()
    outcome = ValidationOutcome(report=report, file_size=size)
    try:
        check()
        outcome.layout = read_layout(handle, size, report, settings.limit("max_json_bytes"))
        raw = read_at(handle, outcome.layout.json_offset, outcome.layout.json_length, size)
        check()
        document = parse_document(raw, report, settings.limit("max_json_depth"), check)
        del raw
        validator = _Validator(handle, outcome.layout, document, settings, report, check)
        try:
            validator.run()
        finally:
            if validator.facts.gltf_version is not None:
                outcome.facts = validator.facts
    except Stop:
        pass
    return outcome
