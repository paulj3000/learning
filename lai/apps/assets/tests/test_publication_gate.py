"""The publication gate (LAI-LAMBDA-007, ADR-064 canonical path): with
LAI_ASSET_ASYNC_VALIDATION on, publishing a GLB needs a completed, passing `asset.validate_model`
job for exactly its stored file by the current processor version. Flag off, other formats,
rollback and set default: unchanged. Jobs run inline through the real validator, or stay pending
on the fake SQS backend. No AWS."""

import io

import pytest

from apps.assets import processing, services
from apps.assets.models import AssetVersion, VersionStatus
from apps.assets.services import AssetActionRefused
from apps.assets.tests.helpers import glb_bytes, gltf_json_bytes, make_definition
from apps.jobs import services as jobs
from apps.jobs.models import JobStatus, ProcessingJob

from .validation_jobs import complete, queued, refused_glb, upload

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


@pytest.fixture(autouse=True)
def fresh_clients():
    jobs.set_aws_clients()
    yield
    jobs.set_aws_clients()


@pytest.fixture
def pip():
    return make_definition("npc-pip")


@pytest.fixture
def flag_on(settings):
    settings.LAI_ASSET_ASYNC_VALIDATION = "on"
    return settings


def refused(version) -> AssetActionRefused:
    with pytest.raises(AssetActionRefused) as error:
        services.publish_version(version)
    return error.value


def assert_unchanged(version, status=VersionStatus.VALIDATED):
    version.refresh_from_db()
    assert version.status == status and version.published_at is None
    version.asset.refresh_from_db()
    assert version.asset.default_version_id is None


def edit_payload(job, section, **changes):
    payload = dict(job.payload)
    payload[section] = {**payload[section], **changes}
    ProcessingJob.objects.filter(pk=job.pk).update(payload=payload)


def test_flag_off_publishes_without_a_job(pip):
    version = upload(pip, glb_bytes())
    assert services.publish_version(version).status == VersionStatus.PUBLISHED
    assert not ProcessingJob.objects.exists()


def test_flag_on_without_validation_is_refused(pip, flag_on):
    version = upload(pip, glb_bytes())
    error = refused(version)
    assert error.code == "processing_required"
    assert "Validate in background" in error.message and "—" not in error.message
    assert_unchanged(version)


def test_a_pending_job_is_not_enough(pip, flag_on):
    version = upload(pip, glb_bytes())
    job, _sqs = queued(version, flag_on)
    assert job.status == JobStatus.PENDING
    assert refused(version).code == "processing_required"
    assert_unchanged(version)


def test_a_passing_validation_allows_publication(pip, flag_on):
    version = upload(pip, glb_bytes())
    complete(version)
    published = services.publish_version(version)
    assert published.status == VersionStatus.PUBLISHED
    pip.refresh_from_db()
    assert pip.default_version_id == version.pk


def test_an_inline_upload_with_the_flag_on_can_then_be_published(pip, flag_on):
    version = services.upload_version(pip, io.BytesIO(glb_bytes()), original_filename="pip.glb")
    assert version.status == VersionStatus.VALIDATED and version.published_at is None
    assert services.publish_version(version).status == VersionStatus.PUBLISHED


def test_a_passing_validation_still_rereads_the_bytes(pip, flag_on, storage):
    version = upload(pip, glb_bytes())
    complete(version)
    data, content_type, when = storage.objects[version.storage_key]
    storage.objects[version.storage_key] = (data[:-4] + b"\x00\x00\x00\x01", content_type, when)
    error = refused(version)
    assert error.code == "invalid_file"
    assert {f.code for f in error.findings} == {"checksum_mismatch"}
    assert_unchanged(version, VersionStatus.REJECTED)


def test_synchronous_revalidation_is_preserved(pip, flag_on):
    version = upload(pip, glb_bytes(clips=("Idle",)))
    complete(version)
    type(pip).objects.filter(pk=pip.pk).update(clips=["Idle", "Talk"])
    assert refused(version).code == "invalid_file"
    version.refresh_from_db()
    assert any(f["code"] == "missing_clip" for f in version.validation_report)


def test_a_failing_verdict_is_refused(pip, flag_on):
    version = upload(pip, refused_glb())
    job = complete(version)
    assert job.result["verdict"] == "fail"
    assert refused(version).code == "processing_required"
    assert_unchanged(version)


@pytest.mark.parametrize("status", [JobStatus.FAILED, JobStatus.RUNNING, JobStatus.PENDING])
def test_a_pass_result_on_an_unfinished_or_failed_job_is_refused(pip, flag_on, status):
    version = upload(pip, glb_bytes())
    job = complete(version)
    ProcessingJob.objects.filter(pk=job.pk).update(status=status)
    assert refused(version).code == "processing_required"
    assert_unchanged(version)


def test_a_job_for_another_version_is_refused(pip, flag_on):
    first = upload(pip, glb_bytes(clips=("Idle",)))
    second = upload(pip, glb_bytes(clips=("Idle", "Wave")))
    job = complete(first)
    # Pointed at the second version's row, but its request is still the first file's.
    ProcessingJob.objects.filter(pk=job.pk).update(subject_id=str(second.pk))
    assert refused(second).code == "processing_required"
    assert_unchanged(second)


def test_a_stale_result_for_an_earlier_checksum_is_refused(pip, flag_on):
    version = upload(pip, glb_bytes())
    complete(version)
    AssetVersion.objects.filter(pk=version.pk).update(sha256="0" * 64)
    version.refresh_from_db()
    assert refused(version).code == "processing_required"


@pytest.mark.parametrize(
    "change",
    [
        lambda job: edit_payload(job, "input", size_bytes=job.payload["input"]["size_bytes"] + 1),
        lambda job: edit_payload(
            job, "input", ref={**job.payload["input"]["ref"], "key": "assets/models/x/model.glb"}
        ),
        lambda job: edit_payload(job, "asset", asset_id="npc-other"),
        lambda job: edit_payload(job, "profile", version=2),
        lambda job: ProcessingJob.objects.filter(pk=job.pk).update(subject_outcome="key_mismatch"),
    ],
    ids=["size", "key", "asset", "profile", "outcome"],
)
def test_mismatched_identity_is_refused(pip, flag_on, change):
    version = upload(pip, glb_bytes())
    change(complete(version))
    assert refused(version).code == "processing_required"
    assert_unchanged(version)


def test_an_obsolete_processor_version_is_refused(pip, flag_on, monkeypatch):
    version = upload(pip, glb_bytes())
    complete(version)
    processor_id, _version = processing.current_processor()
    monkeypatch.setattr(processing, "current_processor", lambda: (processor_id, "99.0.0"))
    assert refused(version).code == "processing_required"
    assert_unchanged(version)


def test_an_older_failed_job_does_not_hide_a_newer_passing_one(pip, flag_on):
    version = upload(pip, glb_bytes())
    old = complete(version)
    ProcessingJob.objects.filter(pk=old.pk).update(status=JobStatus.FAILED)
    complete(version)  # a failed job may be submitted again
    assert ProcessingJob.objects.count() == 2
    assert services.publish_version(version).status == VersionStatus.PUBLISHED


def test_other_formats_keep_the_synchronous_path(pip, flag_on):
    version = upload(pip, gltf_json_bytes(), name="pip.gltf")
    assert version.format == "gltf"
    assert services.publish_version(version).status == VersionStatus.PUBLISHED
    assert not ProcessingJob.objects.exists()


def test_a_completed_job_never_publishes(pip, flag_on):
    version = upload(pip, glb_bytes())
    complete(version)
    assert_unchanged(version)  # only the explicit publish call publishes
    draft = services.upload_version(
        pip, io.BytesIO(glb_bytes(clips=("Idle", "Wave"))), original_filename="pip.glb"
    )
    assert draft.status == VersionStatus.VALIDATED and draft.published_at is None


def test_rollback_and_set_default_are_not_gated(pip, settings):
    first = services.publish_version(upload(pip, glb_bytes(clips=("Idle",))))
    second = services.publish_version(upload(pip, glb_bytes(clips=("Idle", "Wave"))))
    services.set_default_version(second)
    settings.LAI_ASSET_ASYNC_VALIDATION = "on"  # neither version has a background validation
    services.rollback_to_version(first)
    pip.refresh_from_db()
    assert pip.default_version_id == first.pk
    services.set_default_version(second)
    pip.refresh_from_db()
    assert pip.default_version_id == second.pk
    services.retire_version(first)
    services.rollback_to_version(first)  # republishes a retired version, ungated
    first.refresh_from_db()
    assert first.status == VersionStatus.PUBLISHED
    assert not ProcessingJob.objects.exists()


def test_published_versions_stay_immutable(pip, flag_on):
    version = upload(pip, glb_bytes())
    complete(version)
    services.publish_version(version)
    published_at = AssetVersion.objects.get(pk=version.pk).published_at
    with pytest.raises(AssetActionRefused, match="Only a validated"):
        services.publish_version(version)
    complete(version)  # a later validation result is recorded on the job only
    version.refresh_from_db()
    assert version.status == VersionStatus.PUBLISHED and version.published_at == published_at
