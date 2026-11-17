"""Submitting jobs and applying results: ordering, duplicates, S3 results, sweep, consumer."""

import json
from datetime import timedelta
from types import SimpleNamespace

import pytest
from django.core.management import call_command
from django.utils.timezone import now

from apps.jobs import services
from apps.jobs.core import envelope, tasks
from apps.jobs.models import JobStatus, ProcessingJob

from . import helpers
from .helpers import FakeS3, FakeSQS, result, use_sqs

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

KIND = "asset.inspect"
PAYLOAD = {"storage_key": "assets/models/x/y/model.glb", "format": "glb"}


class Recorder:
    """A stand-in handler module: records what it is asked to apply."""

    def __init__(self, result=None, error=None):
        self.applied: list[tuple[str, str, object]] = []
        self.result = result if result is not None else {"ok": True}
        self.error = error

    def apply(self, job):
        self.applied.append((str(job.pk), job.status, job.result))

    def inline_ports(self, job):
        return SimpleNamespace()


@pytest.fixture
def recorder(monkeypatch):
    rec = Recorder()

    def fake_run(kind, payload, ports):
        if rec.error is not None:
            raise rec.error
        return rec.result

    monkeypatch.setattr(services, "handler", lambda kind: rec)
    monkeypatch.setattr(tasks, "run", fake_run)
    return rec


@pytest.fixture
def aws():
    fakes = SimpleNamespace(sqs=FakeSQS(), s3=FakeS3())
    services.set_aws_clients(sqs=fakes.sqs, s3=fakes.s3)
    yield fakes
    services.set_aws_clients()


def pending(**fields):
    return ProcessingJob.objects.create(
        kind=KIND, queue="media", backend="sqs", payload=PAYLOAD, **fields
    )


# --- submit ---------------------------------------------------------------------------------------


def test_inline_submit_runs_and_applies(recorder):
    job = services.submit(KIND, PAYLOAD, subject=("assets.assetversion", "7"))
    assert job.status == JobStatus.COMPLETED and job.result == {"ok": True}
    assert job.attempts == 1 and job.deliveries == 2 and job.backend == "inline"
    assert (job.subject_type, job.subject_id) == ("assets.assetversion", "7")
    assert recorder.applied == [(str(job.pk), "completed", {"ok": True})]


def test_inline_task_errors_fail_the_job(recorder):
    recorder.error = tasks.TaskError("object_missing")
    job = services.submit(KIND, PAYLOAD)
    assert job.status == JobStatus.FAILED and job.error_code == "object_missing"
    recorder.error = ValueError("boom")
    assert services.submit(KIND, PAYLOAD).error_code == "internal_error"


def test_disabled_backend_refuses(settings, recorder):
    settings.LAI_JOBS_BACKEND = "disabled"
    with pytest.raises(services.JobsDisabled):
        services.submit(KIND, PAYLOAD)
    assert not ProcessingJob.objects.exists()


def test_unknown_kind_and_oversized_payloads_are_refused(recorder):
    with pytest.raises(services.JobsError):
        services.submit("shell.exec", {})
    with pytest.raises(services.JobsError, match="payload_too_large"):
        services.submit(KIND, {"x": "y" * (services.MAX_WORK_BYTES + 1)})


def test_sqs_submit_sends_after_commit_to_the_kind_queue(
    settings, recorder, aws, django_capture_on_commit_callbacks
):
    use_sqs(settings)
    with django_capture_on_commit_callbacks(execute=True):
        job = services.submit(KIND, PAYLOAD)
        assert aws.sqs.sent == []  # nothing leaves before the job row is committed
    [message] = aws.sqs.sent
    assert message["QueueUrl"] == helpers.MEDIA_URL
    work = envelope.parse_work(message["Body"])
    assert work["job_id"] == str(job.pk) and work["payload"] == PAYLOAD
    with django_capture_on_commit_callbacks(execute=True):
        services.submit("studio.generate_chunk", {"x": 1})
    assert aws.sqs.sent[-1]["QueueUrl"] == helpers.AI_URL


def test_a_failed_send_fails_the_job_and_runs_the_handler(
    settings, recorder, aws, django_capture_on_commit_callbacks
):
    use_sqs(settings)
    aws.sqs.fail_send = True
    with django_capture_on_commit_callbacks(execute=True):
        job = services.submit(KIND, PAYLOAD)
    job.refresh_from_db()
    assert job.status == JobStatus.FAILED and job.error_code == "submit_failed"
    assert recorder.applied == [(str(job.pk), "failed", None)]


# --- apply_result ---------------------------------------------------------------------------------


def test_running_then_completed(recorder):
    job = pending()
    assert services.apply_result(result(job, "running")) == services.RUNNING
    job.refresh_from_db()
    assert job.status == JobStatus.RUNNING and job.started_at and job.attempts == 1
    assert services.apply_result(result(job, "succeeded", result={"n": 1})) == services.APPLIED
    job.refresh_from_db()
    assert job.status == JobStatus.COMPLETED and job.result == {"n": 1} and job.finished_at
    assert job.worker_function == "lai-dev-jobs-media" and job.deliveries == 2
    assert len(recorder.applied) == 1


def test_completed_then_late_running_is_ignored(recorder):
    job = pending()
    services.apply_result(result(job, "succeeded", result={"n": 1}))
    assert services.apply_result(result(job, "running")) == services.DUPLICATE
    job.refresh_from_db()
    assert job.status == JobStatus.COMPLETED and job.deliveries == 2


def test_duplicate_final_results_apply_once(recorder):
    job = pending()
    first = result(job, "succeeded", result={"n": 1})
    assert services.apply_result(first) == services.APPLIED
    assert services.apply_result(first) == services.DUPLICATE
    assert services.apply_result(result(job, "failed", code="late")) == services.DUPLICATE
    job.refresh_from_db()
    assert job.status == JobStatus.COMPLETED and job.error_code == ""
    assert len(recorder.applied) == 1


def test_failed_result_records_the_code(recorder):
    job = pending()
    services.apply_result(result(job, "failed", code="invalid_asset_key"))
    job.refresh_from_db()
    assert job.status == JobStatus.FAILED and job.error_code == "invalid_asset_key"
    assert recorder.applied[0][1] == "failed"


def test_invalid_unknown_and_mismatched_results(recorder):
    job = pending()
    assert services.apply_result({"schema": 1}) == services.INVALID
    assert services.apply_result("not json") == services.INVALID
    stray = envelope.build_result(
        "00000000-0000-4000-8000-000000000000", KIND, "succeeded", result={}
    )
    assert services.apply_result(stray) == services.UNKNOWN_JOB
    other_kind = envelope.build_result(str(job.pk), "speech.synthesize", "running")
    assert services.apply_result(other_kind) == services.INVALID
    job.refresh_from_db()
    assert job.status == JobStatus.PENDING and recorder.applied == []


def test_results_held_in_s3_are_fetched(settings, recorder, aws):
    use_sqs(settings)
    job = pending()
    full = result(job, "succeeded", result={"big": "x" * 10})
    aws.s3.objects[(helpers.BUCKET, envelope.result_key(str(job.pk)))] = envelope.encode(
        full
    ).encode()
    pointer = {**full, "result": None, "result_s3_key": envelope.result_key(str(job.pk))}
    assert services.apply_result(pointer) == services.APPLIED
    job.refresh_from_db()
    assert job.result == {"big": "x" * 10}


def test_an_unreadable_s3_result_is_left_for_later(settings, recorder, aws):
    use_sqs(settings)
    job = pending()
    pointer = {
        **result(job, "succeeded", result={"a": 1}),
        "result": None,
        "result_s3_key": envelope.result_key(str(job.pk)),
    }
    aws.s3.fail = True
    with pytest.raises(services.ResultUnavailable):
        services.apply_result(pointer)
    job.refresh_from_db()
    assert job.status == JobStatus.PENDING


def test_a_handler_error_rolls_the_result_back(recorder, monkeypatch):
    job = pending()

    def explode(job):
        raise RuntimeError("bug")

    monkeypatch.setattr(recorder, "apply", explode)
    with pytest.raises(RuntimeError):
        services.apply_result(result(job, "succeeded", result={"n": 1}))
    job.refresh_from_db()
    assert job.status == JobStatus.PENDING  # SQS redelivers; the DLQ catches a persistent bug


# --- sweep ----------------------------------------------------------------------------------------


def test_sweep_fails_stale_jobs_and_prunes_old_completed(recorder, settings):
    settings.LAI_JOBS_STALE_MINUTES = 60
    stale = pending(created_at=now() - timedelta(minutes=61))
    running = pending(created_at=now() - timedelta(hours=3), status=JobStatus.RUNNING)
    fresh = pending()
    old_done = pending(status=JobStatus.COMPLETED, finished_at=now() - timedelta(days=31))
    old_failed = pending(status=JobStatus.FAILED, finished_at=now() - timedelta(days=90))
    call_command("jobs_sweep", "--dry-run")
    stale.refresh_from_db()
    assert stale.status == JobStatus.PENDING
    services.sweep()
    for job in (stale, running):
        job.refresh_from_db()
        assert job.status == JobStatus.FAILED and job.error_code == "timeout"
    fresh.refresh_from_db()
    assert fresh.status == JobStatus.PENDING
    assert not ProcessingJob.objects.filter(pk=old_done.pk).exists()
    assert ProcessingJob.objects.filter(pk=old_failed.pk).exists()
    assert {status for _id, status, _r in recorder.applied} == {"failed"}
    assert len(recorder.applied) == 2


# --- consumer -------------------------------------------------------------------------------------


def test_consumer_exits_when_the_backend_is_not_sqs(capsys):
    call_command("jobs_consume_results", "--once")
    assert "nothing to consume" in capsys.readouterr().out


def test_consumer_once_applies_and_deletes(settings, recorder, aws, capsys):
    use_sqs(settings)
    job = pending()
    done = aws.sqs.queue(result(job, "running"))
    final = aws.sqs.queue(result(job, "succeeded", result={"n": 2}))
    poison = aws.sqs.queue("{not json")
    stray = aws.sqs.queue(
        envelope.build_result("00000000-0000-4000-8000-000000000000", KIND, "running")
    )
    call_command("jobs_consume_results", "--once", "--max-messages", "10", "--wait-seconds", "0")
    assert json.loads(capsys.readouterr().out.strip().splitlines()[-1]) == {
        "deleted": 2,
        "left": 2,
        "received": 4,
    }
    assert aws.sqs.deleted == [done, final]
    assert poison not in aws.sqs.deleted and stray not in aws.sqs.deleted
    job.refresh_from_db()
    assert job.status == JobStatus.COMPLETED and job.result == {"n": 2}


def test_consumer_survives_a_receive_failure(settings, aws, monkeypatch):
    use_sqs(settings)

    def broken(**kwargs):
        raise RuntimeError("network")

    monkeypatch.setattr(aws.sqs, "receive_message", broken)
    call_command("jobs_consume_results", "--once")  # logs and exits 0
