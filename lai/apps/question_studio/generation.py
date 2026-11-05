"""Bedrock question generation (LAI-AQS-005 to 009).

Reuses the ADR-044 model client, Guardrail, structured output, kill switch and cost estimate.
Nothing here imports boto3 or knows an AWS credential. It does not use `run_turn`, which is
child-bound (child limits, child-keyed audit): a staff batch records its own provenance, tokens
and estimated cost on `GenerationBatch`. Questions are only ever stored as drafts; nothing here
publishes (LAI-AQS-009).
"""

import logging
import os
import socket
import threading
import uuid

from django.conf import settings
from django.db import close_old_connections, connection, transaction
from django.db.models import Sum
from django.utils.timezone import now

from apps.ai.providers import get_model_client
from apps.ai.providers.base import ModelClient
from apps.ai.services.usage import model_calls_enabled

from . import contracts, jobs, prompts
from .models import GenerationBatch, StudioLimits

logger = logging.getLogger("lai.studio")

RETRYABLE = jobs.RETRYABLE


class StudioError(Exception):
    code = "studio_error"


class NotPermitted(StudioError):
    code = "not_permitted"


class DuplicateSubmission(StudioError):
    """The same Generate form was submitted twice; `batch` is the one the first submit made."""

    code = "duplicate_submission"

    def __init__(self, batch: GenerationBatch):
        super().__init__("This request was already submitted.")
        self.batch = batch


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


def create_batch(
    user, params: contracts.GenerationParams, *, submission_key: uuid.UUID | None = None
) -> GenerationBatch:
    """Check permission, input and limits, then store a QUEUED batch and its chunks. Makes no
    model call.

    `submission_key` (one per rendered Generate form) makes a resubmit return the first batch
    as `DuplicateSubmission` instead of queuing a second one. Submissions are serialized by an
    advisory lock so two at once cannot both pass the daily quotas."""
    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_advisory_xact_lock(%s)", [jobs.SUBMIT_LOCK_KEY])
        return _create_batch(user, params, submission_key)


def _create_batch(user, params, submission_key) -> GenerationBatch:
    if not may_generate(user):
        raise NotPermitted
    if problems := params.problems():
        raise contracts.InvalidGenerationRequest(problems)
    if studio_model_id() not in approved_model_ids():
        raise GenerationRefused(
            "model_not_approved", "The configured model is not on the approved list."
        )
    if submission_key is not None:
        earlier = GenerationBatch.objects.filter(
            requested_by=user, submission_key=submission_key
        ).first()
        if earlier is not None:
            raise DuplicateSubmission(earlier)
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
    batch = GenerationBatch.objects.create(
        requested_by=user,
        submission_key=submission_key,
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
        chunks_total=len(jobs.chunk_sizes(params.count)),
    )
    jobs.create_chunks(batch)
    logger.info(
        "studio.queue event=submitted batch=%s staff=%s count=%s chunks=%s",
        batch.pk,
        user.pk,
        batch.requested_count,
        batch.chunks_total,
    )
    return batch


def start_batch(batch: GenerationBatch) -> None:
    """Hand a QUEUED batch to the configured runner without holding the admin request.

    `worker` and `manual` only leave it queued, for `manage.py studio_worker` or
    `studio_run_batch`. `thread` (development) and `inline` (tests) run it in this process but
    through the same claim and lease, so if this process dies a worker takes the batch over when
    the lease runs out."""
    mode = settings.LAI_STUDIO_RUN_MODE
    if mode == "inline":
        run_batch(batch.pk)
    elif mode == "thread":
        threading.Thread(target=_run_in_thread, args=(batch.pk,), daemon=True).start()


def _run_in_thread(batch_id) -> None:
    try:
        run_batch(batch_id)
    finally:
        close_old_connections()


def _in_process_worker_id() -> str:
    return f"in-process:{socket.gethostname()[:60]}:{os.getpid()}:{threading.get_ident()}"


def run_batch(batch_id, client: ModelClient | None = None) -> GenerationBatch:
    """Run one batch to the end in this process (the `inline` and `thread` modes, and
    `studio_run_batch --id`). Claims it like a worker would; a batch another worker holds, or one
    already finished, is returned untouched. Retries happen at once rather than after a backoff,
    since nothing would come back for a parked batch."""
    claim = jobs.claim_batch(batch_id, _in_process_worker_id())
    if claim is None:
        return GenerationBatch.objects.get(pk=batch_id)
    return jobs.process(claim, client, honor_backoff=False)
