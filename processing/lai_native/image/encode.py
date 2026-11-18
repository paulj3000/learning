"""Deterministic encoding with explicit, metadata-free save arguments."""

from __future__ import annotations

import hashlib
import io
from dataclasses import dataclass

from ._pil import Image
from .audit import audit_output
from .errors import ImageError
from .limits import MAX_IMAGE_BYTES
from .prepare import PreparedImage

_COLOUR = lambda text: tuple(int(text[i : i + 2], 16) for i in (1, 3, 5))  # noqa: E731


@dataclass(frozen=True, slots=True)
class EncodedImage:
    data: bytes
    format: str
    content_type: str
    width: int
    height: int
    sha256: str
    #: True when the output walk found no metadata (always, or the call raised).
    sanitized: bool

    @property
    def size_bytes(self) -> int:
        return len(self.data)


def _flatten(image: Image.Image, background: str) -> Image.Image:
    base = Image.new("RGB", image.size, _COLOUR(background))
    rgba = image.convert("RGBA") if image.mode in ("LA", "RGBA") else image
    base.paste(rgba, mask=rgba.getchannel("A") if "A" in rgba.mode else None)
    return base


def _target_mode(prepared: PreparedImage) -> Image.Image:
    """The image in a mode its encoder writes natively, with no stray metadata attached."""
    profile, image = prepared.profile, prepared.image
    fmt = profile.output_format
    if fmt == "jpeg":
        if image.mode in ("LA", "RGBA"):
            if image.getchannel("A").getextrema() != (255, 255):
                if profile.flatten_background is None:
                    raise ImageError("alpha_not_supported")
                image = _flatten(image, profile.flatten_background)
            else:
                image = image.convert("L" if image.mode == "LA" else "RGB")
    elif fmt == "webp":
        if image.mode == "L":
            image = image.convert("RGB")
        elif image.mode == "LA":
            image = image.convert("RGBA")
    out = image.copy() if image is prepared.image else image
    out.info = {}
    return out


def encode(prepared: PreparedImage) -> EncodedImage:
    profile = prepared.profile
    fmt = profile.output_format
    image = _target_mode(prepared)
    icc = prepared.icc_profile
    buffer = io.BytesIO()
    if fmt == "png":
        image.save(
            buffer,
            "PNG",
            compress_level=profile.png_compress_level,
            optimize=False,
            icc_profile=icc,
            exif=b"",
        )
    elif fmt == "jpeg":
        image.save(
            buffer,
            "JPEG",
            quality=profile.quality,
            optimize=True,
            progressive=False,
            subsampling="4:2:0" if image.mode == "RGB" else 0,
            icc_profile=icc,
            exif=b"",
        )
    else:
        image.save(
            buffer,
            "WEBP",
            quality=profile.quality,
            lossless=profile.lossless,
            method=4,
            exact=profile.lossless,
            icc_profile=icc,
            exif=b"",
            xmp=b"",
        )
    data = buffer.getvalue()
    if len(data) > MAX_IMAGE_BYTES:
        raise ImageError("output_too_large")
    if audit_output(data, fmt, icc_allowed=icc is not None):
        raise ImageError("output_check_failed")
    return EncodedImage(
        data=data,
        format=fmt,
        content_type=profile.content_type,
        width=image.width,
        height=image.height,
        sha256=hashlib.sha256(data).hexdigest(),
        sanitized=True,
    )
