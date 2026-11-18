"""Pillow image conversion (ADR-068). Native code lives here, never in `lai_processing`.

Public API:

- `decode_image(data)`, `prepare_texture(data_or_decoded, profile) -> PreparedImage`: resize and
  colour handling by profile, returning pixels (reused by KTX2 texture preparation).
- `encode(prepared) -> EncodedImage`, `convert_image(data, profile)`, `convert_many(data,
  profiles) -> ConversionReport`.
- `PROFILES`, `get_profile(name)`, `ImageProfile`, `ImageError`.

Requires Pillow (`native/pillow/`); importing without it raises `ImageError("pillow_unavailable")`.
Import allowlist (checked by `tests/native_image/test_import_allowlist.py`): standard library,
`PIL`, and this package.
"""

from .audit import audit_output
from .convert import ConversionReport, ConvertedOutput, convert_image, convert_many
from .decode import DecodedImage, decode_image, sniff_format
from .encode import EncodedImage, encode
from .errors import ImageError
from .limits import MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS, MAX_IMAGE_SIDE
from .prepare import PreparedImage, prepare_texture
from .profiles import PROFILES, THUMBNAIL_PROFILES, ImageProfile, get_profile

__all__ = [
    "ConversionReport",
    "ConvertedOutput",
    "DecodedImage",
    "EncodedImage",
    "ImageError",
    "ImageProfile",
    "MAX_IMAGE_BYTES",
    "MAX_IMAGE_PIXELS",
    "MAX_IMAGE_SIDE",
    "PROFILES",
    "PreparedImage",
    "THUMBNAIL_PROFILES",
    "audit_output",
    "convert_image",
    "convert_many",
    "decode_image",
    "encode",
    "get_profile",
    "prepare_texture",
    "sniff_format",
]
