"""The `studio_worker` process and its health reporting (LAI-AQS-027, ADR-052). Fake model only."""

import threading
from datetime import timedelta

import pytest
from django.core.management import call_command
from django.utils.timezone import now

from apps.ai.providers.fake import FakeModelClient
from apps.question_studio import generation, jobs
from apps.question_studio.models import (
    BatchStatus,
    GenerationBatch,
    Question,
    StudioWorker,
    WorkerState,
)
from apps.question_studio.worker import Worker, health_report

from .conftest import params

pytestmark = pytest.mark.django_db


def make_worker(tmp_path, **kwargs):
    kwargs.setdefault("poll_seconds", 0.01)
    kwargs.setdefault("client_factory", FakeModelClient)
    return Worker(health_file=str(tmp_path / "alive"), **kwargs)


def test_once_drains_every_queued_batch_and_records_itself(author, tmp_path):
    batches = [generation.create_batch(author, params(count=6)) for _ in range(2)]
    worker = make_worker(tmp_path, worker_id="w-test", once=True)
    assert worker.run() == 2
    for batch in batches:
        batch.refresh_from_db()
        assert batch.status == BatchStatus.SUCCEEDED and batch.produced_count == 6
    row = StudioWorker.objects.get(worker_id="w-test")
    assert row.state == WorkerState.STOPPED and row.stopped_at
    assert row.batches_processed == 2 and row.chunks_processed == 4
    assert not (tmp_path / "alive").exists()  # removed on a clean stop


def test_max_batches_recycles_the_process(author, tmp_path):
    for _ in range(3):
        generation.create_batch(author, params(count=1))
    assert make_worker(tmp_path, max_batches=2).run() == 2
    assert GenerationBatch.objects.filter(status=BatchStatus.QUEUED).count() == 1


def test_a_stop_signal_hands_the_batch_back_after_the_chunk_in_flight(author, tmp_path):
    batch = generation.create_batch(author, params(count=10))
    worker = make_worker(tmp_path)

    def stop_during_first_call():
        client = FakeModelClient()
        original = client.invoke

        def invoke(request):
            worker.request_stop()  # what SIGTERM does
            return original(request)

        client.invoke = invoke
        return client

    worker.client_factory = stop_during_first_call
    worker.run()
    batch.refresh_from_db()
    assert batch.status == BatchStatus.RUNNING and batch.lease_owner == ""
    assert batch.produced_count == 5  # the chunk in flight committed
    assert make_worker(tmp_path, once=True).run() == 1
    batch.refresh_from_db()
    assert batch.status == BatchStatus.SUCCEEDED
    assert Question.objects.filter(batch=batch).count() == 10


def test_signal_handlers_request_a_stop(tmp_path):
    import signal

    worker = make_worker(tmp_path)
    previous = signal.getsignal(signal.SIGTERM)
    try:
        worker.install_signal_handlers()
        signal.raise_signal(signal.SIGTERM)
        assert worker.stop_event.is_set()
    finally:
        signal.signal(signal.SIGTERM, previous)


def test_a_loop_error_is_logged_by_type_and_the_worker_keeps_going(author, tmp_path, monkeypatch):
    generation.create_batch(author, params(count=1))
    calls = {"n": 0}
    real = jobs.claim_next

    def flaky(owner):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("database went away: secret detail")
        return real(owner)

    monkeypatch.setattr(jobs, "claim_next", flaky)
    worker = make_worker(tmp_path, once=True)
    assert worker.run() == 1 and worker.errors == 1


@pytest.mark.django_db(transaction=True)
def test_concurrent_slots_share_the_work_without_duplicates(author, tmp_path, settings):
    settings.LAI_STUDIO_MAX_RUNNING_BATCHES = 4
    batches = [generation.create_batch(author, params(count=5)) for _ in range(4)]
    worker = make_worker(tmp_path, concurrency=3, once=True)
    thread = threading.Thread(target=worker.run)
    thread.start()
    thread.join(timeout=60)
    assert not thread.is_alive()
    for batch in batches:
        batch.refresh_from_db()
        assert batch.status == BatchStatus.SUCCEEDED
    assert Question.objects.count() == 20


def test_health_report_flags_queued_work_without_a_worker(author, fake):
    healthy, lines = health_report(120)
    assert healthy and "queued=0" in lines[-2]
    generation.create_batch(author, params(count=1))
    healthy, lines = health_report(120)
    assert not healthy and lines[0] == "workers_alive=0"
    StudioWorker.objects.create(worker_id="w1", last_seen_at=now())
    assert health_report(120)[0]
    StudioWorker.objects.filter(worker_id="w1").update(last_seen_at=now() - timedelta(minutes=10))
    assert not health_report(120)[0]


def test_health_command_exit_code(author, fake, capsys):
    call_command("studio_worker_health")
    assert "healthy" in capsys.readouterr().out
    generation.create_batch(author, params(count=1))
    with pytest.raises(SystemExit) as exit_:
        call_command("studio_worker_health")
    assert exit_.value.code == 1 and "UNHEALTHY" in capsys.readouterr().out


def test_worker_command_once(author, fake, tmp_path, settings, capsys):
    settings.LAI_STUDIO_WORKER_HEALTH_FILE = str(tmp_path / "alive")
    generation.create_batch(author, params(count=2))
    call_command("studio_worker", "--once", "--worker-id", "cmd", "--poll-seconds", "0")
    assert "worker=cmd batches=1 errors=0" in capsys.readouterr().out


def test_run_batch_command_also_takes_over_stalled_batches(author, fake, capsys):
    batch = generation.create_batch(author, params(count=2))
    jobs.claim_next("dead")
    GenerationBatch.objects.filter(pk=batch.pk).update(lease_expires_at=now() - timedelta(1))
    call_command("studio_run_batch")
    assert f"{batch.pk} SUCCEEDED produced=2/2" in capsys.readouterr().out


def test_run_batch_command_leaves_a_live_batch_alone(author, fake, capsys):
    batch = generation.create_batch(author, params(count=2))
    jobs.claim_next("alive")
    call_command("studio_run_batch", "--id", str(batch.pk))
    assert capsys.readouterr().out == "" and not fake.requests


def test_worker_and_manual_modes_only_queue(author, fake, settings):
    for mode in ("worker", "manual"):
        settings.LAI_STUDIO_RUN_MODE = mode
        batch = generation.create_batch(author, params(count=1))
        generation.start_batch(batch)
        batch.refresh_from_db()
        assert batch.status == BatchStatus.QUEUED
    assert not fake.requests
