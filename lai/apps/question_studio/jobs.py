"""The Question Studio background queue (LAI-AQS-027, ADR-052).

PostgreSQL is the queue: a `GenerationBatch` is the job, its `GenerationChunk` rows are the work
items, and a worker owns a batch only while it holds a lease on it.

- **Claiming** runs under one advisory transaction lock with `SELECT ... FOR UPDATE SKIP LOCKED`,
  so two workers never take the same batch, and the running-batch cap holds across workers.
- **Leases and heartbeats.** A claim stamps a fresh `lease_token` and an expiry. The owner renews
  it at every step and from a heartbeat thread during a model call. When a worker dies, its lease
  runs out and the next claim takes the batch over ("recovered"), returning the chunk that was
  in flight to the pending queue.
- **Fencing.** Every write a worker makes re-reads the locked batch and checks its token. A worker
  that lost its lease (paused, partitioned, or overtaken) cannot commit anything.
- **Idempotent results.** A chunk's questions, its SUCCEEDED status and the batch counters commit
  in one transaction, and each question holds a unique (chunk, position) slot. A crash before the
  commit loses only that chunk's model call; a crash after it loses nothing; and no path stores a
  slot twice.
- **Retries.** A retryable failure puts the chunk back as PENDING with exponential backoff until
  its attempt budget is spent. A worker parks a batch whose remaining chunks are all waiting
  (lease cleared, expiry = the next retry time) instead of sleeping on it. Staff can retry a
  finished batch's FAILED chunks; SUCCEEDED chunks are never re-run.
- **Cancellation** is cooperative: a running owner sees the request before its next chunk.

Nothing here logs a prompt, staff notes, model output or an exception message: ids, counts,
statuses and failure categories only (ADR-025).
"""

from __future__ import annotations

import logging
import threading
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta

from django.conf import settings
from django.db import close_old_connections, connection, transaction
from django.db.models import Q
from django.utils.timezone import now

from apps.ai.providers.base import ModelClient, ModelRequest, ProviderError
from apps.ai.services.costs import estimate_microusd
from apps.ai.services.usage import model_calls_enabled

from . import contracts, prompts, taxonomy, validation
from .models import (
    BatchStatus,
    ChunkStatus,
    GenerationBatch,
    GenerationChunk,
    Question,
    ReviewEvent,
    ReviewStatus,
    StudioLimits,
    ValidationStatus,
)

logger = logging.getLogger("lai.studio.queue")

# Arbitrary constant keys for pg_advisory_xact_lock (cf. catalog.importer.IMPORT_LOCK_KEY).
CLAIM_LOCK_KEY = 0x5157_0001  # one claim decision at a time, so the running cap holds
SUBMIT_LOCK_KEY = 0x5157_0002  # one submission at a time, so the daily quotas hold

RETRYABLE = frozenset({"TIMEOUT", "THROTTLED", "UNAVAILABLE", "INVALID_RESPONSE", "TRUNCATED"})
# Retrying the rest of the batch against these only costs more; they stop the batch.
STOPS_BATCH = frozenset(
    {"CONFIGURATION", "ACCESS_DENIED", "GUARDRAIL", "DISABLED", "INTERNAL", "PROMPT_CHANGED"}
)

# Fixed staff-facing messages per failure category. Nothing from a provider error or a model
# response ever reaches `last_error`.
ERROR_MESSAGES = {
    "TIMEOUT": "The model did not answer in time.",
    "THROTTLED": "The model service asked us to slow down.",
    "UNAVAILABLE": "The model service was unavailable.",
    "INVALID_RESPONSE": "The model's answer did not have the expected shape.",
    "TRUNCATED": "The model's answer was cut off.",
    "CONFIGURATION": "The model is not configured correctly for this environment.",
    "ACCESS_DENIED": "This environment is not allowed to call the model.",
    "GUARDRAIL": "The safety Guardrail blocked the request or the answer.",
    "DISABLED": "AI generation is not configured in this environment.",
    "KILL_SWITCH": "AI model calls were switched off.",
    "GENERATION_DISABLED": "Generation was switched off in Studio limits.",
    "TOKEN_QUOTA": "The daily token limit was reached.",
    "WORKER_LOST": "The worker stopped while running this chunk too many times.",
    "NOT_RUN": "Not run: an earlier chunk failed in a way that stops the batch.",
    "PROMPT_CHANGED": "The prompt version changed after this batch was queued.",
    "SHORT_RESPONSE": "The model returned fewer questions than asked.",
    "INTERNAL": "An internal error stopped this chunk. See the worker log.",
}


def error_message(category: str) -> str:
    return ERROR_MESSAGES.get(category, "Generation failed.") if category else ""


class QueueError(Exception):
    """A refused queue operation. `code` is stable; the message is for staff."""

    def __init__(self, code: str, message: str = ""):
        super().__init__(message or code)
        self.code = code


class LeaseLost(Exception):
    """This worker no longer owns the batch; whatever it was about to write is discarded."""


@dataclass(frozen=True)
class Claim:
    batch_id: uuid.UUID
    token: uuid.UUID
    worker_id: str
    recovered: bool = False


def _lease_seconds() -> timedelta:
    return timedelta(seconds=settings.LAI_STUDIO_LEASE_SECONDS)


def backoff(attempt: int) -> timedelta:
    """Delay before attempt `attempt + 1`: base * 2^(attempt - 1), capped."""
    base = settings.LAI_STUDIO_RETRY_BACKOFF_SECONDS
    seconds = min(base * (2 ** max(0, attempt - 1)), settings.LAI_STUDIO_RETRY_BACKOFF_MAX_SECONDS)
    return timedelta(seconds=seconds)


def chunk_attempt_budget() -> int:
    return max(1, settings.LAI_STUDIO_MAX_ATTEMPTS)


# --- chunks -----------------------------------------------------------------------------------


def chunk_sizes(requested: int) -> list[int]:
    size = max(1, settings.LAI_STUDIO_CHUNK_SIZE)
    return [min(size, requested - start) for start in range(0, requested, size)]


def create_chunks(batch: GenerationBatch) -> None:
    budget = chunk_attempt_budget()
    GenerationChunk.objects.bulk_create(
        GenerationChunk(batch=batch, index=index, size=size, max_attempts=budget)
        for index, size in enumerate(chunk_sizes(batch.requested_count))
    )


def ensure_chunks(batch: GenerationBatch) -> None:
    """Give a batch stored before the queue existed its chunk rows. The first `chunks_done`
    chunks already ran on the old thread path and count as done, so they are not re-run; their
    questions keep no chunk slot. Call with the batch row locked."""
    if batch.chunks.exists():
        return
    create_chunks(batch)
    if batch.chunks_done:
        batch.chunks.filter(index__lt=batch.chunks_done).update(
            status=ChunkStatus.SUCCEEDED, finished_at=now()
        )
    if batch.chunks_total != batch.chunks.count():
        batch.chunks_total = batch.chunks.count()
        batch.save(update_fields=["chunks_total"])


# --- claiming ---------------------------------------------------------------------------------


def _claimable(at: datetime) -> Q:
    return Q(status=BatchStatus.QUEUED) | Q(status=BatchStatus.RUNNING, lease_expires_at__lt=at)


def live_running_count(at: datetime | None = None) -> int:
    at = at or now()
    return (
        GenerationBatch.objects.filter(status=BatchStatus.RUNNING, lease_expires_at__gte=at)
        .exclude(lease_owner="")
        .count()
    )


def claim_next(worker_id: str) -> Claim | None:
    """Take the oldest claimable batch, or None when there is none or the running cap is full."""
    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_advisory_xact_lock(%s)", [CLAIM_LOCK_KEY])
        at = now()
        if live_running_count(at) >= settings.LAI_STUDIO_MAX_RUNNING_BATCHES:
            return None
        batch = (
            GenerationBatch.objects.select_for_update(skip_locked=True)
            .filter(_claimable(at))
            .order_by("created_at")
            .first()
        )
        return _take(batch, worker_id, at) if batch else None


def claim_batch(batch_id, worker_id: str) -> Claim | None:
    """Take one named batch if it is claimable (QUEUED, or RUNNING with an expired lease).

    Used by the in-process run modes and `studio_run_batch --id`; it does not count against the
    running cap, which governs the background workers."""
    with transaction.atomic():
        at = now()
        batch = (
            GenerationBatch.objects.select_for_update(skip_locked=True)
            .filter(_claimable(at), pk=batch_id)
            .first()
        )
        return _take(batch, worker_id, at) if batch else None


def _take(batch: GenerationBatch, worker_id: str, at: datetime) -> Claim:
    recovered = batch.status == BatchStatus.RUNNING and bool(batch.lease_owner)
    if recovered:
        batch.recovered_count += 1
        # The previous owner's chunk in flight is returned to the queue; its attempt is spent, so
        # a chunk that crashes every worker that runs it ends FAILED instead of looping forever.
        for chunk in batch.chunks.select_for_update().filter(status=ChunkStatus.RUNNING):
            chunk.claim_token = None
            if chunk.attempts >= chunk.max_attempts:
                _fail_chunk(chunk, "WORKER_LOST", at)
                batch.failure_category = batch.failure_category or "WORKER_LOST"
            else:
                chunk.status = ChunkStatus.PENDING
                chunk.next_attempt_at = None
                chunk.save(update_fields=["status", "claim_token", "next_attempt_at"])
        logger.warning(
            "studio.queue event=recovered batch=%s worker=%s previous=%s recoveries=%s",
            batch.pk,
            worker_id,
            batch.lease_owner,
            batch.recovered_count,
        )
    ensure_chunks(batch)
    sync_counts(batch)
    token = uuid.uuid4()
    if batch.status == BatchStatus.QUEUED:
        batch.status = BatchStatus.RUNNING
    batch.started_at = batch.started_at or at
    batch.lease_token = token
    batch.lease_owner = worker_id[:120]
    batch.lease_expires_at = at + _lease_seconds()
    batch.heartbeat_at = at
    batch.claim_count += 1
    batch.save()
    logger.info(
        "studio.queue event=claimed batch=%s worker=%s claims=%s",
        batch.pk,
        worker_id,
        batch.claim_count,
    )
    return Claim(batch.pk, token, worker_id, recovered)


def _locked_batch(claim: Claim) -> GenerationBatch:
    """The batch, row-locked, if this claim still owns it. Call inside a transaction."""
    batch = GenerationBatch.objects.select_for_update().get(pk=claim.batch_id)
    if batch.status != BatchStatus.RUNNING or batch.lease_token != claim.token:
        raise LeaseLost
    return batch


def _renew(batch: GenerationBatch, at: datetime) -> None:
    batch.lease_expires_at = at + _lease_seconds()
    batch.heartbeat_at = at


def heartbeat(claim: Claim) -> bool:
    """Extend the lease. False when the claim no longer owns the batch."""
    at = now()
    return bool(
        GenerationBatch.objects.filter(
            pk=claim.batch_id, status=BatchStatus.RUNNING, lease_token=claim.token
        ).update(lease_expires_at=at + _lease_seconds(), heartbeat_at=at)
    )


def release(claim: Claim) -> bool:
    """Give the batch back at once (graceful shutdown): still RUNNING, no owner, immediately
    claimable. Its pending chunks lose nothing."""
    at = now()
    with transaction.atomic():
        try:
            batch = _locked_batch(claim)
        except LeaseLost:
            return False
        batch.lease_token = None
        batch.lease_owner = ""
        batch.lease_expires_at = at
        batch.save(update_fields=["lease_token", "lease_owner", "lease_expires_at"])
    logger.info("studio.queue event=released batch=%s worker=%s", claim.batch_id, claim.worker_id)
    return True


class _Heartbeat:
    """Renews the lease from a thread while a model call is in flight. Its first write is one
    heartbeat interval after the start, so a call shorter than that never touches the row."""

    def __init__(self, claim: Claim):
        self.claim = claim
        self.lost = False
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True, name="studio-heartbeat")

    def __enter__(self):
        self._thread.start()
        return self

    def __exit__(self, *exc):
        self._stop.set()
        self._thread.join(timeout=10)

    def _run(self):
        try:
            while not self._stop.wait(settings.LAI_STUDIO_HEARTBEAT_SECONDS):
                if not heartbeat(self.claim):
                    self.lost = True
                    logger.warning(
                        "studio.queue event=lease_lost batch=%s worker=%s",
                        self.claim.batch_id,
                        self.claim.worker_id,
                    )
                    return
        except Exception as error:  # a failed heartbeat must not kill the worker
            logger.error("studio.queue event=heartbeat_error type=%s", type(error).__name__)
        finally:
            close_old_connections()
            connection.close()


# --- processing -------------------------------------------------------------------------------


@dataclass
class _Outcome:
    items: list | None = None
    failure: str = ""
    input_tokens: int = 0
    output_tokens: int = 0


def params_of(batch: GenerationBatch) -> contracts.GenerationParams:
    return contracts.GenerationParams(
        subject=batch.subject,
        grade=batch.grade,
        topic=batch.topic,
        difficulty=batch.difficulty,
        question_type=batch.question_type,
        count=batch.requested_count,
        skill_code=batch.skill_code,
        include_hints=batch.include_hints,
        include_explanations=batch.include_explanations,
        notes=batch.notes,
    )


def _call(client: ModelClient, batch: GenerationBatch, chunk: GenerationChunk) -> _Outcome:
    """One model call for one chunk. Never raises for a provider failure."""
    params = params_of(batch)
    offset = sum(
        batch.chunks.filter(index__lt=chunk.index).values_list("size", flat=True)
    )  # deterministic per chunk, so a re-run asks for the same slots
    request = ModelRequest(
        route="studio",
        system_prompt=prompts.SYSTEM_PROMPT,
        content=prompts.build_content(
            params,
            chunk.size,
            island=batch.world.title if batch.world_id else "",
            adventure=batch.adventure.title if batch.adventure_id else "",
        ),
        output_schema=contracts.QUESTION_OUTPUT_SCHEMA,
        schema_name="question_batch",
        max_output_tokens=settings.LAI_STUDIO_MAX_OUTPUT_TOKENS,
        temperature=settings.LAI_STUDIO_TEMPERATURE,
        fake_hints={"studio": True, "count": chunk.size, "params": params, "offset": offset},
    )
    try:
        response = client.invoke(request)
    except ProviderError as error:
        return _Outcome(failure=error.category)
    outcome = _Outcome(
        input_tokens=response.input_tokens or 0, output_tokens=response.output_tokens or 0
    )
    if response.guardrail_intervened:
        outcome.failure = "GUARDRAIL"
        return outcome
    output = response.output
    questions = output.get("questions") if isinstance(output, dict) else None
    if not isinstance(questions, list):
        outcome.failure = "INVALID_RESPONSE"
        return outcome
    outcome.items = questions
    return outcome


def store_question(
    batch: GenerationBatch, chunk: GenerationChunk | None, position: int | None, item: object
) -> Question:
    """One draft from one untrusted item: validated, never published (LAI-AQS-009)."""
    params = params_of(batch)
    fields = contracts.parse_item(item, params)
    if params.difficulty != taxonomy.MIXED:
        fields["difficulty"] = params.difficulty
    question = Question.objects.create(
        batch=batch,
        chunk=chunk,
        chunk_position=position,
        subject=batch.subject,
        grade=batch.grade,
        topic=batch.topic,
        skill_code=batch.skill_code,
        question_type=batch.question_type,
        world_id=batch.world_id,
        location_id=batch.location_id,
        adventure_id=batch.adventure_id,
        source_model=batch.model_id,
        prompt_version=batch.prompt_version,
        generated_at=now(),
        **fields,
    )
    validation.run_validation(question)
    question.refresh_from_db()
    # A draft with a blocking finding stays a plain draft; a clean one waits for a reviewer.
    if question.validation_status != ValidationStatus.FAIL:
        question.review_status = ReviewStatus.NEEDS_REVIEW
        question.save(update_fields=["review_status", "updated_at"])
    ReviewEvent.objects.create(
        question=question,
        actor=batch.requested_by,
        action="generated",
        to_status=question.review_status,
        note=f"batch {batch.pk}",
    )
    return question


def _fail_chunk(chunk: GenerationChunk, category: str, at: datetime) -> None:
    chunk.status = ChunkStatus.FAILED
    chunk.failure_category = category
    chunk.last_error = error_message(category)
    chunk.finished_at = at
    chunk.next_attempt_at = None
    chunk.claim_token = None
    chunk.save()


def _fail_pending(batch: GenerationBatch, category: str, at: datetime) -> int:
    """Fail every chunk not yet run (kill switch, quota, a batch-stopping failure). They were never
    attempted, so they do not count as done and staff can retry them later."""
    return batch.chunks.filter(status=ChunkStatus.PENDING).update(
        status=ChunkStatus.FAILED,
        failure_category=category,
        last_error=error_message(category),
        finished_at=at,
        next_attempt_at=None,
    )


def sync_counts(batch: GenerationBatch) -> None:
    """`chunks_done` is the number of chunks that ran to a result (stored, or failed after at
    least one attempt; a chunk failed without a call does not count). Derived, never counted up,
    so retries and recoveries cannot skew it."""
    batch.chunks_done = batch.chunks.filter(
        Q(status=ChunkStatus.SUCCEEDED) | Q(status=ChunkStatus.FAILED, attempts__gt=0)
    ).count()


def _tokens_today() -> int:
    from .generation import tokens_today

    return tokens_today()


def _gate(batch: GenerationBatch) -> str:
    """Why the batch may not make another model call now, or ''."""
    if batch.prompt_version != prompts.PROMPT_VERSION:
        return "PROMPT_CHANGED"
    if not model_calls_enabled():
        return "KILL_SWITCH"
    limits = StudioLimits.current()
    if not limits.generation_enabled:
        return "GENERATION_DISABLED"
    if _tokens_today() >= limits.max_tokens_per_day:
        return "TOKEN_QUOTA"
    return ""


def finish(batch: GenerationBatch, at: datetime | None = None) -> GenerationBatch:
    """Settle a locked batch whose chunks are all finished (or which was cancelled)."""
    at = at or now()
    if batch.cancel_requested_at:
        batch.chunks.filter(status__in=[ChunkStatus.PENDING, ChunkStatus.RUNNING]).update(
            status=ChunkStatus.CANCELLED, finished_at=at, claim_token=None, next_attempt_at=None
        )
        batch.status = BatchStatus.CANCELLED
    else:
        statuses = set(batch.chunks.values_list("status", flat=True))
        if batch.produced_count >= batch.requested_count and statuses <= {ChunkStatus.SUCCEEDED}:
            batch.status = BatchStatus.SUCCEEDED
        elif batch.produced_count:
            batch.status = BatchStatus.PARTIALLY_FAILED
        else:
            batch.status = BatchStatus.FAILED
        if batch.status != BatchStatus.SUCCEEDED and not batch.failure_category:
            batch.failure_category = "SHORT_RESPONSE"
    sync_counts(batch)
    batch.last_error = error_message(batch.failure_category)
    batch.finished_at = at
    batch.lease_token = None
    batch.lease_owner = ""
    batch.lease_expires_at = None
    batch.cost_microusd = estimate_microusd(batch.input_tokens, batch.output_tokens)
    batch.save()
    logger.info(
        "studio.queue event=finished batch=%s status=%s produced=%s/%s attempts=%s failure=%s",
        batch.pk,
        batch.status,
        batch.produced_count,
        batch.requested_count,
        batch.attempts,
        batch.failure_category or "-",
    )
    return batch


def _next_step(claim: Claim, honor_backoff: bool) -> tuple[str, GenerationChunk | None]:
    """Decide and record the next step under the batch lock.

    Returns ("run", chunk) with the chunk marked RUNNING and its attempt counted; ("park", None)
    when every remaining chunk is waiting out a backoff; or ("done", None) once settled."""
    with transaction.atomic():
        batch = _locked_batch(claim)
        at = now()
        if batch.cancel_requested_at:
            finish(batch, at)
            return "done", None
        pending = batch.chunks.select_for_update().filter(status=ChunkStatus.PENDING)
        if not pending.exists():
            finish(batch, at)
            return "done", None
        if gate := _gate(batch):
            _fail_pending(batch, gate, at)
            batch.failure_category = batch.failure_category or gate
            finish(batch, at)
            return "done", None
        ready = pending
        if honor_backoff:
            ready = pending.filter(Q(next_attempt_at__isnull=True) | Q(next_attempt_at__lte=at))
        chunk = ready.order_by("index").first()
        if chunk is None:  # all waiting: hand the batch back until the earliest retry
            wake = pending.order_by("next_attempt_at").values_list("next_attempt_at", flat=True)[0]
            batch.lease_token = None
            batch.lease_owner = ""
            batch.lease_expires_at = wake
            batch.save(update_fields=["lease_token", "lease_owner", "lease_expires_at"])
            logger.info("studio.queue event=parked batch=%s until=%s", batch.pk, wake.isoformat())
            return "park", None
        chunk.status = ChunkStatus.RUNNING
        chunk.attempts += 1
        chunk.claim_token = claim.token
        chunk.started_at = at
        chunk.next_attempt_at = None
        chunk.save()
        batch.attempts += 1
        _renew(batch, at)
        batch.save(update_fields=["attempts", "lease_expires_at", "heartbeat_at"])
        return "run", chunk


def _record(claim: Claim, chunk_id: int, outcome: _Outcome) -> None:
    """Commit one chunk call's result, or nothing at all if this claim lost the batch."""
    with transaction.atomic():
        batch = _locked_batch(claim)
        chunk = GenerationChunk.objects.select_for_update().get(pk=chunk_id)
        if chunk.status != ChunkStatus.RUNNING or chunk.claim_token != claim.token:
            raise LeaseLost
        at = now()
        chunk.input_tokens += outcome.input_tokens
        chunk.output_tokens += outcome.output_tokens
        batch.input_tokens += outcome.input_tokens
        batch.output_tokens += outcome.output_tokens
        chunk.claim_token = None
        if outcome.items is not None:
            for position, item in enumerate(outcome.items[: chunk.size]):
                store_question(batch, chunk, position, item)
            chunk.produced_count = min(len(outcome.items), chunk.size)
            chunk.status = ChunkStatus.SUCCEEDED
            chunk.failure_category = ""
            chunk.last_error = ""
            chunk.finished_at = at
            batch.produced_count += chunk.produced_count
        elif outcome.failure in RETRYABLE and chunk.attempts < chunk.max_attempts:
            chunk.status = ChunkStatus.PENDING
            chunk.failure_category = outcome.failure
            chunk.last_error = error_message(outcome.failure)
            chunk.next_attempt_at = at + backoff(chunk.attempts)
        else:
            chunk.status = ChunkStatus.FAILED
            chunk.failure_category = outcome.failure
            chunk.last_error = error_message(outcome.failure)
            chunk.finished_at = at
            batch.failure_category = batch.failure_category or outcome.failure
            if outcome.failure in STOPS_BATCH:
                _fail_pending(batch, "NOT_RUN", at)
        chunk.save()
        sync_counts(batch)
        _renew(batch, at)
        batch.save()
    logger.info(
        "studio.queue event=chunk batch=%s chunk=%s status=%s attempt=%s/%s failure=%s",
        claim.batch_id,
        chunk.index,
        chunk.status,
        chunk.attempts,
        chunk.max_attempts,
        outcome.failure or "-",
    )


def _record_internal_error(claim: Claim, chunk_id: int, error: Exception) -> None:
    """A bug while storing a chunk: its transaction rolled back; fail the chunk and the batch's
    remaining work so nothing is left RUNNING. The exception text is never stored or logged."""
    logger.error(
        "studio.queue event=internal_error batch=%s type=%s", claim.batch_id, type(error).__name__
    )
    with transaction.atomic():
        batch = _locked_batch(claim)
        chunk = GenerationChunk.objects.select_for_update().get(pk=chunk_id)
        at = now()
        if chunk.status == ChunkStatus.RUNNING:
            _fail_chunk(chunk, "INTERNAL", at)
        _fail_pending(batch, "NOT_RUN", at)
        sync_counts(batch)
        batch.failure_category = batch.failure_category or "INTERNAL"
        _renew(batch, at)
        batch.save()


def _fail_everything(claim: Claim, category: str) -> None:
    with transaction.atomic():
        batch = _locked_batch(claim)
        at = now()
        _fail_pending(batch, category, at)
        batch.failure_category = batch.failure_category or category
        finish(batch, at)


def _resolve_client(client: ModelClient | None) -> tuple[ModelClient | None, str]:
    if client is not None:
        return client, ""
    from .generation import studio_client

    try:
        resolved = studio_client()
    except ProviderError as error:
        return None, error.category
    return resolved, "" if resolved is not None else "DISABLED"


def process(
    claim: Claim,
    client: ModelClient | None = None,
    *,
    honor_backoff: bool = True,
    should_stop: Callable[[], bool] = lambda: False,
    on_chunk: Callable[[], None] = lambda: None,
) -> GenerationBatch:
    """Run a claimed batch until it is settled, parked for a backoff, or the worker is stopping.

    `honor_backoff=False` retries a failed chunk at once (the in-process run modes, which have
    no later pass to come back on)."""
    try:
        client, problem = _resolve_client(client)
        if problem:
            _fail_everything(claim, problem)
            return GenerationBatch.objects.get(pk=claim.batch_id)
        with transaction.atomic():
            batch = _locked_batch(claim)
            if batch.model_id != client.model_id:
                batch.model_id = client.model_id
                batch.save(update_fields=["model_id"])
        while True:
            if should_stop():
                release(claim)
                break
            step, chunk = _next_step(claim, honor_backoff)
            if step != "run":
                break
            batch = GenerationBatch.objects.get(pk=claim.batch_id)
            with _Heartbeat(claim):
                outcome = _call(client, batch, chunk)
            try:
                _record(claim, chunk.pk, outcome)
            except LeaseLost:
                raise  # nothing was written; handled below
            except Exception as error:
                _record_internal_error(claim, chunk.pk, error)
            on_chunk()
    except LeaseLost:
        logger.warning(
            "studio.queue event=lease_lost batch=%s worker=%s discarded=chunk",
            claim.batch_id,
            claim.worker_id,
        )
    return GenerationBatch.objects.get(pk=claim.batch_id)


# --- staff operations -------------------------------------------------------------------------


def _staff_may(user, codename: str) -> bool:
    return bool(
        user and user.is_active and user.is_staff and user.has_perm(f"question_studio.{codename}")
    )


def lease_is_live(batch: GenerationBatch, at: datetime | None = None) -> bool:
    at = at or now()
    return bool(batch.lease_owner and batch.lease_expires_at and batch.lease_expires_at >= at)


def request_cancel(batch_id, user) -> str:
    """Cancel a queued batch at once, or ask a running one's worker to stop before its next chunk.

    Returns "cancelled" or "cancelling". A batch no worker currently owns (stalled, or waiting out
    a backoff) is cancelled at once: clearing its lease also fences off a worker that might still
    wake up holding it. Questions already stored stay as drafts."""
    if not _staff_may(user, "cancel_generationbatch"):
        raise QueueError("not_permitted", "You may not cancel generation batches.")
    with transaction.atomic():
        batch = GenerationBatch.objects.select_for_update().get(pk=batch_id)
        if batch.is_terminal:
            raise QueueError("already_finished", "This batch has already finished.")
        at = now()
        if batch.cancel_requested_at is None:
            batch.cancel_requested_at = at
            batch.cancelled_by = user
        if batch.status == BatchStatus.RUNNING and lease_is_live(batch, at):
            batch.save(update_fields=["cancel_requested_at", "cancelled_by"])
            outcome = "cancelling"
        else:
            finish(batch, at)
            outcome = "cancelled"
    logger.info(
        "studio.queue event=cancel batch=%s staff=%s outcome=%s", batch_id, user.pk, outcome
    )
    return outcome


def retry_failed(batch_id, user) -> int:
    """Queue a finished batch's FAILED chunks again. SUCCEEDED chunks and their questions are
    untouched, so a retry can never duplicate them. Returns the number of chunks queued."""
    if not _staff_may(user, "retry_generationbatch"):
        raise QueueError("not_permitted", "You may not retry generation batches.")
    with transaction.atomic():
        batch = GenerationBatch.objects.select_for_update().get(pk=batch_id)
        if batch.status not in (BatchStatus.FAILED, BatchStatus.PARTIALLY_FAILED):
            raise QueueError("not_retryable", "Only a failed or partially failed batch can retry.")
        failed = batch.chunks.select_for_update().filter(status=ChunkStatus.FAILED)
        count = failed.count()
        if not count:
            raise QueueError("nothing_to_retry", "This batch has no failed chunks to retry.")
        if batch.retry_count >= settings.LAI_STUDIO_MAX_BATCH_RETRIES:
            raise QueueError("retry_limit", "This batch has been retried as often as allowed.")
        if batch.prompt_version != prompts.PROMPT_VERSION:
            raise QueueError(
                "prompt_changed", "The prompt changed since this batch; generate a new batch."
            )
        if not model_calls_enabled():
            raise QueueError("kill_switch", "AI model calls are switched off.")
        limits = StudioLimits.current()
        if not limits.generation_enabled:
            raise QueueError("generation_disabled", "Generation is switched off.")
        if _tokens_today() >= limits.max_tokens_per_day:
            raise QueueError("daily_token_quota", "Daily token limit reached.")
        budget = chunk_attempt_budget()
        for chunk in failed:
            chunk.status = ChunkStatus.PENDING
            chunk.max_attempts = chunk.attempts + budget
            chunk.next_attempt_at = None
            chunk.finished_at = None
            chunk.failure_category = ""
            chunk.last_error = ""
            chunk.save()
        sync_counts(batch)
        batch.status = BatchStatus.QUEUED
        batch.retry_count += 1
        batch.failure_category = ""
        batch.last_error = ""
        batch.finished_at = None
        batch.lease_token = None
        batch.lease_owner = ""
        batch.lease_expires_at = None
        batch.save()
    logger.info(
        "studio.queue event=retry batch=%s staff=%s chunks=%s round=%s",
        batch_id,
        user.pk,
        count,
        batch.retry_count,
    )
    return count


def display_state(batch: GenerationBatch, at: datetime | None = None) -> str:
    """What Admin shows: the status, or a finer state of a RUNNING batch."""
    at = at or now()
    if batch.status != BatchStatus.RUNNING:
        if batch.status == BatchStatus.QUEUED and batch.cancel_requested_at:
            return "Cancelling"
        return batch.get_status_display()
    if batch.cancel_requested_at:
        return "Cancelling"
    if not batch.lease_owner:
        if batch.lease_expires_at and batch.lease_expires_at > at:
            return "Waiting to retry"
        return "Waiting for a worker"
    if batch.lease_expires_at and batch.lease_expires_at < at:
        return "Stalled"
    return "Running"
