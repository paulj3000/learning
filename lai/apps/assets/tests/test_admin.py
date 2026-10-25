"""AM-5: asset management in Django Admin, by role (LAI-2200, ADR-035)."""

import pytest
from django.contrib.auth.models import Group, Permission
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.test import Client
from django.urls import reverse

from apps.assets import services
from apps.assets.management.commands.ensure_asset_roles import EDITORS, PUBLISHERS, ROLES
from apps.assets.models import AssetVersion, VersionStatus
from apps.assets.tests.helpers import glb_bytes, make_definition
from apps.catalog.models import AssetOrigin, AssetStatus, ContentAsset
from apps.users.models import ADMIN_ONLY_SUB_PREFIX, ParentAccount

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

UPLOAD = "/admin/assets/assetversion/upload/"
VERSIONS = "/admin/assets/assetversion/"
DEFINITIONS = "/admin/catalog/contentasset/"


@pytest.fixture(autouse=True)
def roles():
    call_command("ensure_asset_roles", verbosity=0)


def staff(username, *groups, superuser=False):
    account = ParentAccount.objects.create(
        cognito_sub=f"{ADMIN_ONLY_SUB_PREFIX}{username}",
        admin_username=username,
        is_staff=True,
        is_superuser=superuser,
    )
    account.groups.set(Group.objects.filter(name__in=groups))
    client = Client()
    client.force_login(account, backend="apps.users.backends.AdminPasswordBackend")
    return client


def upload_through_admin(client, asset, data=None, name="pip.glb"):
    return client.post(
        UPLOAD,
        {
            "asset": asset.pk,
            "model_file": SimpleUploadedFile(name, data or glb_bytes()),
            "notes": "",
        },
    )


def run_action(client, action, *versions):
    return client.post(
        VERSIONS,
        {"action": action, "_selected_action": [v.pk for v in versions], "index": 0},
        follow=True,
    )


def test_roles_are_exact_and_idempotent():
    group = Group.objects.get(name=EDITORS)
    group.permissions.add(Permission.objects.get(codename="publish_assetversion"))  # by hand
    call_command("ensure_asset_roles", verbosity=0)
    for name, expected in ROLES.items():
        granted = {
            f"{p.content_type.app_label}.{p.codename}"
            for p in Group.objects.get(name=name).permissions.select_related("content_type")
        }
        assert granted == set(expected)
    assert "assets.publish_assetversion" not in ROLES[EDITORS]
    assert {"assets.publish_assetversion", "assets.retire_assetversion"} <= set(ROLES[PUBLISHERS])


def test_staff_without_an_asset_role_see_definitions_but_cannot_manage_assets():
    client = staff("viewer")
    make_definition("npc-pip")
    assert client.get(DEFINITIONS).status_code == 200
    assert client.get(f"{DEFINITIONS}add/").status_code == 403
    assert client.get(VERSIONS).status_code == 403
    assert client.get(UPLOAD).status_code == 403


def test_a_parent_never_reaches_the_asset_screens():
    parent = ParentAccount.objects.get_or_create_for_cognito("sub-parent")
    client = Client()
    client.force_login(parent, backend="apps.users.backends.AdminPasswordBackend")
    for url in (UPLOAD, VERSIONS, DEFINITIONS):
        response = client.get(url)
        assert response.status_code == 302 and "/admin/login/" in response["Location"]


def test_an_editor_creates_a_definition_and_kind_category_must_match():
    client = staff("editor", EDITORS)
    response = client.post(
        f"{DEFINITIONS}add/",
        {"asset_id": "pirate-captain", "kind": "character", "category": "building",
         "display_name": "Pirate Captain", "description": "", "tags": "", "clips": ""},
    )
    assert response.status_code == 200 and b"cannot be in the" in response.content
    assert not ContentAsset.objects.filter(asset_id="pirate-captain").exists()
    response = client.post(
        f"{DEFINITIONS}add/",
        {"asset_id": "pirate-captain", "kind": "character", "category": "npc",
         "display_name": "Pirate Captain", "description": "Leads the bay crew.",
         "tags": "pirates,bay", "clips": "Idle"},
    )
    assert response.status_code == 302, response.context["adminform"].form.errors
    asset = ContentAsset.objects.get(asset_id="pirate-captain")
    assert asset.origin == AssetOrigin.DJANGO and asset.last_seen_release is None
    assert asset.tags == ["pirates", "bay"] and asset.clips == ["Idle"]
    assert asset.created_by.admin_username == "editor"


def test_an_editor_uploads_and_sees_the_detected_metadata(storage):
    client = staff("editor", EDITORS)
    pip = make_definition("npc-pip")
    response = upload_through_admin(client, pip, glb_bytes(clips=("Idle", "Talk")))
    version = AssetVersion.objects.get()
    assert response.status_code == 302 and response["Location"].endswith(f"/{version.pk}/change/")
    assert version.status == VersionStatus.VALIDATED
    assert version.uploaded_by.admin_username == "editor"
    assert storage.exists(version.storage_key)
    page = client.get(response["Location"])
    assert page.status_code == 200
    for text in (b"Idle", b"Talk", version.sha256.encode(), b"Validation findings"):
        assert text in page.content


def test_an_invalid_upload_shows_structured_findings_and_stores_nothing(storage):
    client = staff("editor", EDITORS)
    pip = make_definition("npc-pip")
    response = upload_through_admin(client, pip, b"PK\x03\x04 zip", name="pip.glb")
    assert response.status_code == 200
    assert b"did not pass validation" in response.content and b"not_a_model" in response.content
    assert not AssetVersion.objects.exists() and not list(storage.list())


def test_an_editor_cannot_publish_or_retire(storage):
    client = staff("editor", EDITORS)
    version = new_version(make_definition("npc-pip"))
    run_action(client, "publish_versions", version)
    version.refresh_from_db()
    assert version.status == VersionStatus.VALIDATED
    page = client.get(VERSIONS)
    assert b"publish_versions" not in page.content and b"retire_versions" not in page.content


def test_a_publisher_publishes_changes_the_default_and_retires():
    client = staff("publisher", PUBLISHERS)
    pip = make_definition("npc-pip")
    first = services.upload_version(pip, _file(clips=("Idle",)), original_filename="a.glb")
    second = services.upload_version(pip, _file(clips=("Idle", "Wave")), original_filename="b.glb")
    run_action(client, "publish_versions", first, second)
    pip.refresh_from_db()
    assert pip.default_version == first
    assert set(AssetVersion.objects.values_list("status", flat=True)) == {VersionStatus.PUBLISHED}

    page = run_action(client, "retire_versions", first)
    assert b"default version" in page.content  # refused, with the reason
    run_action(client, "make_default", second)
    run_action(client, "retire_versions", first)
    pip.refresh_from_db()
    first.refresh_from_db()
    assert pip.default_version == second and first.status == VersionStatus.RETIRED

    client.post(
        DEFINITIONS, {"action": "retire_assets", "_selected_action": [pip.pk], "index": 0}
    )
    pip.refresh_from_db()
    assert pip.status == AssetStatus.RETIRED


def test_published_versions_cannot_be_deleted_or_have_their_binary_edited():
    client = staff("root", superuser=True)
    version = services.publish_version(
        services.upload_version(make_definition("npc-pip"), _file(), original_filename="p.glb")
    )
    assert client.get(f"{VERSIONS}{version.pk}/delete/").status_code == 403
    client.post(f"{VERSIONS}{version.pk}/change/", {"notes": "checked", "sha256": "0" * 64})
    version.refresh_from_db()
    assert version.notes == "checked" and version.sha256 != "0" * 64


def test_deleting_a_never_published_version_removes_its_file(
    storage, django_capture_on_commit_callbacks
):
    client = staff("editor", EDITORS)
    version = new_version(make_definition("npc-pip"))
    with django_capture_on_commit_callbacks(execute=True):
        response = client.post(f"{VERSIONS}{version.pk}/delete/", {"post": "yes"})
    assert response.status_code == 302
    assert not AssetVersion.objects.exists() and not storage.exists(version.storage_key)


def test_superusers_can_open_every_asset_page():
    client = staff("root", superuser=True)
    pip = make_definition("npc-pip")
    version = services.upload_version(pip, _file(), original_filename="p.glb")
    for url in (UPLOAD, VERSIONS, f"{VERSIONS}{version.pk}/change/", DEFINITIONS,
                f"{DEFINITIONS}{pip.pk}/change/", f"{DEFINITIONS}add/", "/admin/auth/group/"):
        assert client.get(url).status_code == 200, url
    assert client.get(f"{VERSIONS}add/")["Location"].startswith(UPLOAD)


def test_export_definitions_keep_their_content_fields_read_only():
    from apps.catalog.admin import ContentAssetAdmin
    from django.contrib import admin
    from django.test import RequestFactory

    exported = ContentAsset(asset_id="rock", kind="prop", origin=AssetOrigin.EXPORT)
    made_here = ContentAsset(asset_id="new-rock", kind="prop", origin=AssetOrigin.DJANGO)
    request = RequestFactory().get("/admin/")
    request.user = ParentAccount.objects.create(
        cognito_sub=f"{ADMIN_ONLY_SUB_PREFIX}root", admin_username="root", is_staff=True,
        is_superuser=True,
    )
    model_admin = admin.site._registry[ContentAsset]
    assert isinstance(model_admin, ContentAssetAdmin)
    exported_readonly = set(model_admin.get_readonly_fields(request, exported))
    assert {"kind", "clips", "asset_id", "bundled_path"} <= exported_readonly
    assert not {"display_name", "description", "category", "tags"} & exported_readonly
    assert not {"kind", "clips"} & set(model_admin.get_readonly_fields(request, made_here))


def new_version(asset, **options):
    return services.upload_version(asset, _file(**options), original_filename="p.glb")


def _file(**options):
    import io

    return io.BytesIO(glb_bytes(**options))
