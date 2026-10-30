"""AM-4: upload, publish, default, retire, delete and the storage audit (LAI-2200)."""

import io
from datetime import timedelta

import pytest
from django.db import IntegrityError

from apps.assets import services
from apps.assets.models import AssetVersion, VersionStatus
from apps.assets.services import AssetActionRefused
from apps.assets.tests.helpers import glb_bytes, gltf_json_bytes, make_definition
from apps.catalog.models import AssetStatus, ContentAsset

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


def upload(asset, data=None, **kwargs):
    data = data if data is not None else glb_bytes()
    return services.upload_version(asset, io.BytesIO(data), original_filename="pip.glb", **kwargs)


def published(asset, **options):
    return services.publish_version(upload(asset, glb_bytes(**options)))


@pytest.fixture
def pip():
    return make_definition("npc-pip")


def test_upload_stores_an_immutable_validated_version(pip, storage):
    version = upload(pip, glb_bytes(clips=("Idle", "Talk")))
    assert version.status == VersionStatus.VALIDATED and version.number == 1
    assert version.storage_key == f"assets/models/npc-pip/{version.version_id}/model.glb"
    assert storage.open(version.storage_key).read() == glb_bytes(clips=("Idle", "Talk"))
    assert version.clips == ["Idle", "Talk"] and version.dimensions["y"] == 2.0
    assert version.content_type == "model/gltf-binary" and version.original_filename == "pip.glb"
    assert len(version.sha256) == 64
    assert version.size_bytes == len(glb_bytes(clips=("Idle", "Talk")))


def test_a_gltf_upload_gets_its_own_type_and_key(pip):
    version = upload(pip, gltf_json_bytes())
    assert version.format == "gltf" and version.storage_key.endswith("/model.gltf")
    assert version.content_type == "model/gltf+json"


def test_version_numbers_increase_and_replacements_get_new_keys(pip):
    first = upload(pip, glb_bytes(clips=("Idle",)))
    second = upload(pip, glb_bytes(clips=("Idle", "Wave")))
    assert (first.number, second.number) == (1, 2)
    assert first.storage_key != second.storage_key


def test_an_invalid_model_is_not_stored_and_makes_no_row(pip, storage):
    with pytest.raises(AssetActionRefused) as refused:
        upload(pip, b"PK\x03\x04 not a model")
    assert refused.value.code == "invalid_model"
    assert {f.code for f in refused.value.findings} == {"not_a_model"}
    assert not AssetVersion.objects.exists() and not list(storage.list())


def test_the_same_file_twice_is_refused(pip):
    upload(pip)
    with pytest.raises(AssetActionRefused, match="already version 1"):
        upload(pip)


def test_a_storage_failure_leaves_nothing_behind(pip, storage):
    storage.fail_next.add("put")
    with pytest.raises(AssetActionRefused) as refused:
        upload(pip)
    assert refused.value.code == "storage_failed"
    assert not AssetVersion.objects.exists() and not list(storage.list())


def test_a_database_failure_after_storing_removes_the_object(pip, storage, monkeypatch):
    def broken_create(**kwargs):
        raise IntegrityError("simulated")

    monkeypatch.setattr(AssetVersion.objects, "create", broken_create)
    with pytest.raises(IntegrityError):
        upload(pip)
    assert not list(storage.list())


def test_a_retired_asset_takes_no_uploads(pip):
    services.retire_asset(pip)
    with pytest.raises(AssetActionRefused) as refused:
        upload(pip)  # a stale instance: the service re-reads the locked row
    assert refused.value.code == "asset_retired"
    pip.refresh_from_db()
    with pytest.raises(AssetActionRefused) as refused:
        upload(pip)  # a fresh one: validation refuses it first
    assert {f.code for f in refused.value.findings} == {"asset_retired"}


# --- publishing ----------------------------------------------------------------------------------


def test_the_first_publication_becomes_the_default_and_later_ones_do_not(pip):
    first = published(pip, clips=("Idle",))
    pip.refresh_from_db()
    assert first.status == VersionStatus.PUBLISHED and first.published_at is not None
    assert pip.default_version == first
    second = published(pip, clips=("Idle", "Wave"))
    pip.refresh_from_db()
    assert second.status == VersionStatus.PUBLISHED and pip.default_version == first
    services.set_default_version(second)
    pip.refresh_from_db()
    assert pip.default_version == second


def test_publishing_reverifies_the_stored_checksum(pip, storage):
    version = upload(pip)
    data, content_type, when = storage.objects[version.storage_key]
    storage.objects[version.storage_key] = (data[:-4] + b"\x00\x00\x00\x01", content_type, when)
    with pytest.raises(AssetActionRefused) as refused:
        services.publish_version(version)
    assert {f.code for f in refused.value.findings} == {"checksum_mismatch"}
    version.refresh_from_db()
    assert version.status == VersionStatus.REJECTED
    pip.refresh_from_db()
    assert pip.default_version is None


def test_publishing_revalidates_against_the_definition_as_it_is_now(pip):
    version = upload(pip, glb_bytes(clips=("Idle",)))
    ContentAsset.objects.filter(pk=pip.pk).update(clips=["Idle", "Talk"])  # a new reference
    with pytest.raises(AssetActionRefused):
        services.publish_version(version)
    version.refresh_from_db()
    assert version.status == VersionStatus.REJECTED
    assert any(f["code"] == "missing_clip" for f in version.validation_report)


@pytest.mark.parametrize("status", [VersionStatus.PUBLISHED, VersionStatus.REJECTED])
def test_only_a_validated_version_can_be_published(pip, status):
    version = published(pip) if status == VersionStatus.PUBLISHED else upload(pip)
    if status == VersionStatus.REJECTED:
        AssetVersion.objects.filter(pk=version.pk).update(status=status)
    with pytest.raises(AssetActionRefused, match="Only a validated"):
        services.publish_version(version)


def test_the_default_must_be_a_published_version_of_the_same_asset(pip):
    quill = make_definition("npc-quill")
    draft = upload(pip)
    with pytest.raises(AssetActionRefused):
        services.set_default_version(draft)
    other = published(quill)
    services.set_default_version(other)  # its own asset: fine
    pip.refresh_from_db()
    assert pip.default_version is None


# --- retirement ---------------------------------------------------------------------------------


def test_the_default_version_cannot_be_retired_until_it_moves(pip):
    first = published(pip, clips=("Idle",))
    second = published(pip, clips=("Idle", "Wave"))
    with pytest.raises(AssetActionRefused) as refused:
        services.retire_version(first)
    assert refused.value.code == "default_in_use"
    services.retire_version(first, replacement=second)
    pip.refresh_from_db()
    first.refresh_from_db()
    assert first.status == VersionStatus.RETIRED and first.retired_at is not None
    assert pip.default_version == second


def test_a_non_default_published_version_retires_directly(pip):
    first = published(pip, clips=("Idle",))
    second = published(pip, clips=("Idle", "Wave"))
    services.retire_version(second)
    second.refresh_from_db()
    pip.refresh_from_db()
    assert second.status == VersionStatus.RETIRED and pip.default_version == first


def test_retiring_an_asset_keeps_its_versions_and_files(pip, storage):
    version = published(pip)
    services.retire_asset(pip)
    pip.refresh_from_db()
    assert pip.status == AssetStatus.RETIRED
    assert AssetVersion.objects.get(pk=version.pk).status == VersionStatus.PUBLISHED
    assert storage.exists(version.storage_key)
    with pytest.raises(AssetActionRefused):
        services.publish_version(version)  # nothing more is published for a retired asset


# --- deletion and the storage audit --------------------------------------------------------


def test_deleting_an_unpublished_version_removes_its_file_after_commit(
    pip, storage, django_capture_on_commit_callbacks
):
    version = upload(pip)
    with django_capture_on_commit_callbacks(execute=True):
        services.delete_unpublished_version(version)
    assert not AssetVersion.objects.exists() and not storage.exists(version.storage_key)


def test_a_published_version_is_never_deleted(pip, storage):
    version = published(pip)
    with pytest.raises(AssetActionRefused):
        services.delete_unpublished_version(version)
    assert storage.exists(version.storage_key)


def test_the_audit_finds_orphans_and_missing_files(pip, storage):
    kept = upload(pip, glb_bytes(clips=("Idle",)))
    gone = upload(pip, glb_bytes(clips=("Idle", "Wave")))
    storage.objects.pop(gone.storage_key)
    orphan = "assets/models/npc-pip/00000000-0000-4000-8000-000000000000/model.glb"
    fresh = "assets/models/npc-pip/00000000-0000-4000-8000-000000000001/model.glb"
    data, content_type, when = storage.objects[kept.storage_key]
    storage.objects[orphan] = (b"x", content_type, when - timedelta(days=2))
    storage.objects[fresh] = (b"y", content_type, when)
    report = services.audit_storage()
    assert sorted(report["orphans"]) == [orphan, fresh] and report["missing"] == [gone.storage_key]
    assert report["deleted"] == []
    report = services.audit_storage(delete=True)
    assert report["deleted"] == [orphan] and report["kept_too_recent"] == [fresh]
    assert storage.exists(kept.storage_key) and not storage.exists(orphan)
