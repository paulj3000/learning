"""The texture preparation seam: Workstream D's image module, not a second resize subsystem.

Workstream D owns image conversion and resizing (`processing/lai_native/image/`, branch
`feature/lambda-image-conversion`, ADR-068). The KTX2 step only needs one call from it:

    prepare_texture(data: bytes, profile: str) -> PreparedTexture

which returns an image toktx can read (PNG or JPEG) whose sides are multiples of 4 and within the
profile's cap, with sensitive metadata stripped. Until D lands, `passthrough_texture` is used: it
reads the dimensions from the header (stdlib `lai_processing` helper), refuses anything that would
need a resize (`texture_needs_resize`) and never re-encodes. At integration the principal passes
D's function as `prepare=` (or binds it here); no other code changes.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from lai_processing.processors.gltf.images import image_dimensions, sniff_image

__all__ = ["PreparedTexture", "PrepareTexture", "TextureError", "passthrough_texture"]


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


def passthrough_texture(data: bytes, profile: str, *, max_side: int = 4096) -> PreparedTexture:
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
