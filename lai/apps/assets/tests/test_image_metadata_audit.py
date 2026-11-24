"""`image_metadata_audit`: a read-only report of stored image versions that carry location,
device, owner, comment, thumbnail, XMP, IPTC or text metadata. Presence only, never a value;
nothing is changed. Bytes are built in the test (no binary fixtures); storage is in memory."""

import io
import json
import sys
from pathlib import Path

import pytest
from django.core.management import call_command

from apps.assets import services
from apps.assets.image_audit import audit_image_metadata
from apps.assets.models import AssetVersion, VersionStatus
from apps.assets.storage import get_storage
from apps.assets.tests.helpers import make_definition, make_version

sys.path.insert(0, str(Path(__file__).resolve().parents[4] / "tests" / "processing"))
from image_builder import (  # noqa: E402
    jpeg,
    jpeg_app1_exif,
    jpeg_app1_xmp,
    png,
    tiff_exif,
    tiff_tags,
    webp,
)

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

SECRET = b"<x:xmpmeta><rdf:li exif:GPSLatitude='51.5'/></x:xmpmeta>"


def upload(asset, data, name="a.jpg"):
    return services.upload_version(asset, io.BytesIO(data), original_filename=name)


@pytest.fixture
def library():
    asset = make_definition("sign-board", kind="texture", category="texture")
    gps = upload(asset, jpeg(jpeg_app1_exif(tiff_exif(orientation=6, gps="position"))))
    device = upload(
        asset,
        jpeg(jpeg_app1_exif(tiff_tags(ifd0=[0x010F, 0x0110, 0x013B, 0x010E], thumbnail=[0x0201]))),
    )
    xmp = upload(asset, png((b"tEXt", b"Comment\x00hi")), name="b.png")
    clean = upload(asset, webp(), name="c.webp")
    return {"gps": gps, "device": device, "xmp": xmp, "clean": clean, "asset": asset}


def by_version(rows):
    return {row["version"]: row for row in rows}


def test_each_version_reports_its_categories_and_nothing_else(library):
    rows = by_version(audit_image_metadata())
    assert rows[library["gps"].number]["categories"] == ["location"]
    assert rows[library["device"].number]["categories"] == [
        "comment",
        "device",
        "owner",
        "thumbnail",
    ]
    assert rows[library["xmp"].number]["categories"] == ["text"]
    assert rows[library["clean"].number]["categories"] == []
    assert [r["sensitive"] for r in rows.values()] == [True, True, True, False]
    assert all(r["state"] == "scanned" for r in rows.values())


def test_the_status_filter_and_published_versions(library):
    services.publish_version(library["gps"])
    rows = list(audit_image_metadata(statuses=[VersionStatus.PUBLISHED]))
    assert [(r["version"], r["status"]) for r in rows] == [(library["gps"].number, "PUBLISHED")]


def test_a_missing_object_is_reported_not_raised(library):
    get_storage().delete(library["gps"].storage_key)
    rows = by_version(audit_image_metadata())
    assert rows[library["gps"].number]["state"] == "missing"
    assert rows[library["gps"].number]["categories"] == []


def test_models_and_audio_are_not_scanned():
    asset = make_definition("pip-model")
    make_version(asset)  # a GLB row
    assert list(audit_image_metadata()) == []


def test_the_audit_changes_nothing(library):
    before = list(AssetVersion.objects.order_by("pk").values())
    objects = dict(get_storage().objects)
    list(audit_image_metadata())
    call_command("image_metadata_audit", stdout=io.StringIO())
    assert list(AssetVersion.objects.order_by("pk").values()) == before
    assert dict(get_storage().objects) == objects


def test_the_command_prints_counts_and_never_a_value(library, capsys):
    upload(library["asset"], jpeg(jpeg_app1_xmp(SECRET)), name="d.jpg")
    call_command("image_metadata_audit")
    out = capsys.readouterr().out
    assert "scanned: 5  sensitive: 4" in out
    assert "location: 2" in out and "device: 1" in out and "thumbnail: 1" in out
    assert "sign-board v1 VALIDATED jpeg scanned: location" in out
    assert "51.5" not in out and "GPSLatitude" not in out


def test_json_output_and_only_sensitive(library, capsys):
    call_command("image_metadata_audit", "--json", "--only-sensitive")
    document = json.loads(capsys.readouterr().out)
    assert document["summary"]["sensitive"] == 3 and len(document["versions"]) == 3
    assert document["summary"]["by_category"]["owner"] == 1
