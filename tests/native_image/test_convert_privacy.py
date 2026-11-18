"""Outputs carry no EXIF, GPS, XMP, IPTC, comments, text, thumbnails or device ids."""

import pytest

pytest.importorskip("PIL")

import io  # noqa: E402

from builders import jpeg_with_gps, png_with_text, webp_with_metadata  # noqa: E402
from PIL import Image  # noqa: E402

from lai_native.image import PROFILES, audit_output, convert_image, get_profile  # noqa: E402

SECRETS = [
    b"SecretMaker",
    b"SecretModel",
    b"SecretComment",
    b"SecretAuthor",
    b"SecretXMP",
    b"2026:01:02",
]
MARKERS = [
    b"Exif",
    b"GPS",
    b"http://ns.adobe.com",
    b"xmpmeta",
    b"Photoshop",
    b"eXIf",
    b"tEXt",
    b"iTXt",
    b"zTXt",
]
SOURCES = {
    "jpeg": jpeg_with_gps,
    "png": png_with_text,
    "webp": webp_with_metadata,
}
# the artwork profiles that tag sRGB legitimately contain an ICC profile whose bytes include the
# word "sRGB"; none of the markers above can appear in it.


def test_the_fixtures_really_carry_the_secrets():
    assert b"SecretMaker" in jpeg_with_gps()
    assert b"SecretAuthor" in png_with_text()
    assert b"SecretXMP" in webp_with_metadata()
    exif = Image.open(io.BytesIO(jpeg_with_gps())).getexif()
    assert exif.get_ifd(0x8825)  # GPS present in the source


@pytest.mark.parametrize("source", sorted(SOURCES))
@pytest.mark.parametrize("name", sorted(PROFILES))
def test_no_metadata_survives(source, name):
    out = convert_image(SOURCES[source](), get_profile(name))
    data = out.image.data
    for needle in SECRETS + MARKERS:
        assert needle not in data, (source, name, needle)
    image = Image.open(io.BytesIO(data))
    image.load()
    assert len(image.getexif()) == 0
    assert not image.getexif().get_ifd(0x8825)
    for key in ("exif", "xmp", "comment", "XML:com.adobe.xmp", "photoshop"):
        assert key not in image.info, key
    assert not getattr(image, "text", None)
    # Pillow reads the thumbnail of a JPEG through its MPO/APP segments: none are written.
    assert audit_output(data, out.image.format, icc_allowed=get_profile(name).tag_srgb) == []


def test_png_has_only_plain_chunks_and_jpeg_has_no_app1():
    png = convert_image(png_with_text(), get_profile("texture-data-png")).image.data
    kinds, position = [], 8
    while position < len(png):
        length = int.from_bytes(png[position : position + 4], "big")
        kinds.append(png[position + 4 : position + 8])
        position += 12 + length
    assert set(kinds) <= {b"IHDR", b"PLTE", b"tRNS", b"IDAT", b"IEND"}
    jpeg = convert_image(jpeg_with_gps(), get_profile("convert-jpeg")).image.data
    assert b"\xff\xe1" not in jpeg[:200] and b"\xff\xfe" not in jpeg[:200]


def test_audit_flags_dirty_files():
    dirty_jpeg = jpeg_with_gps()
    assert audit_output(dirty_jpeg, "jpeg", icc_allowed=False)
    assert audit_output(png_with_text(), "png", icc_allowed=False)
    assert audit_output(webp_with_metadata(), "webp", icc_allowed=False)
    assert audit_output(b"garbage", "png", icc_allowed=False)
    assert audit_output(b"x", "gif", icc_allowed=False) == ["unknown_format"]


def test_srgb_tag_is_the_only_icc_and_only_for_tagging_profiles():
    for name, profile in PROFILES.items():
        out = convert_image(jpeg_with_gps(), profile)
        image = Image.open(io.BytesIO(out.image.data))
        has_icc = bool(image.info.get("icc_profile"))
        assert has_icc == profile.tag_srgb, name


def test_original_bytes_are_untouched():
    data = jpeg_with_gps(6)
    copy = bytes(data)
    convert_image(data, get_profile("convert-png"))
    assert data == copy
