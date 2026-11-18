"""F9: a JPEG with very many scans fits the byte and pixel limits but would keep an
uninterruptible in-process decode busy until the Lambda timeout. The walk refuses it first."""

import struct
import time

import pytest

pytest.importorskip("PIL")

from builders import encode, gradient  # noqa: E402
from PIL import Image  # noqa: E402

from lai_native.image import ImageError, convert_image, get_profile  # noqa: E402
from lai_native.image.decode import count_jpeg_scans  # noqa: E402
from lai_native.image.limits import MAX_JPEG_SCANS  # noqa: E402


def sos(components=1):
    body = bytes([components]) + b"\x01\x00" * components + b"\x00\x3f\x00"
    return b"\xff\xda" + struct.pack(">H", len(body) + 2) + body


def scan_bomb(scans, entropy=b"\x12\x34"):
    return b"\xff\xd8" + b"".join(sos() + entropy for _ in range(scans)) + b"\xff\xd9"


def progressive(width=96, height=96):
    return encode(gradient(width, height), "JPEG", progressive=True, quality=85)


def test_the_limit_is_conservative_and_documented():
    assert MAX_JPEG_SCANS == 32
    from lai_native.image import limits

    assert "scan" in (limits.__doc__ or "") + open(limits.__file__).read()


def test_ordinary_files_have_few_scans():
    assert count_jpeg_scans(encode(gradient(), "JPEG")) == 1
    scans = count_jpeg_scans(progressive())
    assert 2 <= scans <= 12


def test_a_real_progressive_jpeg_converts():
    out = convert_image(progressive(), get_profile("convert-png"))
    assert (out.image.width, out.image.height) == (96, 96)


def test_walk_counts_and_stops_at_the_limit():
    assert count_jpeg_scans(scan_bomb(5)) == 5
    assert count_jpeg_scans(scan_bomb(MAX_JPEG_SCANS)) == MAX_JPEG_SCANS
    assert count_jpeg_scans(scan_bomb(5000)) == MAX_JPEG_SCANS + 1  # stops early


def test_restart_markers_and_stuffed_bytes_are_not_scans():
    entropy = b"\xff\x00\xff\xd0\x12\xff\xd1\xff\xff\x00" * 100
    assert count_jpeg_scans(scan_bomb(3, entropy)) == 3


def test_a_scan_bomb_is_refused_before_decoding_and_fast():
    real = progressive()
    head = real[: real.index(b"\xff\xda")]
    bomb = head + b"".join(sos() + b"\x00" for _ in range(20_000)) + b"\xff\xd9"
    assert len(bomb) < 10 * 1024 * 1024
    started = time.perf_counter()
    with pytest.raises(ImageError) as caught:
        convert_image(bomb, get_profile("convert-png"))
    assert caught.value.code == "too_many_scans"
    assert time.perf_counter() - started < 1.0


def test_walk_survives_garbage():
    for data in (
        b"\xff\xd8",
        b"\xff\xd8\xff",
        b"\xff\xd8\xff\xda\x00",
        b"\xff\xd8" + b"\xff\xda\x00\x01" * 3,
    ):
        assert count_jpeg_scans(data) >= 0
    assert isinstance(Image.__name__, str)
