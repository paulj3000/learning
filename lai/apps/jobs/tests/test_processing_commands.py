"""jobs_dispatch, jobs_consume_completions (ack after commit), jobs_reconcile, and the legacy
sweep leaving contract kinds alone."""

import json
from datetime import timedelta

import pytest
from django.core.management import CommandError, call_command
from django.db import DatabaseError, IntegrityError, connection
from django.utils.timezone import now

from apps.jobs import processing, services
from apps.jobs.management.commands.jobs_consume_completions import release_delay
from apps.jobs.models import (
    AttemptOutcome,
    CompletionReceipt,
    JobOutbox,
    JobState,
    JobStatus,
    ProcessingJob,
)

from .processing_fakes import (
    KEY,
    current_request,
    event_bytes,
    fake_transport,
    result_for,
    run_worker,
    submit_reference,
)

__all__ = ["fake_transport"]


def run(name, *args, capsys):
    call_command(name, *args)
    return capsys.readouterr().out.strip()


class SpyQueue:
    """Wraps a MemoryQueue and records what the consumer does with each delivery."""

    def __init__(self, inner, on_ack=None):
        self.inner = inner
        self.max_message_bytes = inner.max_message_bytes
        self.acks = []
        self.releases = []
        self.on_ack = on_ack

    def send(self, body, *, delay_seconds=0):
        return self.inner.send(body, delay_seconds=delay_seconds)

    def receive(self, *, max_messages=1, visibility_seconds=30):
        return self.inner.receive(max_messages=max_messages, visibility_seconds=visibility_seconds)

    def ack(self, delivery):
        if self.on_ack:
            self.on_ack(delivery)
        self.acks.append(delivery.message_id)
        self.inner.ack(delivery)

    def release(self, delivery, *, delay_seconds=0):
        self.releases.append((delivery.message_id, delay_seconds))
        self.inner.release(delivery, delay_seconds=delay_seconds)


def install(fake, spy):
    from apps.jobs import processing_transport as transport

    transport.set_transport_for_tests(work=fake.work, completions=spy, storage=fake.storage)


@pytest.mark.postgres
@pytest.mark.django_db(transaction=True)
def test_consumer_acknowledges_only_after_the_commit(fake_transport, capsys):
    job = submit_reference(fake_transport.storage)
    processing.relay_outbox(fake_transport.work)
    run_worker(fake_transport)
    seen = {}

    def check(delivery):
        # Outside any transaction, with the decision already durable.
        seen["atomic"] = connection.in_atomic_block
        seen["state"] = ProcessingJob.objects.get(pk=job.pk).state
        seen["receipts"] = CompletionReceipt.objects.count()

    spy = SpyQueue(fake_transport.completions, on_ack=check)
    install(fake_transport, spy)
    out = run("jobs_consume_completions", "--once", "--wait-seconds", "0", capsys=capsys)
    assert json.loads(out) == {"acked": 1, "left": 0, "received": 1, "released": 0}
    assert seen == {"atomic": False, "state": JobState.VALIDATED, "receipts": 1}
    assert len(fake_transport.completions) == 0


@pytest.mark.postgres
@pytest.mark.django_db
def test_a_failed_commit_is_released_with_backoff_and_never_acknowledged(
    fake_transport, monkeypatch, capsys
):
    job = submit_reference(fake_transport.storage)
    fake_transport.completions.send(event_bytes(result_for(current_request(job))))
    real = processing._apply_locked

    def fail_at_commit(*args, **kwargs):
        real(*args, **kwargs)  # everything written, then the commit fails
        raise DatabaseError("could not commit")

    monkeypatch.setattr(processing, "_apply_locked", fail_at_commit)
    spy = SpyQueue(fake_transport.completions)
    install(fake_transport, spy)
    out = run("jobs_consume_completions", "--once", "--wait-seconds", "0", capsys=capsys)
    assert json.loads(out)["released"] == 1
    assert spy.acks == [] and spy.releases == [("msg-000001", release_delay(1))]
    assert not CompletionReceipt.objects.exists()
    job.refresh_from_db()
    assert job.state == JobState.QUEUED  # rolled back


@pytest.mark.postgres
@pytest.mark.django_db
def test_transient_storage_failure_releases_with_bounded_backoff(fake_transport, capsys):
    from lai_processing.ports.storage import StorageUnavailable

    job = submit_reference(fake_transport.storage)
    request = current_request(job)
    body = event_bytes(
        result_for(request, metadata={"note": "x" * 3000}), store=fake_transport.storage
    )
    fake_transport.completions.send(body)
    fake_transport.storage.fail_next("read", StorageUnavailable({"store": "artifacts"}))
    spy = SpyQueue(fake_transport.completions)
    install(fake_transport, spy)
    run("jobs_consume_completions", "--once", "--wait-seconds", "0", capsys=capsys)
    assert spy.acks == [] and len(spy.releases) == 1
    assert [release_delay(n) for n in (1, 2, 3, 10, 50)] == [5, 10, 20, 300, 300]


@pytest.mark.postgres
@pytest.mark.django_db
def test_invalid_messages_are_left_for_the_dlq(fake_transport, capsys):
    fake_transport.completions.send(b"garbage")
    spy = SpyQueue(fake_transport.completions)
    install(fake_transport, spy)
    out = run("jobs_consume_completions", "--once", "--wait-seconds", "0", capsys=capsys)
    assert json.loads(out) == {"acked": 0, "left": 1, "received": 1, "released": 0}
    assert spy.acks == [] and spy.releases == []
    assert len(fake_transport.completions) == 1  # still there: redelivered, then DLQ


def test_consumer_and_dispatcher_idle_when_disabled(settings, capsys):
    settings.LAI_PROCESSING_BACKEND = "disabled"
    assert "nothing to consume" in run("jobs_consume_completions", "--once", capsys=capsys)
    assert "nothing to dispatch" in run("jobs_dispatch", "--once", capsys=capsys)
    settings.LAI_PROCESSING_BACKEND = "inline"
    assert "nothing to consume" in run("jobs_consume_completions", "--once", capsys=capsys)


@pytest.mark.postgres
@pytest.mark.django_db
def test_dispatch_once_relays_and_honours_pause(fake_transport, settings, capsys):
    submit_reference(fake_transport.storage)
    settings.LAI_PROCESSING_DISPATCH = "paused"
    assert json.loads(run("jobs_dispatch", "--once", capsys=capsys)) == {"sent": 0}
    settings.LAI_PROCESSING_DISPATCH = "enabled"
    assert json.loads(run("jobs_dispatch", "--once", "--limit", "5", capsys=capsys)) == {"sent": 1}
    assert len(fake_transport.work) == 1


@pytest.mark.postgres
@pytest.mark.django_db
def test_reconcile_expires_overdue_jobs_and_reports_stuck_rows(fake_transport, capsys):
    overdue = submit_reference(fake_transport.storage)
    fresh = submit_reference(fake_transport.storage, subject=("test_subject", "fresh"))
    ProcessingJob.objects.filter(pk=overdue.pk).update(expires_at=now() - timedelta(minutes=1))
    JobOutbox.objects.filter(job=fresh).update(available_at=now() - timedelta(hours=1))
    report = json.loads(run("jobs_reconcile", "--dry-run", capsys=capsys))
    assert report == {"dryRun": True, "expired": 0, "expired_due": 1, "stuck_outbox": 1}
    overdue.refresh_from_db()
    assert overdue.state == JobState.QUEUED
    report = json.loads(run("jobs_reconcile", capsys=capsys))
    assert (report["expired"], report["stuck_outbox"]) == (1, 1)
    overdue.refresh_from_db()
    assert (overdue.state, overdue.status, overdue.error_code) == (
        JobState.FAILED,
        JobStatus.FAILED,
        "job_expired",
    )
    assert JobOutbox.objects.get(job=overdue).cancelled_at is not None
    assert overdue.current_attempt.outcome == AttemptOutcome.ABANDONED
    assert processing.relay_outbox(fake_transport.work) == 1  # only the fresh one is sent
    fresh.refresh_from_db()
    assert fresh.state == JobState.QUEUED


@pytest.mark.postgres
@pytest.mark.django_db
def test_legacy_sweep_never_times_out_or_prunes_contract_jobs(fake_transport, settings):
    queued = submit_reference(fake_transport.storage)
    done = submit_reference(fake_transport.storage, subject=("test_subject", "done"))
    ProcessingJob.objects.filter(pk=done.pk).update(
        state=JobState.VALIDATED, status=JobStatus.COMPLETED
    )
    legacy = ProcessingJob.objects.create(kind="asset.inspect", queue="media", backend="sqs")
    overnight = now() - timedelta(hours=14)
    ProcessingJob.objects.update(created_at=overnight, finished_at=now() - timedelta(days=400))
    report = services.sweep()
    assert (report["stale"], report["timed_out"]) == (1, 1)
    queued.refresh_from_db()
    legacy.refresh_from_db()
    assert (queued.state, queued.status, queued.error_code) == (JobState.QUEUED, "pending", "")
    assert legacy.status == JobStatus.FAILED and legacy.error_code == "timeout"
    assert ProcessingJob.objects.filter(pk=done.pk).exists()
    assert services.fail_job(queued.pk, "marked_failed") is False  # contract kinds refused


@pytest.mark.postgres
@pytest.mark.django_db
def test_no_message_is_received_while_the_database_is_unreachable(
    fake_transport, monkeypatch, capsys
):
    """A receive counts toward maxReceiveCount; receiving during an RDS outage would push valid
    completions into the DLQ. The consumer checks the database first and backs off instead."""
    from apps.jobs.management.commands import jobs_consume_completions as command

    job = submit_reference(fake_transport.storage)
    fake_transport.completions.send(event_bytes(result_for(current_request(job))))

    def unreachable():
        raise DatabaseError("connection refused")

    monkeypatch.setattr(command.Command, "_check_database", staticmethod(unreachable))
    spy = SpyQueue(fake_transport.completions)
    install(fake_transport, spy)
    # --once is a scripted health check: it must report the outage and exit non-zero.
    with pytest.raises(CommandError) as error:
        call_command("jobs_consume_completions", "--once", "--wait-seconds", "0")
    assert error.value.returncode == 2
    report = json.loads(capsys.readouterr().out.strip())
    assert report == {
        "acked": 0,
        "database": "unavailable",
        "left": 0,
        "received": 0,
        "released": 0,
    }
    [message] = fake_transport.completions._messages.values()  # noqa: SLF001 - test inspection
    assert message.receive_count == 0  # never received, so never closer to the DLQ
    assert spy.acks == [] and spy.releases == []


@pytest.mark.postgres
@pytest.mark.django_db
def test_after_a_database_failure_the_rest_of_the_batch_is_handed_back_untried(
    fake_transport, monkeypatch, capsys
):
    first = submit_reference(fake_transport.storage)
    second = submit_reference(
        fake_transport.storage,
        data=b"another input\n",
        key=KEY.replace("model.glb", "second.glb"),
        subject=("test_subject", "subject-2"),
    )
    for job in (first, second):
        fake_transport.completions.send(event_bytes(result_for(current_request(job))))
    attempts = []

    def database_down(*args, **kwargs):
        attempts.append(1)
        raise DatabaseError("server closed the connection")

    monkeypatch.setattr(processing, "_apply_locked", database_down)
    spy = SpyQueue(fake_transport.completions)
    install(fake_transport, spy)
    out = run("jobs_consume_completions", "--once", "--wait-seconds", "0", capsys=capsys)
    assert json.loads(out) == {"acked": 0, "left": 0, "received": 2, "released": 2}
    assert len(attempts) == 1  # the second message was not spent on a doomed attempt
    assert spy.releases[0] == ("msg-000001", release_delay(1))  # the failed one: backoff
    assert spy.releases[1] == ("msg-000002", 0)  # the rest: handed back at once


def two_jobs(fake, count=2):
    jobs = [submit_reference(fake.storage)]
    for index in range(1, count):
        jobs.append(
            submit_reference(
                fake.storage,
                data=f"input {index}\n".encode(),
                key=KEY.replace("model.glb", f"model-{index}.glb"),
                subject=("test_subject", f"subject-{index + 1}"),
            )
        )
    for job in jobs:
        fake.completions.send(event_bytes(result_for(current_request(job))))
    return jobs


def _hold_reconcile_lock():
    """A second PostgreSQL session holding the reconcile advisory lock (another running timer)."""
    from apps.jobs.management.commands.jobs_reconcile import RECONCILE_LOCK_KEY

    other = connection.Database.connect(**connection.get_connection_params())
    other.autocommit = True
    with other.cursor() as cursor:
        cursor.execute("SELECT pg_try_advisory_lock(%s)", [RECONCILE_LOCK_KEY])
        assert cursor.fetchone()[0] is True
    return other


@pytest.mark.postgres
@pytest.mark.django_db
def test_reconcile_skips_while_another_run_holds_the_lock(fake_transport, capsys):
    overdue = submit_reference(fake_transport.storage)
    ProcessingJob.objects.filter(pk=overdue.pk).update(expires_at=now() - timedelta(minutes=1))
    other = _hold_reconcile_lock()
    try:
        report = json.loads(run("jobs_reconcile", capsys=capsys))
        assert report == {"dryRun": False, "skipped": "already_running"}
        overdue.refresh_from_db()
        assert overdue.state == JobState.QUEUED  # nothing changed
        # A dry run only reads, so it still reports while the lock is held.
        report = json.loads(run("jobs_reconcile", "--dry-run", capsys=capsys))
        assert report["expired_due"] == 1 and "skipped" not in report
    finally:
        other.close()
    report = json.loads(run("jobs_reconcile", capsys=capsys))
    assert report["expired"] == 1
    # The lock is released after a run: a later run (another session) can take it again.
    _hold_reconcile_lock().close()


@pytest.mark.postgres
@pytest.mark.django_db
def test_a_database_error_after_acks_keeps_them_and_hands_back_the_rest(
    fake_transport, monkeypatch, capsys
):
    jobs = two_jobs(fake_transport, count=3)
    real = processing._apply_locked
    calls = []

    def second_fails(*args, **kwargs):
        calls.append(1)
        if len(calls) == 2:
            raise DatabaseError("server closed the connection")
        return real(*args, **kwargs)

    monkeypatch.setattr(processing, "_apply_locked", second_fails)
    spy = SpyQueue(fake_transport.completions)
    install(fake_transport, spy)
    out = run("jobs_consume_completions", "--once", "--wait-seconds", "0", capsys=capsys)
    assert json.loads(out) == {"acked": 1, "left": 0, "received": 3, "released": 2}
    assert len(calls) == 2
    assert spy.acks == ["msg-000001"]
    assert spy.releases == [("msg-000002", release_delay(1)), ("msg-000003", 0)]
    states = [ProcessingJob.objects.get(pk=job.pk).state for job in jobs]
    assert states == [JobState.VALIDATED, JobState.QUEUED, JobState.QUEUED]
    assert CompletionReceipt.objects.count() == 1  # the acked decision stays committed
    assert len(fake_transport.completions) == 2


@pytest.mark.postgres
@pytest.mark.django_db
def test_reconcile_failure_logs_the_type_only_and_exits_non_zero(monkeypatch, caplog, capsys):
    from django.core.management.base import CommandError

    def broken(**kwargs):
        raise DatabaseError("password=hunter2 host=db.internal")

    monkeypatch.setattr(processing, "reconcile", broken)
    with caplog.at_level("ERROR", logger="lai.jobs"):
        with pytest.raises(CommandError) as raised:
            call_command("jobs_reconcile")
    assert raised.value.returncode == 1
    messages = [r.getMessage() for r in caplog.records]
    assert "processing.reconcile_failed type=DatabaseError" in messages
    assert not any("hunter2" in m or "db.internal" in m for m in messages)
    assert capsys.readouterr().out == ""
    # The lock was released despite the failure.
    _hold_reconcile_lock().close()
    with pytest.raises(CommandError):
        call_command("jobs_reconcile", "--dry-run")


def test_reconcile_creates_no_attempt_and_sends_nothing():
    """Reconciliation only expires and counts: it never retries (no attempt, no outbox row)."""
    import inspect

    source = inspect.getsource(processing.reconcile)
    assert "_new_attempt" not in source and "JobOutbox.objects.create" not in source
    assert "relay" not in source and ".send(" not in source


@pytest.mark.postgres
@pytest.mark.django_db
def test_an_integrity_error_is_not_a_database_outage(fake_transport, monkeypatch, capsys):
    """A constraint violation releases that message with backoff; the rest of the batch is
    still applied (the database is up)."""
    jobs = two_jobs(fake_transport)
    real = processing._apply_locked
    calls = []

    def first_violates(event, *args, **kwargs):
        calls.append(1)
        if event.job_id == str(jobs[0].pk):
            raise IntegrityError("duplicate key value violates unique constraint")
        return real(event, *args, **kwargs)

    monkeypatch.setattr(processing, "_apply_locked", first_violates)
    spy = SpyQueue(fake_transport.completions)
    install(fake_transport, spy)
    out = run("jobs_consume_completions", "--once", "--wait-seconds", "0", capsys=capsys)
    assert json.loads(out) == {"acked": 1, "left": 0, "received": 2, "released": 1}
    assert spy.releases == [("msg-000001", release_delay(1))]
    assert spy.acks == ["msg-000002"]


@pytest.mark.postgres
@pytest.mark.django_db(transaction=True)
def test_the_real_database_check_passes_and_reconnects(fake_transport):
    from apps.jobs.management.commands import jobs_consume_completions as command

    command.Command._check_database()  # PostgreSQL is up: no error
    connection.close()
    command.Command._check_database()  # a closed connection is reopened
    assert connection.is_usable()


class ScriptedConsumer:
    """Drives the run-forever loop: each step is "db" (a database error in the batch), "down"
    (the pre-receive check fails), "ok" or "stop"."""

    def __init__(self, steps):
        self.steps = list(steps)
        self.sleeps = []

    def install(self, monkeypatch):
        from apps.jobs.management.commands import jobs_consume_completions as command

        script = self

        def consume(self, max_messages, wait_seconds, visibility):
            step = script.steps.pop(0)
            self._database_failed = step == "db"
            if step == "down":
                raise DatabaseError("connection refused")
            if step == "stop":
                self._stopping = True
            return {"received": 0, "acked": 0, "released": 0, "left": 0}

        def sleep(self, seconds):
            script.sleeps.append(seconds)

        monkeypatch.setattr(command.Command, "consume", consume)
        monkeypatch.setattr(command.Command, "_sleep", sleep)


def test_the_loop_backs_off_after_database_failures_and_resets_after_a_clean_batch(
    settings, monkeypatch
):
    settings.LAI_PROCESSING_BACKEND = "local"
    script = ScriptedConsumer(["db", "down", "db", "ok", "ok", "db", "stop"])
    script.install(monkeypatch)
    call_command("jobs_consume_completions")
    # 2, 4, 8 while failing; nothing after a clean batch; then 2 again from scratch.
    assert script.sleeps == [2, 4, 8, 2]
    assert script.steps == []


def test_sigterm_during_the_back_off_sleep_stops_the_loop(settings, monkeypatch):
    import os
    import signal

    from apps.jobs.management.commands import jobs_consume_completions as command

    settings.LAI_PROCESSING_BACKEND = "local"
    calls = []

    def consume(self, max_messages, wait_seconds, visibility):
        calls.append(1)
        raise DatabaseError("connection refused")

    naps = []

    def nap(seconds):
        naps.append(seconds)
        if len(naps) == 1:
            os.kill(os.getpid(), signal.SIGTERM)  # delivered to the handler the command set
        if len(naps) > 50:
            raise AssertionError("the sleep did not stop")

    before = signal.getsignal(signal.SIGTERM)
    monkeypatch.setattr(command.Command, "consume", consume)
    monkeypatch.setattr(command.time, "sleep", nap)
    call_command("jobs_consume_completions")
    assert len(calls) == 1  # no second receive after SIGTERM
    assert len(naps) == 1  # the 2 s back-off ended at the first tick
    assert signal.getsignal(signal.SIGTERM) is before  # the previous handler is restored
