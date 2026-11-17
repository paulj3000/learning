"""relay_outbox: pause, transient failures with backoff, at-least-once, skip_locked."""

import threading
from datetime import timedelta

import pytest
from django.db import DatabaseError, connection
from django.utils.timezone import now

from apps.jobs import processing
from apps.jobs.models import JobAttempt, JobOutbox, JobState
from lai_processing.ports.queue import QueueFull, SendReceipt

from .processing_fakes import consume, fake_transport, run_worker, submit_reference

__all__ = ["fake_transport"]


class FlakyQueue:
    max_message_bytes = 240 * 1024

    def __init__(self, error):
        self.error = error
        self.calls = 0

    def send(self, body, *, delay_seconds=0):
        self.calls += 1
        raise self.error


@pytest.mark.postgres
@pytest.mark.django_db
def test_relay_sends_and_marks_rows(fake_transport):
    job = submit_reference(fake_transport.storage)
    assert processing.relay_outbox(fake_transport.work) == 1
    row = JobOutbox.objects.get(job=job)
    assert row.sent_at and row.send_attempts == 1 and row.last_error_code == ""
    assert JobAttempt.objects.get(job=job).dispatched_at == row.sent_at
    assert len(fake_transport.work) == 1
    assert processing.relay_outbox(fake_transport.work) == 0  # nothing left


@pytest.mark.postgres
@pytest.mark.django_db
def test_paused_dispatch_sends_nothing(fake_transport, settings):
    submit_reference(fake_transport.storage)
    settings.LAI_PROCESSING_DISPATCH = "paused"
    assert processing.relay_outbox(fake_transport.work) == 0
    assert len(fake_transport.work) == 0 and JobOutbox.objects.get().sent_at is None
    settings.LAI_PROCESSING_DISPATCH = "enabled"
    assert processing.relay_outbox(fake_transport.work) == 1


@pytest.mark.postgres
@pytest.mark.django_db
@pytest.mark.parametrize(
    ("error", "code"), [(QueueFull(), "queue_full"), (ConnectionError(), "send_failed")]
)
def test_transient_send_failures_back_off_without_failing_the_job(fake_transport, error, code):
    job = submit_reference(fake_transport.storage)
    submit_reference(fake_transport.storage, subject=("test_subject", "second"))
    flaky = FlakyQueue(error)
    before = now()
    assert processing.relay_outbox(flaky) == 0
    assert flaky.calls == 1  # the pass stops at the first transient failure
    row = JobOutbox.objects.get(job=job)
    assert (row.sent_at, row.send_attempts, row.last_error_code) == (None, 1, code)
    assert before < row.available_at <= now() + timedelta(seconds=900)
    job.refresh_from_db()
    assert job.state == JobState.QUEUED
    # The row is not due yet; once due, a healthy queue sends it.
    JobOutbox.objects.filter(pk=row.pk).update(available_at=now())
    assert processing.relay_outbox(fake_transport.work) == 2
    row.refresh_from_db()
    assert row.sent_at and row.send_attempts == 2


@pytest.mark.postgres
@pytest.mark.django_db
def test_a_message_the_queue_can_never_take_fails_the_job(fake_transport):
    job = submit_reference(fake_transport.storage)
    assert processing.relay_outbox(FlakyQueue(ValueError("too large"))) == 0
    job.refresh_from_db()
    assert (job.state, job.error_code) == (JobState.FAILED, "message_too_large")
    assert JobOutbox.objects.get(job=job).cancelled_at is not None


@pytest.mark.postgres
@pytest.mark.django_db
def test_a_crash_between_send_and_mark_sends_twice_and_applies_once(fake_transport, monkeypatch):
    job = submit_reference(fake_transport.storage)
    original = JobOutbox.save

    def crash(self, *args, **kwargs):
        if self.sent_at is not None:
            raise DatabaseError("process died before the commit")
        return original(self, *args, **kwargs)

    monkeypatch.setattr(JobOutbox, "save", crash)
    with pytest.raises(DatabaseError):
        processing.relay_outbox(fake_transport.work)
    monkeypatch.undo()
    assert len(fake_transport.work) == 1 and JobOutbox.objects.get().sent_at is None
    assert processing.relay_outbox(fake_transport.work) == 1
    assert len(fake_transport.work) == 2  # a duplicate work message, never a lost one
    assert run_worker(fake_transport) == 2
    actions = sorted(outcome.action for outcome in consume(fake_transport))
    assert actions == ["apply", "duplicate"]
    job.refresh_from_db()
    assert job.state == JobState.VALIDATED and job.job_attempts.count() == 1


@pytest.mark.postgres
@pytest.mark.django_db(transaction=True)
def test_two_relays_never_send_the_same_row(fake_transport):
    for index in range(6):
        submit_reference(fake_transport.storage, subject=("test_subject", f"s-{index}"))
    barrier = threading.Barrier(2, timeout=10)
    sent: list[bytes] = []
    lock = threading.Lock()
    local = threading.local()

    class SlowQueue:
        max_message_bytes = 240 * 1024

        def send(self, body, *, delay_seconds=0):
            if not getattr(local, "waited", False):
                # Both relays hold a claimed row here; without skip_locked the second could
                # never reach the barrier (it would wait on the first one's row lock).
                local.waited = True
                barrier.wait()
            with lock:
                sent.append(body)
            return SendReceipt(f"m-{len(sent)}")

    errors: list[BaseException] = []

    def relay():
        try:
            processing.relay_outbox(SlowQueue(), limit=10)
        except BaseException as error:  # noqa: BLE001 - reported below
            errors.append(error)
        finally:
            connection.close()

    threads = [threading.Thread(target=relay) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(30)
    assert not errors
    assert len(sent) == 6 and len(set(sent)) == 6
    assert JobOutbox.objects.filter(sent_at__isnull=True).count() == 0


class QueueError(Exception):
    """The shape of `lai_processing_runtime.sqs.QueueError(operation, code, transient)`."""

    def __init__(self, operation, code, transient):
        super().__init__(code)
        self.operation, self.code, self.transient = operation, code, transient


@pytest.mark.postgres
@pytest.mark.django_db
def test_queue_errors_back_off_when_transient_and_fail_loudly_otherwise(fake_transport):
    from apps.jobs.management.commands.jobs_dispatch import log_level

    job = submit_reference(fake_transport.storage)
    transient = QueueError("send", "ServiceUnavailable", True)
    assert processing.relay_outbox(FlakyQueue(transient)) == 0
    row = JobOutbox.objects.get(job=job)
    assert row.last_error_code == "send_failed" and row.sent_at is None
    JobOutbox.objects.filter(pk=row.pk).update(available_at=now())
    denied = QueueError("send", "AccessDenied", False)
    with pytest.raises(QueueError):
        processing.relay_outbox(FlakyQueue(denied))
    row.refresh_from_db()
    assert row.sent_at is None and row.send_attempts == 1  # rolled back, nothing hidden
    job.refresh_from_db()
    assert job.state == JobState.QUEUED
    import logging

    assert (log_level(denied), log_level(transient)) == (logging.ERROR, logging.WARNING)
