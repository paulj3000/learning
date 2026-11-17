"""The publication gate (LAI-LAMBDA-007, WAVE3_INTERFACES section 5): with
LAI_ASSET_ASYNC_VALIDATION on, publishing a GLB needs a passing background validation of exactly
its file by the current validator. Flag off, other formats, rollback and set default: unchanged."""

import pytest

from apps.assets import services
from apps.assets.models import AssetVersion, VersionStatus
from apps.assets.services import AssetActionRefused
from apps.assets.tests.helpers import glb_bytes, gltf_json_bytes, make_definition
from apps.jobs.models import JobState, ProcessingJob

from .validation_jobs import complete, set_state, submit, upload

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


@pytest.fixture(autouse=True)
def local_backend(settings):
    settings.LAI_PROCESSING_BACKEND = "local"  # jobs are submitted, nothing runs


@pytest.fixture
def pip():
    return make_definition("npc-pip")


@pytest.fixture
def flag_on(settings):
    settings.LAI_ASSET_ASYNC_VALIDATION = "on"


def refused(version) -> AssetActionRefused:
    with pytest.raises(AssetActionRefused) as error:
        services.publish_version(version)
    return error.value


def assert_unchanged(version, status=VersionStatus.VALIDATED):
    version.refresh_from_db()
    assert version.status == status and version.published_at is None
    version.asset.refresh_from_db()
    assert version.asset.default_version_id is None


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


def test_a_queued_job_is_not_enough(pip, flag_on):
    version = upload(pip, glb_bytes())
    submit(version)
    assert refused(version).code == "processing_required"
    assert_unchanged(version)


def test_a_passing_validation_allows_publication(pip, flag_on):
    version = upload(pip, glb_bytes())
    complete(version)
    published = services.publish_version(version)
    assert published.status == VersionStatus.PUBLISHED
    pip.refresh_from_db()
    assert pip.default_version_id == version.pk


def test_the_validated_job_state_also_counts(pip, flag_on):
    version = upload(pip, glb_bytes())
    set_state(complete(version), JobState.VALIDATED)
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
    version = upload(pip, glb_bytes())
    complete(version, verdict="fail")
    assert refused(version).code == "processing_required"
    assert_unchanged(version)


@pytest.mark.parametrize(
    "state", [JobState.FAILED, JobState.CANCELLED, JobState.PROCESSING, JobState.QUEUED]
)
def test_a_pass_result_on_a_job_without_an_applied_result_is_refused(pip, flag_on, state):
    version = upload(pip, glb_bytes())
    set_state(complete(version), state)
    assert refused(version).code == "processing_required"


def test_a_result_for_another_version_is_refused(pip, flag_on):
    first = upload(pip, glb_bytes(clips=("Idle",)))
    second = upload(pip, glb_bytes(clips=("Idle", "Wave")))
    job = complete(first)
    # Pointed at the second version's subject, but its identity is still the first file's.
    ProcessingJob.objects.filter(pk=job.pk).update(subject_id=str(second.version_id))
    assert refused(second).code == "processing_required"


def test_a_stale_result_for_an_earlier_checksum_is_refused(pip, flag_on):
    version = upload(pip, glb_bytes())
    complete(version)
    AssetVersion.objects.filter(pk=version.pk).update(sha256="0" * 64)
    version.refresh_from_db()
    assert refused(version).code == "processing_required"


@pytest.mark.parametrize(
    "change",
    [
        lambda job: {"input_size": job.input_size + 1},
        lambda job: {"input_ref": {**job.input_ref, "key": "assets/models/other/model.glb"}},
        lambda job: {"input_ref": {**job.input_ref, "store": "processing"}},
        lambda job: {"input_ref": {**job.input_ref, "version_id": "v2"}},
        lambda job: {"profile_version": 2},
        lambda job: {"payload": {**job.payload, "asset": {"asset_id": "npc-other"}}},
    ],
    ids=["size", "key", "store", "object-version", "profile", "asset"],
)
def test_mismatched_input_is_refused(pip, flag_on, change):
    version = upload(pip, glb_bytes())
    job = complete(version)
    ProcessingJob.objects.filter(pk=job.pk).update(**change(job))
    assert refused(version).code == "processing_required"
    assert_unchanged(version)


def test_an_obsolete_processor_version_is_refused(pip, flag_on):
    version = upload(pip, glb_bytes())
    job = complete(version)
    ProcessingJob.objects.filter(pk=job.pk).update(processor_version="0.9.0")
    assert refused(version).code == "processing_required"


def test_an_older_failing_job_does_not_hide_a_newer_passing_one(pip, flag_on):
    version = upload(pip, glb_bytes())
    old = complete(version, verdict="fail")
    ProcessingJob.objects.filter(pk=old.pk).update(idempotency_key="older-run")
    complete(version)
    assert ProcessingJob.objects.count() == 2
    assert services.publish_version(version).status == VersionStatus.PUBLISHED


def test_other_formats_keep_the_synchronous_path(pip, flag_on):
    version = upload(pip, gltf_json_bytes())
    assert version.format == "gltf"
    assert services.publish_version(version).status == VersionStatus.PUBLISHED


def test_a_completed_job_never_publishes(pip, flag_on):
    version = upload(pip, glb_bytes())
    complete(version)
    assert_unchanged(version)  # only the explicit publish call publishes


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


def test_published_versions_stay_immutable(pip, flag_on):
    version = upload(pip, glb_bytes())
    complete(version)
    services.publish_version(version)
    with pytest.raises(AssetActionRefused, match="Only a validated"):
        services.publish_version(version)
