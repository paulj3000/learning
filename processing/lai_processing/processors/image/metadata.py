"""Bounded presence scanner for embedded image metadata (PNG, JPEG, WebP).

Purpose: tell staff, and later the image conversion planner, whether an image carries location
or other personal metadata, so that it can be warned about or stripped. The scanner:

- reads the file only through a ``read(offset, length)`` callable, in bounded pieces;
- walks container structure (JPEG segments, PNG chunks, RIFF chunks) with a hard step limit;
- reads at most ``MAX_EXIF_BYTES`` of an EXIF block and ``MAX_XMP_BYTES`` of an XMP packet;
- never decodes pixels, never raises on hostile input (problems become flags), and never
  returns a metadata value: only booleans and the EXIF orientation number (1 to 8).

It does not validate the image (``lai/apps/assets/validation_media.py`` does) and it does not
verify checksums; a malformed file simply yields fewer facts and ``truncated`` or
``exif_unparsable``.
"""

from __future__ import annotations

import struct
from collections.abc import Callable
from dataclasses import dataclass
from typing import Final

__all__ = ["ImageMetadataFacts", "scan_image_metadata", "scan_image_metadata_bytes"]

Reader = Callable[[int, int], bytes]

PNG_SIGNATURE: Final = b"\x89PNG\r\n\x1a\n"
MAX_STEPS: Final = 100_000
MAX_EXIF_BYTES: Final = 1024 * 1024
MAX_XMP_BYTES: Final = 1024 * 1024
MAX_IFD_ENTRIES: Final = 1024

_EXIF_APP1: Final = b"Exif\x00\x00"
_XMP_APP1: Final = b"http://ns.adobe.com/xap/1.0/\x00"
_XMP_EXT_APP1: Final = b"http://ns.adobe.com/xmp/extension/\x00"
_ICC_APP2: Final = b"ICC_PROFILE\x00"
_IPTC_APP13: Final = b"Photoshop 3.0\x00"
_PNG_XMP_KEYWORD: Final = b"XML:com.adobe.xmp"

TAG_ORIENTATION: Final = 0x0112
TAG_GPS_POINTER: Final = 0x8825
GPS_TAG_LATITUDE: Final = 0x0002
GPS_TAG_LONGITUDE: Final = 0x0004
_TYPE_SIZES: Final = {1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8}


@dataclass(frozen=True, slots=True)
class ImageMetadataFacts:
    """Presence facts only. No field ever holds a coordinate, device name or timestamp."""

    format: str | None = None
    exif_present: bool = False
    #: A GPS IFD pointer exists in the EXIF data (position, altitude, time or other GPS tags).
    gps_present: bool = False
    #: The GPS IFD holds latitude and longitude tags, or the XMP names them.
    location_present: bool = False
    xmp_present: bool = False
    icc_present: bool = False
    iptc_present: bool = False
    #: PNG tEXt, zTXt, iTXt (other than XMP) or a JPEG COM segment.
    text_present: bool = False
    #: EXIF orientation 1 to 8, or None when absent or unreadable.
    orientation: int | None = None
    #: EXIF was found but its structure could not be read; GPS presence is then unknown.
    exif_unparsable: bool = False
    #: The step limit was reached or the file ended inside a structure.
    truncated: bool = False

    @property
    def any_metadata(self) -> bool:
        return (
            self.exif_present
            or self.xmp_present
            or self.icc_present
            or self.iptc_present
            or self.text_present
        )

    @property
    def location_possible(self) -> bool:
        """True when location may be embedded: a GPS tag, XMP GPS, or unreadable EXIF."""
        return self.gps_present or self.location_present or self.exif_unparsable

    def as_flags(self) -> dict[str, object]:
        """The safe, value-free shape used in results: camelCase booleans and the orientation."""
        return {
            "exifPresent": self.exif_present,
            "gpsPresent": self.gps_present or self.location_present,
            "xmpPresent": self.xmp_present,
            "iccPresent": self.icc_present,
            "iptcPresent": self.iptc_present,
            "textPresent": self.text_present,
            "orientation": self.orientation,
            "exifUnparsable": self.exif_unparsable,
        }


class _State:
    def __init__(self) -> None:
        self.exif = False
        self.gps = False
        self.location = False
        self.xmp = False
        self.icc = False
        self.iptc = False
        self.text = False
        self.orientation: int | None = None
        self.exif_unparsable = False
        self.truncated = False

    def facts(self, fmt: str | None) -> ImageMetadataFacts:
        return ImageMetadataFacts(
            format=fmt,
            exif_present=self.exif,
            gps_present=self.gps,
            location_present=self.location,
            xmp_present=self.xmp,
            icc_present=self.icc,
            iptc_present=self.iptc,
            text_present=self.text,
            orientation=self.orientation,
            exif_unparsable=self.exif_unparsable,
            truncated=self.truncated,
        )


def scan_image_metadata_bytes(data: bytes) -> ImageMetadataFacts:
    def read(offset: int, length: int) -> bytes:
        return data[offset : offset + length] if offset >= 0 and length > 0 else b""

    return scan_image_metadata(read, len(data))


def scan_image_metadata(read: Reader, size: int) -> ImageMetadataFacts:
    """Scan one image. Never raises; format is sniffed from the leading bytes."""
    state = _State()
    fmt: str | None = None
    try:
        head = read(0, 12)
        if head.startswith(PNG_SIGNATURE):
            fmt = "png"
            _scan_png(read, size, state)
        elif head.startswith(b"\xff\xd8\xff"):
            fmt = "jpeg"
            _scan_jpeg(read, size, state)
        elif head[:4] == b"RIFF" and head[8:12] == b"WEBP":
            fmt = "webp"
            _scan_webp(read, size, state)
    except (struct.error, ValueError, OverflowError, IndexError):  # pragma: no cover - defensive
        state.truncated = True
    return state.facts(fmt)


# --- containers --------------------------------------------------------------------------------


def _scan_jpeg(read: Reader, size: int, state: _State) -> None:
    offset = 2
    for _ in range(MAX_STEPS):
        head = read(offset, 4)
        if len(head) < 2 or head[0] != 0xFF:
            state.truncated = True
            return
        marker = head[1]
        if marker == 0xFF:  # fill byte
            offset += 1
            continue
        if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:  # standalone markers
            offset += 2
            continue
        if marker == 0xD9:  # EOI
            return
        if len(head) < 4:
            state.truncated = True
            return
        length = struct.unpack(">H", head[2:4])[0]
        if length < 2 or offset + 2 + length > size:
            state.truncated = True
            return
        body_start, body_len = offset + 4, length - 2
        if marker == 0xE1:
            _jpeg_app1(read, body_start, body_len, state)
        elif marker == 0xE2:
            if read(body_start, len(_ICC_APP2)) == _ICC_APP2:
                state.icc = True
        elif marker == 0xED:
            if read(body_start, len(_IPTC_APP13)) == _IPTC_APP13:
                state.iptc = True
        elif marker == 0xFE:
            state.text = True
        if marker == 0xDA:  # start of scan: metadata segments precede image data
            return
        offset += 2 + length
    state.truncated = True


def _jpeg_app1(read: Reader, start: int, length: int, state: _State) -> None:
    lead = read(start, max(len(_XMP_EXT_APP1), len(_XMP_APP1)))
    if lead.startswith(_EXIF_APP1):
        _exif(read, start + len(_EXIF_APP1), length - len(_EXIF_APP1), state)
    elif lead.startswith(_XMP_APP1):
        _xmp(read, start + len(_XMP_APP1), length - len(_XMP_APP1), state)
    elif lead.startswith(_XMP_EXT_APP1):
        state.xmp = True  # extension packets are fragments; presence is enough


def _scan_png(read: Reader, size: int, state: _State) -> None:
    offset = len(PNG_SIGNATURE)
    for _ in range(MAX_STEPS):
        head = read(offset, 8)
        if len(head) < 8:
            state.truncated = True
            return
        length, kind = struct.unpack(">I4s", head)
        end = offset + 12 + length
        if end > size:
            state.truncated = True
            return
        body = offset + 8
        if kind == b"eXIf":
            _exif(read, body, length, state)
        elif kind == b"iCCP":
            state.icc = True
        elif kind in (b"tEXt", b"zTXt"):
            if read(body, len(_PNG_XMP_KEYWORD) + 1).startswith(_PNG_XMP_KEYWORD + b"\x00"):
                state.xmp = True  # legacy XMP in tEXt/zTXt; compressed text is not searched
            else:
                state.text = True
        elif kind == b"iTXt":
            if read(body, len(_PNG_XMP_KEYWORD) + 1) == _PNG_XMP_KEYWORD + b"\x00":
                _png_xmp(read, body, length, state)
            else:
                state.text = True
        if kind == b"IEND":
            return
        offset = end
    state.truncated = True


def _png_xmp(read: Reader, body: int, length: int, state: _State) -> None:
    state.xmp = True
    # iTXt: keyword NUL, compression flag, method, language NUL, translated keyword NUL, text.
    prefix = read(body, min(length, 256))
    flag_at = len(_PNG_XMP_KEYWORD) + 1
    if len(prefix) <= flag_at + 1 or prefix[flag_at] != 0:
        return  # compressed text is not searched
    _search_xmp(read, body, length, state)


def _scan_webp(read: Reader, size: int, state: _State) -> None:
    offset = 12
    for _ in range(MAX_STEPS):
        head = read(offset, 8)
        if len(head) < 8:
            if offset < size:
                state.truncated = True
            return
        kind, length = head[:4], struct.unpack("<I", head[4:8])[0]
        body = offset + 8
        if body + length > size:
            state.truncated = True
            return
        if kind == b"EXIF":
            payload = read(body, min(length, 6))
            skip = 6 if payload.startswith(_EXIF_APP1) else 0
            _exif(read, body + skip, length - skip, state)
        elif kind == b"XMP ":
            _xmp(read, body, length, state)
        elif kind == b"ICCP":
            state.icc = True
        offset = body + length + (length & 1)
    state.truncated = True


# --- EXIF and XMP ------------------------------------------------------------------------------


def _xmp(read: Reader, start: int, length: int, state: _State) -> None:
    state.xmp = True
    _search_xmp(read, start, length, state)


def _search_xmp(read: Reader, start: int, length: int, state: _State) -> None:
    packet = read(start, min(max(length, 0), MAX_XMP_BYTES))
    if b"GPSLatitude" in packet or b"GPSLongitude" in packet:
        state.location = True


def _exif(read: Reader, start: int, length: int, state: _State) -> None:
    state.exif = True
    if length < 8 or length > MAX_EXIF_BYTES:
        state.exif_unparsable = True
        return
    tiff = read(start, length)
    if len(tiff) < 8 or tiff[:4] not in (b"II*\x00", b"MM\x00*"):
        state.exif_unparsable = True
        return
    order = "<" if tiff[:2] == b"II" else ">"
    try:
        first = struct.unpack_from(order + "I", tiff, 4)[0]
        entries = _ifd(tiff, first, order)
        if entries is None:
            state.exif_unparsable = True
            return
        orientation = entries.get(TAG_ORIENTATION)
        if orientation is not None and orientation[0] == 3 and 1 <= orientation[1] <= 8:
            state.orientation = orientation[1]
        pointer = entries.get(TAG_GPS_POINTER)
        if pointer is None:
            return
        state.gps = True  # the pointer alone is enough to say GPS data is present
        gps = _ifd(tiff, pointer[1], order)
        if gps is None:
            state.exif_unparsable = True
            return
        if GPS_TAG_LATITUDE in gps and GPS_TAG_LONGITUDE in gps:
            state.location = True
    except struct.error:
        state.exif_unparsable = True


def _ifd(tiff: bytes, offset: int, order: str) -> dict[int, tuple[int, int]] | None:
    """Tag -> (type, first value) for one IFD, or None when it is out of bounds."""
    if offset < 8 or offset + 2 > len(tiff):
        return None
    (count,) = struct.unpack_from(order + "H", tiff, offset)
    if count > MAX_IFD_ENTRIES or offset + 2 + count * 12 > len(tiff):
        return None
    out: dict[int, tuple[int, int]] = {}
    for index in range(count):
        tag, kind, items = struct.unpack_from(order + "HHI", tiff, offset + 2 + index * 12)
        if kind not in _TYPE_SIZES:
            continue
        value_at = offset + 2 + index * 12 + 8
        value = 0
        if kind == 3 and items >= 1:
            value = struct.unpack_from(order + "H", tiff, value_at)[0]
        elif kind in (4, 9) and items >= 1:
            value = struct.unpack_from(order + "I", tiff, value_at)[0]
        out[tag] = (kind, value)
    return out
