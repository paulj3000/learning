"""LAI_STUDIO_RUN_MODE=jobs: each chunk is a background job, applied with the same accounting
as the in-process runners (inline backend and a fake SQS round trip)."""

from types import SimpleNamespace

import pytest

from apps.ai.providers import override_model_client
from apps.ai.providers.base import ProviderError
from apps.ai.providers.fake import GUARDRAIL_BLOCK, FakeModelClient
from apps.jobs import services as jobs
from apps.jobs.core import envelope, tasks
from apps.jobs.models import JobStatus, ProcessingJob
from apps.jobs.tests.helpers import FakeSQS, use_sqs
from apps.question_studio import generation
from apps.question_studio import jobs as studio_jobs
from apps.question_studio.models import BatchStatus, Question, ReviewStatus

from .conftest import params

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


@pytest.fixture
def jobs_mode(settings):
    settings.LAI_STUDIO_RUN_MODE = "jobs"
    return settings


def summary(batch):
    return (
        batch.status,
        batch.produced_count,
        batch.chunks_done,
        batch.attempts,
        batch.input_tokens,
        batch.output_tokens,
        batch.failure_category,
        batch.model_id,
    )


def test_inline_jobs_match_the_thread_runner(author, fake, jobs_mode):
    reference = generation.run_batch(generation.create_batch(author, params(count=12)).pk)
    batch = generation.create_batch(author, params(count=12))
    generation.start_batch(batch)
    batch.refresh_from_db()
    assert summary(batch) == summary(reference)
    assert batch.status == BatchStatus.COMPLETED and batch.chunks_done == 3
    stems = lambda b: sorted(Question.objects.filter(batch=b).values_list("stem", flat=True))  # noqa: E731
    assert stems(batch) == stems(reference)
    assert not Question.objects.filter(batch=batch, review_status=ReviewStatus.PUBLISHED).exists()
    chunk_jobs = ProcessingJob.objects.filter(subject_id=str(batch.pk))
    assert chunk_jobs.count() == 3
    assert set(chunk_jobs.values_list("status", flat=True)) == {JobStatus.COMPLETED}
    assert [j.payload["chunk_index"] for j in chunk_jobs.order_by("created_at")] == [0, 1, 2]
    assert [j.payload["want"] for j in chunk_jobs.order_by("created_at")] == [5, 5, 2]


def test_chunk_payload_carries_the_built_request(author, fake, jobs_mode):
    batch = generation.create_batch(author, params(count=3, notes="pirates please"))
    generation.start_batch(batch)
    payload = ProcessingJob.objects.get(subject_id=str(batch.pk)).payload
    tasks.validate_studio_payload(payload)  # what the worker accepts
    request = payload["request"]
    assert request["schema_name"] == "question_batch" and request["route"] == "studio"
    assert request["content"][-1] == {"text": "pirates please", "untrusted": True, "guarded": False}
    assert payload["model_id"] == generation.studio_model_id()
    assert payload["max_attempts"] >= 1 and payload["want"] == 3


def test_guardrail_stops_the_batch_in_jobs_mode(author, jobs_mode):
    with override_model_client(FakeModelClient([GUARDRAIL_BLOCK])) as client:
        batch = generation.create_batch(author, params(count=10))
        generation.start_batch(batch)
    batch.refresh_from_db()
    assert batch.status == BatchStatus.FAILED and batch.failure_category == "GUARDRAIL"
    assert len(client.requests) == 1 and batch.chunks_done == 1


def test_partial_success_in_jobs_mode(author, jobs_mode, settings):
    from apps.ai.providers.fake import studio_output

    settings.LAI_STUDIO_MAX_ATTEMPTS = 1
    first = studio_output({"params": params(), "count": 5, "offset": 0})
    with override_model_client(FakeModelClient([first, ProviderError("THROTTLED")])):
        batch = generation.create_batch(author, params(count=10))
        generation.start_batch(batch)
    batch.refresh_from_db()
    assert batch.status == BatchStatus.PARTIAL and batch.produced_count == 5
    assert batch.failure_category == "THROTTLED"


def test_kill_switch_between_chunks_finishes_the_batch(author, fake, jobs_mode, monkeypatch):
    calls = {"n": 0}

    def switch():
        calls["n"] += 1
        return calls["n"] <= 2  # open for create_batch and the first chunk only

    monkeypatch.setattr(generation, "model_calls_enabled", switch)
    batch = generation.create_batch(author, params(count=10))
    generation.start_batch(batch)
    batch.refresh_from_db()
    assert batch.status == BatchStatus.PARTIAL and batch.failure_category == "KILL_SWITCH"
    assert batch.produced_count == 5


def test_disabled_jobs_backend_fails_the_batch(author, fake, jobs_mode, settings):
    settings.LAI_JOBS_BACKEND = "disabled"
    batch = generation.create_batch(author, params(count=2))
    generation.start_batch(batch)
    batch.refresh_from_db()
    assert batch.status == BatchStatus.FAILED and batch.failure_category == "JOBS_UNAVAILABLE"


# --- the SQS round trip, with the worker's task code standing in for the Lambda ---------------


def worker_result(message, client):
    """What the Lambda would send back for one work message."""
    work = envelope.parse_work(message["Body"])
    job = ProcessingJob.objects.get(pk=work["job_id"])
    ports = studio_jobs.InlinePorts(job)
    with override_model_client(client):
        ports._client = client  # noqa: SLF001
        result = tasks.run(work["kind"], work["payload"], ports)
    return envelope.build_result(
        work["job_id"], work["kind"], "succeeded", result=result, function="lai-dev-jobs-ai"
    )


@pytest.fixture
def sqs(settings):
    use_sqs(settings)
    fake = FakeSQS()
    jobs.set_aws_clients(sqs=fake)
    yield fake
    jobs.set_aws_clients()


def test_sqs_round_trip_one_chunk_at_a_time(
    author, jobs_mode, sqs, django_capture_on_commit_callbacks
):
    client = FakeModelClient()
    batch = generation.create_batch(author, params(count=12))
    with django_capture_on_commit_callbacks(execute=True):
        generation.start_batch(batch)
    assert len(sqs.sent) == 1  # never two chunks in flight
    while True:
        message = sqs.sent[-1]
        sent_before = len(sqs.sent)
        running = envelope.build_result(
            envelope.parse_work(message["Body"])["job_id"], "studio.generate_chunk", "running"
        )
        final = worker_result(message, client)
        with django_capture_on_commit_callbacks(execute=True):
            assert jobs.apply_result(running) == jobs.RUNNING
            assert jobs.apply_result(final) == jobs.APPLIED
            assert jobs.apply_result(final) == jobs.DUPLICATE  # redelivered: applied once
        if len(sqs.sent) == sent_before:
            break
    batch.refresh_from_db()
    assert batch.status == BatchStatus.COMPLETED and batch.produced_count == 12
    assert batch.chunks_done == 3 and len(sqs.sent) == 3 and len(client.requests) == 3
    assert Question.objects.filter(batch=batch).count() == 12
    assert batch.cost_microusd is not None or batch.input_tokens == 30


def test_a_failed_chunk_job_finishes_the_batch(
    author, jobs_mode, sqs, django_capture_on_commit_callbacks
):
    batch = generation.create_batch(author, params(count=10))
    with django_capture_on_commit_callbacks(execute=True):
        generation.start_batch(batch)
    job_id = envelope.parse_work(sqs.sent[0]["Body"])["job_id"]
    failed = envelope.build_result(
        job_id, "studio.generate_chunk", "failed", error_code="model_not_approved"
    )
    with django_capture_on_commit_callbacks(execute=True):
        jobs.apply_result(failed)
    batch.refresh_from_db()
    assert batch.status == BatchStatus.FAILED and batch.failure_category == "MODEL_NOT_APPROVED"
    assert len(sqs.sent) == 1


def test_a_stuck_chunk_is_timed_out_by_the_sweep(
    author, jobs_mode, sqs, django_capture_on_commit_callbacks, settings
):
    from datetime import timedelta

    from django.utils.timezone import now

    batch = generation.create_batch(author, params(count=10))
    with django_capture_on_commit_callbacks(execute=True):
        generation.start_batch(batch)
    ProcessingJob.objects.update(created_at=now() - timedelta(hours=2))
    assert jobs.sweep()["timed_out"] == 1
    batch.refresh_from_db()
    assert batch.status == BatchStatus.FAILED and batch.failure_category == "JOB_TIMEOUT"
    # The worker's late answer changes nothing.
    late = worker_result(sqs.sent[0], FakeModelClient())
    assert jobs.apply_result(late) == jobs.DUPLICATE
    assert Question.objects.filter(batch=batch).count() == 0


def test_an_out_of_order_chunk_result_is_ignored(author, fake, jobs_mode):
    batch = generation.create_batch(author, params(count=10))
    generation.start_batch(batch)
    batch.refresh_from_db()
    before = summary(batch)
    stray = SimpleNamespace(
        pk="x",
        status="completed",
        error_code="",
        payload={"batch_id": str(batch.pk), "chunk_index": 0, "want": 5, "requested_before": 0},
        result={"items": [{}], "input_tokens": 1, "output_tokens": 1, "attempts": 1, "failure": ""},
    )
    generation.apply_chunk_job(stray)  # the batch already finished
    batch.refresh_from_db()
    assert summary(batch) == before


def test_admin_shows_the_batch_jobs(author, fake, jobs_mode):
    from apps.question_studio.admin import GenerationBatchAdmin
    from apps.question_studio.models import GenerationBatch

    batch = generation.create_batch(author, params(count=7))
    generation.start_batch(batch)
    text = GenerationBatchAdmin(GenerationBatch, None).job_status(batch)
    assert text.startswith("2 chunk job(s): completed 2")
