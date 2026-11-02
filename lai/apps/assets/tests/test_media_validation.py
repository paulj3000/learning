"""AM-13: content validation for images and audio (no trust in names or client types)."""

import io
import struct

import pytest

from apps.assets import validation_media
from apps.assets.tests.helpers import glb_bytes, make_definition
from apps.assets.tests.media_files import (
    jpeg_bytes,
    mp3_bytes,
    ogg_bytes,
    png_bytes,
    wav_bytes,
    webp_bytes,
)
from apps.assets.validation import validate_upload

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


def check(data, definition=None):
    return validate_upload(io.BytesIO(data), size=len(data), definition=definition)


def codes(result):
    return {f.code for f in result.errors}


@pytest.mark.parametrize(
    ("data", "fmt", "meta"),
    [
        (png_bytes(4, 8), "png", {"width": 4, "height": 8}),
        (jpeg_bytes(16, 8), "jpeg", {"width": 16, "height": 8}),
        (webp_bytes(32, 16), "webp", {"width": 32, "height": 16}),
    ],
)
def test_valid_images_report_their_format_and_size(data, fmt, meta):
    result = check(data)
    assert result.passed and result.format == fmt
    assert result.metadata == meta and result.dimensions is None and result.clips == []


def test_valid_audio_reports_duration_rate_and_channels():
    wav = check(wav_bytes(seconds=2, rate=8000))
    assert wav.passed and wav.format == "wav"
    assert wav.metadata["durationSeconds"] == 2.0 and wav.metadata["sampleRate"] == 8000
    mp3 = check(mp3_bytes(10))
    assert mp3.passed and mp3.format == "mp3" and mp3.metadata["sampleRate"] == 44100
    assert mp3.metadata["channels"] == 2 and 0.25 < mp3.metadata["durationSeconds"] < 0.28
    ogg = check(ogg_bytes(seconds=3))
    assert ogg.passed and ogg.format == "ogg" and ogg.metadata["durationSeconds"] == 3.0
    assert ogg.metadata["codec"] == "vorbis"


def test_a_non_power_of_two_image_passes_with_a_warning():
    result = check(png_bytes(5, 5))
    assert result.passed and {f.code for f in result.findings} == {"not_power_of_two"}


@pytest.mark.parametrize(
    ("data", "code"),
    [
        (b"", "empty_file"),
        (b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>", "not_a_model"),
        (b"GIF89a\x01\x00\x01\x00", "not_a_model"),
        (png_bytes()[:-5], "png_truncated"),
        (png_bytes() + b"<script>", "trailing_data"),
        (jpeg_bytes() + b"PK\x03\x04", "jpeg_end"),
        (jpeg_bytes()[:-2], "jpeg_end"),
        (webp_bytes() + b"junk", "webp_size"),
        (wav_bytes() + b"EXTRA-BYTES", "trailing_data"),
        (wav_bytes()[:-100], "wav_truncated"),
        (wav_bytes(tag=2), "wav_codec"),
        (mp3_bytes() + b"<html>", "trailing_data"),
        (b"\xff\xfb\x00\x00garbage", "mp3_no_frames"),
        (ogg_bytes(end=False), "ogg_truncated"),
        (ogg_bytes() + b"x", "trailing_data"),
    ],
)
def test_malformed_or_unsupported_files_are_rejected(data, code):
    result = check(data)
    assert not result.passed and code in codes(result)


def test_a_png_with_a_flipped_byte_fails_its_crc():
    data = bytearray(png_bytes())
    data[-20] ^= 0xFF
    assert "png_crc" in codes(check(bytes(data)))


def test_oversized_dimensions_are_rejected():
    assert "image_too_large" in codes(check(png_bytes(5000, 2)))


def test_the_format_comes_from_the_bytes_not_the_name(settings):
    # A PNG renamed .glb is still a PNG; offered to a model asset it is refused by family.
    result = check(png_bytes(), make_definition("npc-pip"))
    assert not result.passed and "wrong_file_family" in codes(result)


def test_each_kind_takes_only_its_own_family():
    texture = make_definition("brick-wall", kind="texture", category="texture")
    sound = make_definition("splash", kind="audio", category="sound")
    assert check(png_bytes(), texture).passed
    assert "wrong_file_family" in codes(check(glb_bytes(), texture))
    assert "wrong_file_family" in codes(check(wav_bytes(), texture))
    assert check(wav_bytes(), sound).passed
    assert "wrong_file_family" in codes(check(png_bytes(), sound))


def test_size_limits_apply_per_family(settings):
    settings.LAI_ASSET_MAX_IMAGE_BYTES = 50
    settings.LAI_ASSET_MAX_AUDIO_BYTES = 50
    assert "too_large" in codes(check(png_bytes()))
    assert "too_large" in codes(check(wav_bytes()))


def test_audio_limits_reject_unsupported_layouts():
    assert "audio_channels" in codes(check(wav_bytes(channels=6)))
    assert "audio_sample_rate" in codes(check(wav_bytes(rate=4000)))


def test_a_retired_definition_cannot_take_media():
    sound = make_definition("splash", kind="audio", category="sound")
    sound.status = "RETIRED"
    assert "asset_retired" in codes(check(wav_bytes(), sound))


def test_sniffing_is_bounded_and_unknown_bytes_are_none():
    assert validation_media.sniff_format(struct.pack("<4s", b"nope")) is None
