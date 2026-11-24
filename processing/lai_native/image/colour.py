"""Colour handling for artwork profiles. Data profiles never call this module."""

from __future__ import annotations

import functools
import io

from ._pil import Image, ImageCms
from .errors import ImageError

_PERCEPTUAL = ImageCms.Intent.PERCEPTUAL


def classify_profile(profile) -> str:
    """A coarse class for reports: `srgb`, `display-p3`, `adobe-rgb` or `other`."""
    try:
        text = (ImageCms.getProfileDescription(profile) or "").lower()
    except ImageCms.PyCMSError:
        return "other"
    if "srgb" in text:
        return "srgb"
    if "display p3" in text or "displayp3" in text:
        return "display-p3"
    if "adobe rgb" in text or "adobergb" in text:
        return "adobe-rgb"
    return "other"


def open_profile(icc: bytes):
    try:
        return ImageCms.ImageCmsProfile(io.BytesIO(icc))
    except Exception:  # noqa: BLE001 - any lcms fault means an unusable profile
        raise ImageError("colour_profile_invalid") from None


@functools.lru_cache(maxsize=1)
def srgb_icc_bytes() -> bytes:
    """A standard sRGB profile with the creation date and profile id cleared, so the same
    code and lcms always embed the same bytes (lcms stamps the current time otherwise)."""
    raw = bytearray(ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes())
    raw[24:36] = bytes(12)  # creation date and time
    raw[84:100] = bytes(16)  # profile id (0 means "not computed")
    return bytes(raw)


def to_srgb(image: Image.Image, icc: bytes | None) -> tuple[Image.Image, dict]:
    """`image` in sRGB values, and what was done (`action`, `profileClass`).

    - no profile or an sRGB profile: values kept (untagged is read as sRGB);
    - an RGB profile of another colour space: perceptual transform to sRGB, alpha untouched;
    - a CMYK image: converted through its profile when it has one, else the naive conversion;
    - grayscale: values kept (a gray profile is ignored, `gray_profile_ignored`).
    """
    if image.mode == "CMYK":
        if icc is None:
            return image.convert("RGB"), {"action": "cmyk_converted", "profileClass": "none"}
        profile = open_profile(icc)
        try:
            converted = ImageCms.profileToProfile(
                image, profile, ImageCms.createProfile("sRGB"), _PERCEPTUAL, outputMode="RGB"
            )
        except Exception:  # noqa: BLE001
            raise ImageError("colour_profile_invalid") from None
        return converted, {"action": "cmyk_converted", "profileClass": classify_profile(profile)}
    if icc is None:
        return image, {"action": "none", "profileClass": "none"}
    profile = open_profile(icc)
    kind = classify_profile(profile)
    if image.mode in ("L", "LA"):
        return image, {"action": "gray_profile_ignored", "profileClass": kind}
    if kind == "srgb":
        return image, {"action": "assumed_srgb", "profileClass": kind}
    if image.mode not in ("RGB", "RGBA"):
        raise ImageError("colour_mode_not_supported")
    try:
        alpha = image.getchannel("A") if image.mode == "RGBA" else None
        rgb = image.convert("RGB") if alpha is not None else image
        converted = ImageCms.profileToProfile(
            rgb, profile, ImageCms.createProfile("sRGB"), _PERCEPTUAL, outputMode="RGB"
        )
    except Exception:  # noqa: BLE001
        raise ImageError("colour_profile_invalid") from None
    if alpha is not None:
        converted.putalpha(alpha)
    return converted, {"action": "converted_to_srgb", "profileClass": kind}
