"""`KHR_texture_basisu` and KTX2 container validation (ADR-070), standard library only.

Sources (read 2026-11-18): the KTX 2.0 specification (header, level index, Data Format
Descriptor, key/value data), the Khronos Data Format specification (colour models 163 ETC1S and
166 UASTC, transfer functions 1 linear and 2 sRGB) and the `KHR_texture_basisu` glTF extension.

`parse_ktx2(data, sink, path)` checks one KTX2 file without decoding any texel:

- the 12-byte identifier; `vkFormat` 0 (`VK_FORMAT_UNDEFINED`, required for Basis Universal);
- `supercompressionScheme` 1 (BasisLZ, ETC1S) with colour model ETC1S, or 0 / 2 (none / Zstandard)
  with colour model UASTC; any other combination is refused;
- `pixelWidth` and `pixelHeight` positive, multiples of 4 (`KHR_texture_basisu`), within the
  side limit; `pixelDepth` 0, `layerCount` 0, `faceCount` 1 (2D textures only);
- `levelCount` >= 1 (0, "generate mipmaps at load", is refused) and not above the full pyramid;
  a partial pyramid is a warning;
- every level, the DFD, the key/value data and the supercompression global data inside the file
  and after the level index; BasisLZ needs global data, the others must have none; for UASTC,
  `uncompressedByteLength` (Zstandard) or `byteLength` (no supercompression) equals the 16-byte
  4x4 block count of the level; for BasisLZ `uncompressedByteLength` is 0;
- the DFD's colour model and transfer function; `KTXorientation`, when present, is `rd`
  (glTF's top-left origin).

`validate_basisu(document, sink, read_image=..., ...)` checks the glTF side: each texture's
`extensions.KHR_texture_basisu.source` names an `image/ktx2` image; a texture without a PNG or
JPEG fallback `source` requires the extension in `extensionsRequired`; no `image/ktx2` image is
used through a plain `source`; declared-use consistency; and colour space against material
usage (base colour and emissive sRGB; normal, occlusion and metallic-roughness linear).

GPU memory is **calculated** per image (`Ktx2Info.gpu_bytes`): 8 bits per pixel for the
transcoded block format (ASTC 4x4, BC7, ETC2 RGBA; ETC1S without alpha may use 4 bpp), and the
RGBA8 fallback (32 bpp) a device without compressed formats would use. Mip chains add the sum of
every level.
"""

from __future__ import annotations

import struct
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Any, Final

from .meshopt import Sink

__all__ = [
    "BASISU_EXTENSION",
    "DEFAULT_MAX_SIDE",
    "KTX2_IDENTIFIER",
    "KTX2_MIME",
    "Ktx2Facts",
    "Ktx2Info",
    "ktx2_image_indices",
    "parse_ktx2",
    "validate_basisu",
]

BASISU_EXTENSION: Final = "KHR_texture_basisu"
KTX2_MIME: Final = "image/ktx2"
KTX2_IDENTIFIER: Final = b"\xabKTX 20\xbb\r\n\x1a\n"
HEADER_BYTES: Final = 80
LEVEL_ENTRY_BYTES: Final = 24
DEFAULT_MAX_SIDE: Final = 4096
SCHEME_NONE: Final = 0
SCHEME_BASISLZ: Final = 1
SCHEME_ZSTD: Final = 2
MODEL_ETC1S: Final = 163
MODEL_UASTC: Final = 166
TRANSFER_LINEAR: Final = 1
TRANSFER_SRGB: Final = 2
_SRGB_SLOTS: Final = ("baseColorTexture", "emissiveTexture")
_LINEAR_SLOTS: Final = ("normalTexture", "occlusionTexture", "metallicRoughnessTexture")

ReadImage = Callable[[int], "bytes | None"]


@dataclass(frozen=True, slots=True)
class Ktx2Info:
    width: int
    height: int
    level_count: int
    scheme: int
    color_model: int | None
    transfer: int | None
    byte_length: int
    orientation: str | None

    @property
    def codec(self) -> str:
        return {MODEL_ETC1S: "etc1s", MODEL_UASTC: "uastc"}.get(self.color_model or 0, "unknown")

    @property
    def color_space(self) -> str | None:
        return {TRANSFER_SRGB: "srgb", TRANSFER_LINEAR: "linear"}.get(self.transfer or 0)

    def gpu_bytes(self, bits_per_pixel: int) -> int:
        total = 0
        width, height = self.width, self.height
        for _level in range(max(1, self.level_count)):
            total += max(1, width) * max(1, height) * bits_per_pixel // 8
            width, height = max(1, width // 2), max(1, height // 2)
        return total

    def as_metadata(self) -> dict[str, Any]:
        return {
            "width": self.width,
            "height": self.height,
            "levels": self.level_count,
            "codec": self.codec,
            "supercompression": {0: "none", 1: "basislz", 2: "zstd"}.get(self.scheme, "other"),
            "color_space": self.color_space,
            "bytes": self.byte_length,
            "gpu_bytes_estimate": self.gpu_bytes(8),
            "gpu_bytes_rgba8_fallback": self.gpu_bytes(32),
            "basis": "calculated",
        }


@dataclass
class Ktx2Facts:
    used: bool = False
    required: bool = False
    images: dict[int, Ktx2Info] = field(default_factory=dict)
    textures: int = 0
    fallbacks: int = 0

    def as_metadata(self) -> dict[str, Any]:
        return {
            "extension": BASISU_EXTENSION,
            "required": self.required,
            "texture_count": self.textures,
            "fallback_count": self.fallbacks,
            "images": [
                {"index": index, **info.as_metadata()}
                for index, info in sorted(self.images.items())
            ],
            "gpu_bytes_estimate": sum(i.gpu_bytes(8) for i in self.images.values()),
            "gpu_bytes_rgba8_fallback": sum(i.gpu_bytes(32) for i in self.images.values()),
            "payload_decoded": False,
        }


def _noop() -> None:
    return None


def _dict(value: object) -> dict[str, Any] | None:
    return value if isinstance(value, dict) else None


def _list(document: Mapping[str, Any], name: str) -> list[Any]:
    value = document.get(name)
    return value if isinstance(value, list) else []


def _full_pyramid(width: int, height: int) -> int:
    return max(width, height).bit_length()


def _key_values(data: bytes, offset: int, length: int) -> dict[bytes, bytes]:
    """Key/value pairs (bounded walk; malformed entries end the walk)."""
    out: dict[bytes, bytes] = {}
    position, end = offset, offset + length
    for _ in range(256):
        if position + 4 > end:
            break
        (size,) = struct.unpack_from("<I", data, position)
        start = position + 4
        if size == 0 or start + size > end:
            break
        entry = data[start : start + size]
        key, _sep, value = entry.partition(b"\x00")
        out[key] = value.rstrip(b"\x00")
        position = start + size + (-size % 4)
    return out


def parse_ktx2(
    data: bytes, sink: Sink, path: str = "", *, max_side: int = DEFAULT_MAX_SIDE
) -> Ktx2Info | None:
    """Check one KTX2 file for `KHR_texture_basisu` use. None when it is unusable."""

    def error(code: str, message: str) -> None:
        sink.error(code, message, path)

    size = len(data)
    if size < HEADER_BYTES or data[:12] != KTX2_IDENTIFIER:
        error("ktx2_invalid", "A KTX2 texture does not start with the KTX 2.0 identifier.")
        return None
    (
        vk_format,
        _type_size,
        width,
        height,
        depth,
        layers,
        faces,
        level_count,
        scheme,
        dfd_offset,
        dfd_length,
        kvd_offset,
        kvd_length,
        sgd_offset,
        sgd_length,
    ) = struct.unpack_from("<9I4I2Q", data, 12)
    ok = True
    if vk_format != 0:
        error("ktx2_format", "A Basis Universal KTX2 texture must have vkFormat 0.")
        ok = False
    if width <= 0 or height <= 0 or width % 4 or height % 4:
        error("ktx2_dimensions", "KTX2 texture width and height must be positive multiples of 4.")
        ok = False
    elif width > max_side or height > max_side:
        error("texture_too_large", f"A KTX2 texture is larger than {max_side} pixels.")
        ok = False
    if depth != 0 or layers != 0 or faces != 1:
        error("ktx2_shape", "Only 2D KTX2 textures are supported (no depth, layers or faces).")
        ok = False
    if scheme not in (SCHEME_NONE, SCHEME_BASISLZ, SCHEME_ZSTD):
        error("ktx2_supercompression", "A KTX2 texture uses an unsupported supercompression.")
        ok = False
    if level_count == 0:
        error("ktx2_levels", "A KTX2 texture must contain its mip levels (levelCount 0).")
        return None
    if width > 0 and height > 0 and level_count > _full_pyramid(width, height):
        error("ktx2_levels", "A KTX2 texture has more mip levels than its size allows.")
        return None
    index_end = HEADER_BYTES + level_count * LEVEL_ENTRY_BYTES
    if index_end > size:
        error("ktx2_truncated", "A KTX2 texture's level index runs past its end.")
        return None

    def in_file(offset: int, length: int) -> bool:
        return length == 0 or (offset >= index_end and offset + length <= size)

    if not in_file(dfd_offset, dfd_length) or dfd_length < 28:
        error("ktx2_dfd", "A KTX2 texture's data format descriptor is missing or out of range.")
        return None
    if not in_file(kvd_offset, kvd_length):
        error("ktx2_truncated", "A KTX2 texture's key/value data is out of range.")
        ok = False
    if scheme == SCHEME_BASISLZ:
        if sgd_length == 0 or not in_file(sgd_offset, sgd_length):
            error(
                "ktx2_truncated", "A BasisLZ KTX2 texture's global data is missing or out of range."
            )
            ok = False
    elif sgd_length != 0:
        error("ktx2_supercompression", "Only BasisLZ KTX2 textures carry global data.")
        ok = False
    color_model = data[dfd_offset + 12]
    transfer = data[dfd_offset + 14]
    if scheme == SCHEME_BASISLZ and color_model != MODEL_ETC1S:
        error("ktx2_color_model", "A BasisLZ KTX2 texture must use the ETC1S colour model.")
        ok = False
    if scheme in (SCHEME_NONE, SCHEME_ZSTD) and color_model != MODEL_UASTC:
        error(
            "ktx2_color_model",
            "A KTX2 texture without BasisLZ must use the UASTC colour model for glTF.",
        )
        ok = False
    if transfer not in (TRANSFER_LINEAR, TRANSFER_SRGB):
        error("ktx2_transfer", "A KTX2 texture's transfer function is neither linear nor sRGB.")
        ok = False
    level_width, level_height = width, height
    for level in range(level_count):
        offset, length, uncompressed = struct.unpack_from(
            "<3Q", data, HEADER_BYTES + level * LEVEL_ENTRY_BYTES
        )
        blocks = (-(-max(1, level_width) // 4)) * (-(-max(1, level_height) // 4)) * 16
        if length == 0 or not in_file(offset, length):
            error("ktx2_truncated", "A KTX2 mip level is empty or runs past the file.")
            return None
        if scheme == SCHEME_BASISLZ and uncompressed != 0:
            error("ktx2_levels", "A BasisLZ mip level declares an uncompressed length.")
            ok = False
        if scheme == SCHEME_ZSTD and uncompressed != blocks:
            error("ktx2_levels", "A Zstandard UASTC mip level has the wrong decoded length.")
            ok = False
        if scheme == SCHEME_NONE and length != blocks:
            error("ktx2_levels", "A UASTC mip level has the wrong length.")
            ok = False
        level_width, level_height = max(1, level_width // 2), max(1, level_height // 2)
    orientation_raw = _key_values(data, kvd_offset, kvd_length).get(b"KTXorientation")
    orientation = orientation_raw.decode("ascii", "replace") if orientation_raw else None
    if orientation is not None and not orientation.startswith("rd"):
        error("ktx2_orientation", "A KTX2 texture is not stored top-left first as glTF expects.")
        ok = False
    if 1 < level_count < _full_pyramid(width, height):
        sink.warn("ktx2_partial_mips", "A KTX2 texture has a partial mip chain.", path)
    if not ok:
        return None
    return Ktx2Info(width, height, level_count, scheme, color_model, transfer, size, orientation)


def _extension(texture: Mapping[str, Any]) -> object:
    extensions = _dict(texture.get("extensions"))
    return None if extensions is None else extensions.get(BASISU_EXTENSION)


def _image_mime(image: Mapping[str, Any]) -> str | None:
    mime = image.get("mimeType")
    if isinstance(mime, str):
        return mime
    uri = image.get("uri")
    if isinstance(uri, str) and uri[:5].lower() == "data:":
        return uri[5:].split(";", 1)[0].split(",", 1)[0].strip().lower()
    return None


def ktx2_image_indices(document: Mapping[str, Any]) -> frozenset[int]:
    """Images reached through `KHR_texture_basisu`: the validators accept `image/ktx2` for
    these images only, and only when the extension is enabled."""
    images = _list(document, "images")
    found: set[int] = set()
    for raw in _list(document, "textures"):
        extension = _dict(_extension(_dict(raw) or {}))
        source = extension.get("source") if extension else None
        if isinstance(source, int) and not isinstance(source, bool) and 0 <= source < len(images):
            found.add(source)
    return frozenset(found)


def _texture_usage(document: Mapping[str, Any]) -> dict[int, set[str]]:
    """texture index -> {"srgb", "linear"} from the core material slots."""
    usage: dict[int, set[str]] = {}
    for raw in _list(document, "materials"):
        material = _dict(raw) or {}
        pbr = _dict(material.get("pbrMetallicRoughness")) or {}
        for holder, slots, space in (
            (pbr, ("baseColorTexture",), "srgb"),
            (material, ("emissiveTexture",), "srgb"),
            (pbr, ("metallicRoughnessTexture",), "linear"),
            (material, ("normalTexture", "occlusionTexture"), "linear"),
        ):
            for slot in slots:
                info = _dict(holder.get(slot))
                index = info.get("index") if info else None
                if isinstance(index, int) and not isinstance(index, bool):
                    usage.setdefault(index, set()).add(space)
    return usage


def validate_basisu(
    document: Mapping[str, Any],
    sink: Sink,
    *,
    read_image: ReadImage | None = None,
    max_side: int = DEFAULT_MAX_SIDE,
    check: Callable[[], None] = _noop,
) -> Ktx2Facts:
    """Check `KHR_texture_basisu` use. `read_image(i)` returns image `i`'s bytes (bounded by the
    caller's image size limit) or None when unavailable; without it only the glTF side is
    checked. Call only when the extension is enabled (`LAI_GLB_KTX2`)."""
    facts = Ktx2Facts()
    used = BASISU_EXTENSION in {n for n in _list(document, "extensionsUsed") if isinstance(n, str)}
    required = BASISU_EXTENSION in {
        n for n in _list(document, "extensionsRequired") if isinstance(n, str)
    }
    facts.required = required
    images = _list(document, "images")
    textures = _list(document, "textures")
    usage = _texture_usage(document)
    basisu_images: dict[int, set[str]] = {}
    for index, raw in enumerate(textures):
        check()
        texture = _dict(raw) or {}
        path = f"textures[{index}]"
        fallback = texture.get("source")
        if fallback is not None and isinstance(fallback, int) and 0 <= fallback < len(images):
            if _image_mime(_dict(images[fallback]) or {}) == KTX2_MIME:
                sink.error(
                    "ktx2_without_extension",
                    "A KTX2 image is used without KHR_texture_basisu.",
                    path,
                )
        raw_extension = _extension(texture)
        if raw_extension is None:
            continue
        facts.textures += 1
        extension = _dict(raw_extension)
        source = extension.get("source") if extension else None
        if (
            extension is None
            or isinstance(source, bool)
            or not isinstance(source, int)
            or not 0 <= source < len(images)
        ):
            sink.error(
                "ktx2_invalid_source",
                "A KHR_texture_basisu texture does not name a valid image.",
                f"{path}.extensions.{BASISU_EXTENSION}",
            )
            continue
        if _image_mime(_dict(images[source]) or {}) != KTX2_MIME:
            sink.error(
                "ktx2_image_type",
                "A KHR_texture_basisu texture must use an image/ktx2 image.",
                f"images[{source}]",
            )
            continue
        if fallback is None:
            if not required:
                sink.error(
                    "ktx2_requires_extension",
                    "A texture with no PNG or JPEG fallback needs KHR_texture_basisu in "
                    "extensionsRequired.",
                    path,
                )
        else:
            facts.fallbacks += 1
            sink.warn(
                "ktx2_fallback_present",
                "A KTX2 texture also carries a PNG or JPEG fallback image.",
                path,
            )
        basisu_images.setdefault(source, set()).update(usage.get(index, set()))
    facts.used = bool(facts.textures) or used or required
    if facts.textures and not used:
        sink.error(
            "ktx2_not_declared",
            "The model uses KHR_texture_basisu but does not list it in extensionsUsed.",
            "extensionsUsed",
        )
    if required and not used:
        sink.error(
            "extension_required_not_used",
            "An extension in extensionsRequired is missing from extensionsUsed.",
            "extensionsRequired",
        )
    for index, spaces in sorted(basisu_images.items()):
        check()
        path = f"images[{index}]"
        if len(spaces) > 1:
            sink.error(
                "ktx2_mixed_color_usage",
                "One KTX2 image is used both as colour and as data.",
                path,
            )
        if read_image is None:
            continue
        data = read_image(index)
        if data is None:
            continue
        info = parse_ktx2(data, sink, path, max_side=max_side)
        if info is None:
            continue
        facts.images[index] = info
        expected = next(iter(spaces)) if len(spaces) == 1 else None
        if expected is not None and info.color_space != expected:
            sink.error(
                "ktx2_color_space",
                "A KTX2 image's transfer function does not match how the material uses it "
                "(sRGB for base colour and emissive, linear for normal, occlusion and "
                "metallic-roughness).",
                path,
            )
    if facts.images:
        sink.warn(
            "ktx2_payload_not_decoded",
            "KTX2 textures were checked for structure only; texels are transcoded by the game.",
            "images",
        )
    return facts
