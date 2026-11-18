"""Data textures (normal, roughness, metallic, ORM, masks): no colour transform, no
premultiplication, exact channel values through a lossless path."""

import pytest

pytest.importorskip("PIL")

import io  # noqa: E402
import random  # noqa: E402

from builders import encode, wide_gamut_icc  # noqa: E402
from PIL import Image  # noqa: E402

from lai_native.image import ImageError, convert_image, get_profile, prepare_texture  # noqa: E402

DATA_PROFILES = ["texture-data-png", "texture-data-webp"]


def random_image(mode, size=(37, 29), seed=7):
    rng = random.Random(seed)  # noqa: S311 - test data
    channels = len(mode)
    data = bytes(rng.randrange(256) for _ in range(size[0] * size[1] * channels))
    return Image.frombytes(mode, size, data)


@pytest.mark.parametrize("name", DATA_PROFILES)
@pytest.mark.parametrize("mode", ["L", "LA", "RGB", "RGBA"])
def test_pixel_bytes_are_identical_through_the_lossless_path(name, mode):
    source = random_image(mode)
    out = convert_image(encode(source, "PNG"), get_profile(name))
    result = Image.open(io.BytesIO(out.image.data))
    result.load()
    expected = (
        source
        if not (name.endswith("webp") and mode in ("L", "LA"))
        else source.convert("RGB" if mode == "L" else "RGBA")
    )
    assert result.mode == expected.mode
    assert result.tobytes() == expected.tobytes()


def test_rgb_under_zero_alpha_is_not_premultiplied_away():
    source = Image.new("RGBA", (8, 8), (10, 200, 30, 0))
    for name in DATA_PROFILES:
        out = convert_image(encode(source, "PNG"), get_profile(name))
        assert Image.open(io.BytesIO(out.image.data)).tobytes() == source.tobytes(), name


def test_icc_profile_is_dropped_not_applied_to_data():
    icc = wide_gamut_icc()
    source = Image.new("RGB", (8, 8), (200, 40, 40))
    out = convert_image(encode(source, "PNG", icc_profile=icc), get_profile("texture-data-png"))
    result = Image.open(io.BytesIO(out.image.data))
    assert result.getpixel((0, 0)) == (200, 40, 40)
    assert "icc_profile" not in result.info
    assert out.summary()["colour"] == {"action": "none_data", "profileClass": "dropped"}


def test_resize_filters_each_band_without_premultiplication():
    source = random_image("RGBA", size=(64, 64))
    profile = get_profile("texture-data-png").with_options(max_side=32)
    prepared = prepare_texture(encode(source, "PNG"), profile)
    expected = Image.merge(
        "RGBA", [band.resize((32, 32), Image.Resampling.BOX) for band in source.split()]
    )
    assert prepared.image.tobytes() == expected.tobytes()
    # and Pillow's own RGBA resize (which premultiplies) would differ, so the test is meaningful
    assert source.resize((32, 32), Image.Resampling.BOX).tobytes() != expected.tobytes()


def test_data_profiles_cannot_be_lossy_tagged_or_flattened():
    from dataclasses import replace

    base = get_profile("texture-data-png")
    for change in (
        {"output_format": "jpeg"},
        {"output_format": "webp", "lossless": False},
        {"tag_srgb": True},
        {"flatten_background": "#ffffff"},
    ):
        with pytest.raises(ImageError):
            replace(base, **change)
    with pytest.raises(ImageError):
        base.with_options(output_format="jpeg")
    assert base.with_options(output_format="webp").lossless is True


def test_alpha_is_never_dropped_for_data():
    source = Image.new("RGBA", (8, 8), (1, 2, 3, 255))
    out = convert_image(encode(source, "PNG"), get_profile("texture-data-png"))
    assert Image.open(io.BytesIO(out.image.data)).mode == "RGBA"


def test_sixteen_bit_and_cmyk_inputs_are_refused_for_data():
    with pytest.raises(ImageError) as caught:
        convert_image(
            encode(Image.new("I;16", (8, 8), 40000), "PNG"), get_profile("texture-data-png")
        )
    assert caught.value.code == "bit_depth_not_supported"
    with pytest.raises(ImageError) as caught:
        convert_image(encode(Image.new("CMYK", (8, 8)), "JPEG"), get_profile("texture-data-png"))
    assert caught.value.code == "colour_mode_not_supported"


def test_colour_key_transparency_survives_exactly():
    source = Image.new("RGB", (4, 4), (9, 9, 9))
    source.putpixel((1, 1), (100, 150, 200))
    out = convert_image(
        encode(source, "PNG", transparency=(9, 9, 9)), get_profile("texture-data-png")
    )
    result = Image.open(io.BytesIO(out.image.data))
    assert result.mode == "RGBA"
    assert result.getpixel((0, 0))[3] == 0 and result.getpixel((1, 1)) == (100, 150, 200, 255)
