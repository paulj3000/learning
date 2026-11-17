"""Bedrock question generation (LAI-AQS-005 to 009).

Reuses the ADR-044 model client, Guardrail, structured output, kill switch and cost estimate.
Nothing here imports boto3 or knows an AWS credential. It does not use `run_turn`, which is
child-bound (child limits, child-keyed audit): a staff batch records its own provenance, tokens
and estimated cost on `GenerationBatch`. Questions are only ever stored as drafts; nothing here
publishes (LAI-AQS-009).
"""

import logging
import threading
from dataclasses import dataclass
from datetime import timedelta

from django.conf import settings
from django.db import IntegrityError, close_old_connections, transaction
from django.db.models import Sum
from django.utils.timezone import now

from apps.ai.providers import get_model_client
from apps.ai.providers.base import ModelClient, ModelRequest
from apps.ai.services.costs import estimate_microusd
from apps.ai.services.usage import model_calls_enabled
from apps.jobs.core import envelope as job_envelope
from apps.jobs.core import tasks as job_tasks

from . import contracts, prompts, taxonomy, validation
from .models import (
    BatchStatus,
    GenerationBatch,
    Question,
    ReviewEvent,
    ReviewStatus,
    StudioLimits,
    ValidationStatus,
)

logger = logging.getLogger("lai.studio")

STALE_RUNNING = timedelta(minutes=15)
# One rule set for every runner (thread, inline, manual and the background jobs).
RETRYABLE = job_tasks.STUDIO_RETRYABLE
# A chunk failing like this stops the batch: retrying every chunk against a broken setup only
# costs more.
STOP_FAILURES = frozenset({"CONFIGURATION", "ACCESS_DENIED", "GUARDRAIL"})
#: Staff retries of one batch's missing questions.
MAX_RETRIES = 3

# Fixed staff-facing text per failure category (taken from LAI-AQS-027). Admin shows only these:
# nothing from a provider error, a job's worker or a model response ever reaches it.
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
    "TOKEN_QUOTA": "The daily token limit was reached.",
    "MODEL_NOT_APPROVED": "The worker's model is not on the approved list.",
    "JOBS_UNAVAILABLE": "The background job service could not take the next part.",
    "JOB_TIMEOUT": "A background job did not report back in time.",
    "INTERNAL": "An internal error stopped this batch. See the server log.",
}


def failure_message(batch: GenerationBatch) -> str:
    """The sanitized reason a finished batch fell short ("" when it did not)."""
    if batch.status == BatchStatus.CANCELLED:
        return "Cancelled by staff. Questions already stored stay as drafts."
    category = batch.failure_category
    if category:
        if category in ERROR_MESSAGES:
            return ERROR_MESSAGES[category]
        if category.startswith("JOB_"):
            return "The background worker reported a failure."
        return "Generation failed."
    if batch.status == BatchStatus.PARTIAL:
        return "The model returned fewer questions than asked."
    if batch.status == BatchStatus.FAILED:
        return "Generation failed."
    return ""


class StudioError(Exception):
    code = "studio_error"


class NotPermitted(StudioError):
    code = "not_permitted"


class GenerationRefused(StudioError):
    """A request refused before any model call. `code` is stable; the message is for staff."""

    def __init__(self, code: str, message: str = ""):
        super().__init__(message or code)
        self.code = code


class DuplicateSubmission(StudioError):
    """The same Generate form was submitted again; `batch` is the one the first submit made."""

    code = "duplicate_submission"

    def __init__(self, batch: GenerationBatch):
        super().__init__(self.code)
        self.batch = batch


def may_generate(user) -> bool:
    return bool(
        user
        and user.is_active
        and user.is_staff
        and user.has_perm("question_studio.add_generationbatch")
    )


def approved_model_ids() -> list[str]:
    return settings.LAI_STUDIO_APPROVED_MODEL_IDS or [settings.LAI_AI_MODEL_ID]


def studio_model_id() -> str:
    return settings.LAI_STUDIO_MODEL_ID or settings.LAI_AI_MODEL_ID


def studio_client() -> ModelClient | None:
    """The ADR-044 client. In Bedrock mode only the timeout differs (authoring calls are longer);
    the adapter, region, Guardrail and retry policy are the shared ones."""
    from apps.ai.providers import _override  # the test override wins, as everywhere

    if _override is not None or settings.LAI_AI_PROVIDER != "bedrock":
        return get_model_client()
    from apps.ai.providers.bedrock import BedrockModelClient

    return BedrockModelClient(
        region=settings.LAI_AI_BEDROCK_REGION,
        model_id=studio_model_id(),
        guardrail_id=settings.LAI_AI_GUARDRAIL_ID,
        guardrail_version=settings.LAI_AI_GUARDRAIL_VERSION,
        timeout_seconds=settings.LAI_STUDIO_TIMEOUT_SECONDS,
        structured_output=settings.LAI_AI_STRUCTURED_OUTPUT,
        max_attempts=settings.LAI_AI_MAX_ATTEMPTS,
    )


def _day_start():
    return now().replace(hour=0, minute=0, second=0, microsecond=0)


def tokens_today() -> int:
    totals = GenerationBatch.objects.filter(created_at__gte=_day_start()).aggregate(
        i=Sum("input_tokens"), o=Sum("output_tokens")
    )
    return (totals["i"] or 0) + (totals["o"] or 0)


def _submitted(user, submission_key) -> GenerationBatch | None:
    if submission_key is None:
        return None
    return GenerationBatch.objects.filter(requested_by=user, submission_key=submission_key).first()


def create_batch(
    user, params: contracts.GenerationParams, *, submission_key=None
) -> GenerationBatch:
    """Check permission, input and limits, then store a QUEUED batch. Makes no model call.

    `submission_key` (one per rendered Generate form) makes a resubmit raise
    `DuplicateSubmission` carrying the first batch, before any limit is counted again."""
    if not may_generate(user):
        raise NotPermitted
    if earlier := _submitted(user, submission_key):
        raise DuplicateSubmission(earlier)
    if problems := params.problems():
        raise contracts.InvalidGenerationRequest(problems)
    if studio_model_id() not in approved_model_ids():
        raise GenerationRefused(
            "model_not_approved", "The configured model is not on the approved list."
        )
    limits = StudioLimits.current()
    if not limits.generation_enabled:
        raise GenerationRefused(
            "generation_disabled", "Generation is switched off in Studio limits."
        )
    if not model_calls_enabled():
        raise GenerationRefused("kill_switch", "AI model calls are switched off.")
    if params.count > limits.max_questions_per_batch:
        raise GenerationRefused(
            "batch_too_large", f"At most {limits.max_questions_per_batch} questions per batch."
        )
    today = GenerationBatch.objects.filter(created_at__gte=_day_start())
    if today.filter(requested_by=user).count() >= limits.max_batches_per_user_per_day:
        raise GenerationRefused("user_quota", "Daily batch limit reached for this account.")
    requested = today.aggregate(n=Sum("requested_count"))["n"] or 0
    if requested + params.count > limits.max_questions_per_day:
        raise GenerationRefused("daily_question_quota", "Daily question limit reached.")
    if tokens_today() >= limits.max_tokens_per_day:
        raise GenerationRefused("daily_token_quota", "Daily token limit reached.")

    world_id, location_id = params.world_id, params.location_id
    if params.adventure_id:
        from apps.catalog.models import Adventure

        adventure = Adventure.objects.filter(pk=params.adventure_id).first()
        if adventure is None:
            raise contracts.InvalidGenerationRequest(["unknown_adventure"])
        world_id = world_id or adventure.world_id
        location_id = location_id or adventure.location_id
    fields = dict(
        requested_by=user,
        subject=params.subject,
        grade=params.grade,
        topic=params.topic,
        skill_code=params.skill_code,
        difficulty=params.difficulty,
        question_type=params.question_type,
        requested_count=params.count,
        include_hints=params.include_hints,
        include_explanations=params.include_explanations,
        world_id=world_id,
        location_id=location_id,
        adventure_id=params.adventure_id,
        notes=params.notes,
        prompt_version=prompts.PROMPT_VERSION,
        schema_version=contracts.OUTPUT_SCHEMA_VERSION,
        model_id=studio_model_id(),
        chunks_total=_chunks_for(params.count),
        submission_key=submission_key,
    )
    try:
        with transaction.atomic():
            return GenerationBatch.objects.create(**fields)
    except IntegrityError:
        # Two submits of the same form raced past the check above; the first one won.
        if earlier := _submitted(user, submission_key):
            raise DuplicateSubmission(earlier) from None
        raise


def _chunks_for(count: int) -> int:
    return -(-count // max(1, settings.LAI_STUDIO_CHUNK_SIZE))


def start_batch(batch: GenerationBatch) -> None:
    """Hand a QUEUED batch to the configured runner without holding the admin request."""
    mode = settings.LAI_STUDIO_RUN_MODE
    if mode == "inline":
        run_batch(batch.pk)
    elif mode == "thread":
        threading.Thread(target=_run_in_thread, args=(batch.pk,), daemon=True).start()
    elif mode == "jobs":
        start_jobs(batch.pk)
    # "manual": `manage.py studio_run_batch` picks it up.


def _run_in_thread(batch_id) -> None:
    try:
        run_batch(batch_id)
    finally:
        close_old_connections()


def _params_of(batch: GenerationBatch) -> contracts.GenerationParams:
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


@dataclass
class _Chunk:
    items: list
    input_tokens: int = 0
    output_tokens: int = 0
    attempts: int = 0
    failure: str = ""


def _claim(batch_id) -> tuple[GenerationBatch, bool]:
    """Move a QUEUED (or stale RUNNING) batch to RUNNING. (batch, False) if it is not ours."""
    with transaction.atomic():
        batch = GenerationBatch.objects.select_for_update().get(pk=batch_id)
        stale = (
            batch.status == BatchStatus.RUNNING
            and batch.started_at
            and now() - batch.started_at > STALE_RUNNING
        )
        if batch.status != BatchStatus.QUEUED and not stale:
            return batch, False
        batch.status = BatchStatus.RUNNING
        batch.started_at = now()
        batch.save(update_fields=["status", "started_at"])
    return batch, True


def run_batch(batch_id, client: ModelClient | None = None) -> GenerationBatch:
    """Generate a queued batch chunk by chunk. A failed chunk loses only itself (partial
    success); a stale RUNNING batch is reclaimed; a finished batch is left alone."""
    batch, claimed = _claim(batch_id)
    if not claimed:
        return batch
    try:
        _generate(batch, client)
    except Exception as error:  # a bug must not leave a batch RUNNING; log the type only (ADR-025)
        logger.error("studio.batch internal_error type=%s", type(error).__name__)
        batch.failure_category = "INTERNAL"
    return _finish(batch)


def _context(batch: GenerationBatch) -> tuple[contracts.GenerationParams, str, str]:
    island = batch.world.title if batch.world_id else ""
    setting = batch.adventure.title if batch.adventure_id else ""
    return _params_of(batch), island, setting


# --- slots ------------------------------------------------------------------------------------
#
# A batch fills slots 0 to requested_count - 1; a stored draft holds its slot under a unique
# (batch, slot) constraint. Every chunk fills one contiguous window of empty slots,
# [start, start + want), so the window is fully described by the job payload (`requested_before`
# is its start, `want` its size). A run walks a cursor upwards: the next window starts at the
# first empty slot at or above the cursor and stops at a filled slot or the chunk size; the
# cursor then moves past it whether or not the model filled it all. A first run therefore asks
# for slots in order, exactly as before; a staff retry starts at 0 again and so asks only for the
# slots still empty (failed chunks and short answers). A result applied twice finds its window
# taken and stores nothing.


def _taken_slots(batch: GenerationBatch) -> set[int]:
    return set(
        Question.objects.filter(batch=batch, slot__isnull=False).values_list("slot", flat=True)
    )


def _window(batch: GenerationBatch, cursor: int, limit: int) -> list[int]:
    taken = _taken_slots(batch)
    start = next((s for s in range(cursor, batch.requested_count) if s not in taken), None)
    if start is None:
        return []
    window = []
    for slot in range(start, min(batch.requested_count, start + limit)):
        if slot in taken:
            break
        window.append(slot)
    return window


def _chunk_size() -> int:
    return max(1, settings.LAI_STUDIO_CHUNK_SIZE)


def cancel_requested(batch: GenerationBatch) -> bool:
    """Re-read the cancel request: staff set it from another request while this one runs."""
    stamp = (
        GenerationBatch.objects.filter(pk=batch.pk)
        .values_list("cancel_requested_at", flat=True)
        .first()
    )
    if stamp is not None:
        batch.cancel_requested_at = stamp
    return stamp is not None


def _next_slots(batch: GenerationBatch, cursor: int) -> list[int]:
    """The slots the next chunk fills; [] when the batch is done or must stop.

    The per-chunk gates every runner shares: a staff cancel, the kill switch and the daily token
    quota."""
    slots = _window(batch, cursor, _chunk_size())
    if not slots or cancel_requested(batch):
        return []
    if not model_calls_enabled():
        batch.failure_category = batch.failure_category or "KILL_SWITCH"
        return []
    if tokens_today() >= StudioLimits.current().max_tokens_per_day:
        batch.failure_category = batch.failure_category or "TOKEN_QUOTA"
        return []
    return slots


def _apply_chunk(batch: GenerationBatch, params, chunk: _Chunk, slots: list[int]) -> bool:
    """Account for one chunk and store its drafts in `slots`. False when the batch must stop.

    Tokens and attempts always count (they were spent). A slot already holding a draft is
    skipped, so applying the same chunk twice never duplicates a question."""
    batch.attempts += chunk.attempts
    batch.input_tokens += chunk.input_tokens
    batch.output_tokens += chunk.output_tokens
    batch.chunks_done += 1
    if chunk.failure:
        batch.failure_category = batch.failure_category or chunk.failure
    taken = _taken_slots(batch)
    for slot, item in zip(slots, chunk.items, strict=False):
        if slot in taken:
            logger.warning("studio.batch id=%s slot_taken slot=%s", batch.pk, slot)
            continue
        try:
            with transaction.atomic():
                _store(batch, params, item, slot)
        except IntegrityError:
            logger.warning("studio.batch id=%s slot_taken slot=%s", batch.pk, slot)
            continue
        batch.produced_count += 1
    batch.save(
        update_fields=[
            "model_id",
            "attempts",
            "input_tokens",
            "output_tokens",
            "chunks_done",
            "produced_count",
            "failure_category",
        ]
    )
    return chunk.failure not in STOP_FAILURES


def _generate(batch: GenerationBatch, client: ModelClient | None) -> None:
    client = client or studio_client()
    if client is None:
        batch.failure_category = "DISABLED"
        return
    batch.model_id = client.model_id
    params, island, setting = _context(batch)
    cursor = 0
    while slots := _next_slots(batch, cursor):
        chunk = _call_chunk(
            client, params, len(slots), island, setting, offset=batch.produced_count
        )
        cursor = slots[-1] + 1
        if not _apply_chunk(batch, params, chunk, slots):
            break


def chunk_request(params, want, island, setting, *, offset: int = 0) -> ModelRequest:
    return ModelRequest(
        route="studio",
        system_prompt=prompts.SYSTEM_PROMPT,
        content=prompts.build_content(params, want, island=island, adventure=setting),
        output_schema=contracts.QUESTION_OUTPUT_SCHEMA,
        schema_name="question_batch",
        max_output_tokens=settings.LAI_STUDIO_MAX_OUTPUT_TOKENS,
        temperature=settings.LAI_STUDIO_TEMPERATURE,
        fake_hints={"studio": True, "count": want, "params": params, "offset": offset},
    )


def _chunk_from(data: dict) -> _Chunk:
    return _Chunk(
        items=list(data["items"]),
        input_tokens=data["input_tokens"],
        output_tokens=data["output_tokens"],
        attempts=data["attempts"],
        failure=data["failure"],
    )


def _call_chunk(client, params, want, island, setting, *, offset: int = 0) -> _Chunk:
    request = chunk_request(params, want, island, setting, offset=offset)
    return _chunk_from(
        job_tasks.call_chunk(lambda: client.invoke(request), settings.LAI_STUDIO_MAX_ATTEMPTS)
    )


# --- background jobs (LAI_STUDIO_RUN_MODE=jobs) -----------------------------------------------
#
# Each chunk is one `studio.generate_chunk` job, submitted only after the previous one was
# applied, so a batch never has two chunks in flight. The worker makes the model call(s) with the
# same attempt rules (`job_tasks.call_chunk`); the result is applied here by `_apply_chunk`, the
# same accounting the in-process runners use, and then the next chunk is submitted or the batch
# finished. The payload's `requested_before` is the first slot of the chunk's window and `want`
# its size, so the result handler knows exactly which slots it fills (the worker contract is
# unchanged).


def start_jobs(batch_id) -> GenerationBatch:
    batch, claimed = _claim(batch_id)
    if not claimed:
        return batch
    if settings.LAI_AI_PROVIDER == "disabled":
        batch.failure_category = "DISABLED"
        return _finish(batch)
    try:
        submit_next_chunk(batch, cursor=0)
    except Exception as error:  # noqa: BLE001 - never leave a batch RUNNING on a bug
        logger.error("studio.batch internal_error type=%s", type(error).__name__)
        batch.refresh_from_db()
        if batch.status == BatchStatus.RUNNING:
            batch.failure_category = "INTERNAL"
            _finish(batch)
    return GenerationBatch.objects.get(pk=batch_id)


def chunk_payload(batch: GenerationBatch, *, want: int, cursor: int) -> dict:
    params, island, setting = _context(batch)
    request = chunk_request(params, want, island, setting, offset=batch.produced_count)
    return {
        "batch_id": str(batch.pk),
        "chunk_index": batch.chunks_done,
        "want": want,
        "offset": batch.produced_count,
        "requested_before": cursor,
        "max_attempts": min(5, max(1, settings.LAI_STUDIO_MAX_ATTEMPTS)),
        "model_id": studio_model_id(),
        "request": {
            "route": request.route,
            "system_prompt": request.system_prompt,
            "content": [
                {"text": part.text, "untrusted": part.untrusted, "guarded": part.guarded}
                for part in request.content
            ],
            "output_schema": request.output_schema,
            "schema_name": request.schema_name,
            "max_output_tokens": request.max_output_tokens,
            "temperature": request.temperature,
        },
    }


def submit_next_chunk(batch: GenerationBatch, *, cursor: int) -> None:
    """Submit the next chunk job, or finish the batch when nothing is left or a gate (a staff
    cancel among them) stops it.

    With the inline jobs backend the job (and every later chunk) runs before this returns, so
    `batch` may be stale afterwards; callers reload it."""
    from apps.jobs import services as jobs

    slots = _next_slots(batch, cursor)
    if not slots:
        _finish(batch)
        return
    payload = chunk_payload(batch, want=len(slots), cursor=slots[0])
    try:
        jobs.submit(
            job_envelope.STUDIO_GENERATE_CHUNK, payload, user=batch.requested_by, subject=batch
        )
    except jobs.JobsError as error:
        logger.warning("studio.batch id=%s submit_refused code=%s", batch.pk, error.code)
        batch.failure_category = batch.failure_category or "JOBS_UNAVAILABLE"
        _finish(batch)


def job_failure_category(code: str) -> str:
    if code == "model_not_approved":
        return "MODEL_NOT_APPROVED"
    if code == "submit_failed":
        return "JOBS_UNAVAILABLE"
    return f"JOB_{code.upper()}"[:40]


def _count(value: object) -> int:
    return value if type(value) is int and 0 <= value <= 10_000_000 else 0


def apply_chunk_job(job) -> None:
    """The `studio.generate_chunk` result handler (runs inside the job's transaction)."""
    payload = job.payload
    batch = GenerationBatch.objects.select_for_update().filter(pk=payload.get("batch_id")).first()
    if batch is None or batch.status != BatchStatus.RUNNING:
        logger.info("studio.batch chunk_ignored job=%s reason=not_running", job.pk)
        return
    if payload.get("chunk_index") != batch.chunks_done:
        logger.warning("studio.batch chunk_ignored job=%s reason=out_of_order", job.pk)
        return
    want = payload["want"]
    start = payload["requested_before"]
    slots = list(range(start, min(batch.requested_count, start + want)))
    try:
        with transaction.atomic():
            if job.status != "completed":
                batch.failure_category = batch.failure_category or job_failure_category(
                    job.error_code or "failed"
                )
                go_on = False
            else:
                result = job.result or {}
                items = result.get("items")
                failure = result.get("failure")
                chunk = _Chunk(
                    items=items if isinstance(items, list) else [],
                    input_tokens=_count(result.get("input_tokens")),
                    output_tokens=_count(result.get("output_tokens")),
                    attempts=_count(result.get("attempts")),
                    failure=failure[:40] if isinstance(failure, str) else "INVALID_RESPONSE",
                )
                model_id = result.get("model_id")
                if isinstance(model_id, str) and model_id:
                    batch.model_id = model_id[:200]
                params = _params_of(batch)
                go_on = _apply_chunk(batch, params, chunk, slots)
    except Exception as error:  # a bug must not leave a batch RUNNING; log the type only
        logger.error("studio.batch internal_error type=%s", type(error).__name__)
        batch.refresh_from_db()
        batch.failure_category = "INTERNAL"
        _finish(batch)
        return
    if go_on:
        submit_next_chunk(batch, cursor=start + want)
    else:
        _finish(batch)


def _store(batch: GenerationBatch, params, item: object, slot: int | None = None) -> Question:
    fields = contracts.parse_item(item, params)
    if params.difficulty != taxonomy.MIXED:
        fields["difficulty"] = params.difficulty
    question = Question.objects.create(
        batch=batch,
        slot=slot,
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


def _finish(batch: GenerationBatch) -> GenerationBatch:
    """Record the final status. Under the row lock, so a staff cancel made meanwhile counts and a
    batch some other path already finished (a cancel of a stalled run) is left as it is."""
    with transaction.atomic():
        current = (
            GenerationBatch.objects.select_for_update()
            .only("status", "cancel_requested_at", "cancelled_by")
            .get(pk=batch.pk)
        )
        if current.is_terminal:
            logger.info("studio.batch id=%s already_finished status=%s", batch.pk, current.status)
            return current
        batch.cancel_requested_at = current.cancel_requested_at
        batch.cancelled_by_id = current.cancelled_by_id
        batch.finished_at = now()
        complete = batch.produced_count >= batch.requested_count and not batch.failure_category
        if complete:
            batch.status = BatchStatus.COMPLETED
        elif batch.cancel_requested_at:
            batch.status = BatchStatus.CANCELLED
        elif batch.produced_count:
            batch.status = BatchStatus.PARTIAL
        else:
            batch.status = BatchStatus.FAILED
        batch.cost_microusd = estimate_microusd(batch.input_tokens, batch.output_tokens)
        batch.save()
    logger.info(
        "studio.batch id=%s status=%s produced=%s/%s attempts=%s failure=%s",
        batch.pk,
        batch.status,
        batch.produced_count,
        batch.requested_count,
        batch.attempts,
        batch.failure_category or "-",
    )
    return batch


# --- staff cancel and retry ------------------------------------------------------------------


class BatchActionRefused(StudioError):
    """A refused cancel or retry. `code` is stable; the message is for staff."""

    def __init__(self, code: str, message: str = ""):
        super().__init__(message or code)
        self.code = code


def _staff_may(user, codename: str) -> bool:
    return bool(
        user and user.is_active and user.is_staff and user.has_perm(f"question_studio.{codename}")
    )


def may_cancel(user) -> bool:
    return _staff_may(user, "cancel_generationbatch")


def may_retry(user) -> bool:
    return _staff_may(user, "retry_generationbatch") and may_generate(user)


def _has_live_run(batch: GenerationBatch) -> bool:
    """Whether something is still working on a RUNNING batch and will see a cancel request.

    Jobs mode: a chunk job not yet finished (its result will be applied, then the batch ends).
    In-process modes: a run that started recently (a thread or the manual command checks
    between chunks); a stale one is cancelled at once."""
    from apps.jobs import services as jobs

    if jobs.unfinished_for(batch):
        return True
    if settings.LAI_STUDIO_RUN_MODE == "jobs":
        return False
    return bool(batch.started_at and now() - batch.started_at <= STALE_RUNNING)


def request_cancel(batch_id, user) -> str:
    """Cancel a batch: at once when nothing is running it ("cancelled"), otherwise before its next
    chunk ("cancelling"). A chunk already in flight is still accounted (its tokens were spent and
    its drafts are kept). Questions already stored stay as drafts."""
    if not may_cancel(user):
        raise NotPermitted
    with transaction.atomic():
        batch = GenerationBatch.objects.select_for_update().get(pk=batch_id)
        if batch.is_terminal:
            raise BatchActionRefused("already_finished", "This batch has already finished.")
        if batch.cancel_requested_at is None:
            batch.cancel_requested_at = now()
            batch.cancelled_by = user
            batch.save(update_fields=["cancel_requested_at", "cancelled_by"])
        if batch.status == BatchStatus.RUNNING and _has_live_run(batch):
            outcome = "cancelling"
        else:
            _finish(batch)
            outcome = "cancelled"
    logger.info("studio.batch id=%s cancel staff=%s outcome=%s", batch_id, user.pk, outcome)
    return outcome


def retry_batch(batch_id, user) -> tuple[GenerationBatch, int]:
    """Queue a FAILED or PARTIAL batch again for its empty slots only (failed chunks and short
    answers). Drafts already stored are never asked for again. Returns (batch, missing). The
    caller starts it (`start_batch`) after this commits."""
    if not may_retry(user):
        raise NotPermitted
    with transaction.atomic():
        batch = GenerationBatch.objects.select_for_update().get(pk=batch_id)
        if batch.status not in (BatchStatus.FAILED, BatchStatus.PARTIAL):
            raise BatchActionRefused(
                "not_retryable", "Only a failed or partly completed batch can be retried."
            )
        stored = Question.objects.filter(batch=batch)
        if stored.filter(slot__isnull=True).exists():
            raise BatchActionRefused(
                "legacy_batch", "This batch predates retries; generate a new batch instead."
            )
        missing = batch.requested_count - stored.count()
        if missing <= 0:
            raise BatchActionRefused("nothing_to_retry", "This batch has no missing questions.")
        if batch.retry_count >= MAX_RETRIES:
            raise BatchActionRefused("retry_limit", "This batch was retried as often as allowed.")
        if batch.prompt_version != prompts.PROMPT_VERSION:
            raise BatchActionRefused(
                "prompt_changed", "The prompt changed since this batch; generate a new batch."
            )
        if studio_model_id() not in approved_model_ids():
            raise BatchActionRefused("model_not_approved", "The configured model is not approved.")
        limits = StudioLimits.current()
        if not limits.generation_enabled:
            raise BatchActionRefused("generation_disabled", "Generation is switched off.")
        if not model_calls_enabled():
            raise BatchActionRefused("kill_switch", "AI model calls are switched off.")
        if tokens_today() >= limits.max_tokens_per_day:
            raise BatchActionRefused("daily_token_quota", "Daily token limit reached.")
        batch.status = BatchStatus.QUEUED
        batch.retry_count += 1
        batch.chunks_total += _chunks_for(missing)
        batch.failure_category = ""
        batch.finished_at = None
        batch.started_at = None
        batch.save(
            update_fields=[
                "status",
                "retry_count",
                "chunks_total",
                "failure_category",
                "finished_at",
                "started_at",
            ]
        )
    logger.info(
        "studio.batch id=%s retry staff=%s missing=%s round=%s",
        batch.pk,
        user.pk,
        missing,
        batch.retry_count,
    )
    return batch, missing
