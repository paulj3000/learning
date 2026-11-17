"""apply_completion: the decision matrix, persisted under the job row lock."""

import dataclasses
import logging

import pytest
from django.db import DatabaseError

from apps.jobs import processing
from apps.jobs.models import (
    AttemptOutcome,
    CompletionReceipt,
    JobArtifact,
    JobAttempt,
    JobOutbox,
    JobState,
    JobStatus,
)
from lai_processing.contracts.codec import decode_request
from lai_processing.contracts.common import ProcessorIdentity, ProfileRef
from lai_processing.contracts.identifiers import StoreName
from lai_processing.core.errors import ErrorCode
from lai_processing.ports.storage import StorageUnavailable

from .processing_fakes import (
    consume,
    current_request,
    event_bytes,
    fake_transport,
    result_for,
    run_worker,
    submit_reference,
)

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]
__all__ = ["fake_transport"]


@pytest.fixture
def queued(fake_transport):
    """A submitted, dispatched reference job and its attempt-1 request."""
    job = submit_reference(fake_transport.storage)
    processing.relay_outbox(fake_transport.work)
    return job, current_request(job)


def apply(fake, body):
    return processing.apply_completion(body, storage=fake.storage)


def test_success_inline_applies_validated_with_results(fake_transport, queued):
    job, _ = queued
    run_worker(fake_transport)
    [outcome] = consume(fake_transport)
    assert (outcome.action, outcome.ack, outcome.reason) == ("apply", True, "succeeded")
    job.refresh_from_db()
    assert (job.state, job.status, job.error_code) == (JobState.VALIDATED, JobStatus.COMPLETED, "")
    assert job.result["metadata"]["checksum_verified"] is True and job.finished_at
    attempt = job.current_attempt
    assert attempt.outcome == AttemptOutcome.SUCCEEDED and attempt.result == job.result
    assert CompletionReceipt.objects.get().action == "apply"
    assert job.deliveries == 1


def test_success_by_reference_is_read_verified_and_recorded(fake_transport, queued):
    job, request = queued
    result = result_for(request, metadata={"note": "x" * 3000})
    body = event_bytes(result, store=fake_transport.storage)
    assert b'"result":null' in body  # it really went by reference
    outcome = apply(fake_transport, body)
    assert outcome.action == "apply"
    job.refresh_from_db()
    assert job.state == JobState.VALIDATED and job.result["metadata"]["note"] == "x" * 3000
    assert JobArtifact.objects.get(job=job).logical_id == "job-result"


def test_by_reference_storage_failure_is_deferred_and_commits_nothing(fake_transport, queued):
    job, request = queued
    body = event_bytes(
        result_for(request, metadata={"note": "x" * 3000}), store=fake_transport.storage
    )
    fake_transport.storage.fail_next("read", StorageUnavailable({"store": "artifacts"}))
    with pytest.raises(processing.CompletionDeferred) as error:
        apply(fake_transport, body)
    assert error.value.code == "result_unavailable"
    assert not CompletionReceipt.objects.exists()
    assert apply(fake_transport, body).action == "apply"  # the redelivery succeeds


def test_a_tampered_by_reference_result_is_rejected(fake_transport, queued, caplog):
    job, request = queued
    body = event_bytes(
        result_for(request, metadata={"note": "x" * 3000}), store=fake_transport.storage
    )
    [(store_key, versions)] = [
        item for item in fake_transport.storage.objects.items() if item[0][0] == "artifacts"
    ]
    stored = versions[-1]
    versions[-1] = dataclasses.replace(stored, data=stored.data.replace(b"xxx", b"yyy", 1))
    with caplog.at_level(logging.WARNING, logger="lai.jobs"):
        outcome = apply(fake_transport, body)
    assert (outcome.action, outcome.reason, outcome.ack) == ("reject", "result_mismatch", True)
    assert "processing.completion_rejected" in caplog.text
    job.refresh_from_db()
    assert job.state == JobState.QUEUED


def test_the_same_event_twice_and_the_same_attempt_twice_are_duplicates(fake_transport, queued):
    job, request = queued
    body = event_bytes(result_for(request))
    assert apply(fake_transport, body).action == "apply"
    again = apply(fake_transport, body)
    assert (again.action, again.reason, again.ack) == ("duplicate", "event_seen", True)
    other_event = apply(fake_transport, event_bytes(result_for(request)))
    assert (other_event.action, other_event.reason) == ("duplicate", "already_applied")
    job.refresh_from_db()
    assert job.deliveries == 3 and JobAttempt.objects.filter(job=job).count() == 1


def test_retry_creates_a_new_attempt_and_outbox_row(fake_transport, queued):
    job, request = queued
    outcome = apply(
        fake_transport,
        event_bytes(result_for(request, status="failed", code=ErrorCode.TEMPORARY_FAILURE)),
    )
    assert (outcome.action, outcome.reason) == ("retry", "retryable_failure")
    job.refresh_from_db()
    assert (job.state, job.status, job.error_code) == (
        JobState.QUEUED,
        JobStatus.PENDING,
        "temporary_failure",
    )
    first, second = JobAttempt.objects.filter(job=job).order_by("number")
    assert first.outcome == AttemptOutcome.FAILED and first.applied_at
    assert job.current_attempt == second and second.number == 2
    assert second.attempt_id != first.attempt_id
    retry = decode_request(JobOutbox.objects.get(attempt=second).body.encode())
    assert (retry.attempt_id, retry.attempt_number) == (str(second.attempt_id), 2)
    assert retry.idempotency_key == request.idempotency_key and retry.job_id == request.job_id
    assert JobOutbox.objects.get(attempt=second).sent_at is None


def test_retries_exhausted_fails_the_job(fake_transport, queued, settings):
    settings.LAI_PROCESSING_MAX_ATTEMPTS = 2
    job, request = queued
    temporary = {"status": "failed", "code": ErrorCode.PROCESSING_TIMEOUT}
    assert apply(fake_transport, event_bytes(result_for(request, **temporary))).action == "retry"
    second = current_request(job)
    outcome = apply(fake_transport, event_bytes(result_for(second, **temporary)))
    assert (outcome.action, outcome.reason) == ("apply", "retries_exhausted")
    job.refresh_from_db()
    assert (job.state, job.status, job.error_code) == (
        JobState.FAILED,
        JobStatus.FAILED,
        "processing_timeout",
    )
    assert processing.retry_eligible(job)


def test_permanent_failure_and_cancelled_results(fake_transport, queued):
    job, request = queued
    outcome = apply(
        fake_transport,
        event_bytes(result_for(request, status="failed", code=ErrorCode.CHECKSUM_MISMATCH)),
    )
    assert (outcome.action, outcome.reason) == ("apply", "failed_permanent")
    job.refresh_from_db()
    assert (job.state, job.error_code) == (JobState.FAILED, "checksum_mismatch")
    assert job.result["errors"][0]["code"] == "checksum_mismatch"

    other = submit_reference(fake_transport.storage, subject=("test_subject", "other"))
    cancelled = result_for(current_request(other), status="cancelled", code=ErrorCode.CANCELLED)
    assert apply(fake_transport, event_bytes(cancelled)).reason == "cancelled"
    other.refresh_from_db()
    assert (other.state, other.status) == (JobState.CANCELLED, JobStatus.FAILED)


def test_late_success_after_cancel_is_stale(fake_transport, queued):
    job, request = queued
    assert processing.cancel_job(job, user=None)
    outcome = apply(fake_transport, event_bytes(result_for(request)))
    assert (outcome.action, outcome.reason, outcome.ack) == ("stale", "job_finished", True)
    job.refresh_from_db()
    assert (job.state, job.result) == (JobState.CANCELLED, None)
    assert job.current_attempt.outcome == AttemptOutcome.ABANDONED


def test_a_superseded_attempt_is_stale_and_never_replaces_a_newer_success(fake_transport, queued):
    job, first = queued
    # The job expired and staff requeued it: attempt 2 is current, attempt 1 never reported.
    processing.ProcessingJob.objects.filter(pk=job.pk).update(
        expires_at=processing._now() - processing.timedelta(minutes=1)
    )
    assert processing.reconcile()["expired"] == 1
    assert processing.requeue_job(job, user=None)
    second = current_request(job)
    assert second.attempt_number == 2
    late = apply(fake_transport, event_bytes(result_for(first)))
    assert (late.action, late.reason) == ("stale", "superseded_attempt")
    assert apply(fake_transport, event_bytes(result_for(second))).action == "apply"
    later = apply(fake_transport, event_bytes(result_for(first)))
    assert (later.action, later.reason) == ("stale", "job_finished")
    job.refresh_from_db()
    assert job.state == JobState.VALIDATED and job.result["attempt_id"] == second.attempt_id


@pytest.mark.parametrize(
    ("change", "reason"),
    [
        ({"idempotency_key": "ik1:" + "b" * 64}, "identity_mismatch"),
        ({"job_id": "00000000-0000-4000-8000-000000000000"}, "unknown_job"),
        ({"namespace": "other"}, "namespace_mismatch"),
        ({"attempt_id": "00000000-0000-4000-8000-000000000001"}, "unknown_attempt"),
    ],
)
def test_forged_identity_is_rejected_and_logged(fake_transport, queued, change, reason, caplog):
    job, request = queued
    forged_request = dataclasses.replace(request, **change) if "namespace" not in change else None
    if forged_request is None:  # the input ref is validated per namespace: rebuild it
        from lai_processing.contracts.common import InputObject, ObjectRef

        ref = request.input.ref
        forged_request = dataclasses.replace(
            request,
            namespace="other",
            input=InputObject(
                ref=ObjectRef(ref.store, ref.key, ref.version_id, "other"),
                content_type=request.input.content_type,
                size_bytes=request.input.size_bytes,
                sha256=request.input.sha256,
            ),
        )
    with caplog.at_level(logging.WARNING, logger="lai.jobs"):
        outcome = apply(fake_transport, event_bytes(result_for(forged_request)))
    assert (outcome.action, outcome.reason, outcome.ack) == ("reject", reason, True)
    assert "processing.completion_rejected job=" in caplog.text and reason in caplog.text
    assert CompletionReceipt.objects.get().action == "reject"
    job.refresh_from_db()
    assert job.state == JobState.QUEUED and job.result is None


@pytest.mark.parametrize(
    ("kwargs", "reason"),
    [
        ({"sha256": "c" * 64}, "input_mismatch"),
        ({"verified": False}, "input_unverified"),
        ({"processor": ProcessorIdentity("reference.checksum", "9.9.9")}, "processor_mismatch"),
        ({"processor": ProcessorIdentity("asset.glb_validator", "1.0.0")}, "processor_mismatch"),
        ({"profile": ProfileRef("reference-default", 2)}, "profile_mismatch"),
    ],
)
def test_results_that_do_not_match_the_job_are_rejected(fake_transport, queued, kwargs, reason):
    job, request = queued
    outcome = apply(fake_transport, event_bytes(result_for(request, **kwargs)))
    assert (outcome.action, outcome.reason) == ("reject", reason)
    job.refresh_from_db()
    assert job.state == JobState.QUEUED
    assert job.current_attempt.outcome == AttemptOutcome.PENDING


def test_undecodable_messages_are_invalid_and_never_acknowledged(fake_transport, queued):
    for body in (b"not json", b"{}", b'{"kind":"lai.processing.job_completed"}', b"x" * 300000):
        outcome = apply(fake_transport, body)
        assert (outcome.action, outcome.ack) == ("invalid", False)
    assert not CompletionReceipt.objects.exists()


def test_a_database_error_is_deferred(fake_transport, queued, monkeypatch):
    job, request = queued

    def broken(*args, **kwargs):
        raise DatabaseError("connection lost")

    monkeypatch.setattr(processing, "_apply_locked", broken)
    with pytest.raises(processing.CompletionDeferred) as error:
        apply(fake_transport, event_bytes(result_for(request)))
    assert isinstance(error.value.__cause__, DatabaseError)


def test_artifacts_must_belong_to_the_job_and_attempt(fake_transport, queued):
    """The contract already refuses a foreign artifact in a result; Django checks again."""
    job, request = queued
    from .processing_fakes import artifact_for

    result = result_for(request, artifacts=[artifact_for(request)])
    assert processing._check_against_job(job, job.current_attempt, result) is None
    other = JobAttempt.objects.create(job=job, number=2)
    assert processing._check_against_job(job, other, result) in {
        "attempt_mismatch",
        "artifact_foreign",
    }
    assert StoreName.ARTIFACTS.value == "artifacts"


def test_staff_transitions_go_through_the_lifecycle(fake_transport, queued):
    job, _ = queued
    assert processing.requeue_job(job, user=None) is False  # QUEUED is not FAILED
    assert not processing.retry_eligible(job)
    assert processing.cancel_job(job, user=None) is True
    assert processing.cancel_job(job, user=None) is False  # CANCELLED is terminal
    assert processing.requeue_job(job, user=None) is False
    assert processing.relay_outbox(fake_transport.work) == 0
    legacy = processing.ProcessingJob.objects.create(
        kind="asset.inspect", queue="media", backend="sqs"
    )
    with pytest.raises(processing.ProcessingJobsError):
        processing.cancel_job(legacy, user=None)


def test_retries_after_a_staff_requeue_carry_the_renewed_expiry(
    fake_transport, queued, monkeypatch
):
    """The requeue renews the expiry for every later attempt, not only for its own: an
    automatic retry built from the job's template must not carry attempt 1's past expiry."""
    job, first = queued
    later = processing._now() + processing.timedelta(
        hours=processing.settings.LAI_PROCESSING_JOB_TTL_HOURS + 1
    )
    monkeypatch.setattr(processing, "_now", lambda: later)  # attempt 1's window has passed
    assert processing.reconcile()["expired"] == 1
    assert processing.requeue_job(job, user=None)
    second = current_request(job)
    assert second.expires_at > later
    temporary = {"status": "failed", "code": ErrorCode.TEMPORARY_FAILURE}
    assert apply(fake_transport, event_bytes(result_for(second, **temporary))).action == "retry"
    third = current_request(job)
    assert third.attempt_number == 3
    assert third.expires_at > later
    assert (third.submitted_at, third.expires_at) == (second.submitted_at, second.expires_at)
    job.refresh_from_db()
    assert job.expires_at == third.expires_at
    # The template keeps its attempt-1 identity; only the window moved.
    assert job.payload["attempt_number"] == 1 and job.payload["attempt_id"] == first.attempt_id

