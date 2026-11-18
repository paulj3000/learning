"""F5: glTF 2.0 texture preparation ignores embedded colour profiles and EXIF orientation."""

import io

import pytest

pytest.importorskip("PIL")

from builders import encode, gradient, jpeg_with_gps, wide_gamut_icc  # noqa: E402
from PIL import Image  # noqa: E402

from lai_native.image import (  # noqa: E402
    PROFILES,
    ImageError,
    convert_image,
    decode_image,
    get_profile,
    prepare_texture,
)


def marked():
    source = Image.new("RGB", (4, 2), (0, 0, 0))
    source.putpixel((0, 0), (255, 0, 0))
    return source


def test_profiles_exist_and_flags():
    for name, purpose in (("texture-colour-gltf", "artwork"), ("texture-data-gltf", "data")):
        profile = PROFILES[name]
        assert profile.purpose == purpose and profile.ignore_icc and profile.ignore_orientation
        assert profile.output_format == "png" and not profile.tag_srgb
    assert not PROFILES["convert-png"].ignore_orientation


@pytest.mark.parametrize("name", ["texture-colour-gltf", "texture-data-gltf"])
def test_orientation_is_not_applied(name):
    exif = Image.Exif()
    exif[0x0112] = 6
    data = encode(marked(), "PNG", exif=exif)
    prepared = prepare_texture(data, get_profile(name))
    assert (prepared.width, prepared.height) == (4, 2)  # not swapped
    assert prepared.image.getpixel((0, 0)) == (255, 0, 0)  # not rotated
    assert prepared.plan["orientationApplied"] == 0
    out = convert_image(data, get_profile(name))
    assert Image.open(io.BytesIO(out.image.data)).size == (4, 2)
    # the standard profiles still rotate, so the flag is what makes the difference
    assert prepare_texture(data, get_profile("texture-data-png")).width == 2


@pytest.mark.parametrize("name", ["texture-colour-gltf", "texture-data-gltf"])
def test_embedded_icc_is_ignored_not_applied(name):
    source = Image.new("RGB", (8, 8), (200, 40, 40))
    data = encode(source, "PNG", icc_profile=wide_gamut_icc())
    out = convert_image(data, get_profile(name))
    result = Image.open(io.BytesIO(out.image.data))
    assert result.getpixel((0, 0)) == (200, 40, 40)
    assert "icc_profile" not in result.info
    # the ordinary artwork profile does change the values
    changed = convert_image(data, get_profile("convert-png"))
    assert Image.open(io.BytesIO(changed.image.data)).getpixel((0, 0)) != (200, 40, 40)
    if name == "texture-colour-gltf":
        assert out.summary()["colour"]["action"] == "icc_ignored_gltf"


def test_metadata_is_still_removed():
    out = convert_image(jpeg_with_gps(6, 40, 30), get_profile("texture-colour-gltf"))
    assert (out.image.width, out.image.height) == (40, 30)
    assert b"SecretMaker" not in out.image.data and b"GPS" not in out.image.data


def test_a_decoded_image_must_match_the_profile_orientation_rule():
    data = jpeg_with_gps(6, 40, 30)
    oriented = decode_image(data)  # default: rotated
    with pytest.raises(ImageError) as caught:
        prepare_texture(oriented, get_profile("texture-data-gltf"))
    assert caught.value.code == "invalid_profile"
    as_stored = decode_image(data, apply_orientation=False)
    assert prepare_texture(as_stored, get_profile("texture-data-gltf")).width == 40
    assert prepare_texture(oriented, get_profile("texture-colour-webp")).width == 30
    assert isinstance(gradient, object)


def test_resize_and_power_of_two_work_with_the_gltf_profiles():
    profile = get_profile("texture-data-gltf").with_options(max_side=64, power_of_two=True)
    prepared = prepare_texture(encode(gradient(300, 200, "RGBA"), "PNG"), profile)
    assert (prepared.width, prepared.height) == (64, 32) and prepared.mode == "RGBA"
