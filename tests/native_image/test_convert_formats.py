"""Format round trips, resizing, thumbnails, transparency, orientation, determinism."""

import pytest

pytest.importorskip("PIL")

import io  # noqa: E402

from builders import encode, gradient, jpeg_with_gps, png_with_text, webp_with_metadata  # noqa: E402
from PIL import Image  # noqa: E402

from lai_native.image import (  # noqa: E402
    PROFILES,
    THUMBNAIL_PROFILES,
    ImageError,
    convert_image,
    convert_many,
    get_profile,
    prepare_texture,
    sniff_format,
)


def open_output(output):
    image = Image.open(io.BytesIO(output.image.data))
    image.load()
    return image


@pytest.mark.parametrize(
    ("source", "name", "expected"),
    [
        ("jpeg", "convert-png", "PNG"),
        ("jpeg", "convert-webp", "WEBP"),
        ("jpeg", "convert-jpeg", "JPEG"),
        ("png", "convert-jpeg", "JPEG"),
        ("png", "convert-webp-lossless", "WEBP"),
        ("png", "convert-png", "PNG"),
        ("webp", "convert-png", "PNG"),
        ("webp", "convert-webp", "WEBP"),
        ("webp", "convert-jpeg", "JPEG"),
    ],
)
def test_every_input_converts_to_every_output(source, name, expected):
    data = {
        "jpeg": encode(gradient(), "JPEG"),
        "png": encode(gradient(mode="RGBA"), "PNG"),
        "webp": encode(gradient(), "WEBP", lossless=True),
    }[source]
    output = convert_image(data, get_profile(name))
    assert open_output(output).format == expected
    assert (output.image.width, output.image.height) == (64, 48)
    assert output.image.sanitized is True
    assert output.image.size_bytes == len(output.image.data)


def test_sniff_uses_bytes_not_extension():
    assert sniff_format(encode(gradient(), "PNG")[:16]) == "png"
    assert sniff_format(b"GIF89a" + bytes(10)) is None
    assert sniff_format(b"RIFF\x00\x00\x00\x00WAVEfmt ") is None
    # a PNG named .jpg is still a PNG, and a GIF is refused whatever it is called
    with pytest.raises(ImageError) as caught:
        convert_image(encode(gradient(), "GIF"), get_profile("convert-png"))
    assert caught.value.code == "unsupported_format"


def test_resize_fits_within_and_preserves_aspect():
    data = encode(gradient(400, 200), "PNG")
    out = convert_image(data, get_profile("thumbnail-128"))
    assert (out.image.width, out.image.height) == (128, 64)
    tall = convert_image(encode(gradient(100, 300), "PNG"), get_profile("thumbnail-128"))
    assert (tall.image.width, tall.image.height) == (43, 128)
    assert max(tall.image.width, tall.image.height) <= 128


def test_never_upscales():
    out = convert_image(encode(gradient(40, 30), "PNG"), get_profile("thumbnail-512"))
    assert (out.image.width, out.image.height) == (40, 30)
    assert out.summary()["resized"] is False


def test_thumbnail_set_decodes_once_and_makes_three_sizes():
    report = convert_many(
        encode(gradient(600, 400), "JPEG"), [get_profile(n) for n in THUMBNAIL_PROFILES]
    )
    sizes = [(o.image.width, o.image.height) for o in report.outputs]
    assert sizes == [(128, 85), (256, 171), (512, 341)]
    assert [o.summary()["logicalId"] for o in report.outputs] == list(THUMBNAIL_PROFILES)
    assert all(o.image.format == "webp" for o in report.outputs)


def test_options_narrow_a_profile_and_unknown_options_are_refused():
    profile = get_profile("convert-png").with_options(max_side=32)
    out = convert_image(encode(gradient(100, 50), "PNG"), profile)
    assert (out.image.width, out.image.height) == (32, 16)
    with pytest.raises(ImageError):
        get_profile("convert-png").with_options(max_side=9999)
    with pytest.raises(ImageError):
        get_profile("convert-png").with_options(colour="x")


def test_power_of_two_rounds_each_side_down():
    profile = get_profile("convert-png").with_options(power_of_two=True)
    out = convert_image(encode(gradient(300, 100), "PNG"), profile)
    assert (out.image.width, out.image.height) == (256, 64)


def test_quality_changes_size():
    data = encode(gradient(256, 256), "JPEG", quality=95)
    low = convert_image(data, get_profile("convert-jpeg").with_options(quality=30))
    high = convert_image(data, get_profile("convert-jpeg").with_options(quality=95))
    assert low.image.size_bytes < high.image.size_bytes


def test_transparency_kept_for_png_and_webp():
    rgba = Image.new("RGBA", (20, 20), (255, 0, 0, 0))
    rgba.putpixel((5, 5), (0, 255, 0, 255))
    for name in ("convert-png", "convert-webp-lossless"):
        out = convert_image(encode(rgba, "PNG"), get_profile(name))
        image = open_output(out)
        assert image.mode == "RGBA"
        assert image.getpixel((5, 5))[3] == 255
        assert image.getpixel((0, 0))[3] == 0


def test_alpha_to_jpeg_flattens_only_when_the_profile_allows():
    rgba = Image.new("RGBA", (20, 20), (255, 0, 0, 0))
    data = encode(rgba, "PNG")
    out = convert_image(data, get_profile("convert-jpeg"))
    corner = open_output(out).getpixel((0, 0))
    assert min(corner) > 240  # flattened on white
    custom = get_profile("convert-jpeg").with_options(flatten_background="#000000")
    assert max(open_output(convert_image(data, custom)).getpixel((0, 0))) < 15
    from dataclasses import replace

    refusing = replace(get_profile("convert-jpeg"), flatten_background=None)
    with pytest.raises(ImageError) as caught:
        convert_image(data, refusing)
    assert caught.value.code == "alpha_not_supported"


def test_opaque_alpha_is_dropped_for_artwork():
    out = convert_image(
        encode(Image.new("RGBA", (10, 10), (1, 2, 3, 255)), "PNG"), get_profile("convert-png")
    )
    assert open_output(out).mode == "RGB"
    assert out.summary()["alphaAction"] == "dropped_opaque"


def test_palette_png_with_transparency_becomes_rgba():
    palette = Image.new("P", (8, 8), 0)
    palette.putpalette([255, 0, 0, 0, 255, 0] + [0] * 250)
    palette.info["transparency"] = 0
    out = convert_image(encode(palette, "PNG", transparency=0), get_profile("convert-png"))
    assert open_output(out).mode == "RGBA"
    assert open_output(out).getpixel((0, 0))[3] == 0


def test_grayscale_stays_grayscale_in_png_and_jpeg():
    gray = encode(gradient(mode="L"), "PNG")
    assert open_output(convert_image(gray, get_profile("convert-png"))).mode == "L"
    assert open_output(convert_image(gray, get_profile("convert-jpeg"))).mode == "L"
    assert open_output(convert_image(gray, get_profile("convert-webp"))).mode == "RGB"


@pytest.mark.parametrize("orientation", [1, 2, 3, 4, 5, 6, 7, 8])
def test_exif_orientation_is_applied(orientation):
    data = jpeg_with_gps(orientation, width=64, height=48)
    out = convert_image(data, get_profile("convert-png"))
    swapped = orientation in (5, 6, 7, 8)
    assert (out.image.width, out.image.height) == ((48, 64) if swapped else (64, 48))
    assert out.summary()["orientationApplied"] == orientation


def test_orientation_moves_the_pixels():
    source = Image.new("RGB", (4, 2), (0, 0, 0))
    source.putpixel((0, 0), (255, 0, 0))  # top-left red
    exif = Image.Exif()
    exif[0x0112] = 6  # rotate 90 clockwise to display
    out = convert_image(encode(source, "PNG", exif=exif), get_profile("texture-data-png"))
    image = open_output(out)
    assert image.size == (2, 4)
    assert image.getpixel((1, 0)) == (255, 0, 0)  # top-left goes to top-right


def test_source_facts_are_flags_only():
    report = convert_many(jpeg_with_gps(6), [get_profile("convert-png")])
    source = report.source
    assert source["exifPresent"] and source["gpsPresent"] and source["orientation"] == 6
    text = repr(report.as_dict())
    for secret in ("SecretMaker", "SecretComment", "37.0", "122.0", "SecretModel"):
        assert secret not in text


def test_animated_input_is_refused_except_for_thumbnails():
    frames = [Image.new("RGB", (30, 30), (i * 40, 0, 0)) for i in range(3)]
    gif_like_webp = encode(
        frames[0], "WEBP", save_all=True, append_images=frames[1:], duration=50, lossless=True
    )
    with pytest.raises(ImageError) as caught:
        convert_image(gif_like_webp, get_profile("convert-png"))
    assert caught.value.code == "animated_not_supported"
    out = convert_image(gif_like_webp, get_profile("thumbnail-128"))
    assert (out.image.width, out.image.height) == (30, 30)


def test_outputs_are_deterministic():
    for data in (jpeg_with_gps(6), png_with_text(), webp_with_metadata()):
        for name in PROFILES:
            if name.startswith("texture-data") and False:
                continue
            first = convert_image(data, get_profile(name)).image.data
            again = convert_image(data, get_profile(name)).image.data
            assert first == again, name


def test_prepare_texture_returns_pixels_for_other_workloads():
    prepared = prepare_texture(
        encode(gradient(300, 200, "RGBA"), "PNG"),
        get_profile("texture-data-png").with_options(max_side=64, power_of_two=True),
    )
    assert (prepared.width, prepared.height) == (64, 32)
    assert prepared.mode == "RGBA" and prepared.has_alpha
    assert len(prepared.pixel_bytes()) == 64 * 32 * 4
    assert prepared.icc_profile is None


def test_invalid_profile_names_and_counts():
    with pytest.raises(ImageError):
        get_profile("nope")
    with pytest.raises(ImageError):
        convert_many(encode(gradient(), "PNG"), [])
    with pytest.raises(ImageError):
        convert_many(encode(gradient(), "PNG"), [get_profile("convert-png")] * 5)
