"""`submit_derived_job`: the one submission path for derived-artifact workloads (ADR-066)."""

import pytest

from apps.assets.artifact_jobs import derived_jobs, submit_derived_job
from apps.jobs import services
from apps.jobs.models import JobStatus, ProcessingJob
from apps.jobs.tests.helpers import FakeSQS, use_sqs

from .artifact_helpers import OGG, deliver, source_version, write

pytestmark = [pytest.mark.postgres, pytest.mark.django_db(transaction=True)]

AUDIO_URL = "https://sqs.us-west-1.amazonaws.com/123456789012/lai-dev-jobs-audio"
KW = {"kind": "asset.transcode_audio", "profile": ("audio-opus", 1), "processor_version": "1.0.0"}


@pytest.fixture
def sqs(settings):
    fake = FakeSQS()
    use_sqs(settings)
    settings.LAI_AUDIO_TRANSCODING = "on"
    settings.LAI_JOBS_AUDIO_QUEUE_URL = AUDIO_URL
    services.set_aws_clients(sqs=fake)
    yield fake
    services.set_aws_clients()


def test_disabled_control_refuses_without_a_row_a_lock_or_a_message(sqs, settings):
    settings.LAI_AUDIO_TRANSCODING = "off"
    version = source_version()
    with pytest.raises(services.WorkloadUnavailable) as refused:
        submit_derived_job(version, **KW)
    assert refused.value.code == "workload_disabled"
    assert ProcessingJob.objects.count() == 0 and sqs.sent == []


def test_submission_builds_the_contract_request_and_routes_to_its_queue(sqs):
    version = source_version()
    job = submit_derived_job(version, **KW, options={})
    assert job.kind == "asset.transcode_audio" and job.queue == "audio"
    assert [m["QueueUrl"] for m in sqs.sent] == [AUDIO_URL]
    work = sqs.sent[0]["Body"]
    assert work["kind"] == "asset.transcode_audio" and work["job_id"] == str(job.pk)
    request = work["payload"]
    assert request["input"]["sha256"] == version.sha256
    assert request["subject"]["subject_id"] == str(version.version_id)
    assert request["idempotency_key"] == job.idempotency_key
    assert job.subject_type == "assets.assetversion" and job.subject_id == str(version.pk)
    assert derived_jobs(version, "asset.transcode_audio").count() == 1


def test_same_logical_work_returns_the_unfinished_or_recorded_job(sqs):
    version = source_version()
    first = submit_derived_job(version, **KW)
    assert submit_derived_job(version, **KW).pk == first.pk
    assert len(sqs.sent) == 1
    ProcessingJob.objects.filter(pk=first.pk).update(status=JobStatus.RUNNING)
    deliver(first, [write(first, "opus", OGG)])
    first.refresh_from_db()
    assert first.subject_outcome == "artifacts_recorded"
    assert submit_derived_job(version, **KW).pk == first.pk


def test_a_failed_job_may_be_resubmitted_up_to_the_cap(sqs, settings):
    settings.LAI_ASSET_VALIDATION_MAX_ATTEMPTS = 2
    version = source_version()
    first = submit_derived_job(version, **KW)
    services.fail_job(first.pk, "timeout")
    second = submit_derived_job(version, **KW)
    assert second.pk != first.pk
    services.fail_job(second.pk, "timeout")
    with pytest.raises(services.JobsError) as refused:
        submit_derived_job(version, **KW)
    assert refused.value.code == "attempts_exhausted"


def test_a_new_processor_version_is_new_work(sqs):
    version = source_version()
    one = submit_derived_job(version, **KW)
    two = submit_derived_job(version, **{**KW, "processor_version": "1.1.0"})
    assert one.pk != two.pk


def test_optimize_variant_is_enforced(sqs, settings):
    settings.LAI_GLB_KTX2 = "on"
    settings.LAI_JOBS_OPTIMIZE_QUEUE_URL = AUDIO_URL.replace("audio", "optimize")
    version = source_version()
    optimize = {"kind": "asset.optimize", "profile": ("meshopt", 1), "processor_version": "1.0.0"}
    with pytest.raises(services.WorkloadUnavailable):
        submit_derived_job(version, **optimize, variant="meshopt")
    job = submit_derived_job(version, **optimize, variant="ktx2")
    assert job.queue == "optimize"
