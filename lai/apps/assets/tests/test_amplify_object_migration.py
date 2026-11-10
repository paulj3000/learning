"""AMP-04: importing the legacy Amplify asset-library objects into the Django asset library.

The legacy bucket is the read-only stub from the photo migration tests (no write method exists on
it). Django storage is the in-memory asset store. Nothing contacts AWS.
"""

import hashlib
import json

import pytest
from django.core.cache import cache
from django.core.management import call_command

from apps.assets import amplify_object_migration as migration
from apps.assets import services
from apps.assets.models import AssetVersion, VersionStatus
from apps.assets.tests.helpers import glb_bytes
from apps.catalog.models import ContentAsset
from apps.core import legacy_bucket
from apps.core.legacy_bucket import LegacyBucket
from apps.core.tests.legacy_s3 import READ_OPERATIONS, LegacyS3

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

V1 = "assets/models/npcs/captain/v1/model.glb"
V2 = "assets/models/npcs/captain/v2/model.glb"
STRAY = "assets/models/props/stray/v1/model.glb"
V1_BYTES = glb_bytes(clips=("Idle",))
V2_BYTES = glb_bytes(clips=("Idle", "Wave"))
STRAY_BYTES = glb_bytes(clips=())


@pytest.fixture
def s3(monkeypatch):
    stub = LegacyS3(
        {V1: V1_BYTES, V2: V2_BYTES, STRAY: STRAY_BYTES},
        versions={"Versions": [{"Key": V1, "IsLatest": False}], "DeleteMarkers": []},
    )
    monkeypatch.setattr(legacy_bucket, "make_client", lambda region: stub)
    yield stub
    assert set(stub.calls) <= READ_OPERATIONS  # the source bucket is only ever read


@pytest.fixture
def export(tmp_path):
    path = tmp_path / "assets.json"
    path.write_text(
        json.dumps(
            {
                "assets": [
                    {
                        "slug": "pirate-captain",
                        "name": "Pirate Captain",
                        "category": "NPC",
                        "versions": [
                            {"version": 1, "s3Key": V1},
                            {"version": 2, "s3Key": V2},
                        ],
                    }
                ]
            }
        )
    )
    return path


def bucket() -> LegacyBucket:
    return LegacyBucket("amplify-media", "us-west-1", prefix=migration.LEGACY_PREFIX)


def by_key(result) -> dict:
    return {record.legacy_key: record for record in result.records}


def test_inventory_lists_checksums_and_imports_nothing(s3, storage):
    result = migration.run(bucket(), mode=migration.INVENTORY, export_file=None)

    records = by_key(result)
    assert set(records) == {V1, V2, STRAY}
    assert records[V1].source_sha256 == hashlib.sha256(V1_BYTES).hexdigest()
    assert {r.outcome for r in result.records} == {"not_in_django"}
    assert result.summary()["sourceBytes"] == len(V1_BYTES) + len(V2_BYTES) + len(STRAY_BYTES)
    assert result.versions == {"available": True, "noncurrentVersions": 1, "deleteMarkers": 0}
    assert not AssetVersion.objects.exists() and not list(storage.list())


def test_a_dry_run_validates_through_the_importer_and_writes_nothing(s3, export, storage):
    result = migration.run(bucket(), mode=migration.DRY_RUN, export_file=export)

    assert len(result.import_report["imported"]) == 2
    assert result.created_versions == []
    assert not ContentAsset.objects.exists() and not list(storage.list())


def test_an_import_creates_verified_unpublished_versions_and_reconciles(s3, export):
    result = migration.run(bucket(), mode=migration.COPY, export_file=export)

    versions = AssetVersion.objects.filter(asset__asset_id="pirate-captain").order_by("number")
    assert [v.status for v in versions] == [VersionStatus.VALIDATED] * 2
    assert [v.sha256 for v in versions] == [
        hashlib.sha256(V1_BYTES).hexdigest(),
        hashlib.sha256(V2_BYTES).hexdigest(),
    ]
    assert all(item["verified"] for item in result.created_versions)
    records = by_key(result)
    assert records[V1].outcome == records[V2].outcome == "in_django"
    assert records[STRAY].outcome == "not_in_django"  # no Amplify record: left for a person
    assert not result.reconciled()
    manifest = result.manifest()
    assert manifest["rollback"]["createdDefinitions"] == ["pirate-captain"]
    assert {v["number"] for v in manifest["rollback"]["createdVersions"]} == {1, 2}

    again = migration.run(bucket(), mode=migration.COPY, export_file=export)
    assert again.created_versions == [] and len(again.import_report["skipped"]) == 2
    assert AssetVersion.objects.count() == 2


def test_a_damaged_download_is_never_imported(s3, export):
    s3.tampered[V1] = bytes(len(V1_BYTES))

    result = migration.run(bucket(), mode=migration.COPY, export_file=export)

    assert by_key(result)[V1].outcome == "integrity_failed"
    assert {item["reason"] for item in result.import_report["unresolved"]} == {"file_missing"}
    assert list(AssetVersion.objects.values_list("number", flat=True)) == [1]  # V2 only
    assert not result.reconciled()


def test_an_imported_version_can_be_published_and_resolved_for_a_child(
    s3, export, api, families, cognito
):
    cache.clear()
    migration.run(bucket(), mode=migration.COPY, export_file=export)
    v2 = AssetVersion.objects.get(asset__asset_id="pirate-captain", number=2)
    services.publish_version(v2)
    services.set_default_version(v2)

    response = api(families.a).get(
        f"/api/v1/children/{families.a1.pk}/assets/", {"ids": "pirate-captain"}
    )

    entry = response.json()["assets"][0]
    assert response.status_code == 200 and entry["status"] == "resolved"
    assert entry["sha256"] == hashlib.sha256(V2_BYTES).hexdigest()
    assert entry["clips"] == ["Idle", "Wave"]
    other = api(families.b).get(f"/api/v1/children/{families.a1.pk}/assets/", {"ids": "x"})
    assert other.status_code == 404


def test_rollback_deletes_only_never_published_versions(s3, export):
    manifest = migration.run(bucket(), mode=migration.COPY, export_file=export).manifest()
    services.publish_version(AssetVersion.objects.get(number=2))

    dry = migration.rollback(manifest, confirm=False)
    assert dry.summary() == {"published": 1, "would_delete": 1}
    assert AssetVersion.objects.count() == 2

    done = migration.rollback(manifest, confirm=True)
    assert done.summary() == {"deleted": 1, "published": 1}
    assert list(AssetVersion.objects.values_list("number", flat=True)) == [2]
    assert done.definitions_to_review == ["pirate-captain"]


def test_the_command_writes_a_manifest_and_refuses_a_photo_manifest(s3, export, tmp_path, capsys):
    manifest = tmp_path / "m.json"
    common = ["--bucket", "amplify-media", "--region", "us-west-1", "--manifest", str(manifest)]

    call_command("migrate_amplify_asset_objects", *common, "--inventory")
    assert "Inventory (read only)" in capsys.readouterr().out
    call_command(
        "migrate_amplify_asset_objects", *common, "--export", str(export), "--confirm-copy"
    )
    assert '"imported": 2' in capsys.readouterr().out
    assert json.loads(manifest.read_text())["kind"] == "asset-objects"

    with pytest.raises(migration.ManifestError):
        migration.rollback({"kind": "child-photos"}, confirm=True)
