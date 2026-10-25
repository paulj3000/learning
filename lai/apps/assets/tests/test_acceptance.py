"""AM-9: LAI-2200 acceptance criteria end to end, and the security edges (ADR-035).

The numbered comments are the brief's acceptance criteria. Criteria 6 and 9 (the Three.js loader
consumes the result; failed assets keep the placeholder path) are proven on the frontend in
react/src/api/assets/djangoAssetResolver.test.ts; here the backend half of each is checked.
"""

import io
import logging

import pytest
from django.contrib.auth.models import Group
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.test import Client

from apps.assets import services
from apps.assets.models import AssetVersion, VersionStatus
from apps.assets.tests.helpers import glb_bytes, make_definition
from apps.catalog.asset_refs import validate_asset_ref
from apps.catalog.models import ContentAsset
from apps.users.models import ADMIN_ONLY_SUB_PREFIX, ParentAccount

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


def admin_client(username, group):
    call_command("ensure_asset_roles", verbosity=0)
    account = ParentAccount.objects.create(
        cognito_sub=f"{ADMIN_ONLY_SUB_PREFIX}{username}", admin_username=username, is_staff=True
    )
    account.groups.set(Group.objects.filter(name=group))
    client = Client()
    client.force_login(account, backend="apps.users.backends.AdminPasswordBackend")
    return client


def resolve(api, parent, child, ids):
    response = api(parent).get(f"/api/v1/children/{child.pk}/assets/", {"ids": ids})
    assert response.status_code == 200
    return {entry["ref"]: entry for entry in response.json()["assets"]}


def test_upload_once_publish_and_reuse_everywhere(api, families, cognito, storage):
    editor = admin_client("editor", "Asset editors")
    publisher = admin_client("publisher", "Asset publishers")

    # 1. A staff administrator registers a reusable model definition.
    created = editor.post(
        "/admin/catalog/contentasset/add/",
        {
            "asset_id": "golden-doubloon",
            "kind": "collectible",
            "category": "collectible",
            "display_name": "Golden doubloon",
            "description": "",
            "tags": "coins",
            "clips": "",
        },
    )
    assert created.status_code == 302
    doubloon = ContentAsset.objects.get(asset_id="golden-doubloon")

    # 8 (before publishing). Nothing resolves for children yet.
    assert resolve(api, families.a, families.a1, "golden-doubloon")["golden-doubloon"] == {
        "ref": "golden-doubloon", "id": "golden-doubloon", "status": "unavailable"
    }

    # 2-3. The binary is uploaded to controlled storage and validated on the way in.
    data = glb_bytes(clips=("Activate",), half_size=(0.1, 0.02, 0.1))
    uploaded = editor.post(
        "/admin/assets/assetversion/upload/",
        {"asset": doubloon.pk, "model_file": SimpleUploadedFile("coin.glb", data), "notes": ""},
    )
    assert uploaded.status_code == 302
    version = AssetVersion.objects.get(asset=doubloon)
    assert version.status == VersionStatus.VALIDATED and storage.exists(version.storage_key)

    # 8. A validated but unpublished version is still invisible.
    assert resolve(api, families.a, families.a1, "golden-doubloon@1")["golden-doubloon@1"][
        "status"
    ] == "unavailable"

    # 4. The publisher publishes the immutable version.
    publisher.post(
        "/admin/assets/assetversion/",
        {"action": "publish_versions", "_selected_action": [version.pk], "index": 0},
    )
    version.refresh_from_db()
    assert version.status == VersionStatus.PUBLISHED

    # 5-6. A child's scene resolves it, and the URL serves exactly the uploaded bytes.
    entry = resolve(api, families.a, families.a1, "golden-doubloon")["golden-doubloon"]
    assert entry["status"] == "resolved" and entry["sha256"] == version.sha256
    assert entry["clips"] == ["Activate"]
    assert entry["dimensions"] == {"x": 0.2, "y": 0.04, "z": 0.2}
    fetched = Client().get(entry["url"])
    assert fetched.status_code == 200 and b"".join(fetched.streaming_content) == data

    # 7. The same id serves any adventure, region or family: one upload, one version.
    other = resolve(api, families.b, families.b2, "golden-doubloon")["golden-doubloon"]
    assert other["versionId"] == entry["versionId"]
    validate_asset_ref("golden-doubloon", "collectible")  # catalog and region rows may name it
    assert AssetVersion.objects.filter(asset=doubloon).count() == 1


def test_treasure_rush_ids_stay_compatible(api, treasure, storage):
    """10. Treasure Cove keeps naming `npc-pip`; publishing under that id needs no change."""
    from apps.regions.models import WorldObjectPlacement

    families = treasure.families
    pip = ContentAsset.objects.get(asset_id="npc-pip")
    placement = WorldObjectPlacement.objects.get(asset_id="npc-pip")
    # 9 (backend half). Until a version is published the client falls back to the bundled file.
    assert resolve(api, families.a, families.a1, "npc-pip")["npc-pip"]["status"] == "unavailable"
    version = services.upload_version(
        pip, io.BytesIO(glb_bytes(clips=tuple(pip.clips) or ("Idle",))), original_filename="p.glb"
    )
    services.publish_version(version)
    entry = resolve(api, families.a, families.a1, "npc-pip")["npc-pip"]
    assert entry["status"] == "resolved" and entry["kind"] == pip.kind
    assert set(pip.clips) <= set(entry["clips"])  # every clip the game already plays survives
    placement.refresh_from_db()
    assert placement.asset_id == "npc-pip"  # no gameplay reference changed


@pytest.mark.parametrize("method", ["post", "put", "patch", "delete"])
def test_there_is_no_mutation_endpoint_for_players(api, families, cognito, method):
    client = api(families.a)
    response = getattr(client, method)(f"/api/v1/children/{families.a1.pk}/assets/?ids=npc-pip")
    assert response.status_code == 405


def test_asset_logs_carry_ids_and_codes_only(families, caplog):
    pip = make_definition("npc-pip")
    with caplog.at_level(logging.INFO, logger="lai.assets"):
        services.upload_version(
            pip, io.BytesIO(glb_bytes()), original_filename="Zinnia-A1 secret pet.glb"
        )
        with pytest.raises(services.AssetActionRefused):
            services.upload_version(pip, io.BytesIO(b"junk"), original_filename="Quince-B1.glb")
    text = " ".join(record.getMessage() for record in caplog.records)
    assert "npc-pip" in text
    for private in ("Zinnia", "Quince", "secret pet", ".glb", "assets/models/"):
        assert private not in text
