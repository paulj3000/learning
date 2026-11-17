"""The asset completion hook (`apps.assets.completion`, WAVE3_INTERFACES sections 3 and 4).

A model validation result is mapped onto the DRAFT `AssetVersion` it validated exactly once, only
for an applied completion of exactly that version's bytes, never for a published version, and
never by publishing anything. Everything runs on the in-memory transport with the real GLB
validator; PostgreSQL only.
"""

import dataclasses
import hashlib
import io
import threading
import time
import uuid

import pytest
from django.db import OperationalError, connection, transaction
from django.test.utils import CaptureQueriesContext

from apps.assets.completion import apply_model_validation
from apps.assets.models import IMMUTABLE_FIELDS, AssetVersion, VersionStatus
from apps.assets.processing import (
    MODEL_VALIDATION_JOB_TYPE,
    SUBJECT_TYPE,
    processing_findings,
    submit_model_validation,
)
from apps.assets.services import publish_version
from apps.assets.storage import get_storage
from apps.assets.tests.helpers import glb_bytes, gltf_document, make_definition, make_version
from apps.jobs import processing
from apps.jobs.models import CompletionReceipt, JobState, ProcessingJob
from apps.jobs.tests.processing_fakes import (
    current_request,
    event_bytes,
    fake_transport,
    result_for,
    run_worker,
    seed,
)
from lai_processing.contracts.common import InputObject, ObjectRef, ProcessorIdentity
from lai_processing.core.errors import ErrorCode

__all__ = ["fake_transport"]  # the shared fixture

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

MIXAMO = "Armature|mixamo.com|Layer0"
GLB = ProcessorIdentity("asset.glb_validator", "1.0.0")
UPLOAD_FINDING = {"code": "clip_extra", "severity": "warning", "message": "Extra clip.", "path": ""}
KEY = (MODEL_VALIDATION_JOB_TYPE, SUBJECT_TYPE)


@pytest.fixture(autouse=True)
def real_hook():
    """The registered hook, whatever another test module left behind."""
    previous = processing.set_completion_hooks_for_tests({KEY: apply_model_validation})
    yield
    processing.set_completion_hooks_for_tests(previous)


def _valid_model() -> bytes:
    return glb_bytes(*gltf_document(clips=("Idle", MIXAMO)))


def _broken_model() -> bytes:
    document, binary = gltf_document()
    document["accessors"][0]["count"] = 10_000  # reads far past its buffer view
    return glb_bytes(document, binary)


def _draft(fake, data: bytes, *, asset=None, status=VersionStatus.DRAFT):
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
    seed(fake.storage, data, row.storage_key)
    get_storage().put(
        row.storage_key, io.BytesIO(data), content_type=row.content_type, sha256=row.sha256
    )
    return row


def _completion_body(fake, version) -> tuple[ProcessingJob, bytes]:
    """Submit, relay and run the worker; return the job and its (unapplied) completion body."""
    job = submit_model_validation(version, user=None)
    processing.relay_outbox(fake.work)
    assert run_worker(fake) == 1
    deliveries = fake.completions.receive(max_messages=10)
    assert len(deliveries) == 1
    fake.completions.ack(deliveries[0])
    return job, deliveries[0].body


def _apply(fake, body):
    return processing.apply_completion(body, storage=fake.storage)


def _state(row):
    row.refresh_from_db()
    return {name: getattr(row, name) for name in (*IMMUTABLE_FIELDS, "status", "retired_at")}


def _drain(fake) -> None:
    processing.relay_outbox(fake.work, ignore_delay=True)
    run_worker(fake)
    for delivery in fake.completions.receive(max_messages=10):
        _apply(fake, delivery.body)
        fake.completions.ack(delivery)


# --- results ----------------------------------------------------------------------------------


def test_a_passing_result_validates_the_draft(fake_transport):
    version = _draft(fake_transport, _valid_model())
    job, body = _completion_body(fake_transport, version)

    outcome = _apply(fake_transport, body)

    assert outcome.action == "apply"
    job.refresh_from_db()
    assert job.state == JobState.READY_FOR_REVIEW
    assert job.subject_outcome == "version_validated"
    version.refresh_from_db()
    assert version.status == VersionStatus.VALIDATED
    assert version.validated_at is not None and version.published_at is None
    assert version.validation_report[0] == UPLOAD_FINDING  # upload findings keep no source key
    assert all(f["source"] == "processing" for f in version.validation_report[1:])
    assert version.metadata["uploaded"] is True
    summary = version.metadata["model_validation"]
    assert summary["verdict"] == "pass" and summary["job_id"] == str(job.pk)
    assert summary["processor_id"] == "asset.glb_validator"
    assert [(a["name"], a["duration_seconds"]) for a in summary["animations"]] == [
        ("Idle", 1.0),
        (MIXAMO, 1.0),
    ]
    assert version.clips == ["Idle", MIXAMO]
    assert version.dimensions == {"x": 1.0, "y": 2.0, "z": 0.5}


def test_a_failing_verdict_rejects_the_draft_with_findings(fake_transport):
    version = _draft(fake_transport, _broken_model())
    job, body = _completion_body(fake_transport, version)

    assert _apply(fake_transport, body).action == "apply"

    job.refresh_from_db()
    assert (job.state, job.subject_outcome) == (JobState.READY_FOR_REVIEW, "version_rejected")
    version.refresh_from_db()
    assert version.status == VersionStatus.REJECTED
    assert version.validated_at is None
    assert version.validation_report == [UPLOAD_FINDING, *processing_findings(job)]
    assert any(f["severity"] == "error" for f in version.validation_report[1:])
    assert version.metadata["model_validation"]["verdict"] == "fail"
    assert version.metadata["model_validation"]["error_count"] >= 1


def test_a_terminal_processing_failure_leaves_the_draft(fake_transport):
    version = _draft(fake_transport, _valid_model())
    job = submit_model_validation(version, user=None)
    before = _state(version)
    request = current_request(job)
    failed = result_for(request, status="failed", code=ErrorCode.INVALID_INPUT, processor=GLB)

    assert _apply(fake_transport, event_bytes(failed)).action == "apply"

    job.refresh_from_db()
    assert (job.state, job.subject_outcome) == (JobState.FAILED, "processing_failed")
    assert _state(version) == before


# --- delivery guarantees ----------------------------------------------------------------------


def test_a_duplicate_completion_changes_the_version_once(fake_transport):
    version = _draft(fake_transport, _valid_model())
    job, body = _completion_body(fake_transport, version)

    assert _apply(fake_transport, body).action == "apply"
    first = _state(version)
    assert _apply(fake_transport, body).action == "duplicate"

    assert _state(version) == first  # validated_at and the report unchanged
    assert CompletionReceipt.objects.filter(job=job, action="apply").count() == 1


def test_the_old_attempt_after_a_requeue_is_stale_and_never_applied(fake_transport):
    version = _draft(fake_transport, _valid_model())
    job, old_body = _completion_body(fake_transport, version)
    ProcessingJob.objects.filter(pk=job.pk).update(expires_at=job.created_at)
    processing.reconcile()  # FAILED job_expired
    assert processing.requeue_job(job, user=None)
    before = _state(version)

    assert _apply(fake_transport, old_body).action == "stale"
    assert _state(version) == before

    _drain(fake_transport)  # attempt 2
    job.refresh_from_db()
    assert job.subject_outcome == "version_validated"
    version.refresh_from_db()
    assert version.status == VersionStatus.VALIDATED
    assert version.metadata["model_validation"]["attempt_number"] == 2


def test_a_retryable_failure_then_success_applies_once_on_the_success(fake_transport):
    version = _draft(fake_transport, _valid_model())
    job = submit_model_validation(version, user=None)
    processing.relay_outbox(fake_transport.work)
    for delivery in fake_transport.work.receive(max_messages=10):
        fake_transport.work.ack(delivery)  # the worker crashed: its failure is reported instead
    failed = result_for(current_request(job), status="failed", processor=GLB)
    before = _state(version)

    assert _apply(fake_transport, event_bytes(failed)).action == "retry"
    assert _state(version) == before

    _drain(fake_transport)
    job.refresh_from_db()
    assert (job.state, job.subject_outcome) == (JobState.READY_FOR_REVIEW, "version_validated")
    assert version.metadata == before["metadata"]  # the stale in-memory row
    version.refresh_from_db()
    assert version.metadata["model_validation"]["attempt_number"] == 2
    assert version.validation_report == [UPLOAD_FINDING, *processing_findings(job)]


def test_cancellation_before_completion_makes_it_stale(fake_transport):
    version = _draft(fake_transport, _valid_model())
    job, body = _completion_body(fake_transport, version)
    assert processing.cancel_job(job, user=None)
    before = _state(version)

    assert _apply(fake_transport, body).action == "stale"
    assert _state(version) == before
    job.refresh_from_db()
    assert job.state == JobState.CANCELLED and job.subject_outcome == ""


@pytest.mark.parametrize(
    "forge",
    [
        {"idempotency_key": "ik1:" + "b" * 64},
        {"attempt_id": str(uuid.uuid4())},
        {"namespace": "other"},
    ],
    ids=["idempotency_key", "attempt", "namespace"],
)
def test_a_forged_completion_is_rejected_and_changes_nothing(fake_transport, forge):
    version = _draft(fake_transport, _valid_model())
    job = submit_model_validation(version, user=None)
    request, forge = current_request(job), dict(forge)
    if "namespace" in forge:  # the input ref is validated per namespace: rebuild it
        ref = request.input.ref
        forge["input"] = InputObject(
            ref=ObjectRef(ref.store, ref.key, ref.version_id, forge["namespace"]),
            content_type=request.input.content_type,
            size_bytes=request.input.size_bytes,
            sha256=request.input.sha256,
        )
    request = dataclasses.replace(request, **forge)
    before = _state(version)

    outcome = _apply(fake_transport, event_bytes(result_for(request, processor=GLB)))

    assert outcome.action == "reject"
    assert _state(version) == before
    job.refresh_from_db()
    assert job.state == JobState.QUEUED and job.subject_outcome == ""


# --- identity -----------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("change", "reason"),
    [
        ("sha256", "checksum_mismatch"),
        ("size_bytes", "size_mismatch"),
        ("storage_key", "storage_mismatch"),
        ("asset_version_id", "asset_mismatch"),
    ],
)
def test_a_result_for_other_bytes_is_a_no_op(fake_transport, caplog, change, reason):
    version = _draft(fake_transport, _valid_model())
    job, body = _completion_body(fake_transport, version)
    rows = AssetVersion.objects.filter(pk=version.pk)
    if change == "sha256":
        rows.update(sha256="0" * 64)
    elif change == "size_bytes":
        rows.update(size_bytes=version.size_bytes + 1)
    elif change == "storage_key":
        rows.update(storage_key=version.storage_key + ".moved")
    else:
        payload = dict(job.payload)
        payload["asset"] = {**payload["asset"], "asset_version_id": str(uuid.uuid4())}
        ProcessingJob.objects.filter(pk=job.pk).update(payload=payload)
    before = _state(version)

    with caplog.at_level("WARNING", logger="lai.assets"):
        assert _apply(fake_transport, body).action == "apply"

    assert _state(version) == before
    job.refresh_from_db()
    assert (job.state, job.subject_outcome) == (JobState.VALIDATED, reason)
    warnings = [r.getMessage() for r in caplog.records if r.name == "lai.assets"]
    assert warnings == [f"processing.subject_mismatch job={job.pk} reason={reason}"]


@pytest.mark.parametrize(
    ("field", "value", "reason"),
    [
        ("subject_type", "asset_version_other", "subject_mismatch"),
        ("profile_version", 2, "profile_mismatch"),
        ("namespace", "other", "namespace_mismatch"),
    ],
)
def test_a_job_recorded_for_another_subject_or_profile_is_a_no_op(
    fake_transport, field, value, reason
):
    """Unreachable through `apply_completion` (the registry and `_check_against_job` refuse
    these first); the hook still refuses them on its own."""
    version = _draft(fake_transport, _valid_model())
    job, body = _completion_body(fake_transport, version)
    assert _apply(fake_transport, body).action == "apply"
    AssetVersion.objects.filter(pk=version.pk).update(
        status=VersionStatus.DRAFT, validated_at=None, metadata={}, validation_report=[]
    )
    before = _state(version)
    job.refresh_from_db()
    setattr(job, field, value)

    with transaction.atomic():
        outcome = apply_model_validation(job, job.current_attempt, _result(job))

    assert outcome == processing.HookResult(reason)
    assert _state(version) == before


def _result(job):
    from lai_processing.contracts.results import ProcessingJobResult

    return ProcessingJobResult.from_dict(job.result)


def test_a_deleted_version_is_version_missing(fake_transport):
    version = _draft(fake_transport, _valid_model())
    job, body = _completion_body(fake_transport, version)
    AssetVersion.objects.filter(pk=version.pk).delete()

    assert _apply(fake_transport, body).action == "apply"

    job.refresh_from_db()
    assert (job.state, job.subject_outcome) == (JobState.VALIDATED, "version_missing")


def test_a_published_version_is_recorded_and_never_changed(fake_transport):
    version = _draft(fake_transport, _valid_model(), status=VersionStatus.PUBLISHED)
    job, body = _completion_body(fake_transport, version)
    before = _state(version)

    assert _apply(fake_transport, body).action == "apply"

    job.refresh_from_db()
    assert (job.state, job.subject_outcome) == (JobState.READY_FOR_REVIEW, "result_recorded")
    assert _state(version) == before


# --- failures inside the hook -------------------------------------------------------------------


def test_a_database_error_in_the_hook_defers_and_a_redelivery_applies_once(fake_transport):
    version = _draft(fake_transport, _valid_model())
    job, body = _completion_body(fake_transport, version)
    before = _state(version)
    calls = []

    def flaky(job, attempt, result):
        outcome = apply_model_validation(job, attempt, result)  # writes the version
        calls.append(outcome.code)
        if len(calls) == 1:
            raise OperationalError("connection lost")
        return outcome

    processing.set_completion_hooks_for_tests({KEY: flaky})
    with pytest.raises(processing.CompletionDeferred):
        _apply(fake_transport, body)

    assert _state(version) == before
    job.refresh_from_db()
    assert (job.state, job.result, job.subject_outcome) == (JobState.QUEUED, None, "")
    assert not CompletionReceipt.objects.filter(job=job).exists()

    assert _apply(fake_transport, body).action == "apply"
    assert _apply(fake_transport, body).action == "duplicate"
    assert calls == ["version_validated", "version_validated"]
    job.refresh_from_db()
    assert job.subject_outcome == "version_validated"
    version.refresh_from_db()
    assert version.status == VersionStatus.VALIDATED


def test_a_hook_bug_keeps_the_result_and_rolls_back_the_version(fake_transport):
    version = _draft(fake_transport, _valid_model())
    job, body = _completion_body(fake_transport, version)
    before = _state(version)

    def buggy(job, attempt, result):
        apply_model_validation(job, attempt, result)
        raise RuntimeError("bug")

    processing.set_completion_hooks_for_tests({KEY: buggy})
    assert _apply(fake_transport, body).action == "apply"

    job.refresh_from_db()
    assert (job.state, job.subject_outcome) == (JobState.VALIDATED, "hook_error")
    assert job.result["status"] == "succeeded"
    assert _state(version) == before


def test_an_outer_rollback_discards_the_hook_writes(fake_transport):
    version = _draft(fake_transport, _valid_model())
    job, body = _completion_body(fake_transport, version)
    before = _state(version)

    class Abort(Exception):
        pass

    with pytest.raises(Abort), transaction.atomic():
        assert _apply(fake_transport, body).action == "apply"
        raise Abort

    assert _state(version) == before
    assert not CompletionReceipt.objects.filter(job=job).exists()


def test_the_hook_locks_the_asset_before_the_version(fake_transport):
    version = _draft(fake_transport, _valid_model())
    job, body = _completion_body(fake_transport, version)

    with CaptureQueriesContext(connection) as queries:
        assert _apply(fake_transport, body).action == "apply"

    locks = [q["sql"] for q in queries.captured_queries if "FOR UPDATE" in q["sql"]]
    tables = [
        next(
            t
            for t in ("jobs_processingjob", "catalog_contentasset", "assets_assetversion")
            if f'FROM "{t}"' in sql
        )
        for sql in locks
    ]
    assert tables == ["jobs_processingjob", "catalog_contentasset", "assets_assetversion"]


# --- concurrency (separate connections) ---------------------------------------------------------


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
def test_two_concurrent_deliveries_apply_once(fake_transport):
    version = _draft(fake_transport, _valid_model())
    job, body = _completion_body(fake_transport, version)
    barrier = threading.Barrier(2)
    actions = []

    def deliver():
        barrier.wait(5)
        actions.append(_apply(fake_transport, body).action)

    _threads(deliver, deliver)

    assert sorted(actions) == ["apply", "duplicate"]
    version.refresh_from_db()
    assert version.status == VersionStatus.VALIDATED
    job.refresh_from_db()
    assert version.validation_report == [UPLOAD_FINDING, *processing_findings(job)]


@pytest.mark.django_db(transaction=True)
def test_completion_and_publishing_another_version_of_the_asset_do_not_deadlock(fake_transport):
    asset = make_definition("npc-locks")
    published = _draft(fake_transport, _valid_model(), asset=asset, status=VersionStatus.VALIDATED)
    draft = _draft(fake_transport, glb_bytes(*gltf_document(clips=("Idle", "Wave"))), asset=asset)
    job, body = _completion_body(fake_transport, draft)
    holding = threading.Event()
    actions = []

    def publish():
        with transaction.atomic():
            # Hold the asset and version locks (publish order) while the completion starts.
            from apps.catalog.models import ContentAsset

            ContentAsset.objects.select_for_update().get(pk=asset.pk)
            AssetVersion.objects.select_for_update().get(pk=published.pk)
            holding.set()
            time.sleep(0.5)
            publish_version(published, user=None)

    def complete():
        assert holding.wait(5)
        actions.append(_apply(fake_transport, body).action)

    _threads(publish, complete)

    assert actions == ["apply"]
    published.refresh_from_db()
    draft.refresh_from_db()
    assert published.status == VersionStatus.PUBLISHED
    assert draft.status == VersionStatus.VALIDATED
