"""Synthetic images for the tests, written with Pillow (nothing is read from disk)."""

import io
import struct
import zlib

from PIL import Image, ImageCms, PngImagePlugin

GPS_IFD = 0x8825


def gradient(width=64, height=48, mode="RGB"):
    image = Image.new(mode, (width, height))
    pixels = image.load()
    channels = len(mode)
    for y in range(height):
        for x in range(width):
            value = ((x * 4) % 256, (y * 5) % 256, (x * y) % 256, 255)[:channels]
            pixels[x, y] = value if channels > 1 else value[0]
    return image


def encode(image, fmt, **kwargs):
    buffer = io.BytesIO()
    image.save(buffer, fmt, **kwargs)
    return buffer.getvalue()


def jpeg_with_gps(orientation=1, width=64, height=48):
    exif = Image.Exif()
    exif[0x0112] = orientation
    exif[0x010F] = "SecretMaker"  # Make
    exif[0x0110] = "SecretModel"  # Model
    exif[0x0132] = "2026:01:02 03:04:05"
    gps = exif.get_ifd(GPS_IFD)
    gps[1], gps[2] = "N", (37.0, 46.0, 29.7)
    gps[3], gps[4] = "W", (122.0, 25.0, 9.8)
    return encode(gradient(width, height), "JPEG", exif=exif, quality=90, comment=b"SecretComment")


def png_with_text(width=32, height=32):
    info = PngImagePlugin.PngInfo()
    info.add_text("Author", "SecretAuthor")
    info.add_itxt("XML:com.adobe.xmp", "<x:xmpmeta>SecretXMP</x:xmpmeta>")
    exif = Image.Exif()
    exif[0x010F] = "SecretMaker"
    return encode(gradient(width, height, "RGBA"), "PNG", pnginfo=info, exif=exif)


def webp_with_metadata(width=40, height=30):
    exif = Image.Exif()
    exif[0x010F] = "SecretMaker"
    return encode(
        gradient(width, height, "RGBA"),
        "WEBP",
        exif=exif,
        xmp=b"<x:xmpmeta>SecretXMP</x:xmpmeta>",
        lossless=True,
    )


def wide_gamut_icc():
    """A real RGB profile that is not sRGB: lcms' sRGB profile with Display P3 style primaries
    and a different description (so it is not recognised as sRGB)."""
    raw = bytearray(ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes())
    count = struct.unpack(">I", raw[128:132])[0]
    p3 = {  # D50 adapted P3 primaries
        b"rXYZ": (0.5151, 0.2412, -0.0011),
        b"gXYZ": (0.2919, 0.6922, 0.0419),
        b"bXYZ": (0.1572, 0.0666, 0.7841),
    }
    for index in range(count):
        base = 132 + 12 * index
        sig = bytes(raw[base : base + 4])
        offset, _size = struct.unpack(">II", raw[base + 4 : base + 12])
        if sig in p3:
            raw[offset + 8 : offset + 20] = b"".join(
                struct.pack(">i", round(value * 65536)) for value in p3[sig]
            )
    text = "sRGB".encode("utf-16-be")
    index = bytes(raw).find(text)
    assert index > 0
    raw[index : index + len(text)] = "Wide".encode("utf-16-be")
    return bytes(raw)


def raw_png(width, height, color_type=2, depth=8, idat=b"", extra=b""):
    def chunk(kind, body):
        return (
            struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body))
        )

    header = struct.pack(">IIBBBBB", width, height, depth, color_type, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + extra
        + chunk(b"IDAT", idat or zlib.compress(b"\x00" * 10))
        + chunk(b"IEND", b"")
    )
