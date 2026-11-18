"""Staff browser GLB thumbnail capture in Django Admin (ADR-069)."""

import io
import re
import struct

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client

from apps.assets import services
from apps.assets.capture_image import BadCapture, check_dimensions, read_facts
from apps.assets.models import ArtifactState, AssetVersion, DerivedArtifact, VersionStatus
from apps.assets.storage import get_storage
from apps.assets.tests.helpers import glb_bytes, make_definition, make_version

from .artifact_helpers import user_with
from .media_files import jpeg_bytes, png_bytes, webp_bytes

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

VERSIONS = "/admin/assets/assetversion/"
CAPTURER = ("view_assetversion", "capture_derivedartifact", "view_derivedartifact")
REVIEWER = (*CAPTURER, "review_derivedartifact")


def page(version) -> str:
    return f"{VERSIONS}{version.pk}/capture/"


def upload_url(version) -> str:
    return f"{VERSIONS}{version.pk}/capture/upload/"


def review_url(version) -> str:
    return f"{VERSIONS}{version.pk}/capture/review/"


def login(user, **kwargs) -> Client:
    client = Client(**kwargs)
    client.force_login(user, backend="apps.users.backends.AdminPasswordBackend")
    return client


@pytest.fixture
def on(settings):
    settings.LAI_THUMBNAIL_CAPTURE = "on"


@pytest.fixture
def glb():
    asset = make_definition("npc-pip")
    return services.upload_version(asset, io.BytesIO(glb_bytes()), original_filename="pip.glb")


def post(client, version, data, *, name="c.png", version_id=None, sha=None, **extra):
    fields = {
        "version_id": str(version.pk if version_id is None else version_id),
        "source_sha256": version.sha256 if sha is None else sha,
        "image": SimpleUploadedFile(name, data),
    }
    return client.post(upload_url(version), fields, **extra)


def square_png(side=64) -> bytes:
    return png_bytes(side, side)


def resized_png(width, height) -> bytes:
    """A real PNG whose header claims another size (the server reads the header only)."""
    data = bytearray(png_bytes(64, 64))
    data[16:24] = struct.pack(">II", width, height)
    return bytes(data)


# --- header parsing ----------------------------------------------------------------------------


def vp8x(width, height, *, flags=0):
    payload = bytes([flags, 0, 0, 0]) + (width - 1).to_bytes(3, "little")
    payload += (height - 1).to_bytes(3, "little")
    chunk = b"VP8X" + struct.pack("<I", len(payload)) + payload
    return b"RIFF" + struct.pack("<I", 4 + len(chunk)) + b"WEBP" + chunk


def vp8(width, height):
    payload = b"\x00\x00\x00\x9d\x01\x2a" + struct.pack("<HH", width, height) + b"\x00" * 6
    chunk = b"VP8 " + struct.pack("<I", len(payload)) + payload
    return b"RIFF" + struct.pack("<I", 4 + len(chunk)) + b"WEBP" + chunk


def test_header_facts_for_png_and_each_webp_flavour():
    assert read_facts(png_bytes(10, 20)).width == 10
    lossless = read_facts(webp_bytes(32, 16))
    assert (lossless.content_type, lossless.width, lossless.height) == ("image/webp", 32, 16)
    lossy = read_facts(vp8(300, 200))
    assert (lossy.width, lossy.height) == (300, 200)
    extended = read_facts(vp8x(512, 512))
    assert (extended.width, extended.height) == (512, 512)


@pytest.mark.parametrize(
    "data",
    [
        b"GIF89a" + b"\x00" * 60,
        b"<html><script>alert(1)</script></html>" + b"\x00" * 40,
        jpeg_bytes(),
        b"\x89PNG\r\n\x1a\n" + b"\x00" * 80,
        png_bytes()[:-3],  # truncated: no IEND
        vp8x(64, 64, flags=0x02),  # animated
        webp_bytes() + b"\x00",  # trailing bytes after the RIFF
        b"",
    ],
)
def test_header_parser_refuses_other_formats(data):
    with pytest.raises(BadCapture):
        read_facts(data)


@pytest.mark.parametrize(("width", "height"), [(64, 32), (2000, 2000), (32, 32), (1025, 1025)])
def test_dimension_rules(width, height):
    with pytest.raises(BadCapture) as bad:
        check_dimensions(read_facts(resized_png(width, height)))
    assert bad.value.code == "bad_dimensions"
    check_dimensions(read_facts(resized_png(1024, 1024)))
    check_dimensions(read_facts(resized_png(64, 64)))


# --- permissions and control -------------------------------------------------------------------


def test_anonymous_is_refused_without_a_redirect_on_upload_and_to_login_on_the_page(on, glb):
    anonymous = Client()
    refused = post(anonymous, glb, square_png())
    assert refused.status_code == 403 and refused.json()["error"]["code"] == "forbidden"
    assert anonymous.get(page(glb)).status_code == 302
    assert DerivedArtifact.objects.count() == 0


def test_staff_without_the_capture_permission_cannot_open_or_post(on, glb):
    client = login(user_with("view_assetversion", "view_derivedartifact"))
    assert client.get(page(glb)).status_code == 403
    assert post(client, glb, square_png()).status_code == 403
    assert DerivedArtifact.objects.count() == 0


def test_capture_permission_without_version_access_is_refused(on, glb):
    client = login(user_with("capture_derivedartifact"))
    assert client.get(page(glb)).status_code == 403
    assert post(client, glb, square_png()).status_code == 403


def test_control_off_refuses_the_upload_and_the_page_explains(settings, glb):
    settings.LAI_THUMBNAIL_CAPTURE = "off"
    client = login(user_with(*CAPTURER))
    refused = post(client, glb, square_png())
    assert refused.status_code == 403 and refused.json()["error"]["code"] == "capture_disabled"
    shown = client.get(page(glb))
    assert shown.status_code == 200
    assert b"switched off" in shown.content and b"data-asset-capture" not in shown.content
    assert DerivedArtifact.objects.count() == 0


def test_only_post_is_accepted_by_the_upload_route(on, glb):
    client = login(user_with(*CAPTURER))
    assert client.get(upload_url(glb)).status_code == 405
    assert client.post(page(glb)).status_code == 405  # the page is GET only


def test_csrf_is_enforced_and_the_page_token_works(on, glb):
    client = login(user_with(*CAPTURER), enforce_csrf_checks=True)
    assert post(client, glb, square_png()).status_code == 403  # no token
    html = client.get(page(glb)).content.decode()
    assert "data-asset-capture" in html and f'data-version-id="{glb.pk}"' in html
    assert f'data-source-sha256="{glb.sha256}"' in html
    token = re.search(r'name="csrfmiddlewaretoken" value="([^"]+)"', html).group(1)
    ok = post(client, glb, square_png(), HTTP_X_CSRFTOKEN=token)
    assert ok.status_code == 201, ok.content


# --- validation --------------------------------------------------------------------------------


def test_successful_capture_creates_a_private_pending_artifact_and_leaves_the_glb_alone(on, glb):
    before = get_storage().open(glb.storage_key).read()
    row_before = AssetVersion.objects.values().get(pk=glb.pk)
    client = login(user_with(*CAPTURER))
    data = square_png(64)
    response = post(client, glb, data)
    assert response.status_code == 201
    body = response.json()
    assert body["state"] == "pending_review" and body["width"] == 64
    artifact = DerivedArtifact.objects.get(pk=body["artifact_id"])
    assert artifact.role == "model.thumbnail" and artifact.producer == "staff_capture"
    assert artifact.source_version_id == glb.pk and artifact.source_sha256 == glb.sha256
    assert get_storage().open(artifact.storage_key).read() == data
    assert get_storage().open(glb.storage_key).read() == before
    assert AssetVersion.objects.values().get(pk=glb.pk) == row_before
    glb.refresh_from_db()
    assert glb.status == VersionStatus.VALIDATED  # never published by a capture


def test_webp_capture_is_accepted(on, glb):
    client = login(user_with(*CAPTURER))
    response = post(client, glb, webp_bytes(64, 64), name="c.webp")
    assert response.status_code == 201 and response.json()["content_type"] == "image/webp"


@pytest.mark.parametrize(
    ("data", "name", "status", "code"),
    [
        (b"GIF89a" + b"\x00" * 80, "c.png", 415, "bad_image"),
        (b"<html><body>hi</body></html>" + b"\x00" * 40, "c.webp", 415, "bad_image"),
        (jpeg_bytes(), "c.png", 415, "bad_image"),
        (resized_png(2048, 2048), "c.png", 422, "bad_dimensions"),
        (resized_png(256, 128), "c.png", 422, "bad_dimensions"),
        (b"\x89PNG\r\n\x1a\n" + b"0" * (512 * 1024 + 1), "c.png", 413, "size"),
    ],
)
def test_bad_uploads_are_refused_with_a_safe_message(on, glb, data, name, status, code):
    client = login(user_with(*CAPTURER))
    response = post(client, glb, data, name=name)
    assert response.status_code == status
    error = response.json()["error"]
    assert error["code"] == code and "—" not in error["message"]
    assert DerivedArtifact.objects.count() == 0 and not list(get_storage().list("processing/"))


def test_a_declared_oversized_body_is_refused_before_parsing(on, glb):
    client = login(user_with(*CAPTURER))
    response = client.post(
        upload_url(glb),
        {"version_id": str(glb.pk), "source_sha256": glb.sha256},
        CONTENT_LENGTH=str(10 * 1024 * 1024),
    )
    assert response.status_code == 413


def test_missing_image_is_refused(on, glb):
    client = login(user_with(*CAPTURER))
    response = client.post(
        upload_url(glb), {"version_id": str(glb.pk), "source_sha256": glb.sha256}
    )
    assert response.status_code == 400


def test_version_and_checksum_must_match_the_current_version(on, glb):
    other = make_version(make_definition("npc-other"))
    client = login(user_with(*CAPTURER))
    for kwargs in (
        {"version_id": other.pk},
        {"version_id": "not-a-number"},
        {"sha": other.sha256},
        {"sha": "0" * 64},
        {"sha": ""},
    ):
        response = post(client, glb, square_png(), **kwargs)
        assert response.status_code == 409, kwargs
        assert response.json()["error"]["code"] == "stale_version"
    assert DerivedArtifact.objects.count() == 0


def test_the_url_must_name_a_real_version(on, glb):
    client = login(user_with(*CAPTURER))
    response = client.post(
        f"{VERSIONS}999999/capture/upload/",
        {"version_id": "999999", "source_sha256": "x", "image": SimpleUploadedFile("c.png", b"x")},
    )
    assert response.status_code == 404


def test_draft_rejected_and_non_glb_versions_are_not_captured(on):
    client = login(user_with(*CAPTURER))
    draft = make_version(make_definition("npc-draft"), status=VersionStatus.DRAFT)
    rejected = make_version(make_definition("npc-rej"), status=VersionStatus.REJECTED)
    gltf = make_version(make_definition("npc-gltf"), format="gltf")
    for version in (draft, rejected, gltf):
        response = post(client, version, square_png())
        assert response.status_code == 409, version.status
        assert response.json()["error"]["code"] == "source_unavailable"
    assert DerivedArtifact.objects.count() == 0


def test_the_browsers_claimed_type_and_name_are_ignored(on, glb):
    client = login(user_with(*CAPTURER))
    upload = SimpleUploadedFile("evil.html", square_png(), content_type="text/html")
    response = client.post(
        upload_url(glb),
        {"version_id": str(glb.pk), "source_sha256": glb.sha256, "image": upload},
    )
    assert response.status_code == 201 and response.json()["content_type"] == "image/png"


def test_a_newer_capture_supersedes_the_older_one(on, glb):
    client = login(user_with(*CAPTURER))
    first = post(client, glb, square_png(64)).json()["artifact_id"]
    second = post(client, glb, square_png(96)).json()["artifact_id"]
    first_row = DerivedArtifact.objects.get(pk=first)
    assert first_row.state == ArtifactState.SUPERSEDED
    assert str(first_row.superseded_by_id) == second
    assert DerivedArtifact.objects.get(pk=second).state == ArtifactState.PENDING_REVIEW


# --- presentation and review -------------------------------------------------------------------


def test_the_version_page_and_list_show_the_current_capture_to_staff_who_can_view(on, glb):
    capturer = login(user_with(*CAPTURER))
    artifact_id = post(capturer, glb, square_png()).json()["artifact_id"]
    change = capturer.get(f"{VERSIONS}{glb.pk}/change/").content.decode()
    assert "Thumbnail capture" in change and f"/derivedartifact/{artifact_id}/media/" in change
    assert f"{VERSIONS}{glb.pk}/capture/" in change
    listing = capturer.get(VERSIONS).content.decode()
    assert f"/derivedartifact/{artifact_id}/media/" in listing

    plain = login(user_with("view_assetversion"))
    assert "derivedartifact" not in plain.get(f"{VERSIONS}{glb.pk}/change/").content.decode()
    assert "derivedartifact" not in plain.get(VERSIONS).content.decode()


def test_review_accepts_and_rejects_through_the_services(on, glb):
    reviewer = login(user_with(*REVIEWER))
    artifact_id = post(reviewer, glb, square_png()).json()["artifact_id"]
    shown = reviewer.get(page(glb)).content.decode()
    assert 'value="accept"' in shown and artifact_id in shown
    accepted = reviewer.post(review_url(glb), {"artifact": artifact_id, "action": "accept"})
    assert accepted.status_code == 302
    assert DerivedArtifact.objects.get(pk=artifact_id).state == ArtifactState.ACCEPTED
    reviewer.post(review_url(glb), {"artifact": artifact_id, "action": "reject"})
    assert DerivedArtifact.objects.get(pk=artifact_id).state == ArtifactState.REJECTED


def test_review_needs_the_review_permission_and_a_real_capture(on, glb):
    capturer = login(user_with(*CAPTURER))
    artifact_id = post(capturer, glb, square_png()).json()["artifact_id"]
    assert (
        capturer.post(review_url(glb), {"artifact": artifact_id, "action": "accept"}).status_code
        == 403
    )
    assert DerivedArtifact.objects.get(pk=artifact_id).state == ArtifactState.PENDING_REVIEW
    reviewer = login(user_with(*REVIEWER))
    for artifact in ("nope", "00000000-0000-0000-0000-000000000000", ""):
        response = reviewer.post(review_url(glb), {"artifact": artifact, "action": "accept"})
        assert response.status_code == 302
    other = make_version(make_definition("npc-other2"))
    foreign = post(reviewer, other, square_png()).json()["artifact_id"]
    reviewer.post(review_url(glb), {"artifact": foreign, "action": "accept"})  # wrong version
    assert DerivedArtifact.objects.get(pk=foreign).state == ArtifactState.PENDING_REVIEW


def test_review_is_csrf_protected(on, glb):
    reviewer = login(user_with(*REVIEWER), enforce_csrf_checks=True)
    response = reviewer.post(review_url(glb), {"artifact": "x", "action": "accept"})
    assert response.status_code == 403


def test_the_capture_bundle_is_shipped():
    from django.contrib.staticfiles import finders

    assert finders.find("assets/admin/asset-capture.js")
