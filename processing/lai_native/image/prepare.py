"""Pixels to the shape a profile asks for: mode, resize, alpha and colour.

`prepare_texture(data, profile)` is the entry point other workloads reuse (for example KTX2
texture preparation): it returns pixels, not encoded bytes, so a texture compressor can take the
resized, colour-correct (or exactly preserved) image directly.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ._pil import Image
from .colour import srgb_icc_bytes, to_srgb
from .decode import DecodedImage, decode_image
from .errors import ImageError
from .profiles import ARTWORK, DATA, ImageProfile

_RESAMPLE = {
    "lanczos": Image.Resampling.LANCZOS,
    "bilinear": Image.Resampling.BILINEAR,
    "box": Image.Resampling.BOX,
}


@dataclass
class PreparedImage:
    """An image ready to encode (or to hand to a texture compressor). Holds a PIL image."""

    image: Image.Image
    profile: ImageProfile
    width: int
    height: int
    mode: str
    #: ICC bytes to embed when the profile tags sRGB (artwork only), else None.
    icc_profile: bytes | None
    plan: dict = field(default_factory=dict)
    findings: list = field(default_factory=list)

    @property
    def has_alpha(self) -> bool:
        return self.mode in ("LA", "RGBA")

    def pixel_bytes(self) -> bytes:
        """Raw interleaved channel bytes (row-major, 8 bits per channel)."""
        return self.image.tobytes()


def _fit(width: int, height: int, profile: ImageProfile) -> tuple[int, int]:
    """Fit inside `max_side` x `max_side`, keep the aspect ratio, never upscale."""
    longest = max(width, height)
    if longest <= profile.max_side:
        new = (width, height)
    else:
        scale = profile.max_side / longest
        new = (max(1, round(width * scale)), max(1, round(height * scale)))
    if profile.power_of_two:
        new = tuple(1 << (side.bit_length() - 1) for side in new)
    return new


def _normalise_mode(decoded: DecodedImage, profile: ImageProfile) -> Image.Image:
    image = decoded.image
    mode = image.mode
    has_key = "transparency" in image.info
    if mode == "P" or mode == "PA":
        return image.convert("RGBA" if (has_key or mode == "PA") else "RGB")
    if has_key and mode in ("L", "RGB"):
        return image.convert("RGBA" if mode == "RGB" else "LA")
    if mode == "1":
        return image.convert("L")
    if mode in ("L", "LA", "RGB", "RGBA"):
        return image
    if mode == "CMYK":
        if profile.purpose == DATA:
            raise ImageError("colour_mode_not_supported")
        return image
    if mode.startswith("I") or mode == "F":
        # 16-bit grayscale PNG: kept exactly only by not existing as a data texture here.
        if profile.purpose == DATA:
            raise ImageError("bit_depth_not_supported")
        return image.point(lambda value: value / 256).convert("L")
    return image.convert("RGBA" if "A" in mode else "RGB")


def _resize(image: Image.Image, size: tuple[int, int], profile: ImageProfile) -> Image.Image:
    if image.size == size:
        return image
    method = _RESAMPLE[profile.resample]
    if profile.purpose == DATA:
        # Band by band: Pillow premultiplies RGBA while resizing, which would change the colour
        # channels under alpha. Channels in a data texture are independent numbers.
        bands = [band.resize(size, method) for band in image.split()]
        return Image.merge(image.mode, bands)
    return image.resize(size, method, reducing_gap=2.0)


def prepare_texture(source: bytes | DecodedImage, profile: ImageProfile) -> PreparedImage:
    """Decode (when given bytes), resize and apply the profile's colour and alpha rules."""
    decoded = (
        source
        if isinstance(source, DecodedImage)
        else decode_image(source, first_frame_only=profile.first_frame_only)
    )
    findings: list[str] = []
    plan: dict = {"orientationApplied": decoded.facts.get("orientation") or 0}
    depth = decoded.facts.get("bitDepth")
    if depth == 16:
        if profile.purpose == DATA:
            raise ImageError("bit_depth_not_supported")
        findings.append("bit_depth_reduced")
    image = _normalise_mode(decoded, profile)
    target = _fit(*image.size, profile)
    plan["resized"] = target != decoded.image.size
    plan["resampling"] = profile.resample if target != image.size else "none"
    image = _resize(image, target, profile)

    if profile.purpose == ARTWORK:
        image, colour = to_srgb(image, decoded.icc_profile)
        if image.mode == "RGBA" and image.getchannel("A").getextrema() == (255, 255):
            image = image.convert("RGB")
            plan["alphaAction"] = "dropped_opaque"
        elif image.mode == "LA" and image.getchannel("A").getextrema() == (255, 255):
            image = image.convert("L")
            plan["alphaAction"] = "dropped_opaque"
        if colour["action"] == "cmyk_converted":
            findings.append("cmyk_converted")
        if colour["action"] == "gray_profile_ignored":
            findings.append("gray_profile_ignored")
    else:
        colour = {
            "action": "none_data",
            "profileClass": "dropped" if decoded.icc_profile else "none",
        }
        # Channels are never premultiplied, dropped or transformed.
    plan["colour"] = colour
    plan.setdefault("alphaAction", "kept" if image.mode in ("LA", "RGBA") else "none")
    return PreparedImage(
        image=image,
        profile=profile,
        width=image.width,
        height=image.height,
        mode=image.mode,
        icc_profile=srgb_icc_bytes() if profile.tag_srgb and profile.purpose == ARTWORK else None,
        plan=plan,
        findings=findings,
    )
