"""The texture preparation seam: Workstream D's image module, not a second resize subsystem.

The KTX2 step calls `prepare(data, name) -> PreparedTexture`, where `name` is `ktx2-color` or
`ktx2-data`, and gets back an image toktx can read (PNG or JPEG) whose sides are multiples of 4
and within the cap.

Preparers are chosen by explicit configuration (`resolve_preparer(name)`), never by a silent
fallback, and the KTX2 report records which one ran:

- `pillow` (production, the only one the optimize worker accepts): Workstream D's
  `lai_native.image.prepare_texture` with its glTF profiles (ADR-068, F5):
  `texture-colour-gltf` for base colour and emissive, `texture-data-gltf` for normal, occlusion
  and metallic-roughness. Both ignore embedded ICC profiles and EXIF orientation (glTF defines
  texture colour and orientation itself), keep data channels exact, drop metadata, and write
  lossless PNG. A side that is not a multiple of 4, or above the cap, is resized with D's
  power-of-two fit (rounding down, never upscaling); otherwise the size is kept.
- `passthrough` (tests and tooling without Pillow): reads the size from the header, refuses
  anything that would need a resize (`texture_needs_resize`), never re-encodes. Not accepted by
  the worker.

`resolve_preparer("pillow")` raises `TextureError("preparer_unavailable")` when Pillow is not
installed: the KTX2 step then fails instead of quietly skipping colour handling.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from lai_processing.processors.gltf.images import image_dimensions, sniff_image

__all__ = [
    "PreparedTexture",
    "PrepareTexture",
    "TextureError",
    "PREPARERS",
    "resolve_preparer",
    "passthrough_texture",
    "pillow_texture",
]

MAX_TEXTURE_SIDE = 4096


class TextureError(ValueError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True, slots=True)
class PreparedTexture:
    data: bytes
    mime_type: str  # image/png or image/jpeg
    width: int
    height: int


PrepareTexture = Callable[[bytes, str], PreparedTexture]


def passthrough_texture(
    data: bytes, profile: str, *, max_side: int = MAX_TEXTURE_SIDE
) -> PreparedTexture:
    mime = sniff_image(data[:32])
    if mime not in ("image/png", "image/jpeg"):
        raise TextureError("texture_type")
    dims = image_dimensions(mime, lambda offset, length: data[offset : offset + length], len(data))
    if dims is None:
        raise TextureError("texture_unreadable")
    width, height = dims
    if width % 4 or height % 4 or width > max_side or height > max_side:
        raise TextureError("texture_needs_resize")
    return PreparedTexture(data=data, mime_type=mime, width=width, height=height)


def _header_size(data: bytes) -> tuple[str, int, int] | None:
    mime = sniff_image(data[:32])
    if mime not in ("image/png", "image/jpeg"):
        return None
    dims = image_dimensions(mime, lambda offset, length: data[offset : offset + length], len(data))
    return (mime, *dims) if dims else None


def pillow_texture(
    data: bytes, profile: str, *, max_side: int = MAX_TEXTURE_SIDE
) -> PreparedTexture:
    """Prepare one texture with Workstream D's glTF texture profiles (`lai_native.image`)."""
    from lai_native.image import ImageError, get_profile, prepare_texture
    from lai_native.image.encode import encode

    head = _header_size(data)
    if head is None:
        raise TextureError("texture_type")
    _mime, width, height = head
    needs_resize = width % 4 or height % 4 or max(width, height) > max_side
    name = "texture-data-gltf" if profile.endswith("-data") else "texture-colour-gltf"
    try:
        options: dict = {"max_side": max_side}
        if needs_resize:
            options["power_of_two"] = True
        prepared = prepare_texture(data, get_profile(name).with_options(**options))
        if prepared.width % 4 or prepared.height % 4:
            raise TextureError("texture_needs_resize")
        encoded = encode(prepared)
    except ImageError as error:
        raise TextureError(f"texture_{error.code}"[:64]) from None
    return PreparedTexture(
        data=encoded.data, mime_type="image/png", width=encoded.width, height=encoded.height
    )


#: name -> preparer. Explicit configuration only (`LAI_KTX2_TEXTURE_PREPARER` in the worker).
PREPARERS: dict[str, PrepareTexture] = {
    "pillow": pillow_texture,
    "passthrough": passthrough_texture,
}


def resolve_preparer(name: str) -> PrepareTexture:
    """The configured preparer. `pillow` needs Pillow installed (`preparer_unavailable`)."""
    if name not in PREPARERS:
        raise TextureError("preparer_unknown")
    if name == "pillow":
        try:
            import PIL  # noqa: F401
        except ImportError:
            raise TextureError("preparer_unavailable") from None
    return PREPARERS[name]
