"""Derived-artifact workload kinds, queues and controls (ADR-066): refusal and queue routing."""

import pytest

from apps.jobs import services, workloads
from apps.jobs.core import envelope
from apps.jobs.models import JobKind, JobQueue, ProcessingJob

from .helpers import FakeSQS, use_sqs

AUDIO_URL = "https://sqs.us-west-1.amazonaws.com/123456789012/lai-dev-jobs-audio"
IMAGE_URL = "https://sqs.us-west-1.amazonaws.com/123456789012/lai-dev-jobs-image"
OPTIMIZE_URL = "https://sqs.us-west-1.amazonaws.com/123456789012/lai-dev-jobs-optimize"

CASES = [
    (JobKind.ASSET_TRANSCODE_AUDIO, "audio", "LAI_AUDIO_TRANSCODING", "LAI_JOBS_AUDIO_QUEUE_URL"),
    (JobKind.ASSET_CONVERT_IMAGE, "image", "LAI_IMAGE_CONVERSION", "LAI_JOBS_IMAGE_QUEUE_URL"),
    (JobKind.ASSET_OPTIMIZE, "optimize", "LAI_GLB_MESHOPT", "LAI_JOBS_OPTIMIZE_QUEUE_URL"),
    (JobKind.ASSET_OPTIMIZE, "optimize", "LAI_GLB_KTX2", "LAI_JOBS_OPTIMIZE_QUEUE_URL"),
]
URLS = {
    "LAI_JOBS_AUDIO_QUEUE_URL": AUDIO_URL,
    "LAI_JOBS_IMAGE_QUEUE_URL": IMAGE_URL,
    "LAI_JOBS_OPTIMIZE_QUEUE_URL": OPTIMIZE_URL,
}


@pytest.fixture
def sqs(settings):
    fake = FakeSQS()
    use_sqs(settings)
    services.set_aws_clients(sqs=fake)
    yield fake
    services.set_aws_clients()


def test_kinds_and_queues_are_registered():
    assert envelope.KIND_QUEUE["asset.transcode_audio"] == "audio"
    assert envelope.KIND_QUEUE["asset.convert_image"] == "image"
    assert envelope.KIND_QUEUE["asset.optimize"] == "optimize"
    assert {q.value for q in JobQueue} >= {"ai", "media", "audio", "image", "optimize"}
    assert max(len(q.value) for q in JobQueue) <= 8
    assert envelope.kinds_for_queue("optimize") == {"asset.optimize"}


@pytest.mark.django_db
@pytest.mark.parametrize(("kind", "queue", "control", "setting"), CASES)
def test_refused_by_default_with_nothing_queued(sqs, settings, kind, queue, control, setting):
    assert workloads.workload_enabled(kind) is False
    with pytest.raises(services.WorkloadUnavailable) as refused:
        workloads.submit_workload(kind, {})
    assert refused.value.code == "workload_disabled"
    assert "switched off" in refused.value.message
    assert "—" not in refused.value.message
    assert ProcessingJob.objects.count() == 0
    assert sqs.sent == []


@pytest.mark.django_db
@pytest.mark.parametrize(("kind", "queue", "control", "setting"), CASES)
def test_control_on_but_queue_missing_is_refused(sqs, settings, kind, queue, control, setting):
    setattr(settings, control, "on")
    assert workloads.workload_enabled(kind) is False
    with pytest.raises(services.WorkloadUnavailable) as refused:
        workloads.submit_workload(kind, {})
    assert refused.value.code == "workload_queue_not_configured"
    assert ProcessingJob.objects.count() == 0


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize(("kind", "queue", "control", "setting"), CASES)
def test_dispatch_routes_to_the_kinds_queue(sqs, settings, kind, queue, control, setting):
    setattr(settings, control, "on")
    setattr(settings, setting, URLS[setting])
    payload = {"hello": "world"}
    if kind == "asset.optimize":  # the dispatch variant comes from the request's profile
        ids = {"LAI_GLB_MESHOPT": "meshopt-conservative", "LAI_GLB_KTX2": "ktx2-basisu"}
        payload["profile"] = {"profile_id": ids[control], "version": 1}
    job = workloads.submit_workload(kind, payload)
    assert job.queue == queue
    assert [m["QueueUrl"] for m in sqs.sent] == [URLS[setting]]
    job.refresh_from_db()
    assert job.dispatched_at is not None


@pytest.mark.django_db(transaction=True)
def test_optimize_variant_selects_one_control(sqs, settings):
    settings.LAI_GLB_KTX2 = "on"
    settings.LAI_JOBS_OPTIMIZE_QUEUE_URL = OPTIMIZE_URL
    assert workloads.workload_enabled("asset.optimize") is True
    assert workloads.workload_enabled("asset.optimize", variant="ktx2") is True
    assert workloads.workload_enabled("asset.optimize", variant="meshopt") is False
    with pytest.raises(services.WorkloadUnavailable):
        workloads.submit_workload("asset.optimize", {}, variant="meshopt")
    assert ProcessingJob.objects.count() == 0


@pytest.mark.django_db(transaction=True)
def test_control_switched_off_after_commit_sends_nothing(sqs, settings):
    settings.LAI_AUDIO_TRANSCODING = "on"
    settings.LAI_JOBS_AUDIO_QUEUE_URL = AUDIO_URL
    sqs.fail_send = True  # the on-commit send fails, leaving the row for the relay
    job = workloads.submit_workload("asset.transcode_audio", {})
    sqs.fail_send = False
    settings.LAI_AUDIO_TRANSCODING = "off"
    assert services._send(job.pk) == "failed"
    job.refresh_from_db()
    assert job.status == "failed"
    assert job.error_code == "workload_disabled"
    assert sqs.sent == []


def test_non_workload_kinds_are_never_refused_here(settings):
    assert workloads.refusal_code("asset.validate_model") is None
    assert workloads.workload_enabled("asset.validate_model") is True


def test_controls_default_off_and_parse(settings):
    for name in (
        "LAI_AUDIO_TRANSCODING",
        "LAI_IMAGE_CONVERSION",
        "LAI_GLB_MESHOPT",
        "LAI_GLB_KTX2",
        "LAI_THUMBNAIL_CAPTURE",
    ):
        assert getattr(settings, name) == "off"
    assert workloads.thumbnail_capture_enabled() is False
    settings.LAI_THUMBNAIL_CAPTURE = "on"
    assert workloads.thumbnail_capture_enabled() is True


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize(
    ("profile", "off", "on"),
    [
        (("ktx2-basisu", 1), "LAI_GLB_KTX2", "LAI_GLB_MESHOPT"),
        (("meshopt-conservative", 1), "LAI_GLB_MESHOPT", "LAI_GLB_KTX2"),
    ],
    ids=["ktx2", "meshopt"],
)
def test_dispatch_checks_the_variant_the_job_was_submitted_under(sqs, settings, profile, off, on):
    """Only the OTHER variant's control stays on: the queued job must fail, not be sent."""
    settings.LAI_GLB_MESHOPT = settings.LAI_GLB_KTX2 = "on"
    settings.LAI_JOBS_OPTIMIZE_QUEUE_URL = OPTIMIZE_URL
    payload = {"profile": {"profile_id": profile[0], "version": profile[1]}}
    sqs.fail_send = True  # the on-commit send fails; the relay path sends later
    job = workloads.submit_workload("asset.optimize", payload)
    sqs.fail_send = False
    settings.LAI_GLB_MESHOPT = settings.LAI_GLB_KTX2 = "off"
    setattr(settings, on, "on")
    assert services._send(job.pk) == "failed"
    job.refresh_from_db()
    assert (job.status, job.error_code) == ("failed", "workload_disabled")
    assert sqs.sent == []


@pytest.mark.django_db(transaction=True)
def test_dispatch_sends_when_the_jobs_own_variant_is_on(sqs, settings):
    settings.LAI_GLB_KTX2 = "on"
    settings.LAI_JOBS_OPTIMIZE_QUEUE_URL = OPTIMIZE_URL
    payload = {"profile": {"profile_id": "ktx2-basisu", "version": 1}}
    sqs.fail_send = True
    job = workloads.submit_workload("asset.optimize", payload, variant="ktx2")
    sqs.fail_send = False
    assert services._send(job.pk) == "sent"
    assert len(sqs.sent) == 1


@pytest.mark.django_db(transaction=True)
def test_an_unrecognised_optimize_profile_is_never_sent(sqs, settings):
    settings.LAI_GLB_MESHOPT = settings.LAI_GLB_KTX2 = "on"
    settings.LAI_JOBS_OPTIMIZE_QUEUE_URL = OPTIMIZE_URL
    job = workloads.submit_workload(
        "asset.optimize", {"profile": {"profile_id": "other", "version": 1}}
    )
    job.refresh_from_db()
    assert (job.status, job.error_code) == ("failed", "workload_disabled")
    assert sqs.sent == []
