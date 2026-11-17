"""Synthetic GLB fixtures, generated in code (no binary assets are committed).

`static_model()` and `skinned_model()` build small valid models; `glb()` packs a document and
binary chunk with optional header and chunk-table corruption; `png()`, `jpeg()` and `webp()`
make image headers. `PARITY_CORPUS` is the shared corpus the parity tests run through both the
processor and Django's `lai/apps/assets/validation.py`; each case records the error codes each
side must report and, where they differ on purpose, why.

Everything is synthetic; no child data.
"""

from __future__ import annotations

import base64
import copy
import json
import struct
import zlib
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

GLB_MAGIC = 0x46546C67
CHUNK_JSON = 0x4E4F534A
CHUNK_BIN = 0x004E4942
MIXAMO_CLIP = "Armature|mixamo.com|Layer0"

Document = dict[str, Any]


def pad(data: bytes, fill: bytes) -> bytes:
    return data + fill * (-len(data) % 4)


def glb(
    document: Document | bytes,
    binary: bytes | None = b"",
    *,
    magic: int = GLB_MAGIC,
    version: int = 2,
    length_delta: int = 0,
    json_type: int = CHUNK_JSON,
    bin_type: int = CHUNK_BIN,
    json_length_delta: int = 0,
    bin_length_delta: int = 0,
    pad_json: bool = True,
    trailing: bytes = b"",
) -> bytes:
    """Pack a GLB. `document` may be raw JSON bytes (for invalid-JSON cases)."""
    raw = document if isinstance(document, bytes) else json.dumps(document).encode()
    json_chunk = pad(raw, b" ") if pad_json else raw
    body = struct.pack("<II", len(json_chunk) + json_length_delta, json_type) + json_chunk
    if binary:
        bin_chunk = pad(binary, b"\x00")
        body += struct.pack("<II", len(bin_chunk) + bin_length_delta, bin_type) + bin_chunk
    body += trailing
    return struct.pack("<III", magic, version, 12 + len(body) + length_delta) + body


def png(width: int, height: int) -> bytes:
    """A real (tiny-bodied) PNG header with the given IHDR dimensions."""
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    chunk = struct.pack(">I", 13) + b"IHDR" + ihdr
    chunk += struct.pack(">I", zlib.crc32(b"IHDR" + ihdr) & 0xFFFFFFFF)
    end = struct.pack(">I", 0) + b"IEND" + struct.pack(">I", zlib.crc32(b"IEND") & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk + end


def jpeg(width: int, height: int, *, app_bytes: int = 16) -> bytes:
    """SOI, an APP0 segment of `app_bytes` payload, then a baseline SOF0 frame header."""
    app = b"\xff\xe0" + struct.pack(">H", app_bytes + 2) + b"J" * app_bytes
    sof = b"\xff\xc0" + struct.pack(">HBHHB", 11, 8, height, width, 1) + b"\x01\x11\x00"
    return b"\xff\xd8" + app + sof + b"\xff\xd9"


def webp(width: int, height: int) -> bytes:
    """A VP8X WebP header."""
    payload = b"VP8X" + struct.pack("<I", 10) + b"\x00\x00\x00\x00"
    payload += (width - 1).to_bytes(3, "little") + (height - 1).to_bytes(3, "little")
    return b"RIFF" + struct.pack("<I", 4 + len(payload)) + b"WEBP" + payload


class Builder:
    """Accumulates a binary buffer, buffer views and accessors for one document."""

    def __init__(self) -> None:
        self.binary = bytearray()
        self.views: list[dict[str, Any]] = []
        self.accessors: list[dict[str, Any]] = []

    def view(self, data: bytes, **extra: Any) -> int:
        while len(self.binary) % 4:
            self.binary.append(0)
        self.views.append(
            {"buffer": 0, "byteOffset": len(self.binary), "byteLength": len(data), **extra}
        )
        self.binary += data
        return len(self.views) - 1

    def accessor(
        self, fmt: str, values: list[float], component: int, kind: str, **extra: Any
    ) -> int:
        components = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}[kind]
        data = struct.pack(f"<{len(values)}{fmt}", *values)
        view = self.view(data)
        self.accessors.append(
            {
                "bufferView": view,
                "componentType": component,
                "count": len(values) // components,
                "type": kind,
                **extra,
            }
        )
        return len(self.accessors) - 1

    def finish(self, document: Document) -> tuple[Document, bytes]:
        while len(self.binary) % 4:
            self.binary.append(0)
        document["buffers"] = [{"byteLength": len(self.binary)}]
        document["bufferViews"] = self.views
        document["accessors"] = self.accessors
        return document, bytes(self.binary)


def _quad(builder: Builder, half: float = 0.5) -> tuple[int, int]:
    positions = [-half, 0, -half, half, 0, -half, half, 0, half, -half, 0, half]
    position = builder.accessor(
        "f", positions, 5126, "VEC3", min=[-half, 0, -half], max=[half, 0, half]
    )
    indices = builder.accessor("H", [0, 1, 2, 0, 2, 3], 5123, "SCALAR")
    return position, indices


def static_model(
    *, texture: bytes | None = None, mime: str = "image/png"
) -> tuple[Document, bytes]:
    """One textured quad (2 triangles, 4 vertices) in one scene, with a named material."""
    builder = Builder()
    position, indices = _quad(builder)
    document: Document = {
        "asset": {"version": "2.0", "generator": "lai-glb-builder"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": "floor", "translation": [0, 1, 0]}],
        "meshes": [
            {
                "name": "floor",
                "primitives": [
                    {"attributes": {"POSITION": position}, "indices": indices, "material": 0}
                ],
            }
        ],
        "materials": [
            {
                "name": "Sand Mat",
                "pbrMetallicRoughness": {"baseColorTexture": {"index": 0}},
            }
        ],
        "samplers": [{"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497}],
        "textures": [{"source": 0, "sampler": 0}],
        "images": [{"bufferView": builder.view(texture or png(64, 32)), "mimeType": mime}],
    }
    return builder.finish(document)


def skinned_model(clips: tuple[str, ...] = ("Idle", "Walk")) -> tuple[Document, bytes]:
    """A skinned quad with two joints and one translation animation per clip name.

    Clip `i` lasts `1.25 * (i + 1)` seconds."""
    builder = Builder()
    position, indices = _quad(builder)
    joints = builder.accessor("B", [0, 1, 0, 0] * 4, 5121, "VEC4")
    weights = builder.accessor("f", [0.5, 0.5, 0, 0] * 4, 5126, "VEC4")
    identity = [1.0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 1.0]
    matrices = builder.accessor("f", identity * 2, 5126, "MAT4")
    animations = []
    for number, clip in enumerate(clips):
        end = 1.25 * (number + 1)
        times = builder.accessor("f", [0.0, end], 5126, "SCALAR", min=[0.0], max=[end])
        moves = builder.accessor("f", [0, 0, 0, 0, 0.1, 0], 5126, "VEC3")
        animations.append(
            {
                "name": clip,
                "samplers": [{"input": times, "output": moves, "interpolation": "LINEAR"}],
                "channels": [{"sampler": 0, "target": {"node": 2, "path": "translation"}}],
            }
        )
    document: Document = {
        "asset": {"version": "2.0", "generator": "lai-glb-builder"},
        "scene": 0,
        "scenes": [{"nodes": [0, 1]}],
        "nodes": [
            {"mesh": 0, "skin": 0, "name": "body"},
            {"name": "hips", "children": [2]},
            {"name": "spine", "translation": [0, 0.5, 0]},
        ],
        "meshes": [
            {
                "primitives": [
                    {
                        "attributes": {
                            "POSITION": position,
                            "JOINTS_0": joints,
                            "WEIGHTS_0": weights,
                        },
                        "indices": indices,
                    }
                ]
            }
        ],
        "skins": [{"name": "Armature", "joints": [1, 2], "inverseBindMatrices": matrices}],
        "animations": animations,
    }
    return builder.finish(document)


def static_glb(**kwargs: Any) -> bytes:
    return glb(*static_model(**kwargs))


def skinned_glb(clips: tuple[str, ...] = ("Idle", "Walk")) -> bytes:
    return glb(*skinned_model(clips))


def mutated(
    change: Callable[[Document], None], base: Callable[[], tuple[Document, bytes]] = static_model
) -> bytes:
    document, binary = base()
    document = copy.deepcopy(document)
    change(document)
    return glb(document, binary)


def data_uri(media: str, data: bytes) -> str:
    return f"data:{media};base64,{base64.b64encode(data).decode()}"


# --- the shared parity corpus ----------------------------------------------------------------

# COMPLEXITY_DEFAULTS["max_json_elements"] and Django's LIMITS["json_elements"] (a parity test
# checks all three agree).
JSON_ELEMENTS = 1_000_000


@dataclass(frozen=True)
class ParityCase:
    name: str
    data: bytes
    django_errors: frozenset[str]
    processor_errors: frozenset[str] = field(default=frozenset())
    # Why the processor differs from Django on purpose (empty: they must agree exactly).
    difference: str = ""

    def __post_init__(self) -> None:
        if not self.difference:
            object.__setattr__(self, "processor_errors", self.django_errors)


def _set(path: str, value: Any) -> Callable[[Document], None]:
    def change(document: Document) -> None:
        target: Any = document
        keys = path.split(".")
        for key in keys[:-1]:
            target = target[int(key)] if isinstance(target, list) else target[key]
        last = keys[-1]
        if isinstance(target, list):
            target[int(last)] = value
        else:
            target[last] = value

    return change


def _corpus() -> list[ParityCase]:
    E = frozenset  # noqa: N806 - short alias for readability
    static = static_glb()
    cases = [
        ParityCase("valid_static", static, E()),
        ParityCase("valid_skinned_animated", skinned_glb(), E()),
        ParityCase("valid_mixamo_clip", skinned_glb((MIXAMO_CLIP, "Armature|Walk")), E()),
        ParityCase("valid_jpeg_texture", static_glb(texture=jpeg(16, 8), mime="image/jpeg"), E()),
        ParityCase("empty_file", b"", E({"empty_file"})),
        ParityCase("bad_magic", b"glTX" + static[4:], E({"not_a_model"})),
        ParityCase("tiny_glb", static[:8], E({"not_glb"})),
        ParityCase("glb_version_1", glb(*static_model(), version=1), E({"glb_version"})),
        ParityCase("truncated", static[:-16], E({"glb_length"})),
        ParityCase("length_mismatch", glb(*static_model(), length_delta=4), E({"glb_length"})),
        ParityCase(
            "first_chunk_not_json", glb(*static_model(), json_type=0x12345678), E({"glb_chunks"})
        ),
        ParityCase(
            "second_chunk_not_bin", glb(*static_model(), bin_type=0x12345678), E({"glb_chunks"})
        ),
        ParityCase(
            "bin_chunk_beyond_file", glb(*static_model(), bin_length_delta=64), E({"glb_chunks"})
        ),
        ParityCase(
            "json_chunk_beyond_file",
            glb(*static_model(), json_length_delta=10**6),
            E({"json_size"}),
        ),
        ParityCase("invalid_json", glb(b"{not json", b""), E({"invalid_json"})),
        ParityCase("json_not_object", glb(b"[1, 2]", b""), E({"invalid_json"})),
        ParityCase("invalid_utf8", glb(b'{"asset": "\xff"}', b""), E({"invalid_json"})),
        # The JSON structure pre-scan, shared by both validators (`max_json_depth`,
        # `max_json_elements`): refused before anything is parsed.
        ParityCase(
            "deep_json",
            glb(b'{"asset": {"version": "2.0"}, "extras": ' + b"[" * 100 + b"]" * 100 + b"}", b""),
            E({"invalid_json"}),
        ),
        ParityCase(
            "json_too_many_elements",
            glb(
                b'{"asset": {"version": "2.0"}, "x": [' + b"0," * JSON_ELEMENTS + b"0]}",
                b"",
            ),
            E({"too_complex"}),
        ),
        ParityCase(
            "json_unterminated_string",
            glb(b'{"asset": {"version": "2.0"}, "x": "abc\\"}', b""),
            E({"invalid_json"}),
        ),
        ParityCase(
            # Brackets, separators and escaped quotes inside strings are not structure.
            "json_structure_inside_strings",
            mutated(_set("asset.generator", '[{,:\\"' * 200)),
            E(),
        ),
        ParityCase("gltf_version_1", mutated(_set("asset.version", "1.0")), E({"gltf_version"})),
        ParityCase(
            "draco_required",
            mutated(_set("extensionsRequired", ["KHR_draco_mesh_compression"])),
            E({"needs_decoder"}),
        ),
        ParityCase(
            "meshopt_used",
            mutated(_set("extensionsUsed", ["EXT_meshopt_compression"])),
            E({"needs_decoder"}),
        ),
        ParityCase(
            "unknown_required_extension",
            mutated(_set("extensionsRequired", ["VENDOR_magic"])),
            E({"unsupported_extension"}),
        ),
        ParityCase(
            "unknown_used_extension_warns",
            mutated(_set("extensionsUsed", ["VENDOR_magic"])),
            E(),
        ),
        ParityCase(
            "external_buffer_uri",
            mutated(_set("buffers.0.uri", "https://example.invalid/model.bin")),
            E({"external_resource"}),
        ),
        ParityCase(
            "path_traversal_buffer_uri",
            mutated(_set("buffers.0.uri", "../../etc/passwd")),
            E({"external_resource"}),
        ),
        ParityCase(
            "external_image_uri",
            mutated(_set("images.0", {"uri": "file:///etc/passwd"})),
            E({"external_resource"}),
        ),
        ParityCase(
            "accessor_past_view",
            mutated(_set("accessors.0.count", 400)),
            E({"buffer_bounds"}),
        ),
        ParityCase(
            "accessor_offset_near_2_32",
            mutated(_set("accessors.0.byteOffset", 2**32 - 4)),
            E({"buffer_bounds"}),
        ),
        ParityCase(
            "accessor_missing_view",
            mutated(_set("accessors.0.bufferView", 99)),
            E({"invalid_accessor"}),
        ),
        ParityCase(
            "accessor_bad_component",
            mutated(_set("accessors.1.componentType", 1234)),
            E({"invalid_accessor"}),
        ),
        ParityCase(
            "accessor_huge_count",
            mutated(_set("accessors.1.count", 10**12)),
            E({"too_complex"}),
        ),
        ParityCase(
            "view_past_buffer",
            mutated(_set("bufferViews.0.byteLength", 10**6)),
            E({"buffer_bounds"}),
        ),
        ParityCase(
            "view_missing_buffer",
            mutated(_set("bufferViews.0.buffer", 3)),
            E({"invalid_buffer_view"}),
        ),
        ParityCase(
            "buffer_longer_than_bin",
            mutated(_set("buffers.0.byteLength", 10**6)),
            E({"buffer_bounds"}),
        ),
        ParityCase(
            "image_wrong_magic",
            static_glb(texture=b"\x00" * 64, mime="image/png"),
            E({"image_type"}),
        ),
        ParityCase(
            "image_gif_type",
            static_glb(texture=b"GIF89a" + b"\x00" * 32, mime="image/gif"),
            E({"image_type"}),
        ),
        ParityCase("no_scene", mutated(_set("scenes", [])), E({"no_scene"})),
        ParityCase(
            "scene_missing_node",
            mutated(_set("scenes.0.nodes", [7])),
            E({"invalid_node", "no_geometry"}),
        ),
        ParityCase(
            "node_cycle",
            mutated(_set("nodes", [{"mesh": 0, "children": [1]}, {"children": [0]}])),
            E({"node_cycle"}),
        ),
        ParityCase("duplicate_clip", skinned_glb(("Idle", "Idle")), E({"duplicate_clip"})),
        ParityCase("long_clip_name", skinned_glb(("W" * 65,)), E({"clip_name"})),
        ParityCase(
            "too_many_nodes",
            mutated(_set("nodes", [{"mesh": 0}] + [{} for _ in range(10_000)])),
            E({"too_complex"}),
        ),
        # --- intentional differences: the processor is stricter ----------------------------
        ParityCase(
            "trailing_bytes",
            glb(*static_model(), trailing=b"\x00" * 16),
            E(),
            E({"glb_trailing_data"}),
            "Django ignores bytes after the BIN chunk; the processor refuses them (a structure "
            "must end where the file ends).",
        ),
        ParityCase(
            "duplicate_json_keys",
            glb(b'{"asset": {"version": "2.0"}, "asset": {"version": "2.0"}}', b""),
            E({"no_scene"}),
            E({"invalid_json"}),
            "Duplicate keys are refused by the strict parser; Django keeps the last value.",
        ),
        ParityCase(
            "nan_in_json",
            mutated(_set("nodes.0.translation", [0, 0, 0]))[:0]
            + glb(b'{"asset": {"version": "2.0"}, "x": NaN}', b""),
            E({"no_scene"}),
            E({"invalid_json"}),
            "NaN and Infinity are refused by the strict parser; Django accepts them.",
        ),
        ParityCase(
            "odd_byte_stride",
            mutated(_set("bufferViews.0.byteStride", 2)),
            E(),
            E({"invalid_buffer_view"}),
            "Django does not check byteStride; the processor requires 4..252, a multiple of 4.",
        ),
        ParityCase(
            "huge_png_dimensions",
            static_glb(texture=png(100_000, 100_000)),
            E(),
            E({"texture_too_large"}),
            "Django does not read embedded texture dimensions; the processor refuses textures "
            "over max_texture_dimension (8192).",
        ),
        ParityCase(
            "animation_sampler_missing_input",
            mutated(_set("animations.0.samplers.0.input", 99), skinned_model),
            E(),
            E({"invalid_animation"}),
            "Django checks only clip names; the processor validates animation samplers and "
            "channels.",
        ),
        ParityCase(
            "skin_joint_missing_node",
            mutated(_set("skins.0.joints", [1, 42]), skinned_model),
            E(),
            E({"invalid_skin"}),
            "Django does not validate skins; the processor checks joints and inverse bind "
            "matrices.",
        ),
        ParityCase(
            "primitive_without_position",
            mutated(_set("meshes.0.primitives.0.attributes", {"NORMAL": 0})),
            E({"no_geometry"}),
            E({"invalid_mesh", "no_geometry"}),
            "The processor requires a POSITION attribute on every primitive.",
        ),
        ParityCase(
            "huge_integer_translation",
            mutated(_set("nodes.0.translation", [10**400, 0, 0])),
            E(),
            E({"invalid_json"}),
            "An integer too large for a float is refused by the strict parser; Django ignores "
            "the transform (it once crashed with OverflowError).",
        ),
        ParityCase(
            "huge_integer_accessor_max",
            mutated(_set("accessors.0.max", [10**400, 0, 0])),
            E({"no_geometry"}),
            E({"invalid_json"}),
            "An integer too large for a float is refused by the strict parser; Django treats "
            "the POSITION bounds as missing.",
        ),
        ParityCase(
            "webp_texture",
            static_glb(texture=webp(64, 64), mime="image/webp"),
            E({"image_type"}),
        ),
        ParityCase(
            "gltf_json_input",
            json.dumps(static_model()[0]).encode(),
            E({"missing_buffer"}),
            E({"gltf_not_supported"}),
            "The processor validates GLB only; Django also accepts a .gltf JSON file (which "
            "fails here anyway because its buffer has no data).",
        ),
    ]
    return cases


PARITY_CORPUS: list[ParityCase] = _corpus()


# --- running the validator directly ----------------------------------------------------------


def validate(
    data: bytes,
    settings: Any = None,
    check: Callable[[], None] | None = None,
) -> Any:
    """Run `validate_glb` over `data`; returns the `ValidationOutcome`."""
    import io

    from lai_processing.processors.gltf import GlbSettings, validate_glb

    return validate_glb(
        io.BytesIO(data), len(data), settings or GlbSettings(), check or (lambda: None)
    )


def error_codes(data: bytes, settings: Any = None) -> set[str]:
    return set(validate(data, settings).report.codes(_severity("error")))


def warning_codes(data: bytes, settings: Any = None) -> set[str]:
    return set(validate(data, settings).report.codes(_severity("warning")))


def _severity(name: str) -> Any:
    from lai_processing.contracts import Severity

    return Severity(name)
