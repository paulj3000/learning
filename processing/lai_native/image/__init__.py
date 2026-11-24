"""Pillow image conversion (ADR-068). Native code lives here, never in `lai_processing`.

Public API (imported lazily, so `lai_native.image.contract`, `profiles` and `limits` can be used
without Pillow, for example by Django, which only needs the contract declarations):

- `decode_image(data)`, `prepare_texture(data_or_decoded, profile) -> PreparedImage`: resize and
  colour handling by profile, returning pixels (reused by KTX2 texture preparation).
- `encode(prepared) -> EncodedImage`, `convert_image(data, profile)`, `convert_many(data,
  profiles) -> ConversionReport`, `convert_decoded(decoded, profiles)`.
- `PROFILES`, `get_profile(name)`, `ImageProfile`, `ImageError`.

Requires Pillow (`native/pillow/`) for everything except `contract`, `profiles`, `limits`,
`errors`: the Pillow modules raise `ImageError("pillow_unavailable")` when it is missing.
"""

from importlib import import_module

_EXPORTS = {
    "ConversionReport": "convert",
    "ConvertedOutput": "convert",
    "convert_image": "convert",
    "convert_many": "convert",
    "convert_decoded": "convert",
    "source_facts": "convert",
    "DecodedImage": "decode",
    "decode_image": "decode",
    "sniff_format": "decode",
    "EncodedImage": "encode",
    "encode": "encode",
    "audit_output": "audit",
    "ImageError": "errors",
    "MAX_IMAGE_BYTES": "limits",
    "MAX_IMAGE_PIXELS": "limits",
    "MAX_IMAGE_SIDE": "limits",
    "PreparedImage": "prepare",
    "prepare_texture": "prepare",
    "PROFILES": "profiles",
    "THUMBNAIL_PROFILES": "profiles",
    "ImageProfile": "profiles",
    "get_profile": "profiles",
}
__all__ = sorted(_EXPORTS)


def __getattr__(name: str):
    module = _EXPORTS.get(name)
    if module is None:
        raise AttributeError(name)
    value = getattr(import_module(f"{__name__}.{module}"), name)
    globals()[name] = value
    return value
