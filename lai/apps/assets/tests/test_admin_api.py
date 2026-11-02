"""The asset manager's administrator API (AM-14; `apps/assets/admin_api.py`).

Signed test tokens, a fake Cognito `GetUser` and the in-memory asset store; nothing contacts
AWS. Every mutation needs a recent sign-in (`MUTATION_GATE`, LAI-0209). The `admin` fixture's
token is a recent sign-in (Cognito `auth_time` a minute ago); `recent_sign_in` names that
precondition in the tests that exercise what a mutation does.
"""

import json
import time

import pytest

from apps.assets import admin_api
from apps.assets.models import AssetVersion, VersionStatus
from apps.catalog.models import AssetOrigin, ContentAsset
from apps.users.permissions import RequiresRecentAuthentication

from .helpers import glb_bytes, make_definition, make_version

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

LIST = "/api/v1/admin/assets/"
ADMINS = {"cognito:groups": ["Admins"]}


def detail(asset_id):
    return f"{LIST}{asset_id}/"


def versions(asset_id):
    return f"{LIST}{asset_id}/versions/"


def version(asset_id, number, action=""):
    return f"{LIST}{asset_id}/versions/{number}/" + (f"{action}/" if action else "")


@pytest.fixture
def admin(families, api, token_for):
    """Family A's parent, signed in with a token in the Cognito `Admins` group."""
    return api(token=token_for(families.a.cognito_sub, **ADMINS))


@pytest.fixture
def parent(families, api):
    """Family B's parent: a valid token without the `Admins` group."""
    return api(families.b)


@pytest.fixture
def recent_sign_in(cognito_revocation):
    """The real guard runs: the admin token's sign-in is recent and Cognito accepts it."""
    assert admin_api.MUTATION_GATE is RequiresRecentAuthentication
    return cognito_revocation


@pytest.fixture
def stale_admin(families, api, token_for):
    """Family A's administrator, whose Cognito sign-in was an hour ago (token still valid)."""
    signed = int(time.time()) - 3600
    return api(token=token_for(families.a.cognito_sub, auth_time=signed, iat=signed, **ADMINS))


def post_json(client, url, body=None):
    return client.post(url, data=json.dumps(body or {}), content_type="application/json")


def upload(client, asset_id, data, name="model.glb"):
    from django.core.files.uploadedfile import SimpleUploadedFile

    return client.post(versions(asset_id), {"file": SimpleUploadedFile(name, data)})


def error_code(response):
    return response.json()["error"]["code"]


# --- authorization -----------------------------------------------------------------------------


def test_reads_need_a_signed_in_administrator(admin, parent, api):
    make_definition()
    assert api().get(LIST).status_code == 401
    refused = parent.get(LIST)
    assert refused.status_code == 403 and error_code(refused) == "permission_denied"
    assert parent.get(detail("npc-pip")).status_code == 403
    listed = admin.get(LIST)
    assert listed.status_code == 200
    assert [a["assetId"] for a in listed.json()["assets"]] == ["npc-pip"]


@pytest.mark.parametrize(
    "method,url",
    [
        ("post", LIST),
        ("post", versions("npc-pip")),
        ("delete", version("npc-pip", 1)),
        ("post", version("npc-pip", 1, "publish")),
        ("post", version("npc-pip", 1, "default")),
        ("post", version("npc-pip", 1, "retire")),
    ],
)
def test_an_administrator_with_a_stale_sign_in_must_verify_again(
    stale_admin, storage, cognito_revocation, method, url
):
    asset = make_definition()
    make_version(asset, 1)
    response = getattr(stale_admin, method)(url)
    assert response.status_code == 403
    assert error_code(response) == "recent_auth_required"
    assert AssetVersion.objects.get().status == VersionStatus.VALIDATED
    assert ContentAsset.objects.count() == 1
    assert cognito_revocation.calls == 0
    assert stale_admin.get(LIST).status_code == 200  # reads need no recent sign-in


def test_a_recent_sign_in_never_grants_administration(parent, storage, cognito_revocation):
    make_definition()
    response = upload(parent, "npc-pip", glb_bytes())
    assert response.status_code == 403 and error_code(response) == "permission_denied"
    assert post_json(parent, LIST, {"assetId": "x"}).status_code == 403
    assert cognito_revocation.calls == 0  # refused as unauthorized before any recency check


def test_a_stale_non_administrator_is_refused_as_unauthorized(api, families, token_for, storage):
    signed = int(time.time()) - 3600
    stale = api(token=token_for(families.b.cognito_sub, auth_time=signed, iat=signed))
    response = post_json(stale, LIST, {"assetId": "x"})
    assert response.status_code == 403 and error_code(response) == "permission_denied"


def test_an_administrator_mutation_fails_closed_without_cognito(admin, storage, cognito_revocation):
    cognito_revocation.unavailable = True
    response = post_json(admin, LIST, {"assetId": "harbor-crane"})
    assert response.status_code == 503 and error_code(response) == "recent_auth_unavailable"
    assert not ContentAsset.objects.filter(asset_id="harbor-crane").exists()


def test_a_revoked_administrator_token_cannot_mutate(admin, storage, cognito_revocation):
    cognito_revocation.revoked = True
    response = post_json(admin, LIST, {"assetId": "harbor-crane"})
    assert response.status_code == 401


def test_a_non_administrator_is_refused_even_with_the_recent_sign_in(
    parent, recent_sign_in, storage
):
    make_definition()
    response = upload(parent, "npc-pip", glb_bytes())
    assert response.status_code == 403 and error_code(response) == "permission_denied"
    assert list(storage.list("assets/")) == []
    assert post_json(parent, LIST, {"assetId": "x"}).status_code == 403


# --- definitions -------------------------------------------------------------------------------


def test_an_administrator_creates_a_django_definition(admin, recent_sign_in, families):
    body = {
        "assetId": "harbor-crane",
        "displayName": "Harbor crane",
        "description": "Lifts crates.",
        "kind": "prop",
        "category": "building",
        "tags": ["harbor"],
    }
    response = post_json(admin, LIST, body)
    assert response.status_code == 201
    created = ContentAsset.objects.get(asset_id="harbor-crane")
    assert created.origin == AssetOrigin.DJANGO and created.created_by == families.a
    assert response.json()["versions"] == [] and response.json()["defaultVersion"] is None

    again = post_json(admin, LIST, body)  # a retry after a lost response
    assert again.status_code == 409 and error_code(again) == "asset_exists"


@pytest.mark.parametrize(
    "change,field",
    [
        ({"assetId": "Harbor_Crane"}, "assetId"),
        ({"kind": "spaceship"}, "kind"),
        ({"category": "npc"}, "category"),  # a prop cannot be an NPC
        ({"displayName": ""}, "displayName"),
    ],
)
def test_an_invalid_definition_is_refused_with_field_errors(admin, recent_sign_in, change, field):
    body = {"assetId": "crane", "displayName": "Crane", "kind": "prop", "category": "prop"}
    response = post_json(admin, LIST, {**body, **change})
    assert response.status_code == 400 and error_code(response) == "validation_error"
    assert field in response.json()["error"]["details"]
    assert not ContentAsset.objects.exists()


def test_definitions_are_never_deleted_through_the_api(admin, recent_sign_in):
    make_definition()
    assert admin.delete(detail("npc-pip")).status_code == 405
    assert ContentAsset.objects.filter(asset_id="npc-pip").exists()


# --- uploads -----------------------------------------------------------------------------------


def test_an_upload_is_validated_and_stored_under_an_opaque_key(admin, recent_sign_in, storage):
    make_definition()
    response = upload(admin, "npc-pip", glb_bytes(), name="../../etc/Pip Final.glb")
    assert response.status_code == 201
    body = response.json()
    assert body["number"] == 1 and body["status"] == VersionStatus.VALIDATED
    assert body["originalFilename"] == "Pip Final.glb" and body["clips"] == ["Idle"]

    stored = AssetVersion.objects.get()
    keys = [item.key for item in storage.list("assets/")]
    assert keys == [stored.storage_key]
    assert stored.storage_key == f"assets/models/npc-pip/{stored.version_id}/model.glb"
    text = response.content.decode()
    assert "storage_key" not in text and "assets/models" not in text and "bucket" not in text


def test_a_repeated_upload_reports_the_existing_version(admin, recent_sign_in, storage):
    make_definition()
    assert upload(admin, "npc-pip", glb_bytes()).status_code == 201
    retry = upload(admin, "npc-pip", glb_bytes())
    assert retry.status_code == 409 and error_code(retry) == "duplicate_version"
    assert retry.json()["error"]["details"] == {"version": 1}
    assert AssetVersion.objects.count() == 1 and len(list(storage.list("assets/"))) == 1


def test_an_invalid_model_is_refused_with_findings_and_nothing_is_kept(
    admin, recent_sign_in, storage
):
    make_definition()
    response = upload(admin, "npc-pip", b"not a model at all")
    assert response.status_code == 400 and error_code(response) == "invalid_model"
    findings = response.json()["error"]["details"]["findings"]
    assert findings and all(f["severity"] in ("error", "warning") for f in findings)
    assert not AssetVersion.objects.exists() and list(storage.list("assets/")) == []


def test_an_oversized_upload_is_refused(admin, recent_sign_in, storage, settings):
    make_definition()
    settings.LAI_ASSET_MAX_UPLOAD_BYTES = 1024
    response = upload(admin, "npc-pip", glb_bytes() + b"\0" * 2048)
    assert response.status_code == 413 and error_code(response) == "asset_too_large"
    assert not AssetVersion.objects.exists()


def test_a_missing_file_or_unknown_asset_is_refused(admin, recent_sign_in):
    make_definition()
    missing = admin.post(versions("npc-pip"), {})
    assert missing.status_code == 400 and "file" in missing.json()["error"]["details"]
    assert upload(admin, "no-such-asset", glb_bytes()).status_code == 404


def test_a_storage_failure_keeps_nothing_and_can_be_retried(admin, recent_sign_in, storage):
    make_definition()
    storage.fail_next.add("put")
    failed = upload(admin, "npc-pip", glb_bytes())
    assert failed.status_code == 503 and error_code(failed) == "storage_failed"
    assert not AssetVersion.objects.exists()
    assert upload(admin, "npc-pip", glb_bytes()).status_code == 201


def test_a_retired_definition_takes_no_upload(admin, recent_sign_in):
    from apps.assets import services

    services.retire_asset(make_definition())
    response = upload(admin, "npc-pip", glb_bytes())
    # Validation already refuses a retired definition, before the service's own check.
    assert response.status_code == 400 and error_code(response) == "invalid_model"
    codes = {f["code"] for f in response.json()["error"]["details"]["findings"]}
    assert "asset_retired" in codes
    assert not AssetVersion.objects.exists()


# --- publication and deletion ------------------------------------------------------------------


def test_publish_makes_the_first_version_the_default(admin, recent_sign_in, storage):
    make_definition()
    assert upload(admin, "npc-pip", glb_bytes()).status_code == 201
    published = post_json(admin, version("npc-pip", 1, "publish"))
    assert published.status_code == 200 and published.json()["status"] == "PUBLISHED"
    assert admin.get(detail("npc-pip")).json()["defaultVersion"] == 1
    again = post_json(admin, version("npc-pip", 1, "publish"))
    assert again.status_code == 409 and error_code(again) == "not_validated"


def test_published_versions_are_never_deleted(admin, recent_sign_in, storage):
    make_definition()
    upload(admin, "npc-pip", glb_bytes())
    post_json(admin, version("npc-pip", 1, "publish"))
    response = admin.delete(version("npc-pip", 1))
    assert response.status_code == 409 and error_code(response) == "published"
    assert AssetVersion.objects.get().status == VersionStatus.PUBLISHED
    assert len(list(storage.list("assets/"))) == 1


def test_deleting_an_unpublished_version_removes_its_file_after_commit(
    admin, recent_sign_in, storage, django_capture_on_commit_callbacks
):
    make_definition()
    upload(admin, "npc-pip", glb_bytes())
    with django_capture_on_commit_callbacks(execute=True):
        response = admin.delete(version("npc-pip", 1))
    assert response.status_code == 204
    assert not AssetVersion.objects.exists() and list(storage.list("assets/")) == []
    assert admin.delete(version("npc-pip", 1)).status_code == 404  # a retry: already gone


def test_the_default_version_is_retired_only_with_a_replacement(admin, recent_sign_in):
    asset = make_definition()
    first = make_version(asset, 1, status=VersionStatus.PUBLISHED)
    make_version(asset, 2, status=VersionStatus.PUBLISHED)
    asset.default_version = first
    asset.save()

    refused = post_json(admin, version("npc-pip", 1, "retire"))
    assert refused.status_code == 409 and error_code(refused) == "default_in_use"
    retired = post_json(admin, version("npc-pip", 1, "retire"), {"replacement": 2})
    assert retired.status_code == 200 and retired.json()["status"] == "RETIRED"
    assert admin.get(detail("npc-pip")).json()["defaultVersion"] == 2
    bad = post_json(admin, version("npc-pip", 2, "retire"), {"replacement": "1"})
    assert bad.status_code == 400


def test_make_default_needs_a_published_version(admin, recent_sign_in):
    asset = make_definition()
    make_version(asset, 1, status=VersionStatus.PUBLISHED)
    make_version(asset, 2)
    refused = post_json(admin, version("npc-pip", 2, "default"))
    assert refused.status_code == 409 and error_code(refused) == "not_published"
    assert post_json(admin, version("npc-pip", 1, "default")).status_code == 200


# --- what the detail shows ---------------------------------------------------------------------


def test_the_detail_counts_uses_in_published_3d_areas(treasure, api, token_for):
    admin = api(token=token_for(treasure.families.a.cognito_sub, **ADMINS))
    body = admin.get(detail("treasure-chest")).json()
    assert body["publishedReferences"] >= 1
    assert "versions" in body and "storage_key" not in json.dumps(body)
