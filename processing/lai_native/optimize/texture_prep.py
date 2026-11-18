"""The texture preparation seam: Workstream D's image module, not a second resize subsystem.

The KTX2 step calls `prepare(data, name) -> PreparedTexture`, where `name` is `ktx2-color` or
`ktx2-data`, and gets back an image toktx can read (PNG or JPEG) whose sides are multiples of 4
and within the cap.

- `pillow_texture` (the production preparer) adapts Workstream D's
  `lai_native.image.prepare_texture` (ADR-068): decode with D's limits, colour-correct artwork to
  sRGB, never transform data channels, drop metadata, and, only when a side is not a multiple of
  4 or is above the cap, resize with D's `power_of_two` fit (rounding down; never upscaling).
  D's `PreparedImage` is encoded with D's lossless PNG encoder into a `PreparedTexture`.
- `passthrough_texture` is the stand-in for environments without Pillow (unit tests): it reads
  the dimensions from the header, refuses anything that needs a resize (`texture_needs_resize`)
  and never re-encodes.

`default_preparer()` picks `pillow_texture` when Pillow is importable, else the stand-in.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from lai_processing.processors.gltf.images import image_dimensions, sniff_image

__all__ = [
    "PreparedTexture",
    "PrepareTexture",
    "TextureError",
    "default_preparer",
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
    """Prepare one texture with Workstream D's module (`lai_native.image`)."""
    from lai_native.image import ImageError, prepare_texture
    from lai_native.image.encode import encode
    from lai_native.image.profiles import ARTWORK, DATA, ImageProfile

    head = _header_size(data)
    if head is None:
        raise TextureError("texture_type")
    _mime, width, height = head
    needs_resize = width % 4 or height % 4 or max(width, height) > max_side
    data_texture = profile.endswith("-data")
    try:
        image_profile = ImageProfile(
            profile if profile in ("ktx2-color", "ktx2-data") else "ktx2-color",
            DATA if data_texture else ARTWORK,
            "png",
            max_side=max_side,
            power_of_two=bool(needs_resize),
            resample="box" if data_texture else "lanczos",
        )
        prepared = prepare_texture(data, image_profile)
        if prepared.width % 4 or prepared.height % 4:
            raise TextureError("texture_needs_resize")
        encoded = encode(prepared)
    except ImageError as error:
        raise TextureError(f"texture_{error.code}"[:64]) from None
    return PreparedTexture(
        data=encoded.data, mime_type="image/png", width=encoded.width, height=encoded.height
    )


def default_preparer() -> PrepareTexture:
    """D's preparer when Pillow is installed (the optimize worker), else the stand-in."""
    try:
        import PIL  # noqa: F401
    except ImportError:
        return passthrough_texture
    return pillow_texture
