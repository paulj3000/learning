"""Wave 2 cross-workstream integration (principal-owned): every real component, no stand-ins.

Django submits an `asset.validate_model` job for a stored AssetVersion (LAI-LAMBDA-004), the
outbox relay sends it through the `local` transport factory onto a LocalDirectoryQueue
(LAI-LAMBDA-003), the LocalWorker runs the real GLB validator (LAI-LAMBDA-002) against the
filesystem stores, and `jobs_consume_completions` applies the CompletionEvent in PostgreSQL.
Only the transport is local (directories instead of SQS and S3); everything else is the code
that runs in AWS. The AssetVersion is never changed and nothing is published.
"""

import hashlib
import io

import pytest
from django.core.management import call_command

from apps.assets.models import VersionStatus
from apps.assets.processing import submit_model_validation
from apps.assets.storage import get_storage
from apps.assets.tests.helpers import glb_bytes, gltf_document, make_definition, make_version
from apps.jobs import processing
from apps.jobs import processing_transport as transport
from apps.jobs.models import CompletionReceipt, JobAttempt, JobOutbox, JobState, ProcessingJob
from lai_processing_runtime.config import LocalRuntimeConfig
from lai_processing_runtime.local_worker import LocalWorker

pytestmark = [pytest.mark.postgres, pytest.mark.django_db(transaction=True)]

NAMESPACE = "test"
MIXAMO = "Armature|mixamo.com|Layer0"


@pytest.fixture
def local_env(settings, tmp_path):
    settings.LAI_PROCESSING_BACKEND = "local"
    settings.LAI_PROCESSING_NAMESPACE = NAMESPACE
    settings.LAI_PROCESSING_LOCAL_ROOT = tmp_path / "processing"
    settings.LAI_PROCESSING_DISPATCH = "enabled"
    settings.LAI_ASSET_STORAGE = "local"
    settings.LAI_ASSET_LOCAL_ROOT = tmp_path / "assets"
    processing.set_registry_for_tests(None)  # the real default registry, GLB validator included
    transport.reset_transport()
    yield tmp_path
    transport.reset_transport()


def _stored_version(data: bytes, asset_id: str = "npc-pip"):
    row = make_version(
        make_definition(asset_id),
        status=VersionStatus.DRAFT,
        sha256=hashlib.sha256(data).hexdigest(),
        size_bytes=len(data),
    )
    get_storage().put(
        row.storage_key, io.BytesIO(data), content_type=row.content_type, sha256=row.sha256
    )
    return row


def _worker(tmp_path) -> LocalWorker:
    config = LocalRuntimeConfig(
        root=tmp_path / "processing", assets_root=tmp_path / "assets", namespace=NAMESPACE
    )
    return LocalWorker(config, poll_interval=0.05)


def _snapshot(row):
    row.refresh_from_db()
    return (row.status, row.metadata, row.validation_report, row.published_at)


def _round_trip(tmp_path) -> None:
    call_command("jobs_dispatch", "--once")
    summary = _worker(tmp_path).run_once()
    assert summary is not None
    call_command("jobs_consume_completions", "--once", "--wait-seconds", "0")


def test_a_valid_model_is_validated_end_to_end_and_the_version_is_untouched(local_env):
    document, binary = gltf_document(clips=("Idle", MIXAMO))
    version = _stored_version(glb_bytes(document, binary))
    before = _snapshot(version)

    job = submit_model_validation(version, user=None)
    assert job.state == JobState.QUEUED and job.status == "pending"
    assert JobOutbox.objects.filter(job=job, sent_at__isnull=True).count() == 1

    call_command("jobs_dispatch", "--once")
    ready = local_env / "processing" / "queues" / "work" / "ready"
    assert len([p for p in ready.iterdir() if p.is_file()]) == 1  # counted, not leased

    _worker(local_env).run_once()
    call_command("jobs_consume_completions", "--once", "--wait-seconds", "0")

    job.refresh_from_db()
    assert job.state == JobState.READY_FOR_REVIEW and job.status == "completed"
    assert job.subject_outcome == "version_validated"
    attempt = JobAttempt.objects.get(job=job, number=1)
    assert attempt.verdict == "pass"
    metadata = attempt.result["metadata"]
    assert [clip["name"] for clip in metadata["animations"]] == ["Idle", MIXAMO]
    assert metadata["counts"]["meshes"] == 1
    assert CompletionReceipt.objects.filter(job=job, action="apply").count() == 1
    # Wave 3: the hook moves the DRAFT to VALIDATED with the summary; publication stays a
    # separate staff action, and the upload's clips and dimensions are kept.
    status, version_metadata, report, published_at = _snapshot(version)
    assert (status, published_at) == (VersionStatus.VALIDATED, None)
    summary = version_metadata["model_validation"]
    assert [clip["name"] for clip in summary["animations"]] == ["Idle", MIXAMO]
    assert summary["job_id"] == str(job.pk)
    assert report[: len(before[2])] == before[2]


def test_an_invalid_model_is_a_successful_job_with_a_failing_verdict(local_env):
    document, binary = gltf_document()
    document["accessors"][0]["count"] = 10_000  # reads far past its buffer view
    version = _stored_version(glb_bytes(document, binary), asset_id="broken-crab")

    job = submit_model_validation(version, user=None)
    _round_trip(local_env)

    job.refresh_from_db()
    attempt = JobAttempt.objects.get(job=job, number=1)
    assert job.state == JobState.READY_FOR_REVIEW
    assert job.subject_outcome == "version_rejected"
    assert attempt.verdict == "fail"
    codes = {finding["code"] for finding in attempt.result["findings"]}
    assert codes, "an invalid model must explain itself with findings"
    version.refresh_from_db()
    assert version.status == VersionStatus.REJECTED
    assert {
        f["code"] for f in version.validation_report if f.get("source") == "processing"
    } == codes


def test_redelivered_work_and_duplicate_completions_apply_once(local_env):
    version = _stored_version(glb_bytes())
    job = submit_model_validation(version, user=None)
    call_command("jobs_dispatch", "--once")
    # The relay crashed after sending and before marking: the same attempt is sent twice.
    JobOutbox.objects.filter(job=job).update(sent_at=None)
    call_command("jobs_dispatch", "--once")

    worker = _worker(local_env)
    worker.run_once()
    worker.run_once()
    call_command("jobs_consume_completions", "--once", "--wait-seconds", "0")
    call_command("jobs_consume_completions", "--once", "--wait-seconds", "0")

    job.refresh_from_db()
    assert job.state == JobState.READY_FOR_REVIEW
    actions = sorted(CompletionReceipt.objects.filter(job=job).values_list("action", flat=True))
    assert actions.count("apply") == 1
    assert set(actions) <= {"apply", "duplicate"}
    assert ProcessingJob.objects.count() == 1


def test_resubmitting_the_same_version_returns_the_same_job(local_env):
    version = _stored_version(glb_bytes())
    first = submit_model_validation(version, user=None)
    second = submit_model_validation(version, user=None)
    assert first.pk == second.pk
    assert JobOutbox.objects.filter(job=first).count() == 1


def test_paused_dispatch_keeps_the_job_queued_until_resumed(local_env, settings):
    version = _stored_version(glb_bytes())
    job = submit_model_validation(version, user=None)
    settings.LAI_PROCESSING_DISPATCH = "paused"
    call_command("jobs_dispatch", "--once")
    assert JobOutbox.objects.get(job=job).sent_at is None
    settings.LAI_PROCESSING_DISPATCH = "enabled"
    _round_trip(local_env)
    job.refresh_from_db()
    assert job.state == JobState.READY_FOR_REVIEW
