"""Bounded decoding: sniff from bytes, check every limit before pixels exist, then load."""

from __future__ import annotations

import io
import struct
import warnings
from dataclasses import dataclass, field

from ._pil import Image, ImageOps
from .errors import ImageError
from .limits import MAX_ICC_BYTES, MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS, MAX_IMAGE_SIDE

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
_PIL_FORMAT = {"png": "PNG", "jpeg": "JPEG", "webp": "WEBP"}
_EXIF_ORIENTATION = 0x0112
_EXIF_GPS_IFD = 0x8825


def sniff_format(head: bytes) -> str | None:
    """`png`, `jpeg` or `webp` from the leading bytes only (never a name or content type)."""
    if head.startswith(PNG_SIGNATURE):
        return "png"
    if head.startswith(b"\xff\xd8\xff"):
        return "jpeg"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "webp"
    return None


@dataclass
class DecodedImage:
    """Pixels after decode and orientation, plus value-free facts about the source."""

    image: Image.Image
    format: str
    width: int
    height: int
    icc_profile: bytes | None
    facts: dict = field(default_factory=dict)


def _bit_depth(data: bytes, file_format: str) -> int | None:
    if file_format == "png" and len(data) >= 25 and data[12:16] == b"IHDR":
        return data[24]
    return None


def _png_header_size(data: bytes) -> tuple[int, int] | None:
    if len(data) >= 24 and data[12:16] == b"IHDR":
        return struct.unpack(">II", data[16:24])
    return None


def decode_image(data: bytes, *, first_frame_only: bool = False) -> DecodedImage:
    """Decode `data` to an oriented image, or raise `ImageError`.

    Order: input byte size, format from bytes, Pillow header parse restricted to that format
    (pixel and side limits are checked on the parsed header, before `load()`), animation rule,
    full decode with bomb warnings as errors, decoded size equals header size, orientation.
    """
    if not isinstance(data, (bytes, bytearray)) or not data:
        raise ImageError("malformed_image")
    if len(data) > MAX_IMAGE_BYTES:
        raise ImageError("input_too_large")
    file_format = sniff_format(bytes(data[:16]))
    if file_format is None:
        raise ImageError("unsupported_format")
    # A PNG header can state a size without Pillow parsing anything else: refuse it first.
    if file_format == "png":
        size = _png_header_size(bytes(data))
        if size is not None and (
            size[0] > MAX_IMAGE_SIDE
            or size[1] > MAX_IMAGE_SIDE
            or size[0] * size[1] > MAX_IMAGE_PIXELS
        ):
            raise ImageError("image_too_large")
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        try:
            image = Image.open(io.BytesIO(bytes(data)), formats=[_PIL_FORMAT[file_format]])
            if image.format != _PIL_FORMAT[file_format]:
                raise ImageError("malformed_image")
            width, height = image.size
            if (
                width < 1
                or height < 1
                or width > MAX_IMAGE_SIDE
                or height > MAX_IMAGE_SIDE
                or width * height > MAX_IMAGE_PIXELS
            ):
                raise ImageError("image_too_large")
            frames = int(getattr(image, "n_frames", 1) or 1)
            animated = frames > 1
            if animated and not first_frame_only:
                raise ImageError("animated_not_supported")
            if animated:
                image.seek(0)
            icc = image.info.get("icc_profile")
            if icc is not None and len(icc) > MAX_ICC_BYTES:
                raise ImageError("colour_profile_invalid")
            facts = _source_facts(image, bytes(data[:64]), file_format, animated)
            facts["bitDepth"] = _bit_depth(bytes(data), file_format)
            image.load()
        except ImageError:
            raise
        except (Image.DecompressionBombError, Image.DecompressionBombWarning):
            raise ImageError("image_too_large") from None
        except Exception:  # noqa: BLE001 - every decoder fault is "malformed", never echoed
            raise ImageError("malformed_image") from None
    if image.size != (width, height):
        raise ImageError("malformed_image")
    orientation = facts["orientation"]
    if orientation and orientation != 1:
        try:
            oriented = ImageOps.exif_transpose(image)
        except Exception:  # noqa: BLE001
            raise ImageError("malformed_image") from None
        oriented.info = dict(image.info)
        image = oriented
    return DecodedImage(
        image=image,
        format=file_format,
        width=width,
        height=height,
        icc_profile=icc,
        facts=facts,
    )


def _source_facts(image: Image.Image, head: bytes, file_format: str, animated: bool) -> dict:
    """Presence flags only. Never a value (no coordinates, device names, dates or text)."""
    exif_present = gps_present = False
    orientation = 0
    try:
        exif = image.getexif()
        if exif:
            exif_present = True
            orientation = int(exif.get(_EXIF_ORIENTATION, 0) or 0)
            if orientation not in range(1, 9):
                orientation = 0
            gps_present = bool(exif.get_ifd(_EXIF_GPS_IFD))
    except Exception:  # noqa: BLE001 - unreadable EXIF counts as present, location unknown
        exif_present = True
    info = image.info
    xmp_present = bool(info.get("xmp") or info.get("XML:com.adobe.xmp"))
    return {
        "format": file_format,
        "mode": image.mode,
        "orientation": orientation,
        "animated": animated,
        "exifPresent": exif_present,
        "gpsPresent": gps_present,
        "xmpPresent": xmp_present,
        "iccPresent": bool(info.get("icc_profile")),
        "textPresent": bool(getattr(image, "text", None)) or bool(info.get("comment")),
        "iptcPresent": "photoshop" in info,
    }
