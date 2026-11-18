"""Limits before decode, malformed input, decompression bombs."""

import pytest

pytest.importorskip("PIL")

import io  # noqa: E402
import struct  # noqa: E402
import warnings  # noqa: E402
import zlib  # noqa: E402

from builders import encode, gradient, raw_png  # noqa: E402
from PIL import Image  # noqa: E402

from lai_native.image import (  # noqa: E402
    MAX_IMAGE_BYTES,
    MAX_IMAGE_PIXELS,
    MAX_IMAGE_SIDE,
    ImageError,
    convert_image,
    decode_image,
    get_profile,
)

PNG = get_profile("convert-png")


def code_of(data, profile=PNG):
    with pytest.raises(ImageError) as caught:
        convert_image(data, profile)
    return caught.value.code


def test_limits_equal_the_documented_values():
    assert (MAX_IMAGE_SIDE, MAX_IMAGE_PIXELS, MAX_IMAGE_BYTES) == (
        4096,
        16_000_000,
        10 * 1024 * 1024,
    )
    assert Image.MAX_IMAGE_PIXELS == MAX_IMAGE_PIXELS


def test_maximum_allowed_image_converts():
    data = encode(Image.new("L", (4096, 3906), 7), "PNG")  # 15,998,976 pixels
    out = convert_image(data, get_profile("thumbnail-512"))
    assert out.image.width == 512


def test_side_over_limit_is_refused_before_decode():
    # a valid-looking header that claims 4097 x 1; Pillow would otherwise decode it
    assert code_of(raw_png(4097, 1)) == "image_too_large"
    assert code_of(encode(Image.new("L", (4097, 8), 0), "PNG")) == "image_too_large"


def test_pixels_over_limit_is_refused():
    assert code_of(encode(Image.new("L", (4000, 4001), 0), "PNG")) == "image_too_large"


def test_huge_declared_size_with_tiny_data_is_a_bomb_and_never_allocates():
    bomb = raw_png(60000, 60000, idat=zlib.compress(b"\x00" * 100))
    assert len(bomb) < 200
    assert code_of(bomb) == "image_too_large"
    # same for a JPEG whose SOF claims 65000 x 65000 (a hand-built minimal header)
    sof = b"\xff\xc0" + struct.pack(">HBHHB", 11, 8, 65000, 65000, 1) + b"\x01\x11\x00"
    jpeg = (
        b"\xff\xd8\xff\xdb\x00\x43\x00"
        + bytes(64)
        + sof
        + b"\xff\xda\x00\x08\x01\x01\x00\x00\x3f\x00"
        + bytes(8)
        + b"\xff\xd9"
    )
    assert code_of(jpeg) in ("image_too_large", "malformed_image")


def test_decompression_bomb_warning_is_an_error_not_a_warning():
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")  # the caller's filters must not hide it
        data = raw_png(4096, 4096, idat=zlib.compress(b"\x00" * 100))  # 16.7 MP, over 16 MP
        assert code_of(data) == "image_too_large"


def test_oversized_input_bytes_are_refused():
    assert code_of(b"\x89PNG\r\n\x1a\n" + bytes(MAX_IMAGE_BYTES)) == "input_too_large"


@pytest.mark.parametrize(
    "data",
    [
        b"",
        b"\x00" * 64,
        b"\x89PNG\r\n\x1a\n" + b"\x00" * 30,
        b"\xff\xd8\xff\xe0" + b"\x00" * 30,
        b"RIFF\x10\x00\x00\x00WEBPVP8 " + b"\x00" * 20,
    ],
)
def test_malformed_input_is_rejected_with_a_stable_code(data):
    assert code_of(data) in ("malformed_image", "unsupported_format")


def test_truncated_files_are_rejected_not_half_decoded():
    for fmt, kwargs in (("PNG", {}), ("JPEG", {"quality": 90}), ("WEBP", {"lossless": True})):
        data = encode(gradient(200, 200), fmt, **kwargs)
        assert code_of(data[: len(data) * 2 // 3]) == "malformed_image", fmt


def test_flipped_bytes_never_crash_the_process():
    base = encode(gradient(64, 64), "PNG")
    outcomes = set()
    for position in range(8, len(base), max(1, len(base) // 60)):
        mutated = bytearray(base)
        mutated[position] ^= 0xFF
        try:
            convert_image(bytes(mutated), PNG)
            outcomes.add("ok")
        except ImageError as error:
            outcomes.add(error.code)
    assert outcomes <= {"ok", "malformed_image", "image_too_large"}


def test_decode_rejects_non_bytes_and_polyglot_formats():
    with pytest.raises(ImageError):
        decode_image("a string")  # type: ignore[arg-type]
    tiff = io.BytesIO()
    Image.new("RGB", (4, 4)).save(tiff, "TIFF")
    assert code_of(tiff.getvalue()) == "unsupported_format"
    # a GIF dressed as PNG bytes: the sniff says png, the parser refuses
    assert code_of(b"\x89PNG\r\n\x1a\n" + encode(gradient(), "GIF")) == "malformed_image"


def test_error_messages_carry_no_input_content():
    with pytest.raises(ImageError) as caught:
        convert_image(b"SecretPayload" * 10, PNG)
    assert "Secret" not in str(caught.value) and "Secret" not in repr(caught.value)
