"""Settings of the derived-artifact workloads (ADR-066): controls, queue URLs, retention."""

import pytest
from django.core.exceptions import ImproperlyConfigured

from .test_jobs_admin_settings import SQS_ENV, _load

CONTROLS = (
    "LAI_AUDIO_TRANSCODING",
    "LAI_IMAGE_CONVERSION",
    "LAI_GLB_MESHOPT",
    "LAI_GLB_KTX2",
    "LAI_THUMBNAIL_CAPTURE",
)
QUEUES = ("LAI_JOBS_AUDIO_QUEUE_URL", "LAI_JOBS_IMAGE_QUEUE_URL", "LAI_JOBS_OPTIMIZE_QUEUE_URL")
URL = "https://sqs.us-west-1.amazonaws.com/123456789012/lai-dev-jobs-audio"


@pytest.fixture(autouse=True)
def clean(monkeypatch):
    for name in (
        *CONTROLS,
        *QUEUES,
        "LAI_JOBS_BACKEND",
        "LAI_ARTIFACT_RETENTION_UNREVIEWED_DAYS",
        "LAI_ARTIFACT_RETENTION_SUPERSEDED_DAYS",
        "LAI_ARTIFACT_ORPHAN_GRACE_HOURS",
    ):
        monkeypatch.delenv(name, raising=False)


def test_everything_is_off_or_empty_by_default():
    base = _load("config.settings.base")
    assert all(getattr(base, name) == "off" for name in CONTROLS)
    assert all(getattr(base, name) == "" for name in QUEUES)
    assert (
        base.LAI_ARTIFACT_RETENTION_UNREVIEWED_DAYS,
        base.LAI_ARTIFACT_RETENTION_SUPERSEDED_DAYS,
    ) == (90, 30)


@pytest.mark.parametrize("name", CONTROLS)
def test_controls_parse_like_the_async_validation_flag(monkeypatch, name):
    monkeypatch.setenv(name, " ON ")
    if name != "LAI_THUMBNAIL_CAPTURE":
        monkeypatch.setenv("LAI_JOBS_BACKEND", "inline")
    assert getattr(_load("config.settings.base"), name) == "on"
    monkeypatch.setenv(name, "maybe")
    with pytest.raises(ImproperlyConfigured, match=f"{name} must be off or on"):
        _load("config.settings.base")


def test_a_workload_control_needs_a_jobs_backend(monkeypatch):
    monkeypatch.setenv("LAI_JOBS_BACKEND", "disabled")
    monkeypatch.setenv("LAI_IMAGE_CONVERSION", "on")
    with pytest.raises(ImproperlyConfigured, match="LAI_JOBS_BACKEND"):
        _load("config.settings.base")
    monkeypatch.setenv("LAI_THUMBNAIL_CAPTURE", "on")  # staff capture runs no job
    monkeypatch.delenv("LAI_IMAGE_CONVERSION")
    assert _load("config.settings.base").LAI_THUMBNAIL_CAPTURE == "on"


@pytest.mark.parametrize("name", QUEUES)
def test_queue_urls_are_validated_when_set_and_may_be_empty(monkeypatch, name):
    for key, value in SQS_ENV.items():
        monkeypatch.setenv(key, value)
    monkeypatch.setenv("LAI_JOBS_BACKEND", "sqs")
    assert getattr(_load("config.settings.base"), name) == ""
    monkeypatch.setenv(name, URL)
    assert getattr(_load("config.settings.base"), name) == URL
    monkeypatch.setenv(name, "http://example.com/queue")
    with pytest.raises(ImproperlyConfigured, match=name):
        _load("config.settings.base")


@pytest.mark.parametrize(
    ("name", "bad"),
    [
        ("LAI_ARTIFACT_RETENTION_UNREVIEWED_DAYS", ("0", "731")),
        ("LAI_ARTIFACT_RETENTION_SUPERSEDED_DAYS", ("0", "366")),
        ("LAI_ARTIFACT_ORPHAN_GRACE_HOURS", ("0", "721")),
    ],
)
def test_retention_settings_are_bounded(monkeypatch, name, bad):
    for value in bad:
        monkeypatch.setenv(name, value)
        with pytest.raises(ImproperlyConfigured, match=name):
            _load("config.settings.base")


def test_production_needs_sqs_and_the_queue_for_an_enabled_workload(monkeypatch):
    from apps.core.tests.test_settings import _prod_env

    _prod_env(monkeypatch)
    monkeypatch.delenv("LAI_STUDIO_RUN_MODE", raising=False)
    monkeypatch.setenv("LAI_AUDIO_TRANSCODING", "on")
    with pytest.raises(ImproperlyConfigured, match="LAI_AUDIO_TRANSCODING"):
        _load("config.settings.production")  # the default backend is disabled
    for name, value in SQS_ENV.items():
        monkeypatch.setenv(name, value)
    with pytest.raises(ImproperlyConfigured, match="LAI_JOBS_AUDIO_QUEUE_URL"):
        _load("config.settings.production")
    monkeypatch.setenv("LAI_JOBS_AUDIO_QUEUE_URL", URL)
    prod = _load("config.settings.production")
    assert prod.LAI_AUDIO_TRANSCODING == "on" and prod.LAI_JOBS_AUDIO_QUEUE_URL == URL
    monkeypatch.setenv("LAI_GLB_KTX2", "on")
    with pytest.raises(ImproperlyConfigured, match="LAI_JOBS_OPTIMIZE_QUEUE_URL"):
        _load("config.settings.production")
