"""Terminal failed job retention (Workstream B, 2026-11-18): failed jobs are pruned after the
same retention as completed ones, never early, never while referenced, never when pruning would
return an attempt of a bounded retry, never while results are queued. PostgreSQL only."""

import threading
import uuid
from datetime import timedelta

import pytest
from django.db import connection, models

from apps.assets import processing
from apps.assets.tests.helpers import glb_bytes, make_definition
from apps.assets.tests.validation_jobs import upload
from apps.jobs import services
from apps.jobs.core import envelope
from apps.jobs.models import JobStatus, ProcessingJob

from .test_jobs_services import STAMP, finished, kept

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

VALIDATE = envelope.ASSET_VALIDATE_MODEL
INSPECT = envelope.ASSET_INSPECT


@pytest.fixture(autouse=True)
def clock(settings, monkeypatch):
    settings.LAI_JOBS_RETENTION_DAYS = 30
    settings.LAI_ASSET_VALIDATION_JOB_RETENTION_DAYS = 90
    monkeypatch.setattr(services, "now", lambda: STAMP)


def failed(kind, days, **fields):
    job = finished(kind, days, status=JobStatus.FAILED, extra=fields.pop("extra", timedelta(0)))
    if fields:
        ProcessingJob.objects.filter(pk=job.pk).update(**fields)
        job.refresh_from_db()
    return job


def test_failed_jobs_use_the_kind_retention_and_the_boundary_is_kept():
    boundary = failed(INSPECT, 30)
    older = failed(INSPECT, 30, extra=timedelta(microseconds=1))
    validate_boundary = failed(VALIDATE, 90)
    validate_older = failed(VALIDATE, 90, extra=timedelta(microseconds=1))
    validate_30 = failed(VALIDATE, 31)  # inside the validation period, outside the default
    assert services.sweep(dry_run=True)["pruned_failed"] == 2
    assert kept(boundary, older, validate_boundary, validate_older, validate_30) == {
        boundary.pk,
        older.pk,
        validate_boundary.pk,
        validate_older.pk,
        validate_30.pk,
    }
    report = services.sweep()
    assert report["pruned_failed"] == 2
    assert kept(boundary, older, validate_boundary, validate_older, validate_30) == {
        boundary.pk,
        validate_boundary.pk,
        validate_30.pk,
    }


@pytest.mark.parametrize("status", [JobStatus.PENDING, JobStatus.RUNNING])
def test_active_jobs_are_never_failed_pruned(status):
    job = finished(INSPECT, 400, status=status)
    assert services.prunable_failed_ids(STAMP) == []
    services.sweep()
    assert ProcessingJob.objects.filter(pk=job.pk).exists()


def test_a_keyed_failed_job_is_kept_while_its_subject_exists():
    """`attempts_exhausted` counts the logical work's jobs: pruning must not hand back attempts."""
    asset = make_definition("npc-retention")
    version = upload(asset, glb_bytes())
    jobs = [
        failed(
            VALIDATE,
            400,
            idempotency_key="k" * 64,
            subject_type=processing.JOB_SUBJECT,
            subject_id=str(version.pk),
        )
        for _ in range(3)
    ]
    assert services.sweep()["pruned_failed"] == 0
    assert kept(*jobs) == {j.pk for j in jobs}
    # Once the version is gone the work cannot be retried: the evidence may go.
    type(version).objects.filter(pk=version.pk).delete()
    assert services.sweep()["pruned_failed"] == 3


def test_pruning_never_resets_the_attempt_limit(settings):
    settings.LAI_ASSET_VALIDATION_MAX_ATTEMPTS = 2
    settings.LAI_JOBS_BACKEND = "inline"
    asset = make_definition("npc-attempts")
    version = upload(asset, glb_bytes())
    key = processing.model_validation_request(version, job_id=str(uuid.uuid4()))["idempotency_key"]
    for _ in range(2):
        failed(
            VALIDATE,
            400,
            idempotency_key=key,
            subject_type=processing.JOB_SUBJECT,
            subject_id=str(version.pk),
        )
    services.sweep()
    assert ProcessingJob.objects.filter(idempotency_key=key).count() == 2
    with pytest.raises(services.JobsError) as error:
        processing.submit_model_validation(version, user=None)
    assert error.value.code == "attempts_exhausted"


def test_results_queued_or_unknown_defers_failed_pruning(monkeypatch):
    job = failed(INSPECT, 400)
    for backlog in (3, None):
        monkeypatch.setattr(services, "results_backlog", lambda value=backlog: value)
        assert services.sweep()["pruned_failed"] == 0
        assert kept(job) == {job.pk}
    monkeypatch.setattr(services, "results_backlog", lambda: 0)
    assert services.sweep()["pruned_failed"] == 1


def test_without_protecting_models_nothing_is_excluded_and_references_are_generic():
    """`_protected_references` reads ProcessingJob's PROTECT relations (Workstream A's derived
    artifact `job` adds one) and honours them without any change here."""
    assert services._protected_references() == [] or all(
        ref.__class__.__name__ == "Exists" for ref in services._protected_references()
    )


def test_a_referenced_job_is_excluded(monkeypatch):
    referenced = failed(INSPECT, 400)
    free = failed(INSPECT, 400)
    monkeypatch.setattr(services, "_protected_references", lambda: [models.Q(pk=referenced.pk)])
    assert services.prunable_failed_ids(STAMP) == [free.pk]
    services.sweep()
    assert kept(referenced, free) == {referenced.pk}


def test_a_reference_created_after_selection_keeps_the_row(monkeypatch):
    """A PROTECT reference that appears between selection and deletion raises ProtectedError;
    the row stays and the sweep carries on."""
    job = failed(INSPECT, 400)
    assert services.prunable_failed_ids(STAMP) == [job.pk]

    def protected(self, *args, **kwargs):
        raise models.ProtectedError("protected", {self})

    monkeypatch.setattr(ProcessingJob, "delete", protected)
    assert services._delete_failed(job.pk, STAMP) is False
    assert services.sweep()["pruned_failed"] == 0
    assert kept(job) == {job.pk}


@pytest.mark.django_db(transaction=True)
def test_a_result_that_arrives_during_the_sweep_wins():
    """The sweep re-checks each row under its lock: a job a concurrent writer already moved out
    of FAILED is not deleted."""
    job = failed(INSPECT, 400)
    ids = services.prunable_failed_ids(STAMP)
    holding, release = threading.Event(), threading.Event()

    def writer():
        from django.db import transaction

        with transaction.atomic():
            ProcessingJob.objects.select_for_update().get(pk=job.pk)
            holding.set()
            release.wait(5)
            ProcessingJob.objects.filter(pk=job.pk).update(
                status=JobStatus.PENDING, finished_at=None
            )
        connection.close()

    thread = threading.Thread(target=writer, daemon=True)
    thread.start()
    assert holding.wait(5)
    timer = threading.Timer(0.5, release.set)
    timer.start()
    assert services._delete_failed(ids[0], STAMP) is False
    thread.join(5)
    assert kept(job) == {job.pk}
