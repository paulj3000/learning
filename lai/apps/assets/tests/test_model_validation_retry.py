"""Retry, resubmission and retention of `asset.validate_model` jobs (owner decisions 2026-11-17;
docs/processing/ASYNC_MODEL_VALIDATION.md, "Retry and resubmission semantics" and "Retention").

The matrix: transport retries are SQS redeliveries of the same job; staff resubmission makes a
new job only after an eligible terminal outcome, at most `LAI_ASSET_VALIDATION_MAX_ATTEMPTS` per
logical work; a superseded (late) result never changes a version; a rejected version stays
rejected and a published one is never changed. Retention: completed validation jobs are pruned
after `LAI_ASSET_VALIDATION_JOB_RETENTION_DAYS`; an unpublished GLB then needs a new validation,
a published one stays deliverable. Results are the real contract over the stored bytes, applied
through `apply_result`. No AWS. PostgreSQL only.
"""

import copy
import threading
import time
import uuid
from datetime import timedelta
from types import SimpleNamespace

import pytest
from django.utils.timezone import now

from apps.assets import resolver, services
from apps.assets.jobs import InlinePorts
from apps.assets.models import AssetVersion, VersionStatus
from apps.assets.processing import (
    MODEL_VALIDATION_JOB_TYPE,
    model_validation_request,
    reusable,
    submit_model_validation,
    validation_jobs,
)
from apps.assets.services import AssetActionRefused
from apps.assets.storage import get_storage
from apps.assets.tests.helpers import glb_bytes, make_definition
from apps.jobs import services as jobs
from apps.jobs.core import contract, tasks
from apps.jobs.models import JobStatus, ProcessingJob
from apps.jobs.tests.helpers import FakeS3, FakeSQS, use_sqs
from lai_processing.core.errors import ERROR_CLASSIFICATION, ErrorCode, RetryClass

from .test_model_validation_results import (
    _threads,
    broken_model,
    message,
    reload,
    state,
    stored_version,
    submitted,
    valid_model,
    worker_result,
)
from .validation_jobs import complete, upload

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


@pytest.fixture
def aws(settings):
    """The SQS backend with fake clients (jobs stay PENDING until a result is applied)."""
    settings.LAI_ASSET_STORAGE = "memory"
    use_sqs(settings)
    fakes = SimpleNamespace(sqs=FakeSQS(), s3=FakeS3())
    jobs.set_aws_clients(sqs=fakes.sqs, s3=fakes.s3)
    yield fakes
    jobs.set_aws_clients()


def fail(job, code):
    assert jobs.apply_result(message(job, "failed", code=code)) == jobs.APPLIED
    return reload(job)


def succeed(job, output=None):
    output = worker_result(job) if output is None else output
    assert jobs.apply_result(message(job, "succeeded", result=output)) == jobs.APPLIED
    return reload(job)


class FlakyPorts(InlinePorts):
    """The worker's asset ports with S3 reads failing transiently (a retryable task error)."""

    def read_asset(self, key, start, length):
        raise tasks.TaskError("storage", retryable=True)


def rival(version, *, minutes_earlier_for=None) -> ProcessingJob:
    """A second unfinished job for `version` submitted directly (as a build with a newer
    processor version would: another idempotency key, so the reuse rule does not return the
    first job). `minutes_earlier_for` moves that job's creation one minute back."""
    job_id = str(uuid.uuid4())
    payload = model_validation_request(version, job_id=job_id)
    job = jobs.submit(
        MODEL_VALIDATION_JOB_TYPE,
        payload,
        subject=version,
        job_id=job_id,
        idempotency_key=payload["idempotency_key"],
    )
    if minutes_earlier_for is not None:
        ProcessingJob.objects.filter(pk=minutes_earlier_for.pk).update(
            created_at=now() - timedelta(minutes=1)
        )
    return job


# --- transport retries: SQS redelivery of the same job --------------------------------------------


def test_a_retryable_s3_read_failure_is_redelivered_as_the_same_job(aws):
    version = stored_version(valid_model())
    job = submitted(version)
    assert jobs.apply_result(message(job, "running")) == jobs.RUNNING

    with pytest.raises(tasks.TaskError) as raised:
        contract.run(job.kind, job.payload, FlakyPorts())
    assert raised.value.code == "storage_failure" and raised.value.retryable
    # The worker raised: no result message, SQS redelivers the same work message.
    assert reload(job).status == JobStatus.RUNNING and job.result is None

    assert jobs.apply_result(message(job, "running", request_id="req-2")) == jobs.DUPLICATE
    job = succeed(job, contract.run(job.kind, job.payload, InlinePorts()))
    assert job.subject_outcome == "version_validated" and job.attempts == 1
    assert list(validation_jobs(version)) == [job]  # no second job
    version.refresh_from_db()
    assert version.status == VersionStatus.VALIDATED


def test_a_missing_input_is_terminal_and_resubmittable(aws):
    version = stored_version(valid_model())
    job = submitted(version)
    get_storage().delete(version.storage_key)
    with pytest.raises(tasks.TaskError) as raised:
        contract.run(job.kind, job.payload, InlinePorts())
    assert raised.value.code == "input_missing" and not raised.value.retryable
    before = state(version)

    job = fail(job, "input_missing")

    assert (job.status, job.subject_outcome) == (JobStatus.FAILED, "processing_failed")
    assert state(version) == before and version.status == VersionStatus.DRAFT
    assert not reusable(job)
    assert submitted(version).pk != job.pk


def test_a_processing_timeout_is_retried_then_swept_then_resubmittable(aws, settings):
    """`processing_timeout` is retryable (the engine's classification): SQS redelivers the same
    job, at most 3 receives, then the media DLQ. The job stays RUNNING until `jobs_sweep` fails it
    as `timeout`; staff may then resubmit it."""
    assert ERROR_CLASSIFICATION[ErrorCode.PROCESSING_TIMEOUT] is RetryClass.RETRYABLE
    settings.LAI_JOBS_STALE_MINUTES = 60
    version = stored_version(valid_model())
    job = submitted(version)
    jobs.apply_result(message(job, "running"))
    ProcessingJob.objects.filter(pk=job.pk).update(created_at=now() - timedelta(hours=2))

    assert jobs.sweep()["timed_out"] == 1
    job = reload(job)
    assert (job.status, job.error_code, job.subject_outcome) == (
        JobStatus.FAILED,
        "timeout",
        "processing_failed",
    )
    retry = submitted(version)
    assert retry.pk != job.pk and retry.idempotency_key == job.idempotency_key
    assert retry.payload["attempt_id"] != job.payload["attempt_id"]
    assert succeed(retry).subject_outcome == "version_validated"


@pytest.mark.parametrize("code", ["cancelled", "marked_failed", "job_expired", "submit_failed"])
def test_a_cancelled_or_expired_job_is_terminal_and_resubmittable(aws, code):
    """The contract's CANCELLED result is a schema-1 `failed` result with code `cancelled` (no
    separate job status); an operator's cancel is `marked_failed`; an expired request is
    `job_expired`. Each leaves the version unchanged and may be resubmitted."""
    version = stored_version(valid_model())
    job = submitted(version)
    before = state(version)
    if code == "marked_failed":
        assert jobs.fail_job(job.pk, code)
        job = reload(job)
    else:
        job = fail(job, code)
    assert (job.status, job.error_code, job.subject_outcome) == (
        JobStatus.FAILED,
        code,
        "processing_failed",
    )
    assert state(version) == before
    retry = submitted(version)
    assert retry.pk != job.pk
    assert succeed(retry).subject_outcome == "version_validated"


# --- validation refusal: never automatic, never un-rejects ----------------------------------------


def test_a_refused_model_is_not_retried_automatically_and_stays_rejected(aws):
    version = stored_version(broken_model())
    job = succeed(submitted(version))
    assert job.subject_outcome == "version_rejected"
    assert validation_jobs(version).count() == 1  # nothing resubmits by itself
    version.refresh_from_db()
    rejected = state(version)

    retry = submit_model_validation(version, user=None)  # the explicit staff action
    assert retry.pk != job.pk
    retry = succeed(retry)
    assert (retry.subject_outcome, retry.result["verdict"]) == ("result_recorded", "fail")
    assert state(version) == rejected


def test_a_pass_for_a_rejected_version_is_recorded_and_never_un_rejects_it(aws, settings):
    settings.LAI_ASSET_ASYNC_VALIDATION = "on"
    version = stored_version(valid_model(), status=VersionStatus.REJECTED)
    before = state(version)
    job = succeed(submitted(version))
    assert (job.subject_outcome, job.result["verdict"]) == ("result_recorded", "pass")
    assert state(version) == before
    with pytest.raises(AssetActionRefused) as refused:
        services.publish_version(version)
    assert refused.value.code == "not_validated"


# --- bounded resubmission -------------------------------------------------------------------------


def test_pending_running_and_passing_jobs_are_reused(aws):
    version = stored_version(valid_model())
    job = submitted(version)
    assert submit_model_validation(version, user=None).pk == job.pk
    jobs.apply_result(message(job, "running"))
    assert submit_model_validation(version, user=None).pk == job.pk
    succeed(job)
    assert submit_model_validation(version, user=None).pk == job.pk
    assert validation_jobs(version).count() == 1


def test_resubmissions_stop_at_the_attempt_cap(aws, settings):
    settings.LAI_ASSET_VALIDATION_MAX_ATTEMPTS = 2
    version = stored_version(valid_model())
    other = stored_version(valid_model(), asset=version.asset)
    fail(submitted(version), "timeout")
    fail(submitted(version), "timeout")

    with pytest.raises(jobs.JobsError) as refused:
        submit_model_validation(version, user=None)
    assert refused.value.code == "attempts_exhausted"
    assert validation_jobs(version).count() == 2
    assert submitted(other).pk  # the cap is per version, file and processor


def _two_clicks(version, monkeypatch) -> list[str]:
    """Two simultaneous submissions on separate connections. The job insert is delayed, so
    without the asset row lock both would read "no job" and both would insert one."""
    barrier = threading.Barrier(2)
    returned = []
    real_submit = jobs.submit

    def slow_submit(*args, **kwargs):
        time.sleep(0.3)
        return real_submit(*args, **kwargs)

    monkeypatch.setattr(jobs, "submit", slow_submit)

    def click():
        barrier.wait(5)
        returned.append(str(submit_model_validation(version, user=None).pk))

    _threads(click, click)
    assert len(returned) == 2
    return returned


@pytest.mark.django_db(transaction=True)
def test_concurrent_double_clicks_create_one_job(aws, monkeypatch):
    version = stored_version(valid_model())
    returned = _two_clicks(version, monkeypatch)

    assert returned[0] == returned[1]
    assert validation_jobs(version).count() == 1


@pytest.mark.django_db(transaction=True)
def test_concurrent_resubmissions_after_a_failure_create_one_new_job(aws, monkeypatch):
    version = stored_version(valid_model())
    first = submit_model_validation(version, user=None)
    fail(first, "timeout")
    returned = _two_clicks(version, monkeypatch)

    assert returned[0] == returned[1] != str(first.pk)
    assert validation_jobs(version).count() == 2


def test_a_duplicate_result_for_a_resubmitted_job_applies_once(aws):
    version = stored_version(valid_model())
    fail(submitted(version), "timeout")
    retry = submitted(version)
    body = message(retry, "succeeded", result=worker_result(retry))
    assert jobs.apply_result(body) == jobs.APPLIED
    applied = state(version)
    assert jobs.apply_result(body) == jobs.DUPLICATE
    assert state(version) == applied and reload(retry).subject_outcome == "version_validated"


# --- late results never overwrite the current one -------------------------------------------------


def test_a_late_result_of_a_superseded_job_does_not_change_the_draft(aws):
    version = stored_version(valid_model())
    old = submitted(version)
    old_output = worker_result(old)
    new = rival(version, minutes_earlier_for=old)
    before = state(version)

    assert succeed(old, old_output).subject_outcome == "result_superseded"
    assert state(version) == before and version.status == VersionStatus.DRAFT

    assert succeed(new).subject_outcome == "version_validated"
    version.refresh_from_db()
    assert version.metadata["model_validation"]["job_id"] == str(new.pk)


def test_a_late_result_after_the_newer_one_was_applied_changes_nothing(aws):
    version = stored_version(broken_model())
    old = submitted(version)
    old_output = worker_result(old)
    new = rival(version, minutes_earlier_for=old)
    assert succeed(new).subject_outcome == "version_rejected"
    rejected = state(version)

    assert succeed(old, old_output).subject_outcome == "result_superseded"
    assert state(version) == rejected
    assert version.metadata["model_validation"]["job_id"] == str(new.pk)


def test_the_gate_follows_the_newest_accepted_result_not_an_older_pass(settings):
    settings.LAI_ASSET_ASYNC_VALIDATION = "on"
    version = upload(make_definition("npc-gate"), glb_bytes())
    older = complete(version)
    assert older.subject_outcome == "result_recorded"
    # A newer accepted result for the same file with verdict `fail` (as after a processor fix).
    newer = copy.copy(older)
    newer.pk = uuid.uuid4()
    newer.result = {**older.result, "verdict": "fail"}
    newer.created_at = older.created_at + timedelta(minutes=1)
    newer.save(force_insert=True)
    with pytest.raises(AssetActionRefused) as refused:
        services.publish_version(version)
    assert refused.value.code == "processing_required"
    # The same newest job with a pass decides the other way.
    ProcessingJob.objects.filter(pk=newer.pk).update(result=older.result)
    assert services.publish_version(version).status == VersionStatus.PUBLISHED


# --- published versions are immutable -------------------------------------------------------------


def test_resubmitting_a_published_version_never_changes_it(aws, settings):
    settings.LAI_ASSET_ASYNC_VALIDATION = "on"
    version = stored_version(valid_model(), status=VersionStatus.PUBLISHED)
    published = state(version)
    fail(submitted(version), "timeout")
    retry = succeed(submitted(version))
    assert retry.subject_outcome == "result_recorded"
    assert state(version) == published
    version.refresh_from_db()
    assert version.status == VersionStatus.PUBLISHED


# --- retention and publication integrity ----------------------------------------------------------


def _age(job, days):
    ProcessingJob.objects.filter(pk=job.pk).update(
        created_at=now() - timedelta(days=days, minutes=1),
        finished_at=now() - timedelta(days=days),
    )


@pytest.fixture
def retention(settings):
    settings.LAI_ASSET_ASYNC_VALIDATION = "on"
    settings.LAI_JOBS_RETENTION_DAYS = 30
    settings.LAI_ASSET_VALIDATION_JOB_RETENTION_DAYS = 90
    return settings


def test_a_retained_passing_result_still_allows_publication(retention):
    version = upload(make_definition("npc-kept"), glb_bytes())
    _age(complete(version), 89)  # older than the general 30 days, inside the 90
    assert jobs.sweep()["pruned"] == 0
    assert services.publish_version(version).status == VersionStatus.PUBLISHED


def test_a_pruned_passing_result_needs_a_new_validation_and_never_auto_publishes(retention):
    version = upload(make_definition("npc-pruned"), glb_bytes())
    _age(complete(version), 91)
    assert jobs.sweep()["pruned"] == 1
    assert not validation_jobs(version).exists()

    with pytest.raises(AssetActionRefused) as refused:
        services.publish_version(version)
    assert refused.value.code == "processing_required"
    version.refresh_from_db()
    assert version.status == VersionStatus.VALIDATED and version.published_at is None

    again = complete(version)  # staff run Validate in background again
    assert again.subject_outcome == "result_recorded"
    version.refresh_from_db()
    assert version.status == VersionStatus.VALIDATED  # a result never publishes
    assert services.publish_version(version).status == VersionStatus.PUBLISHED


def test_a_published_version_stays_deliverable_after_its_evidence_is_pruned(retention):
    asset = make_definition("npc-live")
    version = upload(asset, glb_bytes())
    complete(version)
    services.publish_version(version)
    version.refresh_from_db()
    published = state(version)
    before = resolver.resolve([("npc-live", "npc-live", None)])

    _age(validation_jobs(version).get(), 120)
    assert jobs.sweep()["pruned"] == 1

    assert state(version) == published
    version.refresh_from_db()
    assert version.status == VersionStatus.PUBLISHED
    [entry] = resolver.resolve([("npc-live", "npc-live", None)])
    assert entry["status"] == "resolved" and entry["versionId"] == str(version.version_id)
    assert {k: v for k, v in entry.items() if k not in ("url", "urlExpiresAt")} == {
        k: v for k, v in before[0].items() if k not in ("url", "urlExpiresAt")
    }
    assert AssetVersion.objects.get(pk=version.pk).metadata == version.metadata
