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
from django.db import close_old_connections, transaction
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


class StudioError(Exception):
    code = "studio_error"


class NotPermitted(StudioError):
    code = "not_permitted"


class GenerationRefused(StudioError):
    """A request refused before any model call. `code` is stable; the message is for staff."""

    def __init__(self, code: str, message: str = ""):
        super().__init__(message or code)
        self.code = code


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


def create_batch(user, params: contracts.GenerationParams) -> GenerationBatch:
    """Check permission, input and limits, then store a QUEUED batch. Makes no model call."""
    if not may_generate(user):
        raise NotPermitted
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
    return GenerationBatch.objects.create(
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
        chunks_total=-(-params.count // max(1, settings.LAI_STUDIO_CHUNK_SIZE)),
    )


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


def _next_want(batch: GenerationBatch, requested_before: int) -> int:
    """How many questions the next chunk asks for; 0 when the batch is done or must stop.

    The per-chunk gates every runner shares: the kill switch and the daily token quota."""
    remaining = batch.requested_count - requested_before
    if remaining <= 0:
        return 0
    if not model_calls_enabled():
        batch.failure_category = batch.failure_category or "KILL_SWITCH"
        return 0
    if tokens_today() >= StudioLimits.current().max_tokens_per_day:
        batch.failure_category = batch.failure_category or "TOKEN_QUOTA"
        return 0
    return min(max(1, settings.LAI_STUDIO_CHUNK_SIZE), remaining)


def _apply_chunk(batch: GenerationBatch, params, chunk: _Chunk, want: int) -> bool:
    """Account for one chunk and store its drafts. False when the batch must stop here."""
    batch.attempts += chunk.attempts
    batch.input_tokens += chunk.input_tokens
    batch.output_tokens += chunk.output_tokens
    batch.chunks_done += 1
    if chunk.failure:
        batch.failure_category = batch.failure_category or chunk.failure
    for item in chunk.items[:want]:
        _store(batch, params, item)
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
    requested_before = 0
    while want := _next_want(batch, requested_before):
        chunk = _call_chunk(client, params, want, island, setting, offset=batch.produced_count)
        requested_before += want
        if not _apply_chunk(batch, params, chunk, want):
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
# finished.


def start_jobs(batch_id) -> GenerationBatch:
    batch, claimed = _claim(batch_id)
    if not claimed:
        return batch
    if settings.LAI_AI_PROVIDER == "disabled":
        batch.failure_category = "DISABLED"
        return _finish(batch)
    try:
        submit_next_chunk(batch, requested_before=0)
    except Exception as error:  # noqa: BLE001 - never leave a batch RUNNING on a bug
        logger.error("studio.batch internal_error type=%s", type(error).__name__)
        batch.refresh_from_db()
        if batch.status == BatchStatus.RUNNING:
            batch.failure_category = "INTERNAL"
            _finish(batch)
    return GenerationBatch.objects.get(pk=batch_id)


def chunk_payload(batch: GenerationBatch, *, want: int, requested_before: int) -> dict:
    params, island, setting = _context(batch)
    request = chunk_request(params, want, island, setting, offset=batch.produced_count)
    return {
        "batch_id": str(batch.pk),
        "chunk_index": batch.chunks_done,
        "want": want,
        "offset": batch.produced_count,
        "requested_before": requested_before,
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


def submit_next_chunk(batch: GenerationBatch, *, requested_before: int) -> None:
    """Submit the next chunk job, or finish the batch when nothing is left or a gate stops it.

    With the inline jobs backend the job (and every later chunk) runs before this returns, so
    `batch` may be stale afterwards; callers reload it."""
    from apps.jobs import services as jobs

    want = _next_want(batch, requested_before)
    if not want:
        _finish(batch)
        return
    payload = chunk_payload(batch, want=want, requested_before=requested_before)
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
                go_on = _apply_chunk(batch, params, chunk, want)
    except Exception as error:  # a bug must not leave a batch RUNNING; log the type only
        logger.error("studio.batch internal_error type=%s", type(error).__name__)
        batch.refresh_from_db()
        batch.failure_category = "INTERNAL"
        _finish(batch)
        return
    if go_on:
        submit_next_chunk(batch, requested_before=payload["requested_before"] + want)
    else:
        _finish(batch)


def _store(batch: GenerationBatch, params, item: object) -> Question:
    fields = contracts.parse_item(item, params)
    if params.difficulty != taxonomy.MIXED:
        fields["difficulty"] = params.difficulty
    question = Question.objects.create(
        batch=batch,
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
    batch.finished_at = now()
    complete = batch.produced_count >= batch.requested_count and not batch.failure_category
    if complete:
        batch.status = BatchStatus.COMPLETED
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
