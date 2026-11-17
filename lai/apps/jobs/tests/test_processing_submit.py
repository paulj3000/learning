"""submit_processing_job: idempotency, the transactional outbox, and inline end to end."""

import hashlib

import pytest
from django.db import transaction

from apps.jobs import processing
from apps.jobs import processing_transport as transport
from apps.jobs.models import (
    AttemptOutcome,
    JobArtifact,
    JobAttempt,
    JobOutbox,
    JobState,
    JobStatus,
    ProcessingJob,
)
from lai_processing.contracts.codec import decode_request
from lai_processing.core.idempotency import verify_idempotency_key

from .processing_fakes import DATA, KEY, current_request, fake_transport, seed, submit_reference

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]
__all__ = ["fake_transport"]


def test_submit_creates_job_attempt_and_outbox_in_queued(fake_transport):
    job = submit_reference(fake_transport.storage)
    job.refresh_from_db()
    assert (job.state, job.status, job.queue, job.backend) == (
        JobState.QUEUED,
        JobStatus.PENDING,
        "processing",
        "local",
    )
    assert (job.namespace, job.profile_id, job.profile_version) == ("test", "reference-default", 1)
    assert (job.processor_id, job.processor_version) == ("reference.checksum", "1.0.0")
    assert job.input_ref == {"store": "assets", "key": KEY, "version_id": None}
    assert job.input_size == len(DATA) and job.expires_at > job.created_at
    attempt = JobAttempt.objects.get(job=job)
    assert job.current_attempt == attempt and attempt.number == 1
    assert attempt.outcome == AttemptOutcome.PENDING
    request = decode_request(JobOutbox.objects.get(job=job).body.encode())
    assert request.job_id == str(job.pk) and request.attempt_id == str(attempt.attempt_id)
    # Resolved options (profile defaults filled in) and a key the worker can verify.
    assert dict(request.options) == {"metadata_level": "basic", "write_report": False}
    assert verify_idempotency_key(request, processor_version="1.0.0")
    assert request.idempotency_key == job.idempotency_key
    assert job.payload == request.to_dict()


def test_the_same_work_twice_is_one_job(fake_transport):
    first = submit_reference(fake_transport.storage)
    # Naming a default explicitly is the same logical work.
    again = submit_reference(fake_transport.storage, options={"metadata_level": "basic"})
    assert again.pk == first.pk
    assert ProcessingJob.objects.count() == 1 and JobOutbox.objects.count() == 1
    other = submit_reference(fake_transport.storage, options={"metadata_level": "full"})
    assert other.pk != first.pk


def test_a_rolled_back_submit_leaves_no_job_and_no_outbox(fake_transport):
    with pytest.raises(RuntimeError), transaction.atomic():
        submit_reference(fake_transport.storage)
        raise RuntimeError("the caller's transaction fails")
    assert not ProcessingJob.objects.exists() and not JobOutbox.objects.exists()


def test_disabled_backend_and_invalid_requests_are_refused(fake_transport, settings):
    with pytest.raises(processing.ProcessingJobsError) as error:
        processing.submit_processing_job(
            job_type="asset.inspect", subject=("x", "1"), input=None, profile=("p", 1)
        )
    assert error.value.code == "unknown_kind"
    with pytest.raises(processing.ProcessingJobsError) as error:
        submit_reference(fake_transport.storage, options={"metadata_level": "loud"})
    assert error.value.code == "invalid_processing_profile"
    with pytest.raises(processing.ProcessingJobsError) as error:
        processing.submit_processing_job(
            job_type="reference.checksum",
            subject=("test_subject", "s"),
            input={**seed(fake_transport.storage), "key": "assets/../etc/passwd"},
            profile=("reference-default", 1),
        )
    assert error.value.code == "invalid_object_reference"
    settings.LAI_PROCESSING_BACKEND = "disabled"
    with pytest.raises(processing.ProcessingDisabled):
        submit_reference(fake_transport.storage)
    assert not ProcessingJob.objects.exists()


def test_inline_backend_runs_after_commit_to_validated_with_metadata_and_artifacts(
    settings, django_capture_on_commit_callbacks
):
    """The full inline path: submit, commit, relay, the reference processor in the execution
    engine, the completion through apply_completion."""
    settings.LAI_PROCESSING_BACKEND = "inline"
    transport.reset_transport()
    processing.set_registry_for_tests(None)
    try:
        storage = transport.object_storage().memory  # the in-memory side of the inline store
        from lai_processing.contracts.common import ObjectRef
        from lai_processing.contracts.identifiers import StoreName

        key = "processing/quarantine/test/upload-1/input.bin"
        storage.seed(ObjectRef(StoreName.QUARANTINE, key, None, "test"), DATA)
        with django_capture_on_commit_callbacks(execute=True):
            job = processing.submit_processing_job(
                job_type="reference.checksum",
                subject=("test_subject", "inline-1"),
                input={
                    "store": "quarantine",
                    "key": key,
                    "sha256": hashlib.sha256(DATA).hexdigest(),
                    "size_bytes": len(DATA),
                    "content_type": "text/plain",
                },
                profile=("reference-default", 1),
                options={"write_report": True, "metadata_level": "full"},
            )
            assert ProcessingJob.objects.get(pk=job.pk).state == JobState.QUEUED  # not yet
        job.refresh_from_db()
        assert (job.state, job.status) == (JobState.VALIDATED, JobStatus.COMPLETED)
        assert job.result["verdict"] == "pass"
        assert job.result["metadata"]["byte_count"] == len(DATA)
        assert job.result["metadata"]["checksum_verified"] is True
        attempt = job.current_attempt
        assert attempt.outcome == AttemptOutcome.SUCCEEDED and attempt.applied_at
        assert attempt.processor_id == "reference.checksum" and attempt.verdict == "pass"
        artifact = JobArtifact.objects.get(job=job)
        assert artifact.logical_id == "reference-report" and artifact.attempt == attempt
        assert artifact.key.startswith(f"processing/artifacts/test/{job.pk}/{attempt.attempt_id}/")
        assert job.receipts.get().action == "apply"
        assert JobOutbox.objects.get(job=job).sent_at is not None
    finally:
        transport.reset_transport()


def test_inline_reads_assets_through_django_asset_storage(
    settings, django_capture_on_commit_callbacks
):
    import io

    from apps.assets.storage import get_storage, reset_storage_cache

    settings.LAI_PROCESSING_BACKEND = "inline"
    transport.reset_transport()
    reset_storage_cache()
    get_storage().put(
        KEY,
        io.BytesIO(DATA),
        content_type="model/gltf-binary",
        sha256=hashlib.sha256(DATA).hexdigest(),
    )
    try:
        with django_capture_on_commit_callbacks(execute=True):
            job = processing.submit_processing_job(
                job_type="reference.checksum",
                subject=("test_subject", "asset-1"),
                input={
                    "store": "assets",
                    "key": KEY,
                    "sha256": hashlib.sha256(DATA).hexdigest(),
                    "size_bytes": len(DATA),
                    "content_type": "model/gltf-binary",
                },
                profile=("reference-default", 1),
            )
        job.refresh_from_db()
        assert job.state == JobState.VALIDATED
        assert job.result["input"]["verified"] is True
    finally:
        transport.reset_transport()
        reset_storage_cache()


def test_current_request_helper_tracks_the_attempt(fake_transport):
    job = submit_reference(fake_transport.storage)
    assert current_request(job).attempt_number == 1
