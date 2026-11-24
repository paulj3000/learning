"""Asynchronous model validation at upload (LAI-LAMBDA-006, ADR-064 canonical path).

With `LAI_ASSET_ASYNC_VALIDATION=on`, a GLB upload passes the synchronous checks, is stored and
becomes a `DRAFT` version whose `asset.validate_model` job (a `ProcessingJob` on the media queue)
commits in the same transaction; the job's work message is sent on commit (transactional
outbox). The inline backend runs the job inside the upload, so the returned version is already
`VALIDATED` or `REJECTED`. Every other format, and every upload with the flag off, keeps the
synchronous `VALIDATED` path. No AWS: in-memory storage, inline backend or fake SQS.
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
from django.test import Client, override_settings

from apps.assets import services
from apps.assets.management.commands.ensure_asset_roles import EDITORS
from apps.assets.models import AssetVersion, VersionStatus
from apps.assets.processing import submit_model_validation, validation_jobs
from apps.assets.services import AssetActionRefused
from apps.assets.tests.helpers import glb_bytes, gltf_json_bytes, make_definition
from apps.assets.tests.media_files import mp3_bytes, png_bytes
from apps.assets.tests.test_admin import staff, upload_through_admin
from apps.jobs import services as jobs
from apps.jobs.models import JobStatus, ProcessingJob
from apps.jobs.tests.helpers import MEDIA_URL, FakeS3, FakeSQS, use_sqs

from .validation_jobs import refused_glb

pytestmark = [pytest.mark.postgres]

LAI_DIR = Path(__file__).resolve().parents[3]


def upload(asset, data=None, name="pip.glb", **kwargs):
    data = data if data is not None else glb_bytes()
    return services.upload_version(asset, io.BytesIO(data), original_filename=name, **kwargs)


def nothing_left(storage):
    return (
        not AssetVersion.objects.exists()
        and not ProcessingJob.objects.exists()
        and not list(storage.list())
    )


@pytest.fixture(autouse=True)
def fresh_clients():
    jobs.set_aws_clients()
    yield
    jobs.set_aws_clients()


@pytest.fixture
def async_on(settings):
    settings.LAI_ASSET_ASYNC_VALIDATION = "on"
    return settings


@pytest.fixture
def sqs(async_on):
    """The SQS backend with fake clients: jobs stay pending, sends are recorded."""
    fake = FakeSQS()
    use_sqs(async_on)
    jobs.set_aws_clients(sqs=fake, s3=FakeS3())
    return fake


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


def test_the_flag_is_refused_without_a_jobs_backend():
    refused = _import_settings(LAI_JOBS_BACKEND="disabled", LAI_ASSET_ASYNC_VALIDATION="on")
    assert refused.returncode != 0
    assert "ImproperlyConfigured" in refused.stderr
    assert "LAI_ASSET_ASYNC_VALIDATION=on needs LAI_JOBS_BACKEND" in refused.stderr
    accepted = _import_settings(LAI_JOBS_BACKEND="inline", LAI_ASSET_ASYNC_VALIDATION="on")
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
    sqs, storage, asset_id, kind, category, data, name, fmt
):
    asset = make_definition(asset_id, kind=kind, category=category)
    version = upload(asset, data if data is not None else gltf_json_bytes(), name=name)
    assert version.format == fmt
    assert version.status == VersionStatus.VALIDATED and version.validated_at is not None
    assert not ProcessingJob.objects.exists() and not sqs.sent


# --- flag on, GLB, SQS: a draft and its pending job ----------------------------------------------


@pytest.mark.django_db(transaction=True)
def test_a_glb_upload_commits_a_draft_and_exactly_one_pending_job(sqs, pip, storage):
    version = upload(pip, glb_bytes(clips=("Idle", "Talk")))
    version.refresh_from_db()  # committed: read back outside the upload transaction
    assert version.status == VersionStatus.DRAFT and version.validated_at is None
    assert version.clips == ["Idle", "Talk"] and version.dimensions["y"] == 2.0
    assert version.metadata and version.validation_report is not None
    assert storage.exists(version.storage_key)
    job = ProcessingJob.objects.get()
    assert (job.kind, job.queue, job.status) == ("asset.validate_model", "media", JobStatus.PENDING)
    assert (job.subject_type, job.subject_id) == ("assets.assetversion", str(version.pk))
    assert job.idempotency_key and job.idempotency_key == job.payload["idempotency_key"]
    assert list(validation_jobs(version)) == [job]
    # The outbox send ran on commit: one work message naming the version.
    assert job.dispatched_at is not None
    assert len(sqs.sent) == 1 and sqs.sent[0]["QueueUrl"] == MEDIA_URL
    body = sqs.sent[0]["Body"]
    assert (body["job_id"], body["kind"]) == (str(job.pk), "asset.validate_model")
    request = body["payload"]
    assert request["job_id"] == str(job.pk) and request["job_type"] == "asset.validate_model"
    assert request["subject"] == {
        "subject_type": "asset_version",
        "subject_id": str(version.version_id),
    }
    assert request["asset"]["asset_version_id"] == str(version.version_id)
    assert request["input"]["sha256"] == version.sha256


@pytest.mark.django_db
def test_nothing_is_sent_before_commit(sqs, pip, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=False) as callbacks:
        upload(pip)
    assert not sqs.sent and len(callbacks) == 1
    assert ProcessingJob.objects.get().dispatched_at is None


@pytest.mark.django_db
def test_the_draft_keeps_the_synchronous_report(sqs, pip):
    data = glb_bytes(clips=("Idle", "Wave"))
    with override_settings(LAI_ASSET_ASYNC_VALIDATION="off"):
        reference = upload(make_definition("npc-ref"), data)
    draft = upload(pip, data)
    assert reference.status == VersionStatus.VALIDATED and draft.status == VersionStatus.DRAFT
    assert draft.validation_report == reference.validation_report
    assert draft.metadata == reference.metadata and draft.clips == reference.clips
    assert draft.dimensions == reference.dimensions


@pytest.mark.django_db
def test_resubmitting_the_draft_returns_the_same_job(sqs, pip):
    version = upload(pip)
    first = ProcessingJob.objects.get()
    assert submit_model_validation(version, user=None).pk == first.pk
    assert ProcessingJob.objects.count() == 1


@pytest.mark.django_db
def test_the_same_bytes_twice_are_refused_as_before(sqs, pip):
    upload(pip)
    with pytest.raises(AssetActionRefused, match="already version 1") as refused:
        upload(pip)
    assert refused.value.code == "duplicate_version"
    assert AssetVersion.objects.count() == 1 and ProcessingJob.objects.count() == 1


@pytest.mark.django_db
def test_a_rejected_drafts_bytes_may_be_uploaded_again(sqs, pip):
    rejected = upload(pip)
    AssetVersion.objects.filter(pk=rejected.pk).update(status=VersionStatus.REJECTED)
    again = upload(pip)
    assert (again.number, again.status) == (2, VersionStatus.DRAFT)
    assert again.sha256 == rejected.sha256
    assert ProcessingJob.objects.count() == 2
    assert validation_jobs(again).get().subject_id == str(again.pk)


# --- flag on, GLB, inline: the job runs inside the upload ----------------------------------------


@pytest.mark.django_db
def test_inline_a_passing_model_comes_back_validated(async_on, pip, storage):
    version = upload(pip, glb_bytes(clips=("Idle", "Talk")))
    assert version.status == VersionStatus.VALIDATED and version.validated_at is not None
    assert version.published_at is None
    job = validation_jobs(version).get()
    assert job.status == JobStatus.COMPLETED and job.subject_outcome == "version_validated"
    assert version.metadata["model_validation"]["verdict"] == "pass"
    assert version.clips == ["Idle", "Talk"]


@pytest.mark.django_db
def test_inline_a_model_the_processor_refuses_comes_back_rejected(async_on, pip, storage):
    version = upload(pip, refused_glb())
    assert version.status == VersionStatus.REJECTED and version.validated_at is None
    job = validation_jobs(version).get()
    assert job.subject_outcome == "version_rejected"
    assert any(f.get("source") == "processing" for f in version.validation_report)
    assert storage.exists(version.storage_key)  # kept: a rejected draft is reviewable
    # Its bytes may be uploaded again (a REJECTED version is not a duplicate).
    again = upload(pip, refused_glb())
    assert (again.number, again.status) == (2, VersionStatus.REJECTED)


@pytest.mark.django_db
def test_the_inline_draft_keeps_the_synchronous_report(async_on, pip, settings):
    data = glb_bytes(clips=("Idle", "Wave"))
    settings.LAI_ASSET_ASYNC_VALIDATION = "off"
    reference = upload(make_definition("npc-ref"), data)
    settings.LAI_ASSET_ASYNC_VALIDATION = "on"
    version = upload(pip, data)
    synchronous = [f for f in version.validation_report if f.get("source") != "processing"]
    assert synchronous == reference.validation_report
    assert version.clips == reference.clips and version.dimensions == reference.dimensions
    extra = set(version.metadata) - set(reference.metadata)
    assert extra == {"model_validation"}


# --- failures leave nothing behind -------------------------------------------------------------


@pytest.mark.django_db(transaction=True)
def test_a_failure_after_the_job_is_written_rolls_everything_back(sqs, pip, storage, monkeypatch):
    def submit_then_fail(version, *, user):
        submit_model_validation(version, user=user)
        assert ProcessingJob.objects.count() == 1  # written inside the upload transaction
        raise RuntimeError("simulated")

    monkeypatch.setattr(services, "submit_model_validation", submit_then_fail)
    with pytest.raises(RuntimeError):
        upload(pip)
    assert nothing_left(storage)
    assert not sqs.sent  # the rolled-back job's on-commit send never ran


@pytest.mark.django_db(transaction=True)
def test_a_disabled_jobs_backend_is_processing_unavailable_and_leaves_nothing(
    async_on, pip, storage
):
    async_on.LAI_JOBS_BACKEND = "disabled"  # JobsDisabled from submit
    with pytest.raises(AssetActionRefused) as refused:
        upload(pip)
    assert refused.value.code == "processing_unavailable"
    message = refused.value.message
    assert "—" not in message
    for private in ("queue", "sqs", "aws", "jobs_disabled", "lambda"):
        assert private not in message.lower()
    assert nothing_left(storage)


@pytest.mark.django_db
def test_any_jobs_error_is_processing_unavailable(async_on, pip, storage, monkeypatch):
    def refuse(version, *, user):
        raise jobs.JobsError("payload_too_large")

    monkeypatch.setattr(services, "submit_model_validation", refuse)
    with pytest.raises(AssetActionRefused) as refused:
        upload(pip)
    assert refused.value.code == "processing_unavailable"
    assert nothing_left(storage)


@pytest.mark.django_db
def test_a_storage_failure_is_storage_failed_and_submits_nothing(sqs, pip, storage):
    storage.fail_next.add("put")
    with pytest.raises(AssetActionRefused) as refused:
        upload(pip)
    assert refused.value.code == "storage_failed"
    assert nothing_left(storage)


@pytest.mark.django_db
def test_a_failed_row_insert_removes_the_object(sqs, pip, storage, monkeypatch):
    def broken_create(**kwargs):
        raise IntegrityError("simulated")

    monkeypatch.setattr(AssetVersion.objects, "create", broken_create)
    with pytest.raises(IntegrityError):
        upload(pip)
    assert nothing_left(storage)


@pytest.mark.django_db
def test_an_invalid_glb_is_never_stored_or_submitted(sqs, pip, storage):
    with pytest.raises(AssetActionRefused) as refused:
        upload(pip, b"PK\x03\x04 not a model")
    assert refused.value.code == "invalid_file"
    assert nothing_left(storage)


# --- Django Admin ------------------------------------------------------------------------------


def _admin_message(client, response) -> str:
    page = client.get(response["Location"])
    return " ".join(str(m) for m in page.context["messages"])


@pytest.mark.django_db
def test_the_admin_says_a_draft_is_being_validated_in_the_background(sqs, storage):
    call_command("ensure_asset_roles", verbosity=0)
    client: Client = staff("editor", EDITORS)
    response = upload_through_admin(client, make_definition("npc-pip"))
    version = AssetVersion.objects.get()
    assert response.status_code == 302 and version.status == VersionStatus.DRAFT
    text = _admin_message(client, response)
    assert "stored as a draft and is being validated in the background" in text
    assert "—" not in text and "validated and not yet published" not in text


@pytest.mark.django_db
def test_the_admin_says_when_background_validation_rejected_the_upload(async_on, storage):
    call_command("ensure_asset_roles", verbosity=0)
    client: Client = staff("editor", EDITORS)
    response = upload_through_admin(client, make_definition("npc-pip"), data=refused_glb())
    assert response.status_code == 302
    assert AssetVersion.objects.get().status == VersionStatus.REJECTED
    assert "rejected by background validation" in _admin_message(client, response)


@pytest.mark.django_db
def test_the_admin_message_is_unchanged_with_the_flag_off(storage):
    call_command("ensure_asset_roles", verbosity=0)
    client: Client = staff("editor", EDITORS)
    response = upload_through_admin(client, make_definition("npc-pip"))
    assert "It is validated and not yet published." in _admin_message(client, response)
