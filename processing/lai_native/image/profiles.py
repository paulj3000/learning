"""Immutable, versioned conversion profiles.

A profile says what one output looks like. There are two purposes:

- `artwork`: colours people look at. An embedded ICC profile is converted to sRGB, alpha is
  resized premultiplied (no dark fringes), an opaque alpha channel may be dropped, and a fully
  opaque result may be flattened for JPEG.
- `data`: texture channels that carry numbers (normal, roughness, metallic, ORM, masks). No
  colour transform, no premultiplication, no alpha dropping, no lossy encoder. Channel values
  survive exactly when the image is not resized; a resize filters each band on its own.

A behaviour change is a new `version`. Options (`with_options`) can only narrow within bounds.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, replace

from .errors import ImageError
from .limits import MAX_IMAGE_SIDE

ARTWORK = "artwork"
DATA = "data"
OUTPUT_FORMATS = ("png", "jpeg", "webp")
RESAMPLE = ("lanczos", "bilinear", "box")
_COLOUR = re.compile(r"^#[0-9a-fA-F]{6}$")
_NAME = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
MIN_SIDE = 16
CONTENT_TYPES = {"png": "image/png", "jpeg": "image/jpeg", "webp": "image/webp"}


@dataclass(frozen=True, slots=True)
class ImageProfile:
    name: str
    purpose: str
    output_format: str
    version: int = 1
    max_side: int = MAX_IMAGE_SIDE
    quality: int = 85
    lossless: bool = False
    png_compress_level: int = 6
    #: `#rrggbb` to flatten transparency for JPEG, or None (then alpha into JPEG is refused).
    flatten_background: str | None = None
    #: Embed a standard sRGB profile in an artwork output. Thumbnails stay untagged (untagged
    #: is read as sRGB by browsers and engines, and the profile costs about 0.6 KiB to 3 KiB).
    tag_srgb: bool = False
    #: Animated input: take the first frame (thumbnails) instead of refusing it.
    first_frame_only: bool = False
    #: Round each side down to a power of two after fitting (texture compression).
    power_of_two: bool = False
    resample: str = "lanczos"

    def __post_init__(self) -> None:
        bad = False
        bad |= not _NAME.fullmatch(self.name) or self.purpose not in (ARTWORK, DATA)
        bad |= self.output_format not in OUTPUT_FORMATS or self.resample not in RESAMPLE
        bad |= not (MIN_SIDE <= self.max_side <= MAX_IMAGE_SIDE)
        bad |= not (1 <= self.quality <= 100) or not (0 <= self.png_compress_level <= 9)
        bad |= self.version < 1
        if self.flatten_background is not None:
            bad |= not _COLOUR.fullmatch(self.flatten_background)
        if self.purpose == DATA:
            # Data channels never go through a lossy encoder, a colour transform or a flatten.
            lossy = self.output_format == "jpeg" or (
                self.output_format == "webp" and not self.lossless
            )
            bad |= lossy or self.tag_srgb or self.flatten_background is not None
        if bad:
            raise ImageError("invalid_profile")

    @property
    def content_type(self) -> str:
        return CONTENT_TYPES[self.output_format]

    @property
    def reference(self) -> str:
        return f"{self.name}@{self.version}"

    def with_options(self, **options) -> ImageProfile:
        """A copy with `max_side`, `quality`, `power_of_two`, `flatten_background` or
        `output_format` changed. Anything else is refused. Validation runs again."""
        allowed = {"max_side", "quality", "power_of_two", "flatten_background", "output_format"}
        if set(options) - allowed:
            raise ImageError("invalid_profile")
        if "output_format" in options and options["output_format"] == "webp":
            options.setdefault("lossless", self.purpose == DATA)
        return replace(self, **options)


def _thumb(side: int) -> ImageProfile:
    return ImageProfile(
        name=f"thumbnail-{side}",
        purpose=ARTWORK,
        output_format="webp",
        max_side=side,
        quality=80,
        first_frame_only=True,
    )


_PROFILES = [
    _thumb(128),
    _thumb(256),
    _thumb(512),
    ImageProfile("convert-webp", ARTWORK, "webp", quality=85, tag_srgb=True),
    ImageProfile("convert-webp-lossless", ARTWORK, "webp", lossless=True, tag_srgb=True),
    ImageProfile("convert-png", ARTWORK, "png", tag_srgb=True),
    ImageProfile(
        "convert-jpeg", ARTWORK, "jpeg", quality=88, flatten_background="#ffffff", tag_srgb=True
    ),
    # Data textures: lossless only, no colour transform, band-wise resize.
    ImageProfile("texture-data-png", DATA, "png", resample="box"),
    ImageProfile("texture-data-webp", DATA, "webp", lossless=True, resample="box"),
    ImageProfile("texture-colour-webp", ARTWORK, "webp", quality=90, tag_srgb=True),
]
PROFILES: dict[str, ImageProfile] = {profile.name: profile for profile in _PROFILES}
THUMBNAIL_PROFILES = ("thumbnail-128", "thumbnail-256", "thumbnail-512")


def get_profile(name: object) -> ImageProfile:
    if not isinstance(name, str) or name not in PROFILES:
        raise ImageError("invalid_profile")
    return PROFILES[name]
