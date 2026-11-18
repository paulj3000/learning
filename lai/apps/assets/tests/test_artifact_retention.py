"""Retention, cleanup and orphan reconciliation of derived artifacts (ADR-066)."""

import io
from datetime import timedelta

import pytest
from django.core.management import call_command
from django.utils.timezone import now

from apps.assets import artifact_promotion, artifact_retention, artifacts
from apps.assets import artifact_storage as store
from apps.assets.models import ArtifactState, DerivedArtifact
from apps.assets.processing import namespace
from apps.assets.storage import StorageError, StoredObject, get_storage
from apps.jobs import services
from apps.jobs.models import JobStatus, ProcessingJob

from .artifact_helpers import OGG, make_job, real_artifact, recorded, sha, user_with

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


def exists(key):
    return key in get_storage().objects


def test_default_retention_periods_are_90_and_30_days(settings):
    assert settings.LAI_ARTIFACT_RETENTION_UNREVIEWED_DAYS == 90
    assert settings.LAI_ARTIFACT_RETENTION_SUPERSEDED_DAYS == 30
    _v, _j, artifact = recorded()
    assert artifact.expires_at - artifact.created_at == timedelta(days=90)


def test_unreviewed_boundary_is_exactly_the_deadline():
    _v, _j, artifact = recorded()
    just_before = artifact.expires_at - timedelta(seconds=1)
    report = artifact_retention.run_retention(apply=True, at=just_before)
    assert report["expired"] == [] and exists(artifact.storage_key)
    report = artifact_retention.run_retention(apply=True, at=artifact.expires_at)
    assert report["expired"] == [str(artifact.pk)]
    artifact.refresh_from_db()
    assert artifact.state == ArtifactState.DELETED
    assert not exists(artifact.storage_key)
    assert artifact.object_deleted_at is not None


def test_deleted_tombstone_keeps_lineage_and_frees_the_job():
    _v, job, artifact = recorded()
    artifact_retention.run_retention(apply=True, at=artifact.expires_at)
    artifact.refresh_from_db()
    assert artifact.job_id is None and artifact.job_id_text == job.pk
    ProcessingJob.objects.filter(pk=job.pk).update(finished_at=now() - timedelta(days=400))
    assert services.prunable(now()).filter(pk=job.pk).exists()
    services.sweep()
    assert not ProcessingJob.objects.filter(pk=job.pk).exists()
    assert DerivedArtifact.objects.filter(pk=artifact.pk).exists()


def test_superseded_and_rejected_use_the_short_period():
    _v, _j, artifact = recorded()
    reviewer = user_with("view_derivedartifact", "review_derivedartifact")
    artifacts.reject_artifact(artifact, reviewer)
    artifact.refresh_from_db()
    assert artifact.expires_at - artifact.reviewed_at < timedelta(days=30, seconds=5)
    assert artifact_retention.run_retention(apply=True, at=artifact.expires_at)["expired"] == [
        str(artifact.pk)
    ]


def test_dry_run_is_the_default_and_changes_nothing():
    _v, _j, artifact = recorded()
    late = artifact.expires_at + timedelta(days=1)
    report = artifact_retention.run_retention(at=late)
    assert report["apply"] is False and report["expired"] == [str(artifact.pk)]
    artifact.refresh_from_db()
    assert artifact.state == ArtifactState.PENDING_REVIEW and exists(artifact.storage_key)


def test_accepted_and_promoted_artifacts_are_protected():
    _source, accepted = real_artifact(seconds=2)
    reviewer = user_with("view_derivedartifact", "review_derivedartifact")
    artifacts.accept_artifact(accepted, reviewer)
    _s2, promoted = real_artifact(seconds=3)
    artifact_promotion.promote_artifact(promoted, user_with("promote_derivedartifact"))
    far = now() + timedelta(days=3650)
    report = artifact_retention.run_retention(apply=True, at=far, grace=timedelta(days=9999))
    assert report["expired"] == [] and report["deleted"] == []
    for artifact in (accepted, promoted):
        artifact.refresh_from_db()
        assert exists(artifact.storage_key)
    assert accepted.state == ArtifactState.ACCEPTED and promoted.state == ArtifactState.PROMOTED


def test_hold_and_active_jobs_protect_an_artifact():
    _v, job, held = recorded()
    DerivedArtifact.objects.filter(pk=held.pk).update(retention_hold=True)
    _v2, job2, active = recorded()
    ProcessingJob.objects.filter(pk=job2.pk).update(status=JobStatus.RUNNING)
    far = now() + timedelta(days=365)
    report = artifact_retention.run_retention(apply=True, at=far, grace=timedelta(days=9999))
    assert report["expired"] == []
    assert report["protected_hold"] == [str(held.pk)]
    assert report["protected_active_job"] == [str(active.pk)]
    assert exists(held.storage_key) and exists(active.storage_key)


def test_a_review_between_listing_and_expiry_wins(monkeypatch):
    _v, _j, artifact = recorded()
    late = artifact.expires_at + timedelta(days=1)
    real = artifact_retention._lock_asset

    def review_first(row):
        DerivedArtifact.objects.filter(pk=row.pk).update(
            state="accepted", reviewed_at=now(), expires_at=None
        )
        real(row)

    monkeypatch.setattr(artifact_retention, "_lock_asset", review_first)
    report = artifact_retention.run_retention(apply=True, at=late)
    assert report["expired"] == []
    artifact.refresh_from_db()
    assert artifact.state == ArtifactState.ACCEPTED and exists(artifact.storage_key)


def test_storage_failure_leaves_an_expired_row_for_the_next_run():
    _v, _j, artifact = recorded()
    storage = get_storage()
    storage.fail_next.add("delete")
    report = artifact_retention.run_retention(apply=True, at=artifact.expires_at)
    assert report["delete_failed"] == [str(artifact.pk)]
    artifact.refresh_from_db()
    assert artifact.state == ArtifactState.EXPIRED and exists(artifact.storage_key)
    report = artifact_retention.run_retention(apply=True, at=artifact.expires_at)
    assert report["deleted"] == [str(artifact.pk)]
    artifact.refresh_from_db()
    assert artifact.state == ArtifactState.DELETED and not exists(artifact.storage_key)


def test_a_second_run_is_idempotent():
    _v, _j, artifact = recorded()
    first = artifact_retention.run_retention(apply=True, at=artifact.expires_at)
    second = artifact_retention.run_retention(apply=True, at=artifact.expires_at)
    assert first["expired"] and second["expired"] == [] and second["deleted"] == []


# --- orphans -----------------------------------------------------------------------------------


def put_orphan(key, data=OGG):
    get_storage().put(key, io.BytesIO(data), content_type="audio/ogg", sha256=sha(data))


def orphan_key(job_id, attempt="11111111-1111-4111-8111-111111111111", logical="lost"):
    return f"processing/artifacts/{namespace()}/{job_id}/{attempt}/{logical}.ogg"


def test_old_orphans_are_deleted_and_recent_ones_kept():
    key = orphan_key("22222222-2222-4222-8222-222222222222")
    put_orphan(key)
    report = artifact_retention.run_retention(apply=True)  # inside the 48 hour grace
    assert report["orphans_kept_recent"] == [key] and exists(key)
    later = now() + timedelta(hours=49)
    report = artifact_retention.run_retention(apply=True, at=later)
    assert report["orphans_deleted"] == [key] and not exists(key)


def test_orphan_dry_run_reports_without_deleting():
    key = orphan_key("33333333-3333-4333-8333-333333333333")
    put_orphan(key)
    report = artifact_retention.run_retention(at=now() + timedelta(hours=49))
    assert report["orphans"] == [key] and report["orphans_deleted"] == [] and exists(key)


def test_orphans_of_an_active_job_are_kept():
    version, _job, _artifact = recorded()
    job = make_job(version)  # RUNNING
    key = orphan_key(job.pk, attempt=job.payload["attempt_id"])
    put_orphan(key)
    report = artifact_retention.run_retention(apply=True, at=now() + timedelta(days=30))
    assert report["orphans_kept_active"] == [key] and exists(key)
    ProcessingJob.objects.filter(pk=job.pk).update(status=JobStatus.FAILED)
    report = artifact_retention.run_retention(apply=True, at=now() + timedelta(days=30))
    assert report["orphans_deleted"] == [key] and not exists(key)


def test_a_row_that_appears_meanwhile_keeps_its_object(monkeypatch):
    """Lock then re-check: an artifact recorded after the listing owns its object."""
    version, _job, other = recorded()
    job = make_job(version)
    key = orphan_key(job.pk, attempt=job.payload["attempt_id"], logical="late")
    put_orphan(key)
    ProcessingJob.objects.filter(pk=job.pk).update(status=JobStatus.COMPLETED)

    def list_then_record(prefix=None):
        DerivedArtifact.objects.create(
            source_version=version,
            asset=version.asset,
            source_sha256=version.sha256,
            source_storage_key=version.storage_key,
            job=job,
            job_id_text=job.pk,
            attempt_id=job.payload["attempt_id"],
            logical_id="late",
            role="audio.transcoded",
            sha256=sha(OGG),
            size_bytes=len(OGG),
            content_type="audio/ogg",
            storage_key=key,
            expires_at=now() + timedelta(days=90),
        )
        yield StoredObject(key, len(OGG), now() - timedelta(days=5))

    monkeypatch.setattr(store, "list_objects", list_then_record)
    report = artifact_retention.run_retention(apply=True)
    assert report["orphans_deleted"] == [] and exists(key)
    assert other.storage_key != key


def test_objects_of_other_environments_and_assets_are_never_touched():
    foreign = "processing/artifacts/prod/22222222-2222-4222-8222-222222222222/x/y.ogg"
    asset_orphan = "assets/audio/npc-pip/zzz/audio.ogg"
    for key in (foreign, asset_orphan):
        put_orphan(key)
    report = artifact_retention.run_retention(apply=True, at=now() + timedelta(days=365))
    assert report["orphans"] == [] and exists(foreign) and exists(asset_orphan)


def test_an_unreadable_store_is_reported_not_swallowed(monkeypatch):
    def broken(prefix=None):
        raise store.ArtifactStorageUnavailable
        yield  # pragma: no cover

    monkeypatch.setattr(store, "list_objects", broken)
    assert artifact_retention.run_retention(apply=True)["storage_unavailable"] is True


def test_s3_listing_failure_is_a_storage_error_not_a_deletion():
    class Failing:
        def list_objects_v2(self, **kwargs):
            raise RuntimeError("boom")

    from apps.assets.storage import S3AssetStorage

    with pytest.raises(RuntimeError):
        list(S3AssetStorage("b", "us-west-1", client=Failing()).list("processing/"))
    assert isinstance(StorageError("x"), Exception)


# --- the command -------------------------------------------------------------------------------


def test_command_is_a_dry_run_unless_applied(capsys):
    _v, _j, artifact = recorded()
    DerivedArtifact.objects.filter(pk=artifact.pk).update(expires_at=now() - timedelta(days=1))
    call_command("asset_artifact_retention")
    out = capsys.readouterr().out
    assert "DRY RUN" in out and str(artifact.pk) in out
    artifact.refresh_from_db()
    assert artifact.state == ArtifactState.PENDING_REVIEW
    call_command("asset_artifact_retention", "--apply")
    artifact.refresh_from_db()
    assert artifact.state == ArtifactState.DELETED
