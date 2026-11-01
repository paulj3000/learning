"""Checks and cleans an uploaded child photo before it is stored (LAI-0904, ADR-042).

The upload contract (docs/platform/CHILD_PHOTO_STORAGE.md section 4): one baseline or progressive
8-bit JPEG, already cropped and downsized by the client (React draws a 256 px square through a
canvas; Android must do the same). The server does not trust that:

- the declared type must be `image/jpeg`, and the bytes must parse as a complete JPEG stream:
  start of image, quantization and Huffman tables, exactly one frame header, at least one scan,
  end of image, and nothing after it (no polyglot or appended payload);
- the frame must be 8-bit, 1 or 3 components, within `LAI_CHILD_PHOTO_MAX_DIMENSION` each side;
- every metadata segment is removed: EXIF and XMP (APP1, where GPS coordinates and camera serial
  numbers live), ICC profiles, IPTC, maker notes, comments, and any JFIF thumbnail. Only a bare
  JFIF header and an Adobe colour-transform marker are kept, because they hold no personal data
  and change how the pixels decode.

Parsing is pure Python over at most `LAI_CHILD_PHOTO_MAX_BYTES` bytes: no image library and no
native decoder runs on untrusted input in the API process. The pixels themselves are not decoded,
so the check is structural; the client re-encode is what produces the pixels.
"""

from dataclasses import dataclass

ACCEPTED_CONTENT_TYPES = frozenset({"image/jpeg"})

_SOI, _EOI, _SOS = 0xD8, 0xD9, 0xDA
_DQT, _DHT, _DRI = 0xDB, 0xC4, 0xDD
_APP0, _APP14, _COM = 0xE0, 0xEE, 0xFE
_SOF_SUPPORTED = frozenset({0xC0, 0xC1, 0xC2})  # baseline, extended sequential, progressive
_RESTART = range(0xD0, 0xD8)


class PhotoRejected(Exception):
    """The upload is not an acceptable photo. `code` is a stable, client-safe error code."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class CleanPhoto:
    data: bytes
    width: int
    height: int


def check_content_type(content_type: str) -> None:
    media_type = (content_type or "").split(";", 1)[0].strip().lower()
    if media_type not in ACCEPTED_CONTENT_TYPES:
        raise PhotoRejected("photo_type_unsupported")


def clean_jpeg(data: bytes, *, max_dimension: int) -> CleanPhoto:
    """The JPEG with every metadata segment removed, or `PhotoRejected`."""
    if len(data) < 4 or data[0] != 0xFF or data[1] != _SOI:
        raise PhotoRejected("photo_type_unsupported")
    invalid = PhotoRejected("photo_invalid")
    out = bytearray(b"\xff\xd8")
    pos, end = 2, len(data)
    frame: tuple[int, int] | None = None
    has_quant = has_huffman = False
    scans = 0
    while True:
        if pos >= end or data[pos] != 0xFF:
            raise invalid
        while pos < end and data[pos] == 0xFF:  # fill bytes before a marker
            pos += 1
        if pos >= end:
            raise invalid
        marker = data[pos]
        pos += 1
        if marker == _EOI:
            if scans == 0 or pos != end:  # no image data, or bytes hidden after the image
                raise invalid
            out += b"\xff\xd9"
            break
        if marker in (0x00, 0x01, _SOI) or marker in _RESTART:
            raise invalid
        if pos + 2 > end:
            raise invalid
        length = int.from_bytes(data[pos : pos + 2], "big")
        if length < 2 or pos + length > end:
            raise invalid
        payload = data[pos + 2 : pos + length]
        segment = bytes((0xFF, marker)) + data[pos : pos + length]
        pos += length

        if marker in _SOF_SUPPORTED:
            frame = _frame(payload, frame, max_dimension)
            out += segment
        elif marker in (_DQT, _DHT, _DRI):
            has_quant = has_quant or marker == _DQT
            has_huffman = has_huffman or marker == _DHT
            out += segment
        elif marker == _APP0:
            # Keep a bare JFIF header (16 bytes, no thumbnail); drop JFXX and anything else.
            if len(payload) == 14 and payload[:5] == b"JFIF\x00" and payload[12:14] == b"\0\0":
                out += segment
        elif marker == _APP14:
            if len(payload) == 12 and payload[:5] == b"Adobe":  # colour transform flag only
                out += segment
        elif 0xE1 <= marker <= 0xEF or marker == _COM:
            pass  # EXIF, XMP, ICC, IPTC, maker notes, comments: never stored
        elif marker == _SOS:
            if frame is None or not has_quant or not has_huffman or not _scan_header_ok(payload):
                raise invalid
            out += segment
            scans += 1
            start = pos
            pos = _end_of_entropy_data(data, pos)
            if pos == start:
                raise invalid
            out += data[start:pos]
        else:
            # Lossless, hierarchical and arithmetic-coded frames, DNL, reserved markers.
            raise PhotoRejected("photo_type_unsupported")
    if frame is None:  # unreachable: a scan requires a frame
        raise invalid
    return CleanPhoto(bytes(out), width=frame[0], height=frame[1])


def _frame(payload: bytes, seen, max_dimension: int) -> tuple[int, int]:
    if seen is not None or len(payload) < 6:
        raise PhotoRejected("photo_invalid")
    precision = payload[0]
    height = int.from_bytes(payload[1:3], "big")
    width = int.from_bytes(payload[3:5], "big")
    components = payload[5]
    if precision != 8 or components not in (1, 3) or len(payload) != 6 + 3 * components:
        raise PhotoRejected("photo_invalid")
    if not (1 <= width <= max_dimension and 1 <= height <= max_dimension):
        raise PhotoRejected("photo_dimensions")
    return width, height


def _scan_header_ok(payload: bytes) -> bool:
    if not payload:
        return False
    count = payload[0]
    return 1 <= count <= 4 and len(payload) == 1 + 2 * count + 3


def _end_of_entropy_data(data: bytes, pos: int) -> int:
    """Where a scan's entropy-coded bytes end (stuffed zero bytes and RSTn are skipped)."""
    end = len(data)
    while True:
        index = data.find(b"\xff", pos)
        if index < 0 or index + 1 >= end:
            raise PhotoRejected("photo_invalid")  # truncated: the scan never ends
        following = data[index + 1]
        if following == 0x00 or following in _RESTART:
            pos = index + 2
            continue
        return index
