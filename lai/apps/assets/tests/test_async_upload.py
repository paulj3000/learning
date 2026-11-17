"""Asynchronous model validation at upload (LAI-LAMBDA-006, WAVE3_INTERFACES section 2).

With `LAI_ASSET_ASYNC_VALIDATION=on`, a GLB upload passes the synchronous checks, is stored and
becomes a `DRAFT` version whose `asset.validate_model` job (job, attempt 1, outbox row) commits in
the same transaction. Every other format, and every upload with the flag off, keeps the
synchronous `VALIDATED` path. No AWS: in-memory storage and the inline processing backend.
"""

import io
import os
import subprocess
import sys
from pathlib import Path

import pytest
from django.conf import settings as django_settings
from django.core.management import call_command
from django.db import IntegrityError
from django.test import Client

from apps.assets import services
from apps.assets.management.commands.ensure_asset_roles import EDITORS
from apps.assets.models import AssetVersion, VersionStatus
from apps.assets.processing import submit_model_validation, validation_jobs
from apps.assets.services import AssetActionRefused
from apps.assets.tests.helpers import glb_bytes, gltf_json_bytes, make_definition
from apps.assets.tests.media_files import mp3_bytes, png_bytes
from apps.assets.tests.test_admin import staff, upload_through_admin
from apps.jobs import processing
from apps.jobs import processing_transport as transport
from apps.jobs.models import JobAttempt, JobOutbox, JobState, ProcessingJob

pytestmark = [pytest.mark.postgres]

LAI_DIR = Path(__file__).resolve().parents[3]


def upload(asset, data=None, name="pip.glb", **kwargs):
    data = data if data is not None else glb_bytes()
    return services.upload_version(asset, io.BytesIO(data), original_filename=name, **kwargs)


def nothing_left(storage):
    return (
        not AssetVersion.objects.exists()
        and not ProcessingJob.objects.exists()
        and not JobAttempt.objects.exists()
        and not JobOutbox.objects.exists()
        and not list(storage.list())
    )


@pytest.fixture(autouse=True)
def fresh_processing():
    """The shipped registry and an empty in-process transport for every test."""
    processing.set_registry_for_tests(None)
    transport.reset_transport()
    yield
    processing.set_registry_for_tests(None)
    transport.reset_transport()


@pytest.fixture
def async_on(settings):
    settings.LAI_ASSET_ASYNC_VALIDATION = "on"
    return settings


@pytest.fixture
def paused(async_on):
    """Jobs stay queued even when a commit runs the inline backend."""
    async_on.LAI_PROCESSING_DISPATCH = "paused"
    return async_on


@pytest.fixture
def pip():
    return make_definition("npc-pip")


# --- the flag ----------------------------------------------------------------------------------


def test_the_flag_defaults_off_in_tests():
    assert django_settings.LAI_ASSET_ASYNC_VALIDATION == "off"


def _import_settings(**env):
    environment = {**os.environ, **env, "DJANGO_SETTINGS_MODULE": "config.settings.local"}
    return subprocess.run(  # noqa: S603 - a fixed interpreter and code string
        [sys.executable, "-c", "from django.conf import settings; settings.INSTALLED_APPS"],
        cwd=LAI_DIR,
        env=environment,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )


def test_the_flag_is_refused_without_a_processing_backend():
    refused = _import_settings(LAI_PROCESSING_BACKEND="disabled", LAI_ASSET_ASYNC_VALIDATION="on")
    assert refused.returncode != 0
    assert "ImproperlyConfigured" in refused.stderr
    assert "LAI_ASSET_ASYNC_VALIDATION=on needs a processing backend" in refused.stderr
    accepted = _import_settings(LAI_PROCESSING_BACKEND="inline", LAI_ASSET_ASYNC_VALIDATION="on")
    assert accepted.returncode == 0, accepted.stderr


# --- flag off, or another format: the synchronous path -----------------------------------------


@pytest.mark.django_db
def test_with_the_flag_off_a_glb_upload_is_validated_and_submits_nothing(pip, storage):
    version = upload(pip)
    assert version.status == VersionStatus.VALIDATED and version.validated_at is not None
    assert not ProcessingJob.objects.exists()


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("asset_id", "kind", "category", "data", "name", "fmt"),
    [
        ("npc-pip", "character", "npc", None, "pip.gltf", "gltf"),
        ("brick-wall", "texture", "texture", png_bytes(), "wall.png", "png"),
        ("splash", "audio", "sound", mp3_bytes(), "splash.mp3", "mp3"),
    ],
)
def test_with_the_flag_on_other_formats_stay_synchronous(
    async_on, storage, asset_id, kind, category, data, name, fmt
):
    asset = make_definition(asset_id, kind=kind, category=category)
    version = upload(asset, data if data is not None else gltf_json_bytes(), name=name)
    assert version.format == fmt
    assert version.status == VersionStatus.VALIDATED and version.validated_at is not None
    assert not ProcessingJob.objects.exists()


# --- flag on, GLB: a draft and its job ---------------------------------------------------------


@pytest.mark.django_db(transaction=True)
def test_a_glb_upload_commits_a_draft_and_exactly_one_queued_job(paused, pip, storage):
    version = upload(pip, glb_bytes(clips=("Idle", "Talk")))
    version.refresh_from_db()  # committed: read back outside the upload transaction
    assert version.status == VersionStatus.DRAFT and version.validated_at is None
    assert version.clips == ["Idle", "Talk"] and version.dimensions["y"] == 2.0
    assert version.metadata and storage.exists(version.storage_key)
    job = ProcessingJob.objects.get()
    assert (job.kind, job.subject_type, job.subject_id) == (
        "asset.validate_model",
        "asset_version",
        str(version.version_id),
    )
    assert job.state == JobState.QUEUED
    assert (job.input_sha256, job.input_size) == (version.sha256, version.size_bytes)
    assert job.input_ref["key"] == version.storage_key
    assert JobAttempt.objects.filter(job=job, number=1).count() == 1
    assert JobAttempt.objects.count() == 1
    assert JobOutbox.objects.filter(job=job).count() == 1
    assert list(validation_jobs(version)) == [job]


@pytest.mark.django_db
def test_the_draft_keeps_the_synchronous_report(async_on, pip):
    flag_off = upload(make_definition("npc-ref"), glb_bytes(clips=("Idle", "Wave")))
    draft = upload(pip, glb_bytes(clips=("Idle", "Wave")))
    assert draft.status == VersionStatus.DRAFT
    assert draft.validation_report == flag_off.validation_report
    assert draft.metadata == flag_off.metadata and draft.clips == flag_off.clips


@pytest.mark.django_db
def test_resubmitting_the_draft_returns_the_same_job(async_on, pip):
    version = upload(pip)
    first = ProcessingJob.objects.get()
    assert submit_model_validation(version, user=None).pk == first.pk
    assert ProcessingJob.objects.count() == 1 and JobOutbox.objects.count() == 1


@pytest.mark.django_db
def test_the_same_bytes_twice_are_refused_as_before(async_on, pip):
    upload(pip)
    with pytest.raises(AssetActionRefused, match="already version 1") as refused:
        upload(pip)
    assert refused.value.code == "duplicate_version"
    assert AssetVersion.objects.count() == 1 and ProcessingJob.objects.count() == 1


@pytest.mark.django_db
def test_a_rejected_drafts_bytes_may_be_uploaded_again(async_on, pip):
    rejected = upload(pip)
    rejected.status = VersionStatus.REJECTED
    rejected.save(update_fields=["status"])
    again = upload(pip)
    assert (again.number, again.status) == (2, VersionStatus.DRAFT)
    assert again.sha256 == rejected.sha256
    assert ProcessingJob.objects.count() == 2
    assert list(validation_jobs(again))[0].subject_id == str(again.version_id)


# --- failures leave nothing behind -------------------------------------------------------------


@pytest.mark.django_db(transaction=True)
def test_a_failure_after_the_job_is_written_rolls_everything_back(
    paused, pip, storage, monkeypatch
):
    def submit_then_fail(version, *, user):
        submit_model_validation(version, user=user)
        assert ProcessingJob.objects.count() == 1  # written inside the upload transaction
        raise RuntimeError("simulated")

    monkeypatch.setattr(services, "submit_model_validation", submit_then_fail)
    with pytest.raises(RuntimeError):
        upload(pip)
    assert nothing_left(storage)


@pytest.mark.django_db(transaction=True)
def test_a_refused_submission_is_processing_unavailable_and_leaves_nothing(async_on, pip, storage):
    async_on.LAI_PROCESSING_BACKEND = "disabled"  # ProcessingDisabled from submit
    with pytest.raises(AssetActionRefused) as refused:
        upload(pip)
    assert refused.value.code == "processing_unavailable"
    assert "—" not in refused.value.message
    for private in ("queue", "sqs", "aws", "processing_disabled"):
        assert private not in refused.value.message.lower()
    assert nothing_left(storage)


@pytest.mark.django_db
def test_any_processing_error_is_processing_unavailable(async_on, pip, storage, monkeypatch):
    def refuse(version, *, user):
        raise processing.ProcessingJobsError("unsupported_processor")

    monkeypatch.setattr(services, "submit_model_validation", refuse)
    with pytest.raises(AssetActionRefused) as refused:
        upload(pip)
    assert refused.value.code == "processing_unavailable"
    assert nothing_left(storage)


@pytest.mark.django_db
def test_a_storage_failure_is_storage_failed_and_submits_nothing(async_on, pip, storage):
    storage.fail_next.add("put")
    with pytest.raises(AssetActionRefused) as refused:
        upload(pip)
    assert refused.value.code == "storage_failed"
    assert nothing_left(storage)


@pytest.mark.django_db
def test_a_failed_row_insert_removes_the_object(async_on, pip, storage, monkeypatch):
    def broken_create(**kwargs):
        raise IntegrityError("simulated")

    monkeypatch.setattr(AssetVersion.objects, "create", broken_create)
    with pytest.raises(IntegrityError):
        upload(pip)
    assert nothing_left(storage)


@pytest.mark.django_db
def test_an_invalid_glb_is_never_stored_or_submitted(async_on, pip, storage):
    with pytest.raises(AssetActionRefused) as refused:
        upload(pip, b"PK\x03\x04 not a model")
    assert refused.value.code == "invalid_file"
    assert nothing_left(storage)


# --- the inline backend runs the job; without a completion hook the draft is untouched ---------


@pytest.mark.django_db
def test_inline_processing_reaches_a_result_and_leaves_the_draft_alone(
    async_on, pip, django_capture_on_commit_callbacks
):
    previous = processing.set_completion_hooks_for_tests(None)
    try:
        with django_capture_on_commit_callbacks(execute=True):
            version = upload(pip)
    finally:
        processing.set_completion_hooks_for_tests(previous)
    job = ProcessingJob.objects.get()
    assert job.state in (JobState.VALIDATED, JobState.READY_FOR_REVIEW)
    assert job.result["status"] == "succeeded" and job.result["verdict"] == "pass"
    version.refresh_from_db()
    assert version.status == VersionStatus.DRAFT and version.validated_at is None


# --- Django Admin ------------------------------------------------------------------------------


@pytest.mark.django_db
def test_the_admin_says_a_draft_is_being_validated_in_the_background(async_on, storage):
    call_command("ensure_asset_roles", verbosity=0)
    client: Client = staff("editor", EDITORS)
    pip = make_definition("npc-pip")
    response = upload_through_admin(client, pip)
    version = AssetVersion.objects.get()
    assert response.status_code == 302 and version.status == VersionStatus.DRAFT
    page = client.get(response["Location"])
    text = " ".join(str(m) for m in page.context["messages"])
    assert "stored as a draft and is being validated in the background" in text
    assert "—" not in text and "validated and not yet published" not in text


@pytest.mark.django_db
def test_the_admin_message_is_unchanged_with_the_flag_off(storage):
    call_command("ensure_asset_roles", verbosity=0)
    client: Client = staff("editor", EDITORS)
    response = upload_through_admin(client, make_definition("npc-pip"))
    page = client.get(response["Location"])
    text = " ".join(str(m) for m in page.context["messages"])
    assert "It is validated and not yet published." in text
