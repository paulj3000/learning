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
    fields = {"backend": "sqs", **fields}
    return ProcessingJob.objects.create(kind=KIND, queue="media", payload=PAYLOAD, **fields)


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
    job.refresh_from_db()
    assert job.dispatched_at is not None and job.dispatch_attempts == 0
    with django_capture_on_commit_callbacks(execute=True):
        services.submit("studio.generate_chunk", {"x": 1})
    assert aws.sqs.sent[-1]["QueueUrl"] == helpers.AI_URL


def test_a_failed_send_leaves_the_outbox_row_for_the_relay(
    settings, recorder, aws, django_capture_on_commit_callbacks
):
    use_sqs(settings)
    aws.sqs.fail_send = True
    with django_capture_on_commit_callbacks(execute=True):
        job = services.submit(KIND, PAYLOAD)
    job.refresh_from_db()
    assert job.status == JobStatus.PENDING and job.dispatched_at is None
    assert job.dispatch_attempts == 1 and recorder.applied == []
    ProcessingJob.objects.filter(pk=job.pk).update(created_at=now() - timedelta(minutes=5))
    aws.sqs.fail_send = False
    assert services.relay() == {"sent": 1, "skipped": 0, "deferred": 0, "failed": 0}
    job.refresh_from_db()
    assert job.dispatched_at is not None and len(aws.sqs.sent) == 1
    assert services.relay()["sent"] == 0  # dispatched rows are never re-sent


def test_the_relay_sends_a_row_whose_on_commit_send_never_ran(settings, recorder, aws):
    """A process that died between commit and send: the committed row is the durable intent."""
    use_sqs(settings)
    lost = pending(created_at=now() - timedelta(minutes=2))
    young = pending()  # inside the grace period: its own on-commit send is still due
    inline = pending(created_at=now() - timedelta(minutes=2), backend="inline")
    assert services.relay()["sent"] == 1
    [message] = aws.sqs.sent
    assert envelope.parse_work(message["Body"])["job_id"] == str(lost.pk)
    for job in (young, inline):
        job.refresh_from_db()
        assert job.dispatched_at is None


def test_repeated_send_failures_fail_the_job_and_run_the_handler(settings, recorder, aws):
    use_sqs(settings)
    aws.sqs.fail_send = True
    job = pending(created_at=now() - timedelta(minutes=2))
    outcomes = [services.relay() for _ in range(services.DISPATCH_ATTEMPTS)]
    assert [o["deferred"] for o in outcomes[:-1]] == [1] * (services.DISPATCH_ATTEMPTS - 1)
    assert outcomes[-1]["failed"] == 1
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
    assert not ProcessingJob.objects.filter(pk=old_failed.pk).exists()  # unkeyed, 90 days old
    assert {status for _id, status, _r in recorder.applied} == {"failed"}
    assert len(recorder.applied) == 2


STAMP = now().replace(microsecond=500_000)


def finished(kind, days, *, status=JobStatus.COMPLETED, extra=timedelta(0)):
    """A finished job of `kind` that finished exactly `days` days (plus `extra`) before STAMP."""
    return ProcessingJob.objects.create(
        kind=kind,
        queue=envelope.KIND_QUEUE[kind],
        backend="sqs",
        payload={},
        status=status,
        created_at=STAMP - timedelta(days=days) - extra - timedelta(minutes=1),
        finished_at=STAMP - timedelta(days=days) - extra,
    )


def kept(*jobs):
    return {job.pk for job in jobs} & set(ProcessingJob.objects.values_list("pk", flat=True))


def test_validation_jobs_have_their_own_retention_and_the_boundary_is_kept(
    recorder, settings, monkeypatch
):
    """Completed `asset.validate_model` jobs live LAI_ASSET_VALIDATION_JOB_RETENTION_DAYS (90);
    one that finished exactly 90 days ago is kept, a microsecond older is pruned."""
    settings.LAI_JOBS_RETENTION_DAYS = 30
    settings.LAI_ASSET_VALIDATION_JOB_RETENTION_DAYS = 90
    monkeypatch.setattr(services, "now", lambda: STAMP)
    validate = envelope.ASSET_VALIDATE_MODEL
    young = finished(validate, 89)
    boundary = finished(validate, 90)
    older = finished(validate, 90, extra=timedelta(microseconds=1))
    ancient = finished(validate, 400)
    failed_old = finished(validate, 400, status=JobStatus.FAILED)

    assert services.sweep(dry_run=True)["pruned"] == 2
    assert kept(young, boundary, older, ancient, failed_old) == {
        young.pk,
        boundary.pk,
        older.pk,
        ancient.pk,
        failed_old.pk,
    }
    services.sweep()
    # The failed job (no key, no subject) goes with the same 90 day retention.
    assert kept(young, boundary, older, ancient, failed_old) == {young.pk, boundary.pk}


@pytest.mark.parametrize(
    "kind",
    [
        envelope.ASSET_INSPECT,
        envelope.SPEECH_SYNTHESIZE,
        envelope.STUDIO_GENERATE_CHUNK,
        envelope.REFERENCE_CHECKSUM,
    ],
)
def test_other_kinds_keep_the_general_retention(recorder, settings, monkeypatch, kind):
    settings.LAI_JOBS_RETENTION_DAYS = 30
    settings.LAI_ASSET_VALIDATION_JOB_RETENTION_DAYS = 90
    monkeypatch.setattr(services, "now", lambda: STAMP)
    boundary = finished(kind, 30)
    older = finished(kind, 30, extra=timedelta(microseconds=1))
    failed_old = finished(kind, 400, status=JobStatus.FAILED)
    services.sweep()
    assert kept(boundary, older, failed_old) == {boundary.pk}
    assert services.retention_days(kind) == 30
    assert services.retention_days(envelope.ASSET_VALIDATE_MODEL) == 90


@pytest.mark.parametrize("status", [JobStatus.PENDING, JobStatus.RUNNING])
def test_active_validation_jobs_are_never_pruned_whatever_their_age(
    recorder, settings, monkeypatch, status
):
    """A pending or running job older than every retention period is not prunable; the sweep
    times it out (FAILED, kept until its own retention) instead of deleting it."""
    settings.LAI_JOBS_STALE_MINUTES = 60
    monkeypatch.setattr(services, "now", lambda: STAMP)
    job = ProcessingJob.objects.create(
        kind=envelope.ASSET_VALIDATE_MODEL,
        queue="media",
        backend="sqs",
        payload={},
        status=status,
        created_at=STAMP - timedelta(days=400),
    )
    assert not services.prunable(STAMP).filter(pk=job.pk).exists()
    report = services.sweep()
    assert report["pruned"] == 0 and report["timed_out"] == 1
    job.refresh_from_db()
    assert (job.status, job.error_code) == (JobStatus.FAILED, "timeout")


@pytest.mark.parametrize("backlog, unreadable", [(3, False), (0, True)])
def test_sweep_waits_while_results_are_queued(settings, recorder, aws, backlog, unreadable):
    """After the overnight stop or a database outage, results for "stale" jobs may still be
    queued; timing those jobs out first would turn valid results into ignored duplicates."""
    use_sqs(settings)
    settings.LAI_JOBS_STALE_MINUTES = 60
    stale = pending(created_at=now() - timedelta(hours=9), dispatched_at=now())
    aws.sqs.backlog, aws.sqs.fail_attributes = backlog, unreadable
    report = services.sweep()
    assert report["deferred"] == 1 and report["timed_out"] == 0
    stale.refresh_from_db()
    assert stale.status == JobStatus.PENDING
    aws.sqs.backlog, aws.sqs.fail_attributes = 0, False
    assert services.sweep()["timed_out"] == 1


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
        "released": 0,
        "relayed": 0,
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


def test_consumer_never_receives_while_the_database_is_down(settings, aws, monkeypatch):
    """A prolonged RDS outage must not spend receives: valid results stay in the queue, out of
    the DLQ, until the database answers again."""
    from django.db import OperationalError

    from apps.jobs.management.commands import jobs_consume_results as command

    use_sqs(settings)
    job = pending()
    handle = aws.sqs.queue(result(job, "succeeded", result={"n": 1}))

    def down():
        raise OperationalError("could not connect")

    monkeypatch.setattr(command.Command, "_check_database", staticmethod(down))
    for _ in range(10):
        call_command("jobs_consume_results", "--once", "--wait-seconds", "0")
    assert aws.sqs.receives == 0 and aws.sqs.deleted == [] and len(aws.sqs.inbox) == 1
    monkeypatch.undo()
    use_sqs(settings)
    call_command("jobs_consume_results", "--once", "--wait-seconds", "0")
    assert aws.sqs.deleted == [handle]
    job.refresh_from_db()
    assert job.status == JobStatus.COMPLETED


def test_a_database_error_mid_batch_hands_the_rest_back(settings, recorder, aws, monkeypatch):
    from django.db import OperationalError

    use_sqs(settings)
    jobs = [pending() for _ in range(3)]
    handles = [aws.sqs.queue(result(job, "succeeded", result={"n": 1})) for job in jobs]

    def broken(raw):
        raise OperationalError("server closed the connection")

    monkeypatch.setattr(services, "apply_result", broken)
    call_command("jobs_consume_results", "--once", "--wait-seconds", "0")
    assert aws.sqs.deleted == [] and aws.sqs.released == handles


def test_consumer_leaves_an_artifact_storage_fault_for_retry_not_as_a_handler_bug(
    settings, aws, monkeypatch, caplog, capsys
):
    """ArtifactStorageUnavailable is retryable like ResultUnavailable: the message is left on the
    queue (it reappears), nothing is logged as `handler_error`, and nothing is deleted."""
    from apps.assets.artifact_storage import ArtifactStorageUnavailable

    use_sqs(settings)
    job = pending()
    aws.sqs.queue(result(job, "succeeded", result={"n": 1}))

    def unavailable(body):
        raise ArtifactStorageUnavailable("storage")

    monkeypatch.setattr(services, "apply_result", unavailable)
    call_command("jobs_consume_results", "--once", "--max-messages", "1", "--wait-seconds", "0")
    report = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert (report["left"], report["deleted"]) == (1, 0)
    assert aws.sqs.deleted == []
    assert "outcome=artifact_storage_unavailable" in caplog.text
    assert "handler_error" not in caplog.text
