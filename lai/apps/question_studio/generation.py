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
from apps.ai.providers.base import ModelClient, ModelRequest, ProviderError
from apps.ai.services.costs import estimate_microusd
from apps.ai.services.usage import model_calls_enabled

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
RETRYABLE = frozenset({"TIMEOUT", "THROTTLED", "UNAVAILABLE", "INVALID_RESPONSE", "TRUNCATED"})


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


def run_batch(batch_id, client: ModelClient | None = None) -> GenerationBatch:
    """Generate a queued batch chunk by chunk. A failed chunk loses only itself (partial
    success); a stale RUNNING batch is reclaimed; a finished batch is left alone."""
    with transaction.atomic():
        batch = GenerationBatch.objects.select_for_update().get(pk=batch_id)
        stale = (
            batch.status == BatchStatus.RUNNING
            and batch.started_at
            and now() - batch.started_at > STALE_RUNNING
        )
        if batch.status != BatchStatus.QUEUED and not stale:
            return batch
        batch.status = BatchStatus.RUNNING
        batch.started_at = now()
        batch.save(update_fields=["status", "started_at"])
    try:
        _generate(batch, client)
    except Exception as error:  # a bug must not leave a batch RUNNING; log the type only (ADR-025)
        logger.error("studio.batch internal_error type=%s", type(error).__name__)
        batch.failure_category = "INTERNAL"
    return _finish(batch)


def _generate(batch: GenerationBatch, client: ModelClient | None) -> None:
    client = client or studio_client()
    if client is None:
        batch.failure_category = "DISABLED"
        return
    batch.model_id = client.model_id
    params = _params_of(batch)
    island = batch.world.title if batch.world_id else ""
    setting = batch.adventure.title if batch.adventure_id else ""
    limits = StudioLimits.current()
    chunk_size = max(1, settings.LAI_STUDIO_CHUNK_SIZE)
    remaining = batch.requested_count
    while remaining > 0:
        if not model_calls_enabled():
            batch.failure_category = batch.failure_category or "KILL_SWITCH"
            break
        if tokens_today() >= limits.max_tokens_per_day:
            batch.failure_category = batch.failure_category or "TOKEN_QUOTA"
            break
        want = min(chunk_size, remaining)
        chunk = _call_chunk(client, params, want, island, setting, offset=batch.produced_count)
        batch.attempts += chunk.attempts
        batch.input_tokens += chunk.input_tokens
        batch.output_tokens += chunk.output_tokens
        batch.chunks_done += 1
        if chunk.failure:
            batch.failure_category = batch.failure_category or chunk.failure
        for item in chunk.items[:want]:
            _store(batch, params, item)
            batch.produced_count += 1
        remaining -= want
        batch.save(
            update_fields=[
                "attempts",
                "input_tokens",
                "output_tokens",
                "chunks_done",
                "produced_count",
                "failure_category",
            ]
        )
        if chunk.failure in {"CONFIGURATION", "ACCESS_DENIED", "GUARDRAIL"}:
            break  # retrying every chunk against a broken setup only costs more


def _call_chunk(client, params, want, island, setting, *, offset: int = 0) -> _Chunk:
    chunk = _Chunk(items=[])
    request = ModelRequest(
        route="studio",
        system_prompt=prompts.SYSTEM_PROMPT,
        content=prompts.build_content(params, want, island=island, adventure=setting),
        output_schema=contracts.QUESTION_OUTPUT_SCHEMA,
        schema_name="question_batch",
        max_output_tokens=settings.LAI_STUDIO_MAX_OUTPUT_TOKENS,
        temperature=settings.LAI_STUDIO_TEMPERATURE,
        fake_hints={"studio": True, "count": want, "params": params, "offset": offset},
    )
    for _ in range(max(1, settings.LAI_STUDIO_MAX_ATTEMPTS)):
        chunk.attempts += 1
        try:
            response = client.invoke(request)
        except ProviderError as error:
            chunk.failure = error.category
            if error.category not in RETRYABLE:
                return chunk
            continue
        chunk.input_tokens += response.input_tokens or 0
        chunk.output_tokens += response.output_tokens or 0
        if response.guardrail_intervened:
            chunk.failure = "GUARDRAIL"
            return chunk
        output = response.output
        questions = output.get("questions") if isinstance(output, dict) else None
        if not isinstance(questions, list):
            chunk.failure = "INVALID_RESPONSE"
            continue
        chunk.items, chunk.failure = questions, ""
        return chunk
    return chunk


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
