"""The latest-validation publication gate (Workstream B, 2026-11-18).

With LAI_ASSET_ASYNC_VALIDATION on, the LATEST applicable `asset.validate_model` job for the
exact source (version, stored key, SHA-256, profile) decides: a passing job by the current
processor must be the newest, and any newer pending, running, failed, rejected, invalid, mismatched
or superseded job blocks publication. Submission and publication take the same asset and version
row locks. Published versions and rollback are never touched. No AWS.
"""

import threading
import time
import uuid
from datetime import timedelta

import pytest
from django.db import connection

from apps.assets import processing, services
from apps.assets.models import AssetVersion, VersionStatus
from apps.assets.services import AssetActionRefused
from apps.assets.tests.helpers import glb_bytes, make_definition
from apps.jobs import services as jobs
from apps.jobs.models import JobStatus, ProcessingJob
from apps.jobs.tests.helpers import FakeS3, FakeSQS, use_sqs

from .validation_jobs import complete, refused_glb, upload

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


@pytest.fixture(autouse=True)
def fresh_clients():
    jobs.set_aws_clients()
    yield
    jobs.set_aws_clients()


@pytest.fixture
def pip():
    return make_definition("npc-latest")


@pytest.fixture
def flag_on(settings):
    settings.LAI_ASSET_ASYNC_VALIDATION = "on"
    return settings


def code_of(version) -> str:
    with pytest.raises(AssetActionRefused) as error:
        services.publish_version(version)
    return error.value.code


def newer_job(version, **changes) -> ProcessingJob:
    """A copy of the version's passing job, one minute newer, with `changes` applied."""
    base = validation_newest(version)
    clone = ProcessingJob.objects.get(pk=base.pk)
    clone.pk = None
    clone.id = uuid.uuid4()
    clone.created_at = base.created_at + timedelta(minutes=1)
    for name, value in changes.items():
        setattr(clone, name, value)
    clone.save(force_insert=True)
    return clone


def validation_newest(version) -> ProcessingJob:
    return processing.validation_jobs(version).first()


@pytest.mark.parametrize(
    "changes",
    [
        {"status": JobStatus.PENDING, "result": None, "subject_outcome": ""},
        {"status": JobStatus.RUNNING, "result": None, "subject_outcome": ""},
        {"status": JobStatus.FAILED, "error_code": "timeout", "result": None},
        {"status": JobStatus.FAILED, "error_code": "cancelled", "result": None},
        {"subject_outcome": "result_invalid"},
        {"subject_outcome": "result_superseded"},
        {"subject_outcome": "processing_failed"},
        {"subject_outcome": "identity_mismatch"},
        {"subject_outcome": "version_missing"},
    ],
    ids=[
        "pending",
        "running",
        "failed",
        "cancelled",
        "invalid",
        "superseded",
        "refused",
        "mismatch",
        "version_missing",
    ],
)
def test_a_newer_non_passing_validation_blocks_publication(pip, flag_on, changes):
    version = upload(pip, glb_bytes())
    complete(version)
    newer_job(version, **changes)
    assert code_of(version) == "processing_required"
    version.refresh_from_db()
    assert version.status == VersionStatus.VALIDATED and version.published_at is None


def test_a_newer_failing_verdict_blocks_an_older_pass(pip, flag_on):
    version = upload(pip, glb_bytes())
    complete(version)
    failing = {**validation_newest(version).result, "verdict": "fail"}
    newer_job(version, result=failing)
    assert code_of(version) == "processing_required"


def test_a_newer_pass_publishes_after_an_older_failure(pip, flag_on):
    version = upload(pip, glb_bytes())
    old = complete(version)
    ProcessingJob.objects.filter(pk=old.pk).update(status=JobStatus.FAILED)
    complete(version)
    assert services.publish_version(version).status == VersionStatus.PUBLISHED


def test_a_pending_resubmission_blocks_until_it_passes(pip, flag_on):
    version = upload(pip, glb_bytes())
    complete(version)
    newer_job(version, status=JobStatus.PENDING, result=None, subject_outcome="")
    assert code_of(version) == "processing_required"
    pending = validation_newest(version)
    ProcessingJob.objects.filter(pk=pending.pk).update(status=JobStatus.COMPLETED)
    assert code_of(version) == "processing_required"  # completed without a result to read


def test_a_newer_job_for_other_bytes_does_not_block(pip, flag_on):
    version = upload(pip, glb_bytes())
    complete(version)
    other = newer_job(version, status=JobStatus.FAILED, result=None)
    payload = dict(other.payload)
    payload["input"] = {**payload["input"], "sha256": "0" * 64}
    ProcessingJob.objects.filter(pk=other.pk).update(payload=payload)
    assert services.publish_version(version).status == VersionStatus.PUBLISHED


def test_a_newer_job_with_a_corrupt_payload_blocks(pip, flag_on):
    version = upload(pip, glb_bytes())
    complete(version)
    broken = newer_job(version)
    ProcessingJob.objects.filter(pk=broken.pk).update(payload={})
    assert code_of(version) == "processing_required"


def test_an_older_processor_pass_is_not_enough_after_a_policy_bump(pip, flag_on, monkeypatch):
    version = upload(pip, glb_bytes())
    complete(version)
    processor_id, _ = processing.current_processor()
    monkeypatch.setattr(processing, "current_processor", lambda: (processor_id, "9.9.9"))
    assert code_of(version) == "processing_required"


def test_the_gate_never_unpublishes_or_blocks_rollback(pip, flag_on):
    version = upload(pip, glb_bytes())
    complete(version)
    services.publish_version(version)
    newer_job(version, status=JobStatus.FAILED, result=None, error_code="timeout")
    version.refresh_from_db()
    assert version.status == VersionStatus.PUBLISHED
    pip.refresh_from_db()
    assert pip.default_version_id == version.pk


def test_the_synchronous_checks_still_run_after_a_passing_gate(pip, flag_on):
    version = upload(pip, glb_bytes(clips=("Idle",)))
    complete(version)
    type(pip).objects.filter(pk=pip.pk).update(clips=["Idle", "Talk"])
    assert code_of(version) == "invalid_file"


def test_the_gate_reads_the_job_that_failed_synchronously_checks(pip, flag_on):
    version = upload(pip, refused_glb())
    complete(version)
    assert code_of(version) == "processing_required"


# --- concurrency (separate connections) -------------------------------------------------------


def _run(*targets, timeout=30):
    errors = []

    def wrap(target):
        try:
            target()
        except Exception as error:  # noqa: BLE001 - reported below
            errors.append(error)
        finally:
            connection.close()

    threads = [threading.Thread(target=wrap, args=(t,), daemon=True) for t in targets]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout)
    assert not any(t.is_alive() for t in threads), "a thread is blocked (deadlock?)"
    return errors


@pytest.mark.django_db(transaction=True)
def test_a_submission_waits_for_a_publication_that_already_holds_the_lock(
    pip, flag_on, monkeypatch
):
    version = upload(pip, glb_bytes())
    complete(version)
    holding = threading.Event()
    real_gate = services._has_passing_validation
    order = []

    def slow_gate(candidate):
        holding.set()
        time.sleep(0.6)
        return real_gate(candidate)

    monkeypatch.setattr(services, "_has_passing_validation", slow_gate)

    def publish():
        order.append(("published", services.publish_version(version).status))

    def submit():
        assert holding.wait(5)
        flag_on.LAI_JOBS_BACKEND = "inline"
        # A newer validation: it must wait for the publication, not slip in before it.
        processing.submit_model_validation(version, user=None)
        order.append(("submitted", None))

    errors = _run(publish, submit)
    assert not errors, errors
    assert [name for name, _ in order] == ["published", "submitted"]
    version = AssetVersion.objects.get(pk=version.pk)
    assert version.status == VersionStatus.PUBLISHED  # published state is never undone


@pytest.mark.django_db(transaction=True)
def test_a_publication_waits_for_a_submission_that_already_holds_the_lock(
    pip, flag_on, monkeypatch
):
    version = upload(pip, glb_bytes())
    complete(version)
    use_sqs(flag_on)
    jobs.set_aws_clients(sqs=FakeSQS(), s3=FakeS3())
    holding = threading.Event()
    real_submit = jobs.submit
    outcome = {}

    def slow_submit(*args, **kwargs):
        holding.set()
        time.sleep(0.6)
        return real_submit(*args, **kwargs)

    monkeypatch.setattr(jobs, "submit", slow_submit)

    def submit():
        processing.submit_model_validation(version, user=None)

    def publish():
        assert holding.wait(5)
        try:
            services.publish_version(version)
            outcome["published"] = True
        except AssetActionRefused as refusal:
            outcome["code"] = refusal.code

    # A failed job is never reused, so the submission creates a new pending job.
    ProcessingJob.objects.filter(pk=validation_newest(version).pk).update(status=JobStatus.FAILED)
    errors = _run(submit, publish)
    assert not errors, errors
    assert outcome == {"code": "processing_required"}
    version.refresh_from_db()
    assert version.status == VersionStatus.VALIDATED
    assert ProcessingJob.objects.filter(status=JobStatus.PENDING).count() == 1
