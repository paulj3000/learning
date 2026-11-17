"""The jobs admin for contract kinds: read-only details, inlines, and permission-gated cancel and
requeue actions (legacy behaviour is covered by test_jobs_admin_settings)."""

import dataclasses

import pytest
from django.test import Client
from django.urls import reverse

from apps.jobs import processing
from apps.jobs.models import JobState, ProcessingJob
from lai_processing.contracts.results import Finding

from .processing_fakes import (
    current_request,
    event_bytes,
    fake_transport,
    result_for,
    submit_reference,
)
from .test_jobs_admin_settings import staff

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]
__all__ = ["fake_transport"]

CHANGELIST = "admin:jobs_processingjob_changelist"


def change_url(job):
    return reverse("admin:jobs_processingjob_change", args=[job.pk])


def superuser():
    from apps.core.tests.test_django_admin import make_admin

    user, password = make_admin("root", superuser=True)
    client = Client()
    assert client.login(username="root", password=password)
    return client


def act(client, action, job):
    return client.post(reverse(CHANGELIST), {"action": action, "_selected_action": [str(job.pk)]})


@pytest.fixture
def validated(fake_transport):
    job = submit_reference(fake_transport.storage)
    result = result_for(current_request(job), metadata={"label": "<script>alert(1)</script>"})
    result = dataclasses.replace(
        result,
        findings=(Finding(code="empty_input", severity="warning", message="The <b>input</b>."),),
    )
    assert processing.apply_completion(event_bytes(result), storage=fake_transport.storage).ack
    job.refresh_from_db()
    return job


def test_viewing_needs_the_view_permission(validated):
    assert staff("nobody").get(reverse(CHANGELIST)).status_code == 403
    assert staff("nobody2").get(change_url(validated)).status_code == 403
    viewer = staff("viewer", "view_processingjob")
    assert viewer.get(reverse(CHANGELIST)).status_code == 200
    assert viewer.get(reverse(CHANGELIST), {"q": validated.idempotency_key}).status_code == 200


def test_contract_details_are_shown_escaped_and_read_only(validated):
    page = staff("viewer", "view_processingjob").get(change_url(validated))
    assert page.status_code == 200
    html = page.content.decode().lower()
    for text in (
        validated.idempotency_key,
        validated.input_sha256,
        "validated",
        "reference-default v1",
        "reference.checksum 1.0.0",
        "empty_input",
        "processing attempt",  # the attempts inline
        "completion receipt",
    ):
        assert text in html, text
    assert "<script>alert(1)</script>" not in html and "&lt;script&gt;" in html
    assert "<b>input</b>" not in html
    assert 'name="state"' not in html  # nothing editable
    assert "payload" not in html  # the request template is for superusers only
    assert "Payload" in superuser().get(change_url(validated)).content.decode()


def test_legacy_jobs_show_no_contract_fields():
    legacy = ProcessingJob.objects.create(kind="asset.inspect", queue="media", backend="sqs")
    html = staff("viewer", "view_processingjob").get(change_url(legacy)).content.decode()
    assert "idempotency key" not in html.lower() and "processing attempt" not in html.lower()


def test_cancel_needs_its_permission(fake_transport):
    job = submit_reference(fake_transport.storage)
    act(staff("viewer", "view_processingjob"), "cancel_processing_job", job)
    job.refresh_from_db()
    assert job.state == JobState.QUEUED
    act(staff("other", "cancel_processingjob"), "cancel_processing_job", job)  # no view
    job.refresh_from_db()
    assert job.state == JobState.QUEUED
    operator = staff("operator", "view_processingjob", "cancel_processingjob")
    act(operator, "cancel_processing_job", job)
    job.refresh_from_db()
    assert job.state == JobState.CANCELLED and job.cancelled_by is not None
    assert job.outbox.get().cancelled_at is not None  # never sent now


def test_requeue_needs_its_permission_and_a_failed_job(fake_transport):
    job = submit_reference(fake_transport.storage)
    cancel_only = staff("canceller", "view_processingjob", "cancel_processingjob")
    requeuer = staff("requeuer", "view_processingjob", "requeue_processingjob")
    act(requeuer, "requeue_processing_job", job)  # QUEUED: not eligible
    job.refresh_from_db()
    assert job.job_attempts.count() == 1
    processing.ProcessingJob.objects.filter(pk=job.pk).update(
        expires_at=processing._now() - processing.timedelta(seconds=1)
    )
    processing.reconcile()
    act(cancel_only, "requeue_processing_job", job)
    job.refresh_from_db()
    assert job.state == JobState.FAILED
    html = requeuer.get(change_url(job)).content.decode()
    assert "a staff requeue starts a new attempt" in html
    act(requeuer, "requeue_processing_job", job)
    job.refresh_from_db()
    assert job.state == JobState.QUEUED and job.job_attempts.count() == 2


def test_superusers_may_cancel_and_mark_failed_skips_contract_jobs(fake_transport):
    job = submit_reference(fake_transport.storage)
    root = superuser()
    act(root, "mark_failed", job)
    job.refresh_from_db()
    assert job.state == JobState.QUEUED  # the legacy action never touches contract kinds
    act(root, "cancel_processing_job", job)
    job.refresh_from_db()
    assert job.state == JobState.CANCELLED
