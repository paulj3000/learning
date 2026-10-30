"""TR-10: Treasure Cove's models managed through the asset manager, end to end at the API level.

The staff workflow a deployment follows (docs/ASSET_MANAGER.md section 19): import the cove's
bundled models as validated versions, publish them in Django Admin, and replace one by uploading,
publishing and making a new version the default. The child-facing resolver is what the React
scene asks (react/src/features/region-play/regionAssets.ts); no browser is involved.
"""

import io
from io import StringIO

import pytest
from django.contrib.auth.models import Group
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import CommandError, call_command
from django.test import Client

from apps.assets.models import AssetVersion, VersionStatus
from apps.assets.tests.helpers import glb_bytes
from apps.catalog.models import ContentAsset
from apps.users.models import ADMIN_ONLY_SUB_PREFIX, ParentAccount

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

COVE_IDS = "npc-pip,treasure-chest,ground-tile"


def staff(username, group):
    call_command("ensure_asset_roles", verbosity=0)
    account = ParentAccount.objects.create(
        cognito_sub=f"{ADMIN_ONLY_SUB_PREFIX}{username}", admin_username=username, is_staff=True
    )
    account.groups.set(Group.objects.filter(name=group))
    client = Client()
    client.force_login(account, backend="apps.users.backends.AdminPasswordBackend")
    return client


def resolve(api, treasure, ids):
    families = treasure.families
    response = api(families.a).get(f"/api/v1/children/{families.a1.pk}/assets/", {"ids": ids})
    assert response.status_code == 200
    return response, {entry["ref"]: entry for entry in response.json()["assets"]}


def import_cove(ids=COVE_IDS):
    out = StringIO()
    call_command("import_assets", "--from-bundled", "--ids", ids, stdout=out)
    return out.getvalue()


def publish(client, *versions):
    response = client.post(
        "/admin/assets/assetversion/",
        {"action": "publish_versions", "_selected_action": [v.pk for v in versions], "index": 0},
    )
    assert response.status_code == 302


def test_importing_the_cove_models_is_explicit_idempotent_and_publishes_nothing(
    api, treasure, cognito, storage
):
    output = import_cove()
    assert "Imported 3 file(s)." in output
    versions = AssetVersion.objects.filter(asset__asset_id__in=COVE_IDS.split(","))
    assert sorted(v.asset.asset_id for v in versions) == [
        "ground-tile",
        "npc-pip",
        "treasure-chest",
    ]
    assert {v.status for v in versions} == {VersionStatus.VALIDATED}
    assert all(storage.exists(v.storage_key) for v in versions)
    assert not ContentAsset.objects.filter(default_version__isnull=False).exists()
    # Only the named ids: the rest of the bundled catalogue was left alone.
    assert AssetVersion.objects.count() == 3
    # Nothing published yet, so the game keeps its bundled files.
    _response, entries = resolve(api, treasure, COVE_IDS)
    assert {entry["status"] for entry in entries.values()} == {"unavailable"}
    # A re-run (say, on every deploy) imports nothing new.
    assert "Imported 0 file(s)." in import_cove()
    assert AssetVersion.objects.count() == 3


def test_an_unknown_id_is_reported_rather_than_silently_skipped(treasure, storage):
    output = import_cove("treasure-chest,treasure-chets")
    assert "Imported 1 file(s)." in output
    assert '"asset": "treasure-chets"' in output and '"reason": "unknown_asset"' in output


def test_ids_is_for_bundled_imports_only(tmp_path):
    with pytest.raises(CommandError, match="--from-bundled"):
        call_command(
            "import_assets", "--from-amplify", "x.json", "--files", str(tmp_path), "--ids", "a"
        )


def test_staff_publish_reaches_the_cove_and_a_new_default_replaces_it(
    api, treasure, cognito, storage
):
    import_cove()
    publisher = staff("publisher", "Asset publishers")
    editor = staff("editor", "Asset editors")
    imported = AssetVersion.objects.filter(asset__asset_id__in=COVE_IDS.split(","))
    publish(publisher, *imported)

    _response, entries = resolve(api, treasure, COVE_IDS)
    assert {entry["status"] for entry in entries.values()} == {"resolved"}
    chest_v1 = entries["treasure-chest"]
    assert chest_v1["version"] == 1 and "Open" in chest_v1["clips"]  # the clip the chest plays
    assert set(entries["npc-pip"]["clips"]) >= {"Idle", "Talk", "Wave"}
    for entry in entries.values():
        assert "assets/models/" not in entry["url"]  # never a storage key in django delivery

    # A designer uploads a replacement chest through the same admin form any asset uses.
    chest = ContentAsset.objects.get(asset_id="treasure-chest")
    replacement = glb_bytes(clips=("Open",), half_size=(0.7, 0.5, 0.45))
    uploaded = editor.post(
        "/admin/assets/assetversion/upload/",
        {
            "asset": chest.pk,
            "model_file": SimpleUploadedFile("chest.glb", replacement),
            "notes": "",
        },
    )
    assert uploaded.status_code == 302
    v2 = AssetVersion.objects.get(asset=chest, number=2)
    publish(publisher, v2)
    # Published but not the default: the cove still gets version 1 (docs section 9).
    _response, entries = resolve(api, treasure, "treasure-chest")
    assert entries["treasure-chest"]["versionId"] == chest_v1["versionId"]

    made_default = publisher.post(
        "/admin/assets/assetversion/",
        {"action": "make_default", "_selected_action": [v2.pk], "index": 0},
    )
    assert made_default.status_code == 302
    _response, entries = resolve(api, treasure, "treasure-chest,treasure-chest@1")
    current = entries["treasure-chest"]
    assert current["version"] == 2 and current["versionId"] == str(v2.version_id)
    assert current["url"] != chest_v1["url"]
    fetched = Client().get(current["url"])
    assert fetched.status_code == 200 and b"".join(fetched.streaming_content) == replacement
    # Version 1 is immutable and still there for anything pinned to it, or to roll back to.
    assert entries["treasure-chest@1"]["status"] == "resolved"
    assert entries["treasure-chest@1"]["sha256"] == chest_v1["sha256"]


def test_resolution_is_revalidated_while_the_bytes_are_cached_as_immutable(
    api, treasure, cognito, storage
):
    import_cove("npc-pip")
    publish(staff("publisher", "Asset publishers"), AssetVersion.objects.get())
    response, entries = resolve(api, treasure, "npc-pip")
    # The answer names the current default, so it must be asked again after a publish.
    assert response["Cache-Control"] == "private, no-cache"
    fetched = Client().get(entries["npc-pip"]["url"])
    # One version's bytes never change, so the browser may keep them for the URL's life.
    assert "immutable" in fetched["Cache-Control"] and "private" in fetched["Cache-Control"]
    assert fetched["ETag"] == f'"{entries["npc-pip"]["sha256"]}"'


def test_another_family_cannot_resolve_through_a_cove_child(api, treasure, cognito, storage):
    import_cove("npc-pip")
    publish(staff("publisher", "Asset publishers"), AssetVersion.objects.get())
    families = treasure.families
    response = api(families.b).get(f"/api/v1/children/{families.a1.pk}/assets/", {"ids": "npc-pip"})
    assert response.status_code == 404
    assert Client().get(f"/api/v1/children/{families.a1.pk}/assets/?ids=npc-pip").status_code in (
        401,
        403,
    )


def test_a_client_supplied_storage_path_is_never_signed(api, treasure, cognito, storage):
    import_cove("npc-pip")
    response = api(treasure.families.a).get(
        f"/api/v1/children/{treasure.families.a1.pk}/assets/",
        {"ids": "assets/models/npc-pip/x/model.glb"},
    )
    assert response.status_code == 400
    # A file URL names a signed version id, never a key: a made-up token is a plain 404.
    assert (
        Client().get("/api/v1/asset-files/assets%2Fmodels%2Fnpc-pip/model.glb").status_code == 404
    )


def test_the_bundled_cove_files_import_from_the_real_public_folder(treasure, storage):
    """The files the Docker image now carries (`react/public/models`) are the ones imported."""
    import_cove()
    chest = AssetVersion.objects.get(asset__asset_id="treasure-chest")
    assert chest.original_filename == "treasure-chest.gltf" and chest.format == "gltf"
    assert io.BytesIO(storage.open(chest.storage_key).read()).getbuffer().nbytes == chest.size_bytes
