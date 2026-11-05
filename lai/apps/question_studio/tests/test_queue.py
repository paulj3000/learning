"""The background queue (LAI-AQS-027, ADR-052): claiming, leases, recovery, idempotent results,
retries with backoff, cancellation, the state machine, and legacy rows. The model is always the
fake client; nothing here calls Bedrock."""

import threading
from datetime import timedelta

import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError, close_old_connections, connection, transaction
from django.utils.timezone import now

from apps.ai.providers.base import ProviderError, ProviderTimeout
from apps.ai.providers.fake import FakeModelClient, studio_output
from apps.question_studio import generation, jobs
from apps.question_studio.models import (
    BatchStatus,
    ChunkStatus,
    GenerationBatch,
    GenerationChunk,
    InvalidBatchTransition,
    Question,
    ReviewStatus,
    StudioLimits,
)

from .conftest import make_staff, params

pytestmark = pytest.mark.django_db


class Killed(BaseException):
    """Stands in for SIGKILL: escapes every `except Exception` like a dying process would."""


def chunk_output(count=5, offset=0, **overrides):
    return studio_output({"params": params(**overrides), "count": count, "offset": offset})


def submit(user, **overrides):
    return generation.create_batch(user, params(**overrides))


def expire_lease(batch):
    GenerationBatch.objects.filter(pk=batch.pk).update(
        lease_expires_at=now() - timedelta(seconds=1)
    )


def stems(batch):
    return list(Question.objects.filter(batch=batch).values_list("stem", flat=True))


@pytest.fixture
def operator(db):
    return make_staff(
        "operator",
        "add_generationbatch",
        "view_generationbatch",
        "cancel_generationbatch",
        "retry_generationbatch",
    )


# --- submission -------------------------------------------------------------------------------


def test_submission_queues_a_batch_with_its_chunks_and_makes_no_call(author, fake):
    batch = submit(author, count=12)
    assert batch.status == BatchStatus.QUEUED and batch.chunks_total == 3
    assert list(batch.chunks.values_list("index", "size", "status", "max_attempts")) == [
        (0, 5, ChunkStatus.PENDING, 2),
        (1, 5, ChunkStatus.PENDING, 2),
        (2, 2, ChunkStatus.PENDING, 2),
    ]
    assert not fake.requests


def test_the_same_form_submitted_twice_queues_one_batch(author, reviewer, fake):
    import uuid

    key = uuid.uuid4()
    first = generation.create_batch(author, params(), submission_key=key)
    with pytest.raises(generation.DuplicateSubmission) as again:
        generation.create_batch(author, params(), submission_key=key)
    assert again.value.batch == first and GenerationBatch.objects.count() == 1
    with pytest.raises(IntegrityError), transaction.atomic():
        GenerationBatch.objects.create(
            requested_by=author,
            submission_key=key,
            subject="MATH",
            grade="3",
            topic="multiplication",
            difficulty="MIXED",
            question_type="NUMERIC",
            requested_count=1,
            prompt_version="v",
            schema_version=1,
        )


def test_the_request_is_immutable_once_stored(author, fake):
    batch = GenerationBatch.objects.get(pk=submit(author).pk)
    batch.topic = "addition"
    with pytest.raises(ValidationError):
        batch.save()
    batch = GenerationBatch.objects.get(pk=batch.pk)
    batch.requested_count = 25
    with pytest.raises(ValidationError):
        batch.save()


@pytest.mark.parametrize(
    "start, target",
    [
        (BatchStatus.QUEUED, BatchStatus.SUCCEEDED),
        (BatchStatus.QUEUED, BatchStatus.FAILED),
        (BatchStatus.SUCCEEDED, BatchStatus.QUEUED),
        (BatchStatus.SUCCEEDED, BatchStatus.RUNNING),
        (BatchStatus.CANCELLED, BatchStatus.QUEUED),
        (BatchStatus.FAILED, BatchStatus.RUNNING),
    ],
)
def test_invalid_status_transitions_are_refused(author, fake, start, target):
    batch = submit(author)
    GenerationBatch.objects.filter(pk=batch.pk).update(status=start)
    batch = GenerationBatch.objects.get(pk=batch.pk)
    batch.status = target
    with pytest.raises(InvalidBatchTransition):
        batch.save()


def test_unknown_status_values_are_refused_by_the_database(author, fake):
    batch = submit(author)
    with pytest.raises(IntegrityError), transaction.atomic():
        GenerationBatch.objects.filter(pk=batch.pk).update(status="COMPLETED")


# --- claiming ---------------------------------------------------------------------------------


def test_claim_takes_the_oldest_batch_and_a_live_lease_is_respected(author, fake):
    first, second = submit(author), submit(author)
    claim = jobs.claim_next("w1")
    assert claim.batch_id == first.pk and not claim.recovered
    first.refresh_from_db()
    assert first.status == BatchStatus.RUNNING and first.lease_owner == "w1"
    assert first.lease_token == claim.token and first.lease_expires_at > now()
    assert jobs.claim_next("w2").batch_id == second.pk
    assert jobs.claim_next("w3") is None  # both are held
    assert jobs.claim_batch(first.pk, "w3") is None


def test_the_running_cap_bounds_concurrency(author, fake, settings):
    settings.LAI_STUDIO_MAX_RUNNING_BATCHES = 1
    submit(author), submit(author)
    assert jobs.claim_next("w1") is not None
    assert jobs.claim_next("w2") is None


@pytest.mark.django_db(transaction=True)
def test_concurrent_workers_never_claim_the_same_batch(author, settings):
    settings.LAI_STUDIO_MAX_RUNNING_BATCHES = 20
    batches = [submit(author, count=1) for _ in range(3)]
    claims, barrier = [], threading.Barrier(6)

    def worker(name):
        try:
            barrier.wait()
            claim = jobs.claim_next(name)
            if claim:
                claims.append(claim.batch_id)
        finally:
            close_old_connections()
            connection.close()

    threads = [threading.Thread(target=worker, args=(f"w{i}",)) for i in range(6)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert sorted(map(str, claims)) == sorted(str(b.pk) for b in batches)


@pytest.mark.django_db(transaction=True)
def test_concurrent_claims_respect_the_running_cap(author, settings):
    settings.LAI_STUDIO_MAX_RUNNING_BATCHES = 2
    for _ in range(4):
        submit(author, count=1)
    claims, barrier = [], threading.Barrier(4)

    def worker(name):
        try:
            barrier.wait()
            if jobs.claim_next(name):
                claims.append(name)
        finally:
            close_old_connections()
            connection.close()

    threads = [threading.Thread(target=worker, args=(f"w{i}",)) for i in range(4)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert len(claims) == 2 and jobs.live_running_count() == 2


@pytest.mark.django_db(transaction=True)
def test_concurrent_submissions_cannot_both_pass_the_daily_quota(author):
    limits = StudioLimits.current()
    limits.max_batches_per_user_per_day = 1
    limits.save()
    outcomes, barrier = [], threading.Barrier(2)

    def attempt():
        try:
            barrier.wait()
            generation.create_batch(author, params(count=1))
            outcomes.append("ok")
        except generation.GenerationRefused as error:
            outcomes.append(error.code)
        finally:
            close_old_connections()
            connection.close()

    threads = [threading.Thread(target=attempt) for _ in range(2)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert sorted(outcomes) == ["ok", "user_quota"] and GenerationBatch.objects.count() == 1


# --- processing and crash recovery ------------------------------------------------------------


def test_a_worker_runs_a_batch_to_success(author, fake):
    submit(author, count=12)
    done = jobs.process(jobs.claim_next("w1"))
    assert done.status == BatchStatus.SUCCEEDED and done.produced_count == 12
    assert done.chunks_done == 3 and done.lease_owner == "" and done.lease_token is None
    assert set(done.chunks.values_list("status", flat=True)) == {ChunkStatus.SUCCEEDED}
    assert list(
        Question.objects.filter(batch=done)
        .order_by("chunk__index", "chunk_position")
        .values_list("chunk__index", "chunk_position")
    ) == [(c, p) for c in range(3) for p in range(5 if c < 2 else 2)]
    assert not Question.objects.filter(batch=done, review_status=ReviewStatus.PUBLISHED).exists()


def test_a_killed_worker_loses_only_the_chunk_in_flight_and_the_batch_completes(author):
    """Acceptance: killing the worker mid-batch loses at most the chunk in flight, and the batch
    completes on restart without a duplicate draft."""
    calls = {"n": 0}

    def dies_on_second_call(request):
        calls["n"] += 1
        if calls["n"] == 2:
            raise Killed
        return chunk_output(request.fake_hints["count"], request.fake_hints["offset"])

    batch = submit(author, count=15)
    first = jobs.claim_next("w1")
    with pytest.raises(Killed):
        jobs.process(first, FakeModelClient(respond=dies_on_second_call))
    batch.refresh_from_db()
    assert batch.status == BatchStatus.RUNNING and batch.produced_count == 5  # chunk 0 committed
    assert dict(batch.chunks.values_list("index", "status")) == {
        0: ChunkStatus.SUCCEEDED,
        1: ChunkStatus.RUNNING,
        2: ChunkStatus.PENDING,
    }
    assert jobs.claim_next("w2") is None  # the dead worker's lease is still current

    expire_lease(batch)
    second = jobs.claim_next("w2")
    assert second.recovered and second.batch_id == batch.pk
    restarted = FakeModelClient()
    done = jobs.process(second, restarted)
    assert done.status == BatchStatus.SUCCEEDED and done.produced_count == 15
    assert done.recovered_count == 1 and len(restarted.requests) == 2  # chunks 1 and 2 only
    assert Question.objects.filter(batch=done).count() == 15
    assert len(set(stems(done))) == 15
    assert done.chunks.get(index=1).attempts == 2  # the lost attempt is counted


def test_a_chunk_that_kills_every_worker_ends_failed_not_looping(author, settings):
    settings.LAI_STUDIO_MAX_ATTEMPTS = 2
    batch = submit(author, count=5)

    def always_dies(_request):
        raise Killed

    for name in ("w1", "w2"):
        claim = jobs.claim_next(name)
        with pytest.raises(Killed):
            jobs.process(claim, FakeModelClient(respond=always_dies))
        expire_lease(batch)
    done = jobs.process(jobs.claim_next("w3"), FakeModelClient())
    assert done.status == BatchStatus.FAILED and done.failure_category == "WORKER_LOST"
    assert done.chunks.get().status == ChunkStatus.FAILED and done.recovered_count == 2
    assert done.last_error == jobs.error_message("WORKER_LOST")


def test_a_worker_that_lost_its_lease_cannot_commit(author):
    """Fencing: a paused worker whose batch was taken over writes nothing when it wakes up."""
    batch = submit(author, count=5)
    zombie = jobs.claim_next("zombie")
    rescuer = {}

    def paused_then_overtaken(request):
        expire_lease(batch)
        rescuer["claim"] = jobs.claim_next("rescuer")
        return chunk_output(request.fake_hints["count"])

    jobs.process(zombie, FakeModelClient(respond=paused_then_overtaken))
    assert Question.objects.filter(batch=batch).count() == 0
    assert rescuer["claim"].recovered
    done = jobs.process(rescuer["claim"], FakeModelClient())
    assert (
        done.status == BatchStatus.SUCCEEDED and Question.objects.filter(batch=batch).count() == 5
    )


def test_a_chunk_slot_can_never_hold_two_questions(author, fake):
    done = generation.run_batch(submit(author, count=1).pk)
    stored = Question.objects.get(batch=done)
    with pytest.raises(IntegrityError), transaction.atomic():
        jobs.store_question(
            done, stored.chunk, stored.chunk_position, chunk_output(1)["questions"][0]
        )
    assert Question.objects.filter(batch=done).count() == 1


def test_graceful_stop_hands_the_batch_back_without_losing_work(author, fake):
    batch = submit(author, count=10)
    stops = iter([False, True])
    jobs.process(jobs.claim_next("w1"), should_stop=lambda: next(stops))
    batch.refresh_from_db()
    assert batch.status == BatchStatus.RUNNING and batch.lease_owner == ""
    assert batch.produced_count == 5 and jobs.display_state(batch) == "Waiting for a worker"
    claim = jobs.claim_next("w2")  # immediately claimable, and not a recovery
    assert claim and not claim.recovered
    done = jobs.process(claim)
    assert (
        done.status == BatchStatus.SUCCEEDED and Question.objects.filter(batch=done).count() == 10
    )


@pytest.mark.django_db(transaction=True)
def test_a_batch_runs_outside_any_transaction_as_the_thread_mode_does(author):
    """The old thread path stored questions outside a transaction, where run_validation's
    select_for_update raises. Every write is now inside the chunk's own transaction."""
    from apps.ai.providers import override_model_client

    batch = generation.create_batch(author, params(count=6))
    with override_model_client(FakeModelClient()):
        done = generation.run_batch(batch.pk)
    assert done.status == BatchStatus.SUCCEEDED and Question.objects.filter(batch=done).count() == 6


@pytest.mark.django_db(transaction=True)
def test_the_heartbeat_extends_the_lease_during_a_long_call(author, settings):
    import time

    settings.LAI_STUDIO_HEARTBEAT_SECONDS = 0.05
    batch = generation.create_batch(author, params(count=1))
    claim = jobs.claim_next("w1")
    first_beat = GenerationBatch.objects.get(pk=batch.pk).heartbeat_at
    beats = []

    def slow(request):
        time.sleep(0.4)
        beats.append(GenerationBatch.objects.get(pk=batch.pk).heartbeat_at)
        return chunk_output(1)

    done = jobs.process(claim, FakeModelClient(respond=slow))
    assert done.status == BatchStatus.SUCCEEDED
    assert beats and beats[0] > first_beat


# --- retries and backoff ----------------------------------------------------------------------


def test_backoff_is_exponential_and_capped(settings):
    settings.LAI_STUDIO_RETRY_BACKOFF_SECONDS = 30
    settings.LAI_STUDIO_RETRY_BACKOFF_MAX_SECONDS = 100
    assert [jobs.backoff(n).total_seconds() for n in (1, 2, 3, 4)] == [30, 60, 100, 100]


def test_a_retryable_failure_parks_the_batch_until_its_backoff(author):
    batch = submit(author, count=5)
    client = FakeModelClient([ProviderTimeout()])
    before = now()
    parked = jobs.process(jobs.claim_next("w1"), client)
    chunk = parked.chunks.get()
    assert parked.status == BatchStatus.RUNNING and parked.lease_owner == ""
    assert chunk.status == ChunkStatus.PENDING and chunk.attempts == 1
    assert chunk.failure_category == "TIMEOUT" and chunk.next_attempt_at >= before + timedelta(
        seconds=29
    )
    assert parked.lease_expires_at == chunk.next_attempt_at
    assert jobs.display_state(parked) == "Waiting to retry"
    assert jobs.claim_next("w2") is None  # not before the backoff

    GenerationChunk.objects.filter(pk=chunk.pk).update(next_attempt_at=now() - timedelta(1))
    expire_lease(batch)
    claim = jobs.claim_next("w2")
    assert claim and not claim.recovered
    done = jobs.process(claim, client)
    assert done.status == BatchStatus.SUCCEEDED and done.chunks.get().attempts == 2
    assert done.attempts == 2


def test_retries_stop_at_the_attempt_budget(author, settings):
    settings.LAI_STUDIO_MAX_ATTEMPTS = 3
    client = FakeModelClient([ProviderError("THROTTLED")] * 10)
    done = generation.run_batch(submit(author, count=5).pk, client=client)
    assert done.status == BatchStatus.FAILED and len(client.requests) == 3
    chunk = done.chunks.get()
    assert chunk.status == ChunkStatus.FAILED and chunk.attempts == 3
    assert chunk.last_error == jobs.error_message("THROTTLED")


def test_partial_failure_then_staff_retry_completes_without_duplicates(author, operator, settings):
    settings.LAI_STUDIO_MAX_ATTEMPTS = 1
    client = FakeModelClient([chunk_output(5, 0), ProviderError("THROTTLED")])
    batch = generation.create_batch(operator, params(count=10))
    partial = generation.run_batch(batch.pk, client=client)
    assert partial.status == BatchStatus.PARTIALLY_FAILED and partial.produced_count == 5
    assert partial.failure_category == "THROTTLED"
    kept = set(Question.objects.filter(batch=batch).values_list("pk", flat=True))

    assert jobs.retry_failed(batch.pk, operator) == 1
    queued = GenerationBatch.objects.get(pk=batch.pk)
    assert queued.status == BatchStatus.QUEUED and queued.retry_count == 1
    assert queued.failure_category == "" and queued.finished_at is None
    failed_chunk = queued.chunks.get(index=1)
    assert failed_chunk.status == ChunkStatus.PENDING and failed_chunk.max_attempts == 2

    retry_client = FakeModelClient()
    done = generation.run_batch(batch.pk, client=retry_client)
    assert done.status == BatchStatus.SUCCEEDED and done.produced_count == 10
    assert len(retry_client.requests) == 1  # the succeeded chunk was not run again
    assert Question.objects.filter(batch=batch).count() == 10
    assert kept <= set(Question.objects.filter(batch=batch).values_list("pk", flat=True))
    assert len(set(stems(done))) == 10


def test_staff_retry_is_permissioned_bounded_and_only_for_failed_batches(
    author, operator, settings
):
    settings.LAI_STUDIO_MAX_BATCH_RETRIES = 1
    settings.LAI_STUDIO_MAX_ATTEMPTS = 1
    batch = generation.create_batch(operator, params(count=5))
    generation.run_batch(batch.pk, client=FakeModelClient([ProviderError("ACCESS_DENIED")]))
    with pytest.raises(jobs.QueueError) as refused:
        jobs.retry_failed(batch.pk, author)  # no retry permission
    assert refused.value.code == "not_permitted"
    jobs.retry_failed(batch.pk, operator)
    generation.run_batch(batch.pk, client=FakeModelClient([ProviderError("ACCESS_DENIED")]))
    with pytest.raises(jobs.QueueError) as refused:
        jobs.retry_failed(batch.pk, operator)
    assert refused.value.code == "retry_limit"

    ok = generation.run_batch(generation.create_batch(operator, params(count=1)).pk, client=None)
    with pytest.raises(jobs.QueueError) as refused:
        jobs.retry_failed(ok.pk, operator)
    assert ok.status == BatchStatus.SUCCEEDED and refused.value.code == "not_retryable"


def test_staff_retry_honours_the_kill_switch(operator, settings):
    from apps.ai.models import AIServiceControl
    from apps.ai.services.usage import clear_control_cache

    settings.LAI_STUDIO_MAX_ATTEMPTS = 1
    batch = generation.create_batch(operator, params(count=5))
    generation.run_batch(batch.pk, client=FakeModelClient([ProviderError("THROTTLED")]))
    AIServiceControl.objects.update_or_create(pk=1, defaults={"model_calls_enabled": False})
    clear_control_cache()
    with pytest.raises(jobs.QueueError) as refused:
        jobs.retry_failed(batch.pk, operator)
    assert refused.value.code == "kill_switch"
    assert GenerationBatch.objects.get(pk=batch.pk).status == BatchStatus.FAILED


def test_a_batch_stopping_failure_leaves_the_rest_retryable(author, operator):
    batch = generation.create_batch(operator, params(count=15))
    done = generation.run_batch(batch.pk, client=FakeModelClient([ProviderError("ACCESS_DENIED")]))
    assert done.status == BatchStatus.FAILED and done.chunks_done == 1
    assert list(done.chunks.values_list("failure_category", flat=True)) == [
        "ACCESS_DENIED",
        "NOT_RUN",
        "NOT_RUN",
    ]
    assert jobs.retry_failed(batch.pk, operator) == 3
    assert generation.run_batch(batch.pk, client=FakeModelClient()).status == BatchStatus.SUCCEEDED


def test_a_changed_prompt_version_stops_a_queued_batch(author, fake, monkeypatch):
    batch = submit(author)
    monkeypatch.setattr("apps.question_studio.prompts.PROMPT_VERSION", "studio-q-v999")
    done = generation.run_batch(batch.pk)
    assert done.status == BatchStatus.FAILED and done.failure_category == "PROMPT_CHANGED"
    assert not fake.requests


# --- cancellation -----------------------------------------------------------------------------


def test_cancelling_a_queued_batch_is_immediate(author, operator, fake):
    batch = submit(author)
    with pytest.raises(jobs.QueueError):
        jobs.request_cancel(batch.pk, author)  # no cancel permission
    assert jobs.request_cancel(batch.pk, operator) == "cancelled"
    batch.refresh_from_db()
    assert batch.status == BatchStatus.CANCELLED and batch.cancelled_by == operator
    assert set(batch.chunks.values_list("status", flat=True)) == {ChunkStatus.CANCELLED}
    assert jobs.claim_next("w1") is None
    with pytest.raises(jobs.QueueError) as again:
        jobs.request_cancel(batch.pk, operator)
    assert again.value.code == "already_finished" and not fake.requests


def test_cancelling_a_running_batch_stops_it_before_the_next_chunk(author, operator):
    batch = submit(author, count=15)
    claim = jobs.claim_next("w1")
    outcomes = []

    def cancel_during_first_call(request):
        if not outcomes:
            outcomes.append(jobs.request_cancel(batch.pk, operator))
        return chunk_output(request.fake_hints["count"], request.fake_hints["offset"])

    client = FakeModelClient(respond=cancel_during_first_call)
    done = jobs.process(claim, client)
    assert outcomes == ["cancelling"] and len(client.requests) == 1
    assert done.status == BatchStatus.CANCELLED and done.produced_count == 5
    assert list(done.chunks.values_list("status", flat=True)) == [
        ChunkStatus.SUCCEEDED,
        ChunkStatus.CANCELLED,
        ChunkStatus.CANCELLED,
    ]
    # The chunk that finished keeps its drafts; nothing is published.
    assert set(Question.objects.filter(batch=done).values_list("review_status", flat=True)) <= {
        ReviewStatus.NEEDS_REVIEW,
        ReviewStatus.DRAFT,
    }


def test_cancelling_a_stalled_batch_is_immediate_and_fences_the_old_worker(author, operator):
    batch = submit(author, count=5)
    claim = jobs.claim_next("w1")
    expire_lease(batch)
    assert jobs.display_state(GenerationBatch.objects.get(pk=batch.pk)) == "Stalled"
    assert jobs.request_cancel(batch.pk, operator) == "cancelled"
    done = jobs.process(claim, FakeModelClient())
    assert done.status == BatchStatus.CANCELLED and not Question.objects.filter(batch=batch)


# --- legacy rows ------------------------------------------------------------------------------


def legacy_batch(author, **fields):
    batch = GenerationBatch.objects.create(
        requested_by=author,
        subject="MATH",
        grade="3",
        topic="multiplication",
        skill_code="multiplication-facts",
        difficulty="MIXED",
        question_type="MULTIPLE_CHOICE",
        requested_count=10,
        prompt_version=generation.prompts.PROMPT_VERSION,
        schema_version=1,
        chunks_total=2,
    )
    GenerationBatch.objects.filter(pk=batch.pk).update(**fields)
    return GenerationBatch.objects.get(pk=batch.pk)


def test_a_batch_stored_before_the_queue_gets_chunks_when_claimed(author, fake):
    legacy_batch(author)
    done = jobs.process(jobs.claim_next("w1"))
    assert done.status == BatchStatus.SUCCEEDED and done.chunks.count() == 2
    assert Question.objects.filter(batch=done).count() == 10


def test_a_stranded_thread_batch_resumes_after_its_finished_chunks(author, fake):
    legacy_batch(
        author,
        status=BatchStatus.RUNNING,
        started_at=now() - timedelta(hours=1),
        lease_owner="legacy-thread",
        lease_expires_at=now() - timedelta(minutes=45),
        chunks_done=1,
        produced_count=5,
    )
    claim = jobs.claim_next("w1")
    assert claim.recovered
    done = jobs.process(claim)
    assert done.status == BatchStatus.SUCCEEDED and done.produced_count == 10
    assert len(fake.requests) == 1  # only the chunk the thread never ran


@pytest.mark.django_db(transaction=True)
def test_migration_renames_statuses_and_gives_stranded_batches_a_lease(author):
    from django.db.migrations.executor import MigrationExecutor

    executor = MigrationExecutor(connection)
    executor.migrate([("question_studio", "0001_initial")])
    old = (
        MigrationExecutor(connection).loader.project_state(("question_studio", "0001_initial")).apps
    )
    Batch = old.get_model("question_studio", "GenerationBatch")
    common = dict(
        subject="MATH",
        grade="3",
        topic="multiplication",
        difficulty="MIXED",
        question_type="NUMERIC",
        requested_count=1,
        prompt_version="v",
        schema_version=1,
    )
    started = now() - timedelta(minutes=5)
    done = Batch.objects.create(status="COMPLETED", **common)
    partial = Batch.objects.create(status="PARTIAL", **common)
    stranded = Batch.objects.create(status="RUNNING", started_at=started, **common)

    MigrationExecutor(connection).migrate([("question_studio", "0002_job_queue")])
    rows = {b.pk: b for b in GenerationBatch.objects.all()}
    assert rows[done.pk].status == BatchStatus.SUCCEEDED
    assert rows[partial.pk].status == BatchStatus.PARTIALLY_FAILED
    assert rows[stranded.pk].lease_owner == "legacy-thread"
    assert rows[stranded.pk].lease_expires_at == started + timedelta(minutes=15)

    MigrationExecutor(connection).migrate([("question_studio", "0001_initial")])
    reverted = old.get_model("question_studio", "GenerationBatch").objects
    assert reverted.get(pk=done.pk).status == "COMPLETED"
    assert reverted.get(pk=partial.pk).status == "PARTIAL"
    MigrationExecutor(connection).migrate(MigrationExecutor(connection).loader.graph.leaf_nodes())


# --- privacy of operational logs --------------------------------------------------------------


def test_queue_logs_carry_ids_and_counts_never_prompts_notes_or_output(author, caplog):
    caplog.set_level("DEBUG", logger="lai.studio")
    output = chunk_output(2)
    secret_stem = output["questions"][0]["stem"]
    batch = generation.create_batch(author, params(count=2, notes="SECRET-STAFF-NOTE"))
    generation.run_batch(batch.pk, client=FakeModelClient([ProviderTimeout(), output]))
    text = caplog.text
    assert "event=finished" in text and str(batch.pk) in text
    assert "SECRET-STAFF-NOTE" not in text and secret_stem not in text
    assert "multiplication" not in text  # not even the request's topic
