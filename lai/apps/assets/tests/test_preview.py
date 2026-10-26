"""AM-10: the staff-only 3D model preview in Django Admin (LAI-2200, ADR-035)."""

import hashlib
import io
import logging
import time

import pytest
from django.contrib.staticfiles import finders
from django.core.management import call_command
from django.test import Client, override_settings

from apps.assets import preview, services
from apps.assets.management.commands.ensure_asset_roles import EDITORS, PUBLISHERS
from apps.assets.models import AssetVersion, ModelFormat, VersionStatus
from apps.assets.tests.helpers import glb_bytes, gltf_json_bytes, make_definition, make_version
from apps.assets.tests.test_admin import staff
from apps.users.models import ParentAccount

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

VERSIONS = "/admin/assets/assetversion/"
DEFINITIONS = "/admin/catalog/contentasset/"


@pytest.fixture(autouse=True)
def roles():
    call_command("ensure_asset_roles", verbosity=0)


def page_url(version) -> str:
    return f"{VERSIONS}{version.pk}/preview/"


def file_url(version) -> str:
    return f"{VERSIONS}{version.pk}/preview/model/"


def uploaded(asset_id="npc-pip", data=None, name="pip.glb"):
    asset = make_definition(asset_id)
    return services.upload_version(asset, io.BytesIO(data or glb_bytes()), original_filename=name)


def account(client) -> ParentAccount:
    return ParentAccount.objects.get(pk=client.session["_auth_user_id"])


def fetch(client, version, token=None):
    """The viewer's request: the token travels in a header, never in the URL."""
    if token is None:
        token = preview.issue_token(version, account(client)).value
    return client.get(file_url(version), headers={preview.TOKEN_HEADER: token})


def body_of(response) -> bytes:
    return b"".join(response.streaming_content)


def snapshot(version) -> dict:
    version.refresh_from_db()
    version.asset.refresh_from_db()
    return {
        "status": version.status,
        "published_at": version.published_at,
        "retired_at": version.retired_at,
        "notes": version.notes,
        "default": version.asset.default_version_id,
        "asset_status": version.asset.status,
        "asset_updated": getattr(version.asset, "updated_at", None),
    }


# --- the preview page -----------------------------------------------------------------------


@pytest.mark.parametrize("groups", [(EDITORS,), (PUBLISHERS,)])
def test_asset_roles_open_the_preview_of_an_unpublished_version(groups):
    client = staff("someone", *groups)
    version = uploaded()
    assert version.status == VersionStatus.VALIDATED
    response = client.get(page_url(version))
    assert response.status_code == 200
    html = response.content.decode()
    assert "data-asset-preview" in html and f'data-model-url="{file_url(version)}"' in html
    assert 'data-format="glb"' in html and "asset-preview.js" in html
    assert f'data-token-header="{preview.TOKEN_HEADER}"' in html
    # The page names no storage location and no delivery URL.
    assert version.storage_key not in html and "/api/v1/asset-files/" not in html


def test_superusers_open_the_preview():
    client = staff("root", superuser=True)
    assert client.get(page_url(uploaded())).status_code == 200


def test_the_page_shows_the_version_facts():
    client = staff("publisher", PUBLISHERS)
    version = uploaded(data=glb_bytes(clips=("Idle", "Talk")))
    services.publish_version(version)
    version.refresh_from_db()
    response = client.get(page_url(version))
    facts = dict(response.context["summary"])
    assert facts["Asset"] == "Npc Pip (npc-pip)"
    assert facts["Version"] == f"1 ({version.version_id})"
    assert facts["Format"] == "glTF binary (.glb)"
    assert facts["File size"] == f"{version.size_bytes:,} bytes"
    assert facts["Validation"] == "Passed"
    assert facts["Lifecycle"] == "Published"
    assert facts["Default version"].startswith("Yes")
    assert facts["Animation clips"] == "Idle, Talk"
    assert facts["Bounding box"].endswith(" m")
    for label in facts:
        assert label in response.content.decode()


def test_a_published_version_that_is_not_the_default_says_so():
    client = staff("publisher", PUBLISHERS)
    first = uploaded()
    services.publish_version(first)
    second = services.upload_version(
        first.asset, io.BytesIO(glb_bytes(half_size=(1, 1, 1))), original_filename="b.glb"
    )
    services.publish_version(second)
    facts = dict(client.get(page_url(second)).context["summary"])
    assert facts["Lifecycle"] == "Published" and facts["Default version"] == "No"


def test_viewing_the_preview_and_its_file_changes_nothing():
    client = staff("publisher", PUBLISHERS)
    version = uploaded()
    before = snapshot(version)
    assert client.get(page_url(version)).status_code == 200
    assert fetch(client, version).status_code == 200
    assert snapshot(version) == before
    services.publish_version(version)
    before = snapshot(version)
    client.get(page_url(version))
    fetch(client, version)
    assert snapshot(version) == before
    assert AssetVersion.objects.count() == 1


def test_staff_without_an_asset_role_cannot_open_the_preview():
    client = staff("viewer")
    version = uploaded()
    assert client.get(page_url(version)).status_code == 403


@pytest.mark.parametrize("who", ["anonymous", "parent"])
def test_non_staff_are_sent_to_the_admin_login(who):
    client = Client()
    if who == "parent":
        parent = ParentAccount.objects.get_or_create_for_cognito("sub-parent")
        client.force_login(parent, backend="apps.users.backends.AdminPasswordBackend")
    response = client.get(page_url(uploaded()))
    assert response.status_code == 302 and "/admin/login/" in response["Location"]


def test_a_missing_version_redirects_like_any_missing_admin_object():
    client = staff("editor", EDITORS)
    response = client.get(f"{VERSIONS}987654/preview/")
    assert response.status_code == 302 and response["Location"] == "/admin/"


def test_a_non_numeric_id_is_not_routed_to_the_preview():
    client = staff("editor", EDITORS)
    response = client.get(f"{VERSIONS}..%2F..%2Fetc/preview/model/")
    assert response.status_code in (302, 404)
    assert b"root:" not in response.content


@pytest.mark.parametrize("status", [VersionStatus.DRAFT, VersionStatus.REJECTED])
def test_draft_and_rejected_versions_are_not_previewed(status):
    client = staff("editor", EDITORS)
    version = make_version(make_definition("npc-pip"), status=status)
    response = client.get(page_url(version))
    assert response.status_code == 200
    assert response.context["refusal"].code == "not_previewable"
    assert "data-asset-preview" not in response.content.decode()
    assert "preview_token" not in response.context
    refused = fetch(client, version)
    assert refused.status_code == 409 and refused.json()["error"]["code"] == "not_previewable"


def test_a_retired_version_can_still_be_inspected(storage):
    client = staff("publisher", PUBLISHERS)
    version = uploaded()
    services.publish_version(version)
    services.retire_asset(version.asset)
    version.refresh_from_db()
    # Retiring the definition does not stop staff inspecting the file.
    assert client.get(page_url(version)).status_code == 200
    assert fetch(client, version).status_code == 200


def test_an_oversized_version_is_refused_on_the_page_and_the_file():
    client = staff("editor", EDITORS)
    version = uploaded()
    with override_settings(LAI_ASSET_MAX_UPLOAD_BYTES=version.size_bytes - 1):
        page = client.get(page_url(version))
        assert page.context["refusal"].code == "too_large"
        token = preview.issue_token(version, account(client)).value
        refused = fetch(client, version, token)
    assert refused.status_code == 413 and refused.json()["error"]["code"] == "too_large"


# --- the file route ---------------------------------------------------------------------------


def test_the_file_is_the_stored_bytes_and_is_never_cached():
    client = staff("editor", EDITORS)
    data = glb_bytes()
    version = uploaded(data=data)
    response = fetch(client, version)
    assert response.status_code == 200 and body_of(response) == data
    assert response["Content-Type"] == "model/gltf-binary"
    assert response["Content-Length"] == str(len(data))
    assert "no-store" in response["Cache-Control"] and "private" in response["Cache-Control"]


def test_a_self_contained_gltf_is_served_as_gltf_json():
    client = staff("editor", EDITORS)
    data = gltf_json_bytes()
    version = uploaded(data=data, name="pip.gltf")
    assert version.format == ModelFormat.GLTF
    response = fetch(client, version)
    assert response.status_code == 200 and body_of(response) == data
    assert response["Content-Type"] == "model/gltf+json"
    page = client.get(page_url(version)).content.decode()
    assert 'data-format="gltf"' in page


@pytest.mark.parametrize("who", ["anonymous", "parent", "staff-without-role"])
def test_the_file_refuses_everyone_else_with_json_and_no_data(who):
    version = uploaded()
    if who == "anonymous":
        client = Client()
    elif who == "parent":
        client = Client()
        parent = ParentAccount.objects.get_or_create_for_cognito("sub-parent")
        client.force_login(parent, backend="apps.users.backends.AdminPasswordBackend")
    else:
        client = staff("viewer")
    # Even holding a genuine token for the version (issued to an editor) changes nothing.
    editor = staff("editor", EDITORS)
    token = preview.issue_token(version, account(editor)).value
    response = client.get(file_url(version), headers={preview.TOKEN_HEADER: token})
    assert response.status_code == 403
    assert response["Content-Type"] == "application/json"
    assert response.json()["error"]["code"] == "forbidden"
    body = response.content.decode()
    assert version.storage_key not in body and version.sha256 not in body


def test_the_file_needs_the_token_header():
    client = staff("editor", EDITORS)
    version = uploaded()
    response = client.get(file_url(version))
    assert response.status_code == 404 and response.json()["error"]["code"] == "not_found"
    token = preview.issue_token(version, account(client)).value
    in_query = client.get(f"{file_url(version)}?token={token}")
    assert in_query.status_code == 404  # a token in the URL is never read


def test_a_token_for_another_version_or_account_or_a_forged_one_reads_as_missing():
    client = staff("editor", EDITORS)
    version = uploaded()
    other = uploaded("treasure-chest")
    other_account = account(staff("publisher", PUBLISHERS))
    for token in (
        preview.issue_token(other, account(client)).value,
        preview.issue_token(version, other_account).value,
        "forged.token.value",
        preview.issue_token(version, account(client)).value[:-2] + "xx",
    ):
        response = fetch(client, version, token)
        assert response.status_code == 404, token
        assert response.json()["error"]["code"] == "not_found"


def test_a_gameplay_delivery_token_is_not_a_preview_token():
    from apps.assets.delivery import SALT, signing

    client = staff("editor", EDITORS)
    version = uploaded()
    gameplay = signing.dumps(
        {"v": str(version.version_id), "u": str(account(client).pk), "e": int(time.time()) + 60},
        salt=SALT,
    )
    assert fetch(client, version, gameplay).status_code == 404


def test_an_expired_token_is_refused_and_says_to_reload():
    client = staff("editor", EDITORS)
    version = uploaded()
    stale = preview.issue_token(
        version, account(client), now=time.time() - preview.PREVIEW_TTL_SECONDS - 1
    )
    assert stale.expires_at < time.time()
    response = fetch(client, version, stale.value)
    assert response.status_code == 410
    error = response.json()["error"]
    assert error["code"] == "preview_expired" and "Reload" in error["message"]


def test_the_token_lifetime_is_short():
    client = staff("editor", EDITORS)
    version = uploaded()
    now = time.time()
    token = preview.issue_token(version, account(client), now=now)
    assert token.expires_at - int(now) == preview.PREVIEW_TTL_SECONDS <= 900
    preview.check_token(token.value, version, account(client), now=now + 1)
    with pytest.raises(preview.PreviewRefused) as refused:
        preview.check_token(token.value, version, account(client), now=token.expires_at)
    assert refused.value.status == 410


def test_a_missing_version_file_is_a_json_404():
    client = staff("editor", EDITORS)
    response = client.get(f"{VERSIONS}987654/preview/model/", headers={preview.TOKEN_HEADER: "x"})
    assert response.status_code == 404 and response.json()["error"]["code"] == "not_found"


@pytest.mark.parametrize("failure", ["open", "missing"])
def test_a_storage_failure_is_a_safe_503(storage, failure):
    client = staff("editor", EDITORS)
    version = uploaded()
    token = preview.issue_token(version, account(client)).value
    if failure == "open":
        storage.fail_next.add("open")
    else:
        storage.objects.pop(version.storage_key)
    response = fetch(client, version, token)
    assert response.status_code == 503
    error = response.json()["error"]
    assert error["code"] == "content_unavailable" and "simulated" not in error["message"]
    assert version.storage_key not in response.content.decode()


def test_bytes_that_no_longer_match_the_checksum_are_not_served(storage):
    client = staff("editor", EDITORS)
    version = uploaded()
    _, content_type, stamp = storage.objects[version.storage_key]
    tampered = glb_bytes(half_size=(9, 9, 9))
    storage.objects[version.storage_key] = (tampered, content_type, stamp)
    response = fetch(client, version)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "checksum_mismatch"
    assert tampered not in response.content


class RecordingStream(io.BytesIO):
    """A stored file that remembers the largest single read made from it."""

    largest_read = 0

    def read(self, size=-1):
        data = super().read(size)
        RecordingStream.largest_read = max(RecordingStream.largest_read, len(data))
        return data


def test_the_checksum_and_the_response_read_in_bounded_chunks(storage, monkeypatch):
    from apps.assets.storage import CHUNK

    client = staff("editor", EDITORS)
    big = glb_bytes()
    big += b"\x00" * (3 * CHUNK)  # a file several chunks long (validation is bypassed below)
    version = uploaded()
    _, content_type, stamp = storage.objects[version.storage_key]
    storage.objects[version.storage_key] = (big, content_type, stamp)
    AssetVersion.objects.filter(pk=version.pk).update(
        size_bytes=len(big), sha256=hashlib.sha256(big).hexdigest()
    )
    version.refresh_from_db()
    RecordingStream.largest_read = 0
    monkeypatch.setattr(storage, "open", lambda key: RecordingStream(storage.objects[key][0]))
    response = fetch(client, version)
    assert response.status_code == 200 and response.streaming
    assert body_of(response) == big
    assert 0 < RecordingStream.largest_read <= CHUNK


def test_a_read_error_while_checksumming_is_a_safe_503(storage, monkeypatch):
    class Failing(io.BytesIO):
        def read(self, size=-1):
            raise OSError("disk gone")

    client = staff("editor", EDITORS)
    version = uploaded()
    monkeypatch.setattr(storage, "open", lambda key: Failing(b""))
    response = fetch(client, version)
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "content_unavailable"
    assert "disk gone" not in response.content.decode()


def test_only_get_is_allowed():
    client = staff("editor", EDITORS)
    version = uploaded()
    token = preview.issue_token(version, account(client)).value
    response = client.post(file_url(version), headers={preview.TOKEN_HEADER: token})
    assert response.status_code == 405


def test_logs_never_carry_the_token_or_storage_key(caplog):
    client = staff("editor", EDITORS)
    version = uploaded()
    with caplog.at_level(logging.DEBUG, logger="lai.assets"):
        page = client.get(page_url(version))
        token = page.context["preview_token"]
        fetch(client, version, token)
    assert "asset version previewed: npc-pip v1" in caplog.text
    assert token not in caplog.text and version.storage_key not in caplog.text


# --- links from the existing admin pages ------------------------------------------------------


def test_the_version_list_and_change_page_link_to_the_preview():
    client = staff("editor", EDITORS)
    version = uploaded()
    rejected = make_version(version.asset, status=VersionStatus.REJECTED)
    listing = client.get(VERSIONS).content.decode()
    assert page_url(version) in listing and "Not previewable (rejected" in listing
    assert page_url(rejected) not in listing
    change = client.get(f"{VERSIONS}{version.pk}/change/").content.decode()
    assert page_url(version) in change


def test_the_definition_page_links_its_default_and_each_version():
    client = staff("publisher", PUBLISHERS)
    version = uploaded()
    services.publish_version(version)
    newer = services.upload_version(
        version.asset, io.BytesIO(glb_bytes(half_size=(2, 2, 2))), original_filename="n.glb"
    )
    page = client.get(f"{DEFINITIONS}{version.asset.pk}/change/").content.decode()
    assert page_url(version) in page  # the definition's own link: its default
    assert page_url(newer) in page  # the versions inline


def test_a_definition_without_a_default_links_its_newest_previewable_version():
    client = staff("editor", EDITORS)
    version = uploaded()
    page = client.get(f"{DEFINITIONS}{version.asset.pk}/change/").content.decode()
    assert page_url(version) in page


def test_staff_without_version_access_see_no_preview_link_on_definitions():
    client = staff("viewer")
    version = uploaded()
    page = client.get(f"{DEFINITIONS}{version.asset.pk}/change/")
    assert page.status_code == 200
    assert page_url(version) not in page.content.decode()


def test_the_viewer_bundle_and_stylesheet_ship_as_admin_static_files():
    for name in ("assets/admin/asset-preview.js", "assets/admin/asset-preview.css"):
        found = finders.find(name)
        assert found, name
    with open(finders.find("assets/admin/asset-preview.js"), encoding="utf-8") as bundle:
        source = bundle.read()
    assert "sourceMappingURL" not in source  # collectstatic's manifest would chase it
    assert "data-asset-preview" in source


# --- the facts, without a request -------------------------------------------------------------


def test_validation_summary_reports_warnings_errors_and_unvalidated():
    asset = make_definition("npc-pip")
    warned = make_version(
        asset,
        validation_report=[{"code": "w", "severity": "warning", "message": "m", "path": ""}],
    )
    assert dict(preview.summary(warned))["Validation"] == "Passed (1 warning(s))"
    failed = make_version(
        asset,
        status=VersionStatus.REJECTED,
        validation_report=[{"code": "e", "severity": "error", "message": "m", "path": ""}],
    )
    assert dict(preview.summary(failed))["Validation"] == "Failed (1 error(s))"
    draft = make_version(asset, status=VersionStatus.DRAFT)
    assert dict(preview.summary(draft))["Validation"] == "Not validated"
    assert dict(preview.summary(draft))["Bounding box"] == "Unknown"


def test_only_active_staff_with_version_access_may_preview():
    editor = account(staff("editor", EDITORS))
    assert preview.can_preview(editor)
    editor.is_active = False
    assert not preview.can_preview(editor)
    assert not preview.can_preview(account(staff("viewer")))
    assert not preview.can_preview(ParentAccount.objects.get_or_create_for_cognito("sub-p"))
    assert not preview.can_preview(None)
