"""`asset.validate_model` results on the canonical jobs path (ADR-064), end to end.

Jobs are submitted with the SQS backend and fake AWS clients, so they stay PENDING exactly as in
production until a result arrives. Results are produced by running the real contract
(`apps.jobs.core.contract.run`) against in-memory asset storage, wrapped in schema-1 result
envelopes and applied with `apps.jobs.services.apply_result` (once through the
`jobs_consume_results` command). Negative cases tamper copies of a real result. PostgreSQL only.
"""

import copy
import hashlib
import io
import json
import threading
import time
import uuid
from datetime import timedelta
from types import SimpleNamespace

import pytest
from django.core.management import call_command
from django.db import DatabaseError, connection, transaction
from django.test.utils import CaptureQueriesContext
from django.utils.timezone import now

from apps.assets.jobs import InlinePorts
from apps.assets.models import IMMUTABLE_FIELDS, AssetVersion, VersionStatus
from apps.assets.processing import (
    MODEL_VALIDATION_JOB_TYPE,
    processing_findings,
    submit_model_validation,
    validation_jobs,
)
from apps.assets.services import publish_version
from apps.assets.storage import get_storage
from apps.assets.tests.helpers import glb_bytes, gltf_document, make_definition, make_version
from apps.jobs import services
from apps.jobs.core import contract, envelope
from apps.jobs.models import JobStatus, ProcessingJob
from apps.jobs.tests.helpers import MEDIA_URL, FakeS3, FakeSQS, use_sqs
from lai_processing.contracts.results import JobError, ProcessingJobResult
from lai_processing.core.errors import ErrorCode, ProcessingError

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

MIXAMO = "Armature|mixamo.com|Layer0"
UPLOAD_FINDING = {"code": "clip_extra", "severity": "warning", "message": "Extra clip.", "path": ""}


@pytest.fixture
def aws(settings):
    settings.LAI_ASSET_STORAGE = "memory"
    use_sqs(settings)
    fakes = SimpleNamespace(sqs=FakeSQS(), s3=FakeS3())
    services.set_aws_clients(sqs=fakes.sqs, s3=fakes.s3)
    yield fakes
    services.set_aws_clients()


def valid_model() -> bytes:
    return glb_bytes(*gltf_document(clips=("Idle", MIXAMO)))


def broken_model() -> bytes:
    document, binary = gltf_document()
    document["accessors"][0]["count"] = 10_000  # reads far past its buffer view
    return glb_bytes(document, binary)


def stored_version(data: bytes, *, asset=None, status=VersionStatus.DRAFT):
    row = make_version(
        asset or make_definition(f"npc-{uuid.uuid4().hex[:8]}"),
        status=status,
        sha256=hashlib.sha256(data).hexdigest(),
        size_bytes=len(data),
        clips=["Idle", MIXAMO],
        dimensions={"x": 1.0, "y": 2.0, "z": 0.5},
        metadata={"uploaded": True},
        validation_report=[UPLOAD_FINDING],
    )
    get_storage().put(
        row.storage_key, io.BytesIO(data), content_type=row.content_type, sha256=row.sha256
    )
    return row


def worker_result(job) -> dict:
    """What the media worker computes for `job` (the real contract over the stored bytes)."""
    return contract.run(job.kind, job.payload, InlinePorts())


def message(job, status, *, result=None, code=None, request_id="req-1") -> dict:
    return envelope.build_result(
        str(job.pk),
        job.kind,
        status,
        result=result,
        error_code=code,
        function="lai-dev-jobs-media",
        request_id=request_id,
    )


def submitted(version) -> ProcessingJob:
    job = submit_model_validation(version, user=None)
    job.refresh_from_db()
    assert job.status == JobStatus.PENDING and job.backend == "sqs"
    return job


def state(row) -> dict:
    row.refresh_from_db()
    return {name: getattr(row, name) for name in (*IMMUTABLE_FIELDS, "status", "retired_at")}


def reload(job) -> ProcessingJob:
    job.refresh_from_db()
    return job


# --- results ----------------------------------------------------------------------------------


def test_a_passing_result_validates_the_draft(aws, django_capture_on_commit_callbacks):
    version = stored_version(valid_model())
    with django_capture_on_commit_callbacks(execute=True):
        job = submit_model_validation(version, user=None)
    [sent] = aws.sqs.sent
    assert sent["QueueUrl"] == MEDIA_URL
    work = envelope.parse_work(sent["Body"])
    assert work["kind"] == MODEL_VALIDATION_JOB_TYPE and work["payload"] == reload(job).payload
    assert job.status == JobStatus.PENDING and job.dispatched_at is not None

    output = contract.run(work["kind"], work["payload"], InlinePorts())
    assert services.apply_result(message(job, "running")) == services.RUNNING
    assert reload(job).status == JobStatus.RUNNING and job.attempts == 1
    assert services.apply_result(message(job, "succeeded", result=output)) == services.APPLIED

    job = reload(job)
    assert job.status == JobStatus.COMPLETED and job.subject_outcome == "version_validated"
    assert job.attempts == 1 and job.deliveries == 2 and job.result == output
    version.refresh_from_db()
    assert version.status == VersionStatus.VALIDATED
    assert version.validated_at is not None and version.published_at is None
    findings = processing_findings(job)
    assert version.validation_report == [UPLOAD_FINDING, *findings]
    assert all(f["source"] == "processing" for f in version.validation_report[1:])
    assert version.metadata["uploaded"] is True
    summary = version.metadata["model_validation"]
    assert summary["verdict"] == "pass" and summary["job_id"] == str(job.pk)
    assert summary["processor_id"] == "asset.glb_validator"
    assert summary["profile_id"] == "glb-default" and summary["profile_version"] == 1
    assert [(a["name"], a["duration_seconds"]) for a in summary["animations"]] == [
        ("Idle", 1.0),
        (MIXAMO, 1.0),
    ]
    assert version.clips == ["Idle", MIXAMO]  # the worker never rewrites upload fields
    assert version.dimensions == {"x": 1.0, "y": 2.0, "z": 0.5}


def test_a_failing_verdict_rejects_the_draft(aws):
    version = stored_version(broken_model())
    job = submitted(version)
    output = worker_result(job)
    assert output["verdict"] == "fail"

    assert services.apply_result(message(job, "succeeded", result=output)) == services.APPLIED

    job = reload(job)
    assert (job.status, job.subject_outcome) == (JobStatus.COMPLETED, "version_rejected")
    version.refresh_from_db()
    assert version.status == VersionStatus.REJECTED and version.validated_at is None
    assert version.validation_report == [UPLOAD_FINDING, *processing_findings(job)]
    assert any(f["severity"] == "error" for f in version.validation_report[1:])
    assert version.metadata["model_validation"]["verdict"] == "fail"
    assert version.metadata["model_validation"]["error_count"] >= 1


def test_a_failed_result_leaves_the_draft(aws):
    version = stored_version(valid_model())
    job = submitted(version)
    before = state(version)

    assert (
        services.apply_result(message(job, "failed", code="checksum_mismatch")) == services.APPLIED
    )

    job = reload(job)
    assert (job.status, job.error_code) == (JobStatus.FAILED, "checksum_mismatch")
    assert job.subject_outcome == "processing_failed" and job.result is None
    assert state(version) == before


def test_the_consumer_command_applies_a_queued_result(aws, capsys):
    version = stored_version(valid_model())
    job = submitted(version)
    running = aws.sqs.queue(message(job, "running"))
    final = aws.sqs.queue(message(job, "succeeded", result=worker_result(job)))

    call_command("jobs_consume_results", "--once", "--wait-seconds", "0")

    counts = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert counts["received"] == 2 and counts["deleted"] == 2 and counts["left"] == 0
    assert aws.sqs.deleted == [running, final]
    assert reload(job).subject_outcome == "version_validated"
    version.refresh_from_db()
    assert version.status == VersionStatus.VALIDATED


# --- delivery guarantees ----------------------------------------------------------------------


def test_a_duplicate_result_changes_the_version_once(aws):
    version = stored_version(valid_model())
    job = submitted(version)
    body = message(job, "succeeded", result=worker_result(job))

    assert services.apply_result(body) == services.APPLIED
    first = state(version)
    assert services.apply_result(body) == services.DUPLICATE
    assert services.apply_result(message(job, "running")) == services.DUPLICATE

    assert state(version) == first  # validated_at, report and metadata unchanged
    job = reload(job)
    assert job.deliveries == 3 and job.subject_outcome == "version_validated"


def test_a_late_result_after_a_sweep_timeout_is_ignored(aws, settings):
    settings.LAI_JOBS_STALE_MINUTES = 60
    version = stored_version(valid_model())
    job = submitted(version)
    body = message(job, "succeeded", result=worker_result(job))
    ProcessingJob.objects.filter(pk=job.pk).update(created_at=now() - timedelta(hours=2))
    before = state(version)

    assert services.sweep()["timed_out"] == 1
    job = reload(job)
    assert (job.status, job.error_code) == (JobStatus.FAILED, "timeout")
    assert job.subject_outcome == "processing_failed"

    assert services.apply_result(body) == services.DUPLICATE
    assert state(version) == before
    assert reload(job).status == JobStatus.FAILED and job.result is None


def test_a_late_result_after_an_operator_failure_is_ignored(aws):
    version = stored_version(valid_model())
    job = submitted(version)
    body = message(job, "succeeded", result=worker_result(job))
    before = state(version)

    assert services.fail_job(job.pk, "cancelled")
    assert not services.fail_job(job.pk, "cancelled")
    assert services.apply_result(body) == services.DUPLICATE

    assert state(version) == before
    job = reload(job)
    assert (job.status, job.subject_outcome) == (JobStatus.FAILED, "processing_failed")


# --- forged or mismatched results -------------------------------------------------------------


def _forge(output: dict, case: str) -> dict:
    forged = copy.deepcopy(output)
    if case == "job_mismatch":
        forged["job_id"] = str(uuid.uuid4())
    elif case == "attempt_mismatch":
        forged["attempt_id"] = str(uuid.uuid4())
    elif case == "attempt_number":
        forged["attempt_number"] = 2
    elif case == "key_mismatch":
        forged["idempotency_key"] = "ik1:" + "b" * 64
    elif case == "namespace":
        forged["namespace"] = "other"
    elif case == "job_type":
        forged["job_type"] = "reference.checksum"
    elif case == "profile_mismatch":
        forged["profile"] = {"profile_id": "glb-default", "version": 2}
    elif case == "unverified":
        forged["input"]["verified"] = False
    elif case == "other_sha":
        forged["input"]["sha256"] = "0" * 64
    elif case == "other_size":
        forged["input"]["size_bytes"] += 1
    elif case == "other_key":
        forged["input"]["ref"]["key"] += ".other"
    elif case == "no_input":
        forged["input"] = None
    elif case == "garbage":
        forged = {"verdict": "pass", "status": "succeeded"}
    else:  # pragma: no cover
        raise AssertionError(case)
    return forged


@pytest.mark.parametrize(
    ("case", "code"),
    [
        ("job_mismatch", "job_mismatch"),
        ("attempt_mismatch", "attempt_mismatch"),
        ("attempt_number", "attempt_mismatch"),
        ("key_mismatch", "key_mismatch"),
        ("namespace", "identity_mismatch"),
        ("job_type", "identity_mismatch"),
        ("profile_mismatch", "profile_mismatch"),
        ("unverified", "input_mismatch"),
        ("other_sha", "input_mismatch"),
        ("other_size", "input_mismatch"),
        ("other_key", "input_mismatch"),
        ("no_input", "input_mismatch"),
        ("garbage", "result_invalid"),
    ],
)
def test_a_forged_result_changes_nothing(aws, case, code):
    version = stored_version(valid_model())
    job = submitted(version)
    forged = _forge(worker_result(job), case)
    before = state(version)

    assert services.apply_result(message(job, "succeeded", result=forged)) == services.APPLIED

    job = reload(job)
    assert job.subject_outcome == code
    assert job.status == JobStatus.COMPLETED  # the result is kept on the job for review
    assert state(version) == before


def test_a_job_mismatch_in_the_recorded_request_changes_nothing(aws):
    """The request in the job row must name the job too (a row edited after submission)."""
    version = stored_version(valid_model())
    job = submitted(version)
    output = worker_result(job)
    ProcessingJob.objects.filter(pk=job.pk).update(
        payload={**job.payload, "job_id": str(uuid.uuid4())}
    )
    before = state(version)

    assert services.apply_result(message(job, "succeeded", result=output)) == services.APPLIED

    assert reload(job).subject_outcome == "job_mismatch"
    assert state(version) == before


def test_a_key_mismatch_with_the_job_row_changes_nothing(aws):
    version = stored_version(valid_model())
    job = submitted(version)
    output = worker_result(job)
    ProcessingJob.objects.filter(pk=job.pk).update(idempotency_key="ik1:" + "c" * 64)
    before = state(version)

    services.apply_result(message(job, "succeeded", result=output))

    assert reload(job).subject_outcome == "key_mismatch"
    assert state(version) == before


@pytest.mark.parametrize("status", ["failed", "cancelled"])
def test_a_result_whose_contract_status_is_not_succeeded_changes_nothing(aws, status):
    version = stored_version(valid_model())
    job = submitted(version)
    code = ErrorCode.CANCELLED if status == "cancelled" else ErrorCode.CHECKSUM_MISMATCH
    error = JobError.from_error(ProcessingError(code))
    forged = copy.deepcopy(worker_result(job))
    forged.update(
        status=status,
        verdict=None,
        errors=[error.to_dict()],
        retry_class=error.retry_class.value,
        findings=[],
    )
    ProcessingJobResult.from_dict(forged)  # a well-formed contract result
    before = state(version)

    services.apply_result(message(job, "succeeded", result=forged))

    assert state(version) == before
    assert reload(job).subject_outcome == "result_invalid"


# --- the version changed between submission and result ----------------------------------------


def test_a_deleted_version_is_version_missing(aws):
    version = stored_version(valid_model())
    job = submitted(version)
    body = message(job, "succeeded", result=worker_result(job))
    AssetVersion.objects.filter(pk=version.pk).delete()

    assert services.apply_result(body) == services.APPLIED

    job = reload(job)
    assert (job.status, job.subject_outcome) == (JobStatus.COMPLETED, "version_missing")


@pytest.mark.parametrize(
    ("change", "code"),
    [
        ("asset_id", "asset_mismatch"),
        ("asset_version_number", "asset_mismatch"),
        ("storage_key", "storage_mismatch"),
        ("sha256", "checksum_mismatch"),
        ("size_bytes", "size_mismatch"),
    ],
)
def test_a_result_for_other_bytes_changes_nothing(aws, change, code):
    version = stored_version(valid_model())
    job = submitted(version)
    body = message(job, "succeeded", result=worker_result(job))
    rows = AssetVersion.objects.filter(pk=version.pk)
    if change == "asset_id":  # the request's asset context names another asset
        payload = copy.deepcopy(job.payload)
        payload["asset"]["asset_id"] = "npc-other"
        ProcessingJob.objects.filter(pk=job.pk).update(payload=payload)
    elif change == "asset_version_number":
        rows.update(number=version.number + 10)
    elif change == "storage_key":
        rows.update(storage_key=version.storage_key + ".moved")
    elif change == "sha256":
        rows.update(sha256="0" * 64)
    else:
        rows.update(size_bytes=version.size_bytes + 1)
    before = state(version)

    assert services.apply_result(body) == services.APPLIED

    job = reload(job)
    assert (job.status, job.subject_outcome) == (JobStatus.COMPLETED, code)
    assert state(version) == before


@pytest.mark.parametrize("status", [VersionStatus.VALIDATED, VersionStatus.PUBLISHED])
def test_a_manual_revalidation_is_recorded_and_never_changes_the_version(aws, status):
    version = stored_version(valid_model(), status=status)
    job = submitted(version)
    before = state(version)

    assert (
        services.apply_result(message(job, "succeeded", result=worker_result(job)))
        == services.APPLIED
    )

    job = reload(job)
    assert (job.status, job.subject_outcome) == (JobStatus.COMPLETED, "result_recorded")
    assert job.result["verdict"] == "pass"
    assert state(version) == before


# --- failures inside the handler --------------------------------------------------------------


def test_a_database_error_in_the_handler_commits_nothing_and_a_redelivery_applies_once(
    aws, monkeypatch
):
    version = stored_version(valid_model())
    job = submitted(version)
    body = message(job, "succeeded", result=worker_result(job))
    before = state(version)

    def broken(self, *args, **kwargs):
        raise DatabaseError("connection lost")

    with monkeypatch.context() as patch:
        patch.setattr(AssetVersion, "save", broken)
        with pytest.raises(DatabaseError):
            services.apply_result(body)

    job = reload(job)
    assert (job.status, job.deliveries, job.result, job.subject_outcome) == (
        JobStatus.PENDING,
        0,
        None,
        "",
    )
    assert state(version) == before

    assert services.apply_result(body) == services.APPLIED
    validated = state(version)
    assert validated["status"] == VersionStatus.VALIDATED
    assert services.apply_result(body) == services.DUPLICATE
    assert state(version) == validated
    job = reload(job)
    assert job.deliveries == 2 and job.subject_outcome == "version_validated"


def test_the_consumer_releases_a_result_whose_handler_hit_a_database_error(aws, monkeypatch):
    version = stored_version(valid_model())
    job = submitted(version)
    handle = aws.sqs.queue(message(job, "succeeded", result=worker_result(job)))

    def broken(self, *args, **kwargs):
        raise DatabaseError("connection lost")

    with monkeypatch.context() as patch:
        patch.setattr(AssetVersion, "save", broken)
        call_command("jobs_consume_results", "--once", "--wait-seconds", "0")
    assert aws.sqs.deleted == [] and aws.sqs.released == [handle]
    assert reload(job).status == JobStatus.PENDING

    aws.sqs.queue(message(job, "succeeded", result=worker_result(job)), handle=handle)
    call_command("jobs_consume_results", "--once", "--wait-seconds", "0")
    assert aws.sqs.deleted == [handle]
    assert reload(job).subject_outcome == "version_validated"


def test_the_handler_locks_job_then_asset_then_version(aws):
    version = stored_version(valid_model())
    job = submitted(version)
    body = message(job, "succeeded", result=worker_result(job))

    with CaptureQueriesContext(connection) as queries:
        assert services.apply_result(body) == services.APPLIED

    tables = ("jobs_processingjob", "catalog_contentasset", "assets_assetversion")
    locked = [
        next(t for t in tables if f'FROM "{t}"' in q["sql"])
        for q in queries.captured_queries
        if "FOR UPDATE" in q["sql"]
    ]
    assert locked == list(tables)


# --- idempotent submission --------------------------------------------------------------------


def test_submission_is_idempotent_per_version_and_retries_after_a_failure(aws):
    version = stored_version(valid_model())
    other = stored_version(valid_model(), asset=version.asset)
    first = submitted(version)

    assert submit_model_validation(version, user=None).pk == first.pk
    assert first.idempotency_key == first.payload["idempotency_key"]

    elsewhere = submitted(other)
    assert elsewhere.pk != first.pk and elsewhere.idempotency_key != first.idempotency_key

    services.apply_result(message(first, "failed", code="input_missing"))
    retry = submitted(version)
    assert retry.pk != first.pk and retry.idempotency_key == first.idempotency_key
    assert validation_jobs(version).count() == 2
    assert submit_model_validation(version, user=None).pk == retry.pk

    services.apply_result(message(retry, "succeeded", result=worker_result(retry)))
    assert reload(retry).subject_outcome == "version_validated"
    assert submit_model_validation(version, user=None).pk == retry.pk  # completed: reused


def test_a_refused_result_does_not_block_a_new_submission(aws):
    version = stored_version(valid_model())
    job = submitted(version)
    forged = _forge(worker_result(job), "attempt_mismatch")
    services.apply_result(message(job, "succeeded", result=forged))
    assert reload(job).subject_outcome == "attempt_mismatch"

    retry = submit_model_validation(version, user=None)

    assert retry.pk != job.pk


# --- concurrency (separate connections) -------------------------------------------------------


def _threads(*targets, timeout=30):
    errors = []

    def run(target):
        try:
            target()
        except Exception as error:  # noqa: BLE001 - reported below
            errors.append(error)
        finally:
            connection.close()

    threads = [threading.Thread(target=run, args=(t,), daemon=True) for t in targets]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout)
    assert not any(t.is_alive() for t in threads), "a thread is blocked (deadlock?)"
    assert not errors, errors


@pytest.mark.django_db(transaction=True)
def test_two_concurrent_deliveries_apply_once(aws):
    version = stored_version(valid_model())
    job = submit_model_validation(version, user=None)
    body = message(job, "succeeded", result=worker_result(job))
    barrier = threading.Barrier(2)
    outcomes = []

    def deliver():
        barrier.wait(5)
        outcomes.append(services.apply_result(body))

    _threads(deliver, deliver)

    assert sorted(outcomes) == [services.APPLIED, services.DUPLICATE]
    job = reload(job)
    assert job.deliveries == 2 and job.subject_outcome == "version_validated"
    version.refresh_from_db()
    assert version.status == VersionStatus.VALIDATED
    assert version.validation_report == [UPLOAD_FINDING, *processing_findings(job)]


@pytest.mark.django_db(transaction=True)
def test_a_result_and_publishing_another_version_of_the_asset_do_not_deadlock(aws):
    from apps.catalog.models import ContentAsset

    asset = make_definition("npc-locks")
    ready = stored_version(valid_model(), asset=asset, status=VersionStatus.VALIDATED)
    draft = stored_version(glb_bytes(*gltf_document(clips=("Idle", "Wave"))), asset=asset)
    job = submit_model_validation(draft, user=None)
    body = message(job, "succeeded", result=worker_result(job))
    holding = threading.Event()
    outcomes = []

    def publish():
        with transaction.atomic():
            # Hold the asset and version locks (publish order) while the result arrives.
            ContentAsset.objects.select_for_update().get(pk=asset.pk)
            AssetVersion.objects.select_for_update().get(pk=ready.pk)
            holding.set()
            time.sleep(0.5)
            publish_version(ready, user=None)

    def deliver():
        assert holding.wait(5)
        outcomes.append(services.apply_result(body))

    _threads(publish, deliver)

    assert outcomes == [services.APPLIED]
    ready.refresh_from_db()
    draft.refresh_from_db()
    assert ready.status == VersionStatus.PUBLISHED
    assert draft.status == VersionStatus.VALIDATED
    assert reload(job).subject_outcome == "version_validated"
