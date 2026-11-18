"""Artwork colour handling: ICC to sRGB, tagging, CMYK, invalid profiles."""

import pytest

pytest.importorskip("PIL")

import io  # noqa: E402

from builders import encode, gradient, wide_gamut_icc  # noqa: E402
from PIL import Image, ImageCms  # noqa: E402

from lai_native.image import ImageError, convert_image, get_profile  # noqa: E402
from lai_native.image.colour import classify_profile, open_profile, srgb_icc_bytes  # noqa: E402


def test_wide_gamut_profile_is_converted_and_values_change():
    icc = wide_gamut_icc()
    source = Image.new("RGB", (16, 16), (200, 40, 40))
    data = encode(source, "PNG", icc_profile=icc)
    out = convert_image(data, get_profile("convert-png"))
    image = Image.open(io.BytesIO(out.image.data))
    assert image.getpixel((0, 0)) != (200, 40, 40)
    assert out.summary()["colour"] == {"action": "converted_to_srgb", "profileClass": "other"}
    tagged = image.info["icc_profile"]
    assert classify_profile(open_profile(tagged)) == "srgb"


def test_srgb_profile_keeps_values_and_is_tagged():
    srgb = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
    data = encode(Image.new("RGB", (16, 16), (200, 40, 40)), "PNG", icc_profile=srgb)
    out = convert_image(data, get_profile("convert-png"))
    assert Image.open(io.BytesIO(out.image.data)).getpixel((0, 0)) == (200, 40, 40)
    assert out.summary()["colour"]["action"] == "assumed_srgb"


def test_no_profile_is_assumed_srgb_and_thumbnails_are_untagged():
    data = encode(gradient(), "PNG")
    assert convert_image(data, get_profile("convert-png")).summary()["colour"]["action"] == "none"
    thumb = convert_image(data, get_profile("thumbnail-256"))
    assert "icc_profile" not in Image.open(io.BytesIO(thumb.image.data)).info


def test_alpha_is_untouched_by_a_colour_transform():
    icc = wide_gamut_icc()
    source = Image.new("RGBA", (8, 8), (200, 40, 40, 77))
    out = convert_image(encode(source, "PNG", icc_profile=icc), get_profile("convert-png"))
    assert Image.open(io.BytesIO(out.image.data)).getpixel((0, 0))[3] == 77


def test_invalid_and_oversized_profiles_are_refused():
    data = encode(gradient(), "PNG", icc_profile=b"not a profile at all" * 10)
    with pytest.raises(ImageError) as caught:
        convert_image(data, get_profile("convert-png"))
    assert caught.value.code == "colour_profile_invalid"
    # JPEG carries the profile in APP2 segments (64 KiB each); PNG's own parser refuses an
    # iCCP that inflates past MAX_PNG_TEXT_CHUNK (64 KiB) as a malformed file.
    huge = encode(gradient(), "JPEG", icc_profile=wide_gamut_icc() + bytes(1024 * 1024))
    with pytest.raises(ImageError) as caught:
        convert_image(huge, get_profile("convert-png"))
    assert caught.value.code == "colour_profile_invalid"
    # PNG: the parser's chunk limit equals the profile limit, so one past it is malformed
    big_png = encode(gradient(), "PNG", icc_profile=wide_gamut_icc() + bytes(1024 * 1024))
    with pytest.raises(ImageError) as caught:
        convert_image(big_png, get_profile("convert-png"))
    assert caught.value.code == "malformed_image"


def test_png_with_a_large_icc_profile_converts():
    """100 KiB and 800 KiB profiles are allowed (MAX_ICC_BYTES is 1 MiB), in PNG as in JPEG."""
    for extra in (100 * 1024, 800 * 1024):
        icc = wide_gamut_icc() + bytes(extra)
        source = Image.new("RGB", (16, 16), (200, 40, 40))
        for fmt in ("PNG", "JPEG"):
            out = convert_image(encode(source, fmt, icc_profile=icc), get_profile("convert-png"))
            assert out.summary()["colour"]["action"] == "converted_to_srgb", (fmt, extra)


def test_png_text_stays_bounded_by_text_memory():
    from builders import png_with_text
    from PIL import PngImagePlugin

    info = PngImagePlugin.PngInfo()
    for index in range(12):
        info.add_text(f"k{index}", "x" * 60_000)  # 720 KB of text in all, over the 256 KiB bound
    with pytest.raises(ImageError) as caught:
        convert_image(encode(gradient(), "PNG", pnginfo=info), get_profile("convert-png"))
    assert caught.value.code == "malformed_image"
    assert convert_image(png_with_text(), get_profile("convert-png")).image.sanitized


def test_cmyk_jpeg_is_converted_with_a_finding():
    cmyk = Image.new("CMYK", (16, 16), (0, 255, 255, 0))
    out = convert_image(encode(cmyk, "JPEG"), get_profile("convert-png"))
    image = Image.open(io.BytesIO(out.image.data))
    assert image.mode == "RGB"
    assert image.getpixel((0, 0))[0] > image.getpixel((0, 0))[1]  # reddish
    assert out.findings == ("cmyk_converted",)


def test_sixteen_bit_gray_png_is_reduced_for_artwork():
    gray16 = Image.new("I;16", (8, 8), 40000)
    out = convert_image(encode(gray16, "PNG"), get_profile("convert-png"))
    assert Image.open(io.BytesIO(out.image.data)).mode == "L"
    assert Image.open(io.BytesIO(out.image.data)).getpixel((0, 0)) == 156  # 40000 // 256


def test_embedded_srgb_profile_is_deterministic_and_small():
    first = srgb_icc_bytes()
    assert first == srgb_icc_bytes()
    assert 400 < len(first) < 4096
    assert first[24:36] == bytes(12)  # no creation date
