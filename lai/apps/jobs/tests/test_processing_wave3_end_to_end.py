"""Wave 3 end to end (LAI-LAMBDA-006 and 007, principal-owned): every real component, no stand-ins.

With `LAI_ASSET_ASYNC_VALIDATION=on`, a staff upload through `services.upload_version` stores a
GLB as a DRAFT and commits its `asset.validate_model` job with it; `jobs_dispatch` relays the
outbox to a LocalDirectoryQueue; the LocalWorker runs the real GLB validator against the
filesystem stores; `jobs_consume_completions` applies the completion and the asset hook moves
the draft to VALIDATED or REJECTED; the publication gate then lets an explicit staff publish
through, and the published model resolves through the existing resolver. Only the transport and
storage are local (directories instead of SQS and S3); nothing touches AWS.

Treasure Rush is the representative consumer: a treasure chest model with an exact Mixamo clip.
"""

import io

import pytest
from django.core.management import call_command

from apps.assets import resolver, services
from apps.assets.models import VersionStatus
from apps.assets.processing import model_validation_summary, validation_jobs
from apps.assets.services import AssetActionRefused
from apps.assets.tests.helpers import glb_bytes, gltf_document, make_definition
from apps.jobs import processing
from apps.jobs import processing_transport as transport
from apps.jobs.models import CompletionReceipt, JobOutbox, JobState, ProcessingJob
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
    settings.LAI_ASSET_DELIVERY = "django"
    settings.LAI_ASSET_ASYNC_VALIDATION = "on"
    processing.set_registry_for_tests(None)  # the real default registry, GLB validator included
    transport.reset_transport()
    yield tmp_path
    transport.reset_transport()


@pytest.fixture
def chest():
    return make_definition("treasure-chest", kind="prop", category="prop")


def upload(asset, data, name="treasure-chest.glb"):
    return services.upload_version(asset, io.BytesIO(data), original_filename=name)


def round_trip(tmp_path, *, consume_twice=False) -> None:
    call_command("jobs_dispatch", "--once")
    worker = LocalWorker(
        LocalRuntimeConfig(
            root=tmp_path / "processing", assets_root=tmp_path / "assets", namespace=NAMESPACE
        ),
        poll_interval=0.05,
    )
    assert worker.run_once() is not None
    call_command("jobs_consume_completions", "--once", "--wait-seconds", "0")
    if consume_twice:
        call_command("jobs_consume_completions", "--once", "--wait-seconds", "0")


def test_flag_off_keeps_the_synchronous_upload(local_env, settings, chest):
    settings.LAI_ASSET_ASYNC_VALIDATION = "off"
    version = upload(chest, glb_bytes())
    assert version.status == VersionStatus.VALIDATED and version.validated_at is not None
    assert not ProcessingJob.objects.exists()
    assert services.publish_version(version).status == VersionStatus.PUBLISHED


def test_upload_validate_review_publish_and_resolve(local_env, chest):
    document, binary = gltf_document(clips=("Idle", MIXAMO))
    version = upload(chest, glb_bytes(document, binary))

    # Upload: a DRAFT and its job, attempt and outbox row, committed together.
    assert version.status == VersionStatus.DRAFT and version.validated_at is None
    [job] = validation_jobs(version)
    assert job.state == JobState.QUEUED
    assert JobOutbox.objects.filter(job=job, sent_at__isnull=True).count() == 1

    # Not publishable while it is a draft, nor before a passing result.
    with pytest.raises(AssetActionRefused) as refused:
        services.publish_version(version)
    assert refused.value.code == "not_validated"

    round_trip(local_env)

    job.refresh_from_db()
    version.refresh_from_db()
    assert job.state == JobState.READY_FOR_REVIEW
    assert job.subject_outcome == "version_validated"
    assert version.status == VersionStatus.VALIDATED and version.published_at is None
    summary = version.metadata["model_validation"]
    assert summary == model_validation_summary(job)
    assert [clip["name"] for clip in summary["animations"]] == ["Idle", MIXAMO]
    assert summary["verdict"] == "pass" and summary["counts"]["meshes"] == 1
    assert not chest.versions.filter(status=VersionStatus.PUBLISHED).exists()  # never automatic

    # Explicit staff publication passes the gate and the synchronous re-validation.
    published = services.publish_version(version)
    assert published.status == VersionStatus.PUBLISHED
    [entry] = resolver.resolve(resolver.parse_references("treasure-chest"))
    assert entry["status"] == "resolved" and entry["versionId"] == str(version.version_id)
    assert entry["sha256"] == version.sha256


def test_a_failing_model_is_rejected_and_never_publishable(local_env, chest):
    # An integer too large for a float in a node transform: the synchronous upload checks pass
    # it (GLB_VALIDATION.md, parity differences), the background validator refuses it.
    document, binary = gltf_document()
    document["nodes"][0]["translation"] = [10**400, 0, 0]
    version = upload(chest, glb_bytes(document, binary), name="broken.glb")
    assert version.status == VersionStatus.DRAFT
    round_trip(local_env)
    version.refresh_from_db()
    job = validation_jobs(version).get()
    assert job.subject_outcome == "version_rejected"
    assert version.status == VersionStatus.REJECTED
    assert any(f.get("source") == "processing" for f in version.validation_report)
    with pytest.raises(AssetActionRefused):
        services.publish_version(version)

    # Safe recovery: a corrected file is a new version with its own job.
    fixed = upload(chest, glb_bytes(), name="fixed.glb")
    assert fixed.number == version.number + 1 and fixed.status == VersionStatus.DRAFT
    round_trip(local_env)
    fixed.refresh_from_db()
    assert fixed.status == VersionStatus.VALIDATED


def test_duplicate_completions_change_the_version_once(local_env, chest):
    version = upload(chest, glb_bytes())
    job = validation_jobs(version).get()
    call_command("jobs_dispatch", "--once")
    JobOutbox.objects.filter(job=job).update(sent_at=None)  # crash after send: sent twice
    round_trip(local_env)
    version.refresh_from_db()
    first = (version.status, version.validated_at, version.metadata, version.validation_report)
    # The second work message runs again and its completion is recognised as a duplicate.
    LocalWorker(
        LocalRuntimeConfig(
            root=local_env / "processing", assets_root=local_env / "assets", namespace=NAMESPACE
        ),
        poll_interval=0.05,
    ).run_once()
    call_command("jobs_consume_completions", "--once", "--wait-seconds", "0")
    version.refresh_from_db()
    assert (version.status, version.validated_at, version.metadata, version.validation_report) == (
        first
    )
    actions = list(CompletionReceipt.objects.filter(job=job).values_list("action", flat=True))
    assert actions.count("apply") == 1 and set(actions) <= {"apply", "duplicate"}


def test_replacement_and_rollback_keep_working(local_env, chest):
    first = upload(chest, glb_bytes(clips=("Idle",)))
    round_trip(local_env)
    first.refresh_from_db()
    services.publish_version(first)

    second = upload(chest, glb_bytes(clips=("Idle", MIXAMO)), name="chest-v2.glb")
    round_trip(local_env)
    second.refresh_from_db()
    services.publish_version(second)
    services.set_default_version(second)
    chest.refresh_from_db()
    assert chest.default_version_id == second.pk

    # Rollback to an already published version is not gated and needs no new job.
    jobs_before = ProcessingJob.objects.count()
    services.rollback_to_version(first)
    chest.refresh_from_db()
    assert chest.default_version_id == first.pk
    assert ProcessingJob.objects.count() == jobs_before
    [entry] = resolver.resolve(resolver.parse_references("treasure-chest"))
    assert entry["versionId"] == str(first.version_id)
