"""AMP-04: copying legacy Amplify Storage child photos into the Django photo bucket.

The legacy bucket is a stub boto3 client with read operations only (no put, copy or delete
method exists on it, so any write attempt fails the test). The Django side is the in-memory photo
store and the tenant-isolation `families` (lai/conftest.py). Nothing contacts AWS.
"""

import hashlib
import json
import os
import stat
import uuid
from pathlib import Path

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from apps.core import legacy_bucket
from apps.core.legacy_bucket import LegacyBucket, LegacyBucketError
from apps.core.tests.legacy_s3 import READ_OPERATIONS, LegacyS3
from apps.users import amplify_photo_migration as migration
from apps.users import photos
from apps.users.models import ChildPhoto, ChildPhotoStatus
from apps.users.photo_storage import (
    MemoryPhotoStorage,
    get_photo_storage,
    reset_photo_storage_cache,
)

FIXTURES = Path(__file__).parent / "fixtures"
EXIF_JPEG = (FIXTURES / "photo_exif.jpg").read_bytes()
GRAY_JPEG = (FIXTURES / "photo_gray.jpg").read_bytes()
PNG = (FIXTURES / "photo.png").read_bytes()
METADATA_MARKERS = [b"Exif", b"SecretCam", b"SECRET-COMMENT", b"xmpmeta", b"SecretTown"]

IDENTITY_A = "us-west-1:11111111-1111-4111-8111-111111111111"
IDENTITY_B = "us-west-1:22222222-2222-4222-8222-222222222222"
KEY_A1 = f"child-photos/{IDENTITY_A}/aaaa.jpg"
KEY_B1 = f"child-photos/{IDENTITY_B}/bbbb.jpg"
ORPHAN = f"child-photos/{IDENTITY_A}/orphan.jpg"


@pytest.fixture(autouse=True)
def fresh_photo_store():
    reset_photo_storage_cache()
    yield
    reset_photo_storage_cache()


@pytest.fixture
def s3(monkeypatch):
    stub = LegacyS3(
        {KEY_A1: EXIF_JPEG, KEY_B1: GRAY_JPEG, ORPHAN: GRAY_JPEG},
        versions={
            "Versions": [{"Key": KEY_A1, "IsLatest": True}, {"Key": KEY_A1, "IsLatest": False}],
            "DeleteMarkers": [{"Key": ORPHAN}],
        },
    )
    monkeypatch.setattr(legacy_bucket, "make_client", lambda region: stub)
    yield stub
    assert set(stub.calls) <= READ_OPERATIONS  # the source bucket is only ever read


def bucket() -> LegacyBucket:
    return LegacyBucket("amplify-media", "us-west-1", prefix=migration.LEGACY_PREFIX)


def export_for(families, **overrides) -> dict:
    children = [
        {"id": str(families.a1.pk), "ownerSub": "sub-family-a", "avatarPhotoKey": KEY_A1},
        {"id": str(families.a2.pk), "ownerSub": "sub-family-a", "avatarPhotoKey": None},
        {"id": str(families.b1.pk), "ownerSub": "sub-family-b", "avatarPhotoKey": KEY_B1},
    ]
    for child in children:
        child.update(overrides.get(child["id"], {}))
    return {"parentProfiles": [], "childProfiles": children}


def by_key(result) -> dict:
    return {record.legacy_key: record for record in result.records}


def store() -> MemoryPhotoStorage:
    storage = get_photo_storage()
    assert isinstance(storage, MemoryPhotoStorage)
    return storage


# --- the legacy bucket reader -------------------------------------------------------------------


def test_the_reader_refuses_keys_outside_its_prefix_and_never_names_a_key():
    reader = LegacyBucket("b", "r", prefix="child-photos/", client=LegacyS3({}))
    for key in ("assets/models/x.glb", "child-photos/../assets/x", "/child-photos/x"):
        with pytest.raises(LegacyBucketError):
            reader.read(key)
    with pytest.raises(LegacyBucketError) as raised:
        reader.read("child-photos/someone/missing.jpg")
    assert "someone" not in str(raised.value) and "NoSuchKey" in str(raised.value)


def test_the_reader_has_no_write_operation():
    for name in ("put", "write", "copy", "delete", "remove"):
        assert not any(attr.startswith(name) for attr in dir(LegacyBucket))


def test_the_reader_pages_checksums_and_reports_versions():
    client = LegacyS3({f"child-photos/i/{n}.jpg": bytes([n]) * 10 for n in range(5)}, page_size=2)
    reader = LegacyBucket("b", "r", prefix="child-photos/", client=client)
    listed = list(reader.list())
    assert len(listed) == 5 and client.calls.count("list_objects_v2") == 3
    read = reader.read(listed[0].key, keep_up_to=4)
    assert read.sha256 == hashlib.sha256(b"\x00" * 10).hexdigest()
    assert read.size == 10 and read.data is None and read.version_id == "v-current"
    assert reader.version_summary() == {"available": False, "reason": "AccessDenied"}


def test_manifests_are_written_owner_only(tmp_path):
    path = tmp_path / "out" / "manifest.json"
    legacy_bucket.write_manifest(path, {"kind": "child-photos"})
    assert stat.S_IMODE(os.stat(path).st_mode) == 0o600
    assert json.loads(path.read_text())["kind"] == "child-photos"


# --- inventory, dry run, copy -------------------------------------------------------------------


@pytest.mark.postgres
@pytest.mark.django_db
class TestPhotoMigration:
    def test_inventory_lists_sizes_and_checksums_and_writes_nothing(self, families, s3):
        result = migration.run(bucket(), mode=migration.INVENTORY, export=None)

        records = by_key(result)
        assert set(records) == {KEY_A1, KEY_B1, ORPHAN}
        assert records[KEY_A1].source_sha256 == hashlib.sha256(EXIF_JPEG).hexdigest()
        assert records[KEY_A1].identity_id == IDENTITY_A
        assert {r.outcome for r in result.records} == {"inventoried"}
        summary = result.summary()
        assert summary["sourceObjects"] == 3
        assert summary["sourceBytes"] == len(EXIF_JPEG) + 2 * len(GRAY_JPEG)
        assert result.versions == {"available": True, "noncurrentVersions": 1, "deleteMarkers": 1}
        assert not ChildPhoto.objects.exists() and not store().objects

    def test_a_dry_run_maps_and_validates_but_copies_nothing(self, families, s3):
        result = migration.run(bucket(), mode=migration.DRY_RUN, export=export_for(families))

        records = by_key(result)
        assert records[KEY_A1].outcome == "would_copy"
        assert records[KEY_A1].child_id == str(families.a1.pk)
        assert records[KEY_A1].byte_identical is False  # the EXIF fixture loses its metadata
        assert records[KEY_B1].outcome == "would_copy"
        assert records[ORPHAN].outcome == "unreferenced_object"
        assert not result.reconciled()
        assert not ChildPhoto.objects.exists() and not store().objects

    def test_a_copy_goes_through_the_django_pipeline_and_is_verified(self, families, s3):
        result = migration.run(bucket(), mode=migration.COPY, export=export_for(families))

        records = by_key(result)
        assert records[KEY_A1].outcome == records[KEY_B1].outcome == "copied"
        assert records[ORPHAN].outcome == "unreferenced_object"
        assert result.reconciled()
        a1 = photos.current_photo(families.a1)
        b1 = photos.current_photo(families.b1)
        assert a1 is not None and b1 is not None
        assert photos.current_photo(families.a2) is None
        stored = photos.read_photo(a1)
        assert not any(marker in stored for marker in METADATA_MARKERS)  # EXIF stripped
        assert hashlib.sha256(stored).hexdigest() == a1.sha256 == records[KEY_A1].django_sha256
        assert a1.storage_key.startswith(f"children/{families.a1.pk}/")
        created = result.manifest()["rollback"]["createdPhotos"]
        assert {entry["photoId"] for entry in created} == {str(a1.pk), str(b1.pk)}

    def test_copied_photos_are_served_to_their_own_parent_only(self, families, s3, api):
        migration.run(bucket(), mode=migration.COPY, export=export_for(families))

        own = api(families.a).get(f"/api/v1/children/{families.a1.pk}/photo/")
        assert own.status_code == 200 and own.json()["photo"] is not None
        content = api(families.a).get(f"/api/v1/children/{families.a1.pk}/photo/content/")
        assert content.status_code == 200
        for path in ("", "content/"):
            other = api(families.b).get(f"/api/v1/children/{families.a1.pk}/photo/{path}")
            assert other.status_code == 404
        assert api(families.b).delete(f"/api/v1/children/{families.a1.pk}/photo/").status_code == (
            404
        )
        assert photos.current_photo(families.a1) is not None

    def test_a_re_run_is_idempotent(self, families, s3):
        migration.run(bucket(), mode=migration.COPY, export=export_for(families))
        again = migration.run(bucket(), mode=migration.COPY, export=export_for(families))

        assert by_key(again)[KEY_A1].outcome == by_key(again)[KEY_B1].outcome == "already_copied"
        assert again.reconciled() and again.manifest()["rollback"]["createdPhotos"] == []
        assert ChildPhoto.objects.count() == 2

    def test_a_damaged_django_object_is_reported_not_trusted(self, families, s3):
        migration.run(bucket(), mode=migration.COPY, export=export_for(families))
        photo = photos.current_photo(families.a1)
        data, modified = store().objects[photo.storage_key]
        store().objects[photo.storage_key] = (data + b"x", modified)

        again = migration.run(bucket(), mode=migration.DRY_RUN, export=export_for(families))

        assert by_key(again)[KEY_A1].outcome == "destination_mismatch"
        assert not again.reconciled()

    def test_a_newer_django_photo_is_never_replaced(self, families, s3):
        own = photos.replace_photo(families.a, families.a1.pk, GRAY_JPEG, "image/jpeg")

        result = migration.run(bucket(), mode=migration.COPY, export=export_for(families))

        assert by_key(result)[KEY_A1].outcome == "django_photo_newer"
        assert photos.current_photo(families.a1).pk == own.pk

    def test_an_owner_that_does_not_match_the_django_parent_is_not_copied(self, families, s3):
        # The export claims family A owns B1 (and the key is under A's identity, so the identity
        # check passes): Django says B1 is family B's child, so nothing is copied.
        claimed = f"child-photos/{IDENTITY_A}/claimed.jpg"
        s3.objects[claimed] = GRAY_JPEG
        export = export_for(
            families,
            **{str(families.b1.pk): {"ownerSub": "sub-family-a", "avatarPhotoKey": claimed}},
        )

        result = migration.run(bucket(), mode=migration.COPY, export=export)

        assert by_key(result)[claimed].outcome == "owner_mismatch"
        assert photos.current_photo(families.b1) is None

    def test_one_owner_under_two_identity_ids_is_a_conflict(self, families, s3):
        export = export_for(families, **{str(families.b1.pk): {"ownerSub": "sub-family-a"}})

        result = migration.run(bucket(), mode=migration.COPY, export=export)

        outcomes = {by_key(result)[KEY_A1].outcome, by_key(result)[KEY_B1].outcome}
        assert outcomes == {"identity_conflict"}
        assert not ChildPhoto.objects.exists()

    def test_a_child_missing_from_django_or_without_an_owner_is_not_copied(self, families, s3):
        unknown = str(uuid.uuid4())
        export = export_for(families)
        export["childProfiles"][0]["id"] = unknown
        export["childProfiles"][2]["ownerSub"] = None

        result = migration.run(bucket(), mode=migration.COPY, export=export)

        assert by_key(result)[KEY_A1].outcome == "child_not_imported"
        assert by_key(result)[KEY_B1].outcome == "unresolved_owner"
        assert not ChildPhoto.objects.exists()

    def test_one_identity_id_for_two_owners_is_a_conflict(self, families, monkeypatch):
        shared_b1 = f"child-photos/{IDENTITY_A}/bbbb.jpg"
        stub = LegacyS3({KEY_A1: EXIF_JPEG, shared_b1: GRAY_JPEG})
        monkeypatch.setattr(legacy_bucket, "make_client", lambda region: stub)
        export = export_for(families, **{str(families.b1.pk): {"avatarPhotoKey": shared_b1}})

        result = migration.run(bucket(), mode=migration.COPY, export=export)

        assert {r.outcome for r in result.records} == {"identity_conflict"}
        assert not ChildPhoto.objects.exists()

    def test_a_referenced_key_with_no_object_is_reported(self, families, s3):
        missing = f"child-photos/{IDENTITY_A}/gone.jpg"
        export = export_for(families, **{str(families.a2.pk): {"avatarPhotoKey": missing}})

        result = migration.run(bucket(), mode=migration.COPY, export=export)

        assert result.missing_objects == [
            {"legacyKey": missing, "childId": str(families.a2.pk), "reason": "missing_object"}
        ]
        assert not result.reconciled()

    def test_a_file_the_pipeline_rejects_is_not_copied(self, families, monkeypatch):
        stub = LegacyS3({KEY_A1: PNG, KEY_B1: GRAY_JPEG})
        monkeypatch.setattr(legacy_bucket, "make_client", lambda region: stub)

        result = migration.run(bucket(), mode=migration.COPY, export=export_for(families))

        assert (by_key(result)[KEY_A1].outcome, by_key(result)[KEY_A1].detail) == (
            "validation_failed",
            "photo_type_unsupported",
        )
        assert photos.current_photo(families.a1) is None

    def test_bytes_that_do_not_match_the_listed_etag_are_never_copied(self, families, s3):
        s3.tampered[KEY_A1] = bytes(len(EXIF_JPEG))  # same size, different bytes

        result = migration.run(bucket(), mode=migration.COPY, export=export_for(families))

        record = by_key(result)[KEY_A1]
        assert (record.outcome, record.etag_matches) == ("integrity_failed", False)
        assert record.referenced and not result.reconciled()
        assert photos.current_photo(families.a1) is None
        assert by_key(result)[KEY_B1].etag_matches is True

    def test_a_storage_failure_leaves_no_row(self, families, s3):
        store().fail_next.add("put")

        result = migration.run(bucket(), mode=migration.COPY, export=export_for(families))

        failed = [r for r in result.records if r.outcome == "copy_failed"]
        assert len(failed) == 1
        assert ChildPhoto.objects.count() == 1  # the other child copied normally


# --- rollback -----------------------------------------------------------------------------------


@pytest.mark.postgres
@pytest.mark.django_db
def test_rollback_removes_only_unchanged_photos_the_run_created(families, s3):
    manifest = migration.run(bucket(), mode=migration.COPY, export=export_for(families)).manifest()
    newer = photos.replace_photo(families.b, families.b1.pk, EXIF_JPEG, "image/jpeg")

    dry = migration.rollback(manifest, confirm=False)
    assert dry.summary() == {"changed_since": 1, "would_remove": 1}
    assert ChildPhoto.objects.filter(status=ChildPhotoStatus.CURRENT).count() == 2

    done = migration.rollback(manifest, confirm=True)
    assert done.summary() == {"changed_since": 1, "removed": 1}
    assert photos.current_photo(families.a1) is None
    assert photos.current_photo(families.b1).pk == newer.pk
    assert migration.rollback(manifest, confirm=True).summary() == {
        "already_gone": 1,
        "changed_since": 1,
    }


def test_rollback_refuses_another_kind_of_manifest():
    with pytest.raises(migration.ImportFileError):
        migration.rollback({"kind": "asset-objects"}, confirm=True)


# --- the command --------------------------------------------------------------------------------


@pytest.mark.postgres
@pytest.mark.django_db
def test_the_command_prints_counts_only_and_writes_the_manifest(families, s3, tmp_path, capsys):
    export = tmp_path / "export.json"
    export.write_text(json.dumps(export_for(families)))
    manifest = tmp_path / "manifest.json"
    common = ["--bucket", "amplify-media", "--region", "us-west-1", "--manifest", str(manifest)]

    call_command("migrate_amplify_child_photos", *common, "--export", str(export))
    dry = capsys.readouterr().out
    assert "Dry run (nothing copied)" in dry and "Reconciled: no" in dry
    assert not ChildPhoto.objects.exists()

    call_command("migrate_amplify_child_photos", *common, "--export", str(export), "--confirm-copy")
    out = capsys.readouterr().out
    assert "Reconciled: yes" in out
    for secret in (str(families.a1.pk), IDENTITY_A, "Zinnia", "sub-family-a"):
        assert secret not in dry + out
    body = json.loads(manifest.read_text())
    assert body["kind"] == "child-photos" and body["reconciled"] is True
    assert len(body["rollback"]["createdPhotos"]) == 2

    call_command("migrate_amplify_child_photos", "--rollback", str(manifest), "--confirm-rollback")
    assert '"removed": 2' in capsys.readouterr().out
    assert not ChildPhoto.objects.filter(status=ChildPhotoStatus.CURRENT).exists()


def test_the_command_needs_the_bucket_and_a_manifest_path():
    with pytest.raises(CommandError):
        call_command("migrate_amplify_child_photos", "--inventory")
    with pytest.raises(CommandError):
        call_command("migrate_amplify_child_photos", "--confirm-rollback")


def test_a_dry_run_without_the_export_is_refused(s3, tmp_path):
    with pytest.raises(CommandError, match="export"):
        call_command(
            "migrate_amplify_child_photos",
            "--bucket",
            "b",
            "--region",
            "r",
            "--manifest",
            str(tmp_path / "m.json"),
        )
