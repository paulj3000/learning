"""LAI-LAMBDA-013 (finding A1): embedded location and metadata raise warnings, never errors."""

import io
import sys
from pathlib import Path

import pytest

from apps.assets.tests.media_files import jpeg_bytes, png_bytes
from apps.assets.validation import validate_upload

sys.path.insert(0, str(Path(__file__).resolve().parents[4] / "tests" / "processing"))
from image_builder import (  # noqa: E402
    jpeg,
    jpeg_app1_exif,
    jpeg_app1_xmp,
    png,
    tiff_exif,
    webp,
)

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


def check(data):
    return validate_upload(io.BytesIO(data), size=len(data))


def warning_codes(result):
    return {f.code for f in result.findings if f.severity == "warning"}


def test_gps_in_a_jpeg_warns_but_still_passes():
    result = check(jpeg(jpeg_app1_exif(tiff_exif(orientation=6, gps="position"))))
    assert result.passed and result.format == "jpeg"
    assert {"image_location_present", "image_metadata_present"} <= warning_codes(result)
    # Metadata is unchanged by the scan: only the header facts (LAI-ENV-02 adds transparency and
    # colour model), never a scanned value such as the GPS position.
    assert result.metadata == {"width": 8, "height": 8, "hasAlpha": False, "colourModel": "grey"}


def test_exif_without_gps_warns_about_metadata_only():
    codes = warning_codes(check(jpeg(jpeg_app1_exif(tiff_exif(orientation=1)))))
    assert "image_metadata_present" in codes and "image_location_present" not in codes


def test_xmp_gps_in_png_and_webp():
    assert "image_location_present" in warning_codes(
        check(webp((b"EXIF", tiff_exif(gps="position"))))
    )
    xmp = jpeg(jpeg_app1_xmp(b"<x exif:GPSLongitude='1'/>"))
    assert "image_location_present" in warning_codes(check(xmp))
    assert "image_location_present" in warning_codes(
        check(png((b"eXIf", tiff_exif(gps="position"))))
    )


def test_clean_images_get_no_metadata_warning():
    for data in (jpeg_bytes(), png_bytes(), webp()):
        codes = warning_codes(check(data))
        assert not codes & {"image_location_present", "image_metadata_present"}


def test_a_scanner_failure_does_not_change_validation(monkeypatch):
    import lai_processing.processors.image.metadata as meta

    def boom(*args, **kwargs):
        raise RuntimeError("scanner failed")

    monkeypatch.setattr(meta, "scan_image_metadata", boom)
    result = check(jpeg(jpeg_app1_exif(tiff_exif(gps="position"))))
    assert result.passed and not warning_codes(result) & {"image_location_present"}
