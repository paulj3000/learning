"""The DerivedArtifact model: constraints, immutability, transitions (ADR-066)."""

from datetime import timedelta

import pytest
from django.db import IntegrityError, transaction
from django.utils.timezone import now

from apps.assets.models import ArtifactState, DerivedArtifact, ImmutableArtifact

from .artifact_helpers import recorded, source_version

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


def test_there_is_no_published_state():
    assert "published" not in {s.value for s in ArtifactState}
    assert {s.value for s in ArtifactState} == {
        "pending_review",
        "accepted",
        "rejected",
        "superseded",
        "promoted",
        "expired",
        "deleted",
    }


def test_identity_fields_are_immutable():
    _version, _job, artifact = recorded()
    for field, value in (("sha256", "c" * 64), ("role", "audio.report"), ("storage_key", "x")):
        setattr(artifact, field, value)
        with pytest.raises(ImmutableArtifact):
            artifact.save()
        artifact.refresh_from_db()


def test_illegal_transitions_are_refused():
    _version, _job, artifact = recorded()
    artifact.state = ArtifactState.DELETED
    with pytest.raises(ImmutableArtifact):
        artifact.save()
    artifact.refresh_from_db()
    artifact.state = ArtifactState.REJECTED
    artifact.reviewed_at = now()
    artifact.expires_at = now() + timedelta(days=30)
    artifact.save()
    artifact.state = ArtifactState.EXPIRED
    artifact.save()
    artifact.state = ArtifactState.PENDING_REVIEW  # expired can only become deleted
    with pytest.raises(ImmutableArtifact):
        artifact.save()


def test_a_live_artifact_cannot_be_deleted():
    _version, _job, artifact = recorded()
    with pytest.raises(ImmutableArtifact):
        artifact.delete()


def test_database_refuses_promoted_without_a_version():
    _version, _job, artifact = recorded()
    with pytest.raises(IntegrityError), transaction.atomic():
        DerivedArtifact.objects.filter(pk=artifact.pk).update(state="promoted", expires_at=None)


def test_database_refuses_a_version_link_without_promotion():
    version, _job, artifact = recorded()
    other = source_version("npc-two")
    with pytest.raises(IntegrityError), transaction.atomic():
        DerivedArtifact.objects.filter(pk=artifact.pk).update(promoted_version=other)


@pytest.mark.parametrize(
    "change",
    [
        {"state": "published"},
        {"state": "accepted"},  # accepted needs reviewed_at and no deadline
        {"expires_at": None},  # pending needs a deadline
        {"sha256": "XYZ"},
        {"storage_key": "assets/audio/x"},
        {"producer": "staff_capture"},  # a capture has no job
        {"job_id_text": None},  # a job output names its job
        {"state": "superseded"},  # needs superseded_at
    ],
)
def test_database_check_constraints(change):
    _version, _job, artifact = recorded()
    with pytest.raises(IntegrityError), transaction.atomic():
        DerivedArtifact.objects.filter(pk=artifact.pk).update(**change)


def test_unique_job_attempt_logical_id_and_storage_key():
    _version, _job, artifact = recorded()
    with pytest.raises(IntegrityError), transaction.atomic():
        DerivedArtifact.objects.create(
            source_version=artifact.source_version,
            asset=artifact.asset,
            source_sha256=artifact.source_sha256,
            source_storage_key=artifact.source_storage_key,
            job=artifact.job,
            job_id_text=artifact.job_id_text,
            attempt_id=artifact.attempt_id,
            logical_id=artifact.logical_id,
            role=artifact.role,
            sha256=artifact.sha256,
            size_bytes=1,
            content_type="audio/ogg",
            storage_key=artifact.storage_key + "2",
            expires_at=now(),
        )


def test_source_version_and_job_are_protected():
    from django.db.models import ProtectedError

    version, job, _artifact = recorded()
    with pytest.raises(ProtectedError):
        version.delete()
    with pytest.raises(ProtectedError):
        job.delete()


def test_jobs_with_artifacts_are_not_pruned():
    from apps.jobs import services

    _version, job, _artifact = recorded()
    from apps.jobs.models import ProcessingJob

    ProcessingJob.objects.filter(pk=job.pk).update(finished_at=now() - timedelta(days=400))
    assert services.prunable(now()).filter(pk=job.pk).count() == 0
