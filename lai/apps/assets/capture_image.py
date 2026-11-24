"""Header facts for a staff thumbnail capture, from the stdlib only (ADR-069).

The browser sends PNG or WebP bytes. The server decides what they are by reading the container
headers, never by the claimed type or file name, and reads the pixel size from the header so a
huge image is refused before anything decodes it. Nothing here decodes pixels.
"""

import struct
from dataclasses import dataclass

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
PNG_END = b"\x00\x00\x00\x00IEND\xaeB`\x82"
MAX_DIMENSION = 1024
MIN_DIMENSION = 64


class BadCapture(Exception):
    """The bytes are not an acceptable capture. `code` and `message` are safe for staff."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class ImageFacts:
    content_type: str
    width: int
    height: int


def _bad_image() -> BadCapture:
    return BadCapture("bad_image", "The capture is not a PNG or WebP image.")


def _png(data: bytes) -> ImageFacts:
    if (
        len(data) < 45
        or data[:8] != PNG_SIGNATURE
        or data[8:12] != b"\x00\x00\x00\x0d"
        or data[12:16] != b"IHDR"
        or data[-12:] != PNG_END
    ):
        raise _bad_image()
    width, height = struct.unpack(">II", data[16:24])
    return ImageFacts("image/png", width, height)


def _webp(data: bytes) -> ImageFacts:
    if len(data) < 30 or data[:4] != b"RIFF" or data[8:12] != b"WEBP":
        raise _bad_image()
    if struct.unpack("<I", data[4:8])[0] + 8 != len(data):
        raise _bad_image()
    kind = data[12:16]
    body = data[20:]
    if kind == b"VP8 ":  # lossy: 3 byte frame tag, start code, 14 bit width and height
        if body[3:6] != b"\x9d\x01\x2a":
            raise _bad_image()
        width, height = struct.unpack("<HH", body[6:10])
        return ImageFacts("image/webp", width & 0x3FFF, height & 0x3FFF)
    if kind == b"VP8L":  # lossless: signature byte, then 14 bit width-1 and height-1
        if body[0] != 0x2F:
            raise _bad_image()
        bits = struct.unpack("<I", body[1:5])[0]
        return ImageFacts("image/webp", (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1)
    if kind == b"VP8X":  # extended: flags, then 24 bit canvas width-1 and height-1
        if body[0] & 0x02:  # animation
            raise BadCapture("bad_image", "Animated images are not accepted.")
        width = int.from_bytes(body[4:7], "little") + 1
        height = int.from_bytes(body[7:10], "little") + 1
        return ImageFacts("image/webp", width, height)
    raise _bad_image()


def read_facts(data: bytes) -> ImageFacts:
    """The image type and size from the header, or `BadCapture`. Squareness and bounds are
    checked by `check_dimensions`."""
    if data[:8] == PNG_SIGNATURE:
        return _png(data)
    if data[:4] == b"RIFF":
        return _webp(data)
    raise _bad_image()


def check_dimensions(facts: ImageFacts) -> None:
    """Square, from 64 to 1024 pixels a side (spec version 1: square output, bounded size)."""
    if facts.width != facts.height:
        raise BadCapture("bad_dimensions", "The capture must be square.")
    if not MIN_DIMENSION <= facts.width <= MAX_DIMENSION:
        raise BadCapture(
            "bad_dimensions",
            f"The capture must be {MIN_DIMENSION} to {MAX_DIMENSION} pixels on each side.",
        )
