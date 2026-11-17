"""The background jobs admin (read-only, permission-gated) and the jobs settings."""

import importlib
import sys

import pytest
from django.contrib.auth.models import Permission
from django.core.exceptions import ImproperlyConfigured
from django.test import Client
from django.urls import reverse

from apps.jobs.models import JobStatus, ProcessingJob

from .helpers import AI_URL, BUCKET, MEDIA_URL, RESULTS_URL


def staff(username, *codenames):
    from apps.core.tests.test_django_admin import make_admin

    user, password = make_admin(username)
    user.user_permissions.set(
        Permission.objects.filter(content_type__app_label="jobs", codename__in=codenames)
    )
    client = Client()
    assert client.login(username=username, password=password)
    return client


@pytest.mark.postgres
@pytest.mark.django_db
def test_admin_is_read_only_and_permission_gated():
    job = ProcessingJob.objects.create(
        kind="asset.inspect", queue="media", backend="sqs", payload={"storage_key": "k"}
    )
    changelist = reverse("admin:jobs_processingjob_changelist")
    assert staff("nobody").get(changelist).status_code == 403
    viewer = staff("viewer", "view_processingjob")
    assert viewer.get(changelist).status_code == 200
    page = viewer.get(reverse("admin:jobs_processingjob_change", args=[job.pk]))
    assert page.status_code == 200 and b"storage_key" not in page.content  # payload hidden
    assert viewer.post(
        changelist, {"action": "mark_failed", "_selected_action": [str(job.pk)]}
    ).status_code in (200, 302)
    job.refresh_from_db()
    assert job.status == JobStatus.PENDING  # no permission for the action
    operator = staff("operator", "view_processingjob", "fail_processingjob")
    operator.post(changelist, {"action": "mark_failed", "_selected_action": [str(job.pk)]})
    job.refresh_from_db()
    assert job.status == JobStatus.FAILED and job.error_code == "marked_failed"


def _load(name):
    sys.modules.pop(name, None)
    sys.modules.pop("config.settings.base", None)  # re-read the environment
    return importlib.import_module(name)


SQS_ENV = {
    "LAI_JOBS_BACKEND": "sqs",
    "LAI_JOBS_AI_QUEUE_URL": AI_URL,
    "LAI_JOBS_MEDIA_QUEUE_URL": MEDIA_URL,
    "LAI_JOBS_RESULTS_QUEUE_URL": RESULTS_URL,
    "LAI_JOBS_RESULTS_BUCKET": BUCKET,
}


def test_base_defaults_to_inline_and_validates_sqs(monkeypatch):
    monkeypatch.delenv("LAI_JOBS_BACKEND", raising=False)
    assert _load("config.settings.base").LAI_JOBS_BACKEND == "inline"
    for name, value in SQS_ENV.items():
        monkeypatch.setenv(name, value)
    assert _load("config.settings.base").LAI_JOBS_RESULTS_BUCKET == BUCKET
    monkeypatch.setenv("LAI_JOBS_AI_QUEUE_URL", "http://example.com/q")
    with pytest.raises(ImproperlyConfigured):
        _load("config.settings.base")
    monkeypatch.delenv("LAI_JOBS_AI_QUEUE_URL")
    with pytest.raises(ImproperlyConfigured):
        _load("config.settings.base")
    monkeypatch.setenv("LAI_JOBS_BACKEND", "lambda")
    with pytest.raises(ImproperlyConfigured):
        _load("config.settings.base")


def test_studio_jobs_mode_needs_a_backend(monkeypatch):
    monkeypatch.setenv("LAI_STUDIO_RUN_MODE", "jobs")
    monkeypatch.setenv("LAI_JOBS_BACKEND", "disabled")
    with pytest.raises(ImproperlyConfigured):
        _load("config.settings.base")
    monkeypatch.setenv("LAI_STUDIO_RUN_MODE", "sometimes")
    monkeypatch.setenv("LAI_JOBS_BACKEND", "inline")
    with pytest.raises(ImproperlyConfigured):
        _load("config.settings.base")


def test_production_jobs_settings(monkeypatch):
    from apps.core.tests.test_settings import _prod_env

    _prod_env(monkeypatch)
    monkeypatch.delenv("LAI_JOBS_BACKEND", raising=False)
    monkeypatch.delenv("LAI_STUDIO_RUN_MODE", raising=False)
    assert _load("config.settings.production").LAI_JOBS_BACKEND == "disabled"
    monkeypatch.setenv("LAI_JOBS_BACKEND", "inline")
    with pytest.raises(ImproperlyConfigured):
        _load("config.settings.production")
    for name, value in SQS_ENV.items():
        monkeypatch.setenv(name, value)
    monkeypatch.setenv("LAI_STUDIO_RUN_MODE", "jobs")
    prod = _load("config.settings.production")
    assert (prod.LAI_JOBS_BACKEND, prod.LAI_STUDIO_RUN_MODE) == ("sqs", "jobs")
    monkeypatch.setenv("LAI_JOBS_BACKEND", "disabled")
    with pytest.raises(ImproperlyConfigured):
        _load("config.settings.production")
