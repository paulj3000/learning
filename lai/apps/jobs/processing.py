"""Contract processing jobs: the Django side of the Wave 1 contracts (ADR-061, ADR-062).

Contract kinds (`asset.validate_model`, `reference.checksum`) live on the canonical
`ProcessingJob` table beside the legacy kinds, but their messages are the `lai_processing`
contracts and their lifecycle is `lai_processing.core.lifecycle`:

- `submit_processing_job` resolves the options against the profile, computes the idempotency
  key and, in one transaction, creates the job, attempt 1 and its outbox row. The same logical
  work submitted again returns the existing job.
- `relay_outbox` sends due outbox rows to the work queue (at least once; a crash between the
  send and the mark repeats the send, never loses it).
- `apply_completion` decodes a completion event, verifies it against Django's record, decides
  with `decide_completion` and persists the decision under the job row lock. The caller
  acknowledges the message only after this returns, i.e. after the commit.
- `cancel_job`, `requeue_job` and `reconcile` are the staff and maintenance transitions.

Every state change goes through `lifecycle.check_transition` on a row held by
`select_for_update`. Nothing here publishes an asset or changes an `AssetVersion`.

Logs carry job ids, attempt ids, kinds and codes only (ADR-025): never message bodies, keys,
metadata or findings.
"""

from __future__ import annotations

import dataclasses
import logging
import random
import uuid
from collections.abc import Callable, Mapping
from datetime import timedelta
from typing import Any

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.db import DatabaseError, IntegrityError, transaction
from django.utils.timezone import now as _now

from lai_processing.contracts.codec import (
    DEFAULT_MAX_MESSAGE_BYTES,
    decode_event,
    decode_result,
    encode,
)
from lai_processing.contracts.common import (
    AssetContext,
    InputObject,
    ObjectRef,
    ProfileRef,
    SubjectRef,
)
from lai_processing.contracts.events import CompletionEvent
from lai_processing.contracts.jobs import MAX_ATTEMPT_NUMBER, ProcessingJobRequest
from lai_processing.contracts.results import ProcessingJobResult, ResultStatus
from lai_processing.core.errors import ProcessingError
from lai_processing.core.idempotency import idempotency_key
from lai_processing.core.lifecycle import (
    CompletionAction,
    InvalidTransition,
    JobSnapshot,
    check_transition,
    decide_completion,
)
from lai_processing.core.registry import ProcessorRegistry, default_registry
from lai_processing.core.retry import RetryPolicy
from lai_processing.ports.queue import QueueFull
from lai_processing.ports.storage import StorageError
from lai_processing.ports.telemetry import LoggingTelemetry

from . import processing_transport as transport
from .models import (
    CONTRACT_KINDS,
    STATE_STATUS,
    AttemptOutcome,
    CompletionReceipt,
    JobArtifact,
    JobAttempt,
    JobOutbox,
    JobQueue,
    JobState,
    ProcessingJob,
)

logger = logging.getLogger("lai.jobs")

#: The largest by-reference result Django reads back (results are bounded far below this).
MAX_RESULT_BYTES = 4 * 1024 * 1024
#: The `action` of an undecodable or contract-invalid completion (never acknowledged).
INVALID = "invalid"
#: States in which a job may still be expired by `reconcile`.
_OPEN_STATES = (JobState.CREATED, JobState.UPLOADING, JobState.QUEUED, JobState.PROCESSING)
#: Highest delay, in seconds, between failed sends of one outbox row.
_MAX_SEND_BACKOFF = 900


class ProcessingJobsError(Exception):
    """A refused submission or staff action, with a safe code."""

    code = "processing_error"

    def __init__(self, code: str | None = None):
        super().__init__(code or self.code)
        if code:
            self.code = code


class ProcessingDisabled(ProcessingJobsError):
    code = "processing_disabled"


class CompletionDeferred(ProcessingJobsError):
    """A transient failure while applying a completion (database, result storage). Nothing was
    committed; the consumer releases the message with a backoff and must not acknowledge it."""

    code = "completion_deferred"


@dataclasses.dataclass(frozen=True, slots=True)
class CompletionOutcome:
    """What `apply_completion` did. `ack` is True when the message must be acknowledged (after
    the commit, which has already happened when this is returned)."""

    action: str
    ack: bool
    reason: str
    job_id: str | None = None


# --- configuration seams -----------------------------------------------------------------------

_registry: ProcessorRegistry | None = None
#: Jitter source for retry and send backoff (tests may seed it).
rng = random.Random()  # noqa: S311 - jitter, not security


def get_registry() -> ProcessorRegistry:
    """The processors and profiles this build ships (`default_registry()`, built once)."""
    global _registry
    if _registry is None:
        _registry = default_registry()
    return _registry


def set_registry_for_tests(registry: ProcessorRegistry | None) -> None:
    global _registry
    _registry = registry


def retry_policy() -> RetryPolicy:
    return RetryPolicy(max_attempts=settings.LAI_PROCESSING_MAX_ATTEMPTS)


def _namespace() -> str:
    return settings.LAI_PROCESSING_NAMESPACE


# --- completion hooks (WAVE3_INTERFACES section 3) ----------------------------------------------


@dataclasses.dataclass(frozen=True, slots=True)
class HookResult:
    """What a completion hook did. `code` is a safe outcome code stored on the job
    (`subject_outcome`); `review_ready` moves a VALIDATED job to READY_FOR_REVIEW."""

    code: str
    review_ready: bool = False


#: `hook(job, attempt, result) -> HookResult`, called inside the completion transaction, under the
#: job row lock, after an APPLY has been recorded. A hook may lock rows of its own app (always
#: after the job row: lock order job -> subject rows). It must not publish anything.
CompletionHook = Callable[[ProcessingJob, JobAttempt, ProcessingJobResult], HookResult]
_COMPLETION_HOOKS: dict[tuple[str, str], CompletionHook] = {}


def register_completion_hook(job_type: str, subject_type: str, hook: CompletionHook) -> None:
    """Register the hook for one (contract kind, subject type) pair, from an `AppConfig.ready()`.

    Explicit and deterministic: no discovery or dynamic import. Registering the same callable
    again is a no-op (a second `ready()`); a different callable for a registered pair is a
    configuration error, never a silent replacement."""
    if job_type not in CONTRACT_KINDS:
        raise ImproperlyConfigured(f"No contract kind {job_type!r} for a completion hook.")
    if not subject_type or len(subject_type) > 64:
        raise ImproperlyConfigured("A completion hook needs a subject type of 64 or fewer.")
    key = (job_type, subject_type)
    current = _COMPLETION_HOOKS.get(key)
    if current is not None and current is not hook:
        raise ImproperlyConfigured(f"Another completion hook is registered for {key!r}.")
    _COMPLETION_HOOKS[key] = hook


def completion_hook(job_type: str, subject_type: str) -> CompletionHook | None:
    return _COMPLETION_HOOKS.get((job_type, subject_type))


def set_completion_hooks_for_tests(
    hooks: Mapping[tuple[str, str], CompletionHook] | None,
) -> dict[tuple[str, str], CompletionHook]:
    """Replace the registered hooks (None: none); returns the previous ones for restoring."""
    previous = dict(_COMPLETION_HOOKS)
    _COMPLETION_HOOKS.clear()
    _COMPLETION_HOOKS.update(hooks or {})
    return previous


def _run_completion_hook(job: ProcessingJob, attempt: JobAttempt, result) -> None:
    """Run the subject's hook for an applied result, in a savepoint.

    A `DatabaseError` propagates: the whole completion rolls back and is redelivered
    (`CompletionDeferred`). Any other exception is a hook bug: its savepoint is rolled back, the job
    keeps the applied result with `subject_outcome = "hook_error"`, and an ERROR is logged, so one
    faulty hook can neither lose a valid completion nor loop it into the dead-letter queue."""
    hook = completion_hook(job.kind, job.subject_type)
    if hook is None:
        return
    try:
        with transaction.atomic():
            outcome = hook(job, attempt, result)
    except DatabaseError:
        raise
    except Exception as error:  # noqa: BLE001 - see the docstring
        job.subject_outcome = "hook_error"
        logger.error(
            "processing.hook_error job=%s kind=%s type=%s", job.pk, job.kind, type(error).__name__
        )
        return
    job.subject_outcome = str(outcome.code)[:64]
    if outcome.review_ready and job.state == JobState.VALIDATED:
        _set_state(job, JobState.READY_FOR_REVIEW)
    logger.info(
        "processing.subject_outcome job=%s kind=%s code=%s", job.pk, job.kind, job.subject_outcome
    )


# --- helpers -----------------------------------------------------------------------------------


def _set_state(job: ProcessingJob, target: str, *, manual: bool = False) -> None:
    """Move a locked job to `target` through the lifecycle table, keeping `status` in step."""
    job.state = check_transition(job.state, target, manual=manual).value
    job.status = STATE_STATUS[job.state]


def _locked(job_id) -> ProcessingJob | None:
    return ProcessingJob.objects.select_for_update().filter(pk=job_id).first()


def _correlation_id() -> str:
    from apps.core.request_context import VALID_REQUEST_ID, get_request_id

    current = get_request_id()
    if current and VALID_REQUEST_ID.fullmatch(current):
        return current
    return uuid.uuid4().hex


def _subject(value) -> SubjectRef:
    if isinstance(value, SubjectRef):
        return value
    if isinstance(value, tuple) and len(value) == 2:
        return SubjectRef(subject_type=str(value[0]), subject_id=str(value[1]))
    raise ProcessingJobsError("invalid_subject")


def _profile(value) -> ProfileRef:
    if isinstance(value, ProfileRef):
        return value
    if isinstance(value, tuple) and len(value) == 2:
        return ProfileRef(profile_id=value[0], version=value[1])
    raise ProcessingJobsError("invalid_profile")


def _input(value, namespace: str) -> InputObject | None:
    """An `InputObject` validated against `namespace`, from an `InputObject` or a mapping of
    store, key, version_id, sha256, size_bytes and content_type."""
    if value is None:
        return None
    if isinstance(value, InputObject):
        ref = value.ref
        return InputObject(
            ref=ObjectRef(ref.store, ref.key, ref.version_id, namespace),
            content_type=value.content_type,
            size_bytes=value.size_bytes,
            sha256=value.sha256,
        )
    if isinstance(value, Mapping):
        return InputObject(
            ref=ObjectRef(value["store"], value["key"], value.get("version_id"), namespace),
            content_type=value["content_type"],
            size_bytes=value["size_bytes"],
            sha256=value["sha256"],
        )
    raise ProcessingJobsError("invalid_input")


def _existing(namespace: str, key: str) -> ProcessingJob | None:
    return ProcessingJob.objects.filter(namespace=namespace, idempotency_key=key).first()


def _schedule_inline() -> None:
    if settings.LAI_PROCESSING_BACKEND == "inline":
        transaction.on_commit(run_inline, robust=True)


# --- submit ------------------------------------------------------------------------------------


def submit_processing_job(
    *,
    job_type: str,
    subject,
    input,  # noqa: A002 - the contract's name
    profile,
    options: Mapping[str, Any] | None = None,
    asset: AssetContext | None = None,
    user=None,
) -> ProcessingJob:
    """Create (or find) the job for one piece of logical work and queue its first attempt.

    `subject` is a `SubjectRef` or a (type, id) pair; `profile` a `ProfileRef` or an (id,
    version) pair; `input` an `InputObject`, a mapping (store, key, version_id, sha256,
    size_bytes, content_type) or None. Raises `ProcessingDisabled` when the backend is
    `disabled` and `ProcessingJobsError` (safe code) for an invalid request.
    """
    mode = settings.LAI_PROCESSING_BACKEND
    if mode == "disabled":
        raise ProcessingDisabled
    if job_type not in CONTRACT_KINDS:
        raise ProcessingJobsError("unknown_kind")
    if asset is not None and not isinstance(asset, AssetContext):
        raise ProcessingJobsError("invalid_asset")
    namespace = _namespace()
    try:
        subject_ref = _subject(subject)
        profile_ref = _profile(profile)
        input_obj = _input(input, namespace)
        processor, resolved_profile = get_registry().resolve(job_type, profile_ref)
        options_resolved = resolved_profile.resolve_options(dict(options or {}))
        key = idempotency_key(
            namespace=namespace,
            job_type=job_type,
            subject=subject_ref,
            profile=profile_ref,
            input=input_obj,
            options=options_resolved,
            processor_version=processor.version,
        )
    except ProcessingError as error:
        raise ProcessingJobsError(error.code.value) from None
    except (KeyError, TypeError):
        raise ProcessingJobsError("invalid_input") from None

    existing = _existing(namespace, key)
    if existing is not None:
        logger.info("processing.submit existing job=%s kind=%s", existing.pk, job_type)
        return existing

    stamp = _now()
    job_id = uuid.uuid4()
    attempt_id = uuid.uuid4()
    try:
        request = ProcessingJobRequest(
            job_id=str(job_id),
            job_type=job_type,
            namespace=namespace,
            subject=subject_ref,
            profile=profile_ref,
            idempotency_key=key,
            correlation_id=_correlation_id(),
            attempt_id=str(attempt_id),
            attempt_number=1,
            submitted_at=stamp,
            input=input_obj,
            asset=asset,
            expires_at=stamp + timedelta(hours=settings.LAI_PROCESSING_JOB_TTL_HOURS),
            options=options_resolved,
            limits=resolved_profile.limits,
        )
    except ProcessingError as error:
        raise ProcessingJobsError(error.code.value) from None
    body = encode(request).decode("utf-8")

    try:
        with transaction.atomic():
            job = ProcessingJob(
                id=job_id,
                kind=job_type,
                queue=JobQueue.PROCESSING,
                backend=mode,
                state=JobState.CREATED,
                status=STATE_STATUS[JobState.CREATED],
                payload=request.to_dict(),
                submitted_by=user if getattr(user, "pk", None) else None,
                subject_type=subject_ref.subject_type,
                subject_id=subject_ref.subject_id,
                namespace=namespace,
                idempotency_key=key,
                profile_id=profile_ref.profile_id,
                profile_version=profile_ref.version,
                processor_id=processor.processor_id,
                processor_version=processor.version,
                input_ref=input_obj.ref.to_dict() if input_obj else None,
                input_sha256=input_obj.sha256 if input_obj else "",
                input_size=input_obj.size_bytes if input_obj else None,
                input_content_type=input_obj.content_type if input_obj else "",
                correlation_id=request.correlation_id,
                expires_at=request.expires_at,
                created_at=stamp,
            )
            job.save(force_insert=True)
            attempt = JobAttempt.objects.create(attempt_id=attempt_id, job=job, number=1)
            _set_state(job, JobState.QUEUED)
            job.current_attempt = attempt
            job.save(update_fields=["state", "status", "current_attempt"])
            JobOutbox.objects.create(job=job, attempt=attempt, body=body, available_at=stamp)
    except IntegrityError:
        # A concurrent submit of the same work won the unique (namespace, key) constraint.
        existing = _existing(namespace, key)
        if existing is None:
            raise
        return existing
    logger.info("processing.submit id=%s kind=%s backend=%s", job.pk, job_type, mode)
    _schedule_inline()
    return job


# --- outbox relay ------------------------------------------------------------------------------


def _send_backoff(send_attempts: int) -> int:
    ceiling = min(_MAX_SEND_BACKOFF, retry_policy().backoff_ceiling(max(1, send_attempts)))
    return max(1, min(ceiling, round(rng.uniform(0, ceiling))))


def _fail_job_locked(job: ProcessingJob, code: str, stamp) -> None:
    _set_state(job, JobState.FAILED)
    job.error_code = code
    job.finished_at = stamp
    job.save(update_fields=["state", "status", "error_code", "finished_at"])
    JobAttempt.objects.filter(job=job, outcome=AttemptOutcome.PENDING).update(
        outcome=AttemptOutcome.ABANDONED
    )
    JobOutbox.objects.filter(job=job, sent_at__isnull=True, cancelled_at__isnull=True).update(
        cancelled_at=stamp
    )


def _relay_one(queue, *, ignore_delay: bool) -> str | None:
    """Send the next due row. Returns "sent", "deferred" (transient failure), "dropped" (a row
    that can never be sent) or None (nothing due)."""
    stamp = _now()
    with transaction.atomic():
        rows = JobOutbox.objects.select_for_update(skip_locked=True).filter(
            sent_at__isnull=True, cancelled_at__isnull=True
        )
        if not ignore_delay:
            rows = rows.filter(available_at__lte=stamp)
        row = rows.order_by("available_at", "pk").first()
        if row is None:
            return None
        row.send_attempts = min(row.send_attempts + 1, 32767)
        try:
            queue.send(row.body.encode("utf-8"))
        except ValueError:  # larger than the queue accepts: it never will be sent
            row.last_error_code = "message_too_large"
            row.cancelled_at = stamp
            row.save(update_fields=["send_attempts", "last_error_code", "cancelled_at"])
            job = _locked(row.job_id)
            if job is not None and job.state in _OPEN_STATES:
                _fail_job_locked(job, "message_too_large", stamp)
            logger.error("processing.dispatch dropped job=%s code=message_too_large", row.job_id)
            return "dropped"
        except Exception as error:  # noqa: BLE001 - QueueFull or a transport failure: later
            if getattr(error, "transient", None) is False:
                # `lai_processing_runtime.sqs.QueueError(transient=False)`: a configuration or
                # permission fault. Fail loudly (the row stays as it was; the dispatcher logs
                # and backs off) rather than quietly delaying every row.
                logger.error(
                    "processing.dispatch send_error job=%s code=%s",
                    row.job_id,
                    str(getattr(error, "code", "-"))[:64],
                )
                raise
            row.last_error_code = "queue_full" if isinstance(error, QueueFull) else "send_failed"
            row.available_at = stamp + timedelta(seconds=_send_backoff(row.send_attempts))
            row.save(update_fields=["send_attempts", "last_error_code", "available_at"])
            logger.warning(
                "processing.dispatch deferred job=%s attempt=%s code=%s type=%s",
                row.job_id,
                row.attempt_id,
                row.last_error_code,
                type(error).__name__,
            )
            return "deferred"
        # A crash from here to the commit leaves the row unsent: it is sent again (a duplicate
        # work message the worker and `apply_completion` tolerate), never lost.
        row.sent_at = stamp
        row.last_error_code = ""
        row.save(update_fields=["send_attempts", "last_error_code", "sent_at"])
        JobAttempt.objects.filter(pk=row.attempt_id).update(dispatched_at=stamp)
    logger.info("processing.dispatch sent job=%s attempt=%s", row.job_id, row.attempt_id)
    return "sent"


def relay_outbox(queue, *, limit: int = 50, ignore_delay: bool = False) -> int:
    """Send up to `limit` due outbox rows; returns how many were sent.

    Rows are claimed with `select_for_update(skip_locked=True)`, so concurrent relays never send
    the same row at the same time. With `LAI_PROCESSING_DISPATCH=paused` nothing is sent. A
    transient send failure (`QueueFull`, a transport error) delays the row with backoff and
    stops this pass; it never fails the job. `ignore_delay` sends rows before their
    `available_at` (the inline backend runs retries straight away).
    """
    if settings.LAI_PROCESSING_DISPATCH == "paused":
        logger.info("processing.dispatch paused")
        return 0
    sent = 0
    for _ in range(max(0, limit)):
        outcome = _relay_one(queue, ignore_delay=ignore_delay)
        if outcome is None or outcome == "deferred":
            break
        if outcome == "sent":
            sent += 1
    return sent


# --- completions -------------------------------------------------------------------------------


def _snapshot(job: ProcessingJob) -> JobSnapshot:
    applied = frozenset(
        str(value)
        for value in JobAttempt.objects.filter(job=job, applied_at__isnull=False).values_list(
            "attempt_id", flat=True
        )
    )
    current = job.current_attempt
    return JobSnapshot(
        job_id=str(job.pk),
        namespace=job.namespace,
        state=job.state,
        idempotency_key=job.idempotency_key,
        current_attempt_id=str(current.attempt_id) if current else None,
        current_attempt_number=current.number if current else 0,
        input_sha256=job.input_sha256 or None,
        applied_attempt_ids=applied,
        max_attempts=settings.LAI_PROCESSING_MAX_ATTEMPTS,
    )


def _check_against_job(
    job: ProcessingJob, attempt: JobAttempt, result: ProcessingJobResult
) -> str | None:
    """Checks beyond `decide_completion` before a result may be applied. Returns a REJECT
    reason or None. Decision (docs/processing/DJANGO_JOBS.md): a result produced by another
    processor id or version than the one the job's key was computed for, or for another
    profile, is not this job's work and is rejected, not applied with a warning."""
    if result.processor is not None and (
        result.processor.processor_id != job.processor_id
        or result.processor.processor_version != job.processor_version
    ):
        return "processor_mismatch"
    if (result.profile.profile_id, result.profile.version) != (
        job.profile_id,
        job.profile_version,
    ):
        return "profile_mismatch"
    if result.attempt_number != attempt.number:
        return "attempt_mismatch"
    expected = job.input_ref
    observed = result.input
    if expected is not None and observed is not None:
        if (
            observed.ref.store.value != expected.get("store")
            or observed.ref.key != expected.get("key")
            or (expected.get("version_id") and observed.ref.version_id != expected["version_id"])
            or (job.input_size is not None and observed.size_bytes != job.input_size)
        ):
            return "input_mismatch"
    if result.status is ResultStatus.SUCCEEDED and expected is not None:
        if observed is None or not observed.verified:
            return "input_unverified"
    for artifact in result.artifacts:
        if (
            not artifact.belongs_to(str(job.pk), str(attempt.attempt_id))
            or artifact.ref.namespace != job.namespace
        ):
            return "artifact_foreign"
    return None


def _record_attempt(attempt: JobAttempt, result: ProcessingJobResult, stamp) -> None:
    error = result.primary_error
    attempt.outcome = {
        ResultStatus.SUCCEEDED: AttemptOutcome.SUCCEEDED,
        ResultStatus.FAILED: AttemptOutcome.FAILED,
        ResultStatus.CANCELLED: AttemptOutcome.CANCELLED,
    }[result.status]
    attempt.applied_at = stamp
    attempt.completed_at = result.completed_at
    attempt.result = result.to_dict()
    attempt.verdict = result.verdict.value if result.verdict else ""
    attempt.retry_class = result.retry_class.value if result.retry_class else ""
    attempt.error_code = error.code.value if error else ""
    attempt.processor_id = result.processor.processor_id if result.processor else ""
    attempt.processor_version = result.processor.processor_version if result.processor else ""
    attempt.duration_ms = result.duration_ms
    attempt.save()


def _record_artifacts(job, attempt, result: ProcessingJobResult, event: CompletionEvent) -> None:
    references = list(result.artifacts)
    if event.result_ref is not None:
        references.append(event.result_ref)
    JobArtifact.objects.bulk_create(
        [
            JobArtifact(
                job=job,
                attempt=attempt,
                logical_id=ref.logical_id,
                artifact_type=ref.artifact_type,
                store=ref.ref.store.value,
                key=ref.ref.key,
                version_id=ref.ref.version_id or "",
                sha256=ref.sha256,
                size_bytes=ref.size_bytes,
                content_type=ref.content_type,
            )
            for ref in references
        ]
    )


def _new_attempt(job: ProcessingJob, stamp, *, available_at, renew: bool) -> JobAttempt:
    """Create the next attempt of a locked job and its outbox row (same transaction).

    The request is the job's template with a new `attempt_id` and `attempt_number`; the
    idempotency key is unchanged. `renew` (a staff requeue) also starts a new expiry window.
    """
    current = job.current_attempt
    number = (current.number if current else 0) + 1
    if number > MAX_ATTEMPT_NUMBER:
        raise ProcessingJobsError("attempt_limit")
    template = ProcessingJobRequest.from_dict(job.payload)
    attempt_id = uuid.uuid4()
    changes: dict[str, Any] = {"attempt_id": str(attempt_id), "attempt_number": number}
    if renew:
        changes["submitted_at"] = stamp
        changes["expires_at"] = stamp + timedelta(hours=settings.LAI_PROCESSING_JOB_TTL_HOURS)
        job.expires_at = changes["expires_at"]
    request = dataclasses.replace(template, **changes)
    attempt = JobAttempt.objects.create(attempt_id=attempt_id, job=job, number=number)
    JobOutbox.objects.create(
        job=job, attempt=attempt, body=encode(request).decode("utf-8"), available_at=available_at
    )
    job.current_attempt = attempt
    return attempt


def _receipt(job, event: CompletionEvent, action: str, reason: str) -> None:
    CompletionReceipt.objects.create(
        event_id=event.event_id,
        job=job,
        attempt_id=event.attempt_id,
        action=action,
        reason=reason[:64],
    )


def _outcome(job, event, action: str, reason: str) -> CompletionOutcome:
    job_id = str(job.pk) if job is not None else None
    if action == CompletionAction.REJECT:
        logger.warning(
            "processing.completion_rejected job=%s attempt=%s reason=%s",
            job_id or "-",
            event.attempt_id,
            reason,
        )
    else:
        logger.info(
            "processing.completion job=%s attempt=%s action=%s reason=%s",
            job_id,
            event.attempt_id,
            action,
            reason,
        )
    return CompletionOutcome(action=str(action), ack=True, reason=reason, job_id=job_id)


def _apply_locked(
    event: CompletionEvent, result: ProcessingJobResult | None, result_error: str | None
) -> CompletionOutcome:
    REJECT = CompletionAction.REJECT  # noqa: N806
    job = _locked(event.job_id)
    if job is None or not job.is_contract:
        if not CompletionReceipt.objects.filter(event_id=event.event_id).exists():
            _receipt(None, event, REJECT, "unknown_job")
        return _outcome(None, event, REJECT, "unknown_job")
    seen = CompletionReceipt.objects.filter(event_id=event.event_id).first()
    job.deliveries = min(job.deliveries + 1, 32767)
    if seen is not None:  # the same event delivered again
        job.save(update_fields=["deliveries"])
        if seen.job_id == job.pk and str(seen.attempt_id) == event.attempt_id:
            return _outcome(job, event, CompletionAction.DUPLICATE, "event_seen")
        return _outcome(job, event, REJECT, "event_id_reused")

    attempt = JobAttempt.objects.filter(job=job, attempt_id=event.attempt_id).first()
    if job.kind != event.job_type:
        action, reason = REJECT, "identity_mismatch"
    elif result_error is not None:
        action, reason = REJECT, result_error
    else:
        decision = decide_completion(_snapshot(job), event, result)
        action, reason = decision.action, decision.reason
        if action is not REJECT and attempt is None:
            action, reason = REJECT, "unknown_attempt"
        elif action in (CompletionAction.APPLY, CompletionAction.RETRY):
            assert result is not None  # noqa: S101 - decided on a result
            problem = _check_against_job(job, attempt, result)
            if problem is not None:
                action, reason = REJECT, problem

    stamp = _now()
    if action == CompletionAction.APPLY:
        assert result is not None and attempt is not None  # noqa: S101
        _set_state(job, decision.next_state)
        _record_attempt(attempt, result, stamp)
        error = result.primary_error
        job.result = result.to_dict()
        job.error_code = error.code.value if error else ""
        job.started_at = job.started_at or result.started_at
        job.finished_at = stamp
        if result.status is ResultStatus.SUCCEEDED:
            _record_artifacts(job, attempt, result, event)
        _run_completion_hook(job, attempt, result)
    elif action == CompletionAction.RETRY:
        assert result is not None and attempt is not None  # noqa: S101
        _set_state(job, decision.next_state)
        _record_attempt(attempt, result, stamp)
        error = result.primary_error
        job.error_code = error.code.value if error else ""
        delay = retry_policy().delay_seconds(attempt.number, rng)
        _new_attempt(job, stamp, available_at=stamp + timedelta(seconds=delay), renew=False)
    job.save()
    _receipt(job, event, action, reason)
    return _outcome(job, event, action, reason)


def apply_completion(
    body: bytes | str, *, storage, max_bytes: int = DEFAULT_MAX_MESSAGE_BYTES
) -> CompletionOutcome:
    """Apply one completion message (WAVE2_INTERFACES section 5).

    Returns `CompletionOutcome(action, ack, reason)`: `apply`, `retry`, `duplicate`, `stale` and
    `reject` are acknowledged (after the commit, which has happened on return); `invalid` (an
    undecodable or contract-invalid message) is not, so it reaches the completion DLQ. Raises
    `CompletionDeferred` for a transient failure (database, result storage): nothing was
    committed and the message must be released with a backoff.
    """
    try:
        event = decode_event(body, max_bytes=max_bytes)
    except ProcessingError as error:
        field = str(error.details.get("field", "-"))[:64]
        logger.warning("processing.completion_invalid code=%s field=%s", error.code, field)
        return CompletionOutcome(action=INVALID, ack=False, reason=error.code.value)

    if event.namespace != _namespace():
        try:
            with transaction.atomic():
                if not CompletionReceipt.objects.filter(event_id=event.event_id).exists():
                    _receipt(None, event, CompletionAction.REJECT, "namespace_mismatch")
        except DatabaseError as error:
            raise CompletionDeferred("database_error") from error
        return _outcome(None, event, CompletionAction.REJECT, "namespace_mismatch")

    result = event.result
    result_error = None
    if result is None:
        # By reference: read it only for a job Django knows (a forged event cannot make Django
        # read arbitrary objects; the reference is already confined to the attempt's prefix).
        try:
            known = ProcessingJob.objects.filter(
                pk=event.job_id, kind__in=sorted(CONTRACT_KINDS)
            ).exists()
        except DatabaseError as error:
            raise CompletionDeferred("database_error") from error
        if known:
            assert event.result_ref is not None  # noqa: S101 - guaranteed by the contract
            try:
                data = storage.read(event.result_ref.ref, max_bytes=MAX_RESULT_BYTES)
            except StorageError as error:
                logger.warning(
                    "processing.completion result_unavailable job=%s code=%s",
                    event.job_id,
                    error.code,
                )
                raise CompletionDeferred("result_unavailable") from error
            except ProcessingError:
                result_error = "result_too_large"
            else:
                try:
                    result = decode_result(data, max_bytes=MAX_RESULT_BYTES)
                    event.verify_result(result)
                except ProcessingError:
                    result, result_error = None, "result_mismatch"
    try:
        with transaction.atomic():
            return _apply_locked(event, result, result_error)
    except DatabaseError as error:
        logger.warning(
            "processing.completion deferred job=%s type=%s", event.job_id, type(error).__name__
        )
        raise CompletionDeferred("database_error") from error


# --- staff actions and maintenance -------------------------------------------------------------


def _contract(job_id) -> ProcessingJob | None:
    job = _locked(job_id)
    if job is None:
        return None
    if not job.is_contract:
        raise ProcessingJobsError("not_a_contract_job")
    return job


def cancel_job(job, *, user) -> bool:
    """Cancel a job that has not finished (CREATED, UPLOADING, QUEUED, PROCESSING). Pending
    outbox rows are cancelled; a completion that arrives later is STALE. False if the job's
    state does not allow it."""
    with transaction.atomic():
        job = _contract(getattr(job, "pk", job))
        if job is None:
            return False
        try:
            _set_state(job, JobState.CANCELLED)
        except InvalidTransition:
            return False
        stamp = _now()
        job.cancel_requested_at = stamp
        job.cancelled_by = user if getattr(user, "pk", None) else None
        job.finished_at = stamp
        job.error_code = "cancelled"
        job.save()
        JobOutbox.objects.filter(job=job, sent_at__isnull=True, cancelled_at__isnull=True).update(
            cancelled_at=stamp
        )
        JobAttempt.objects.filter(job=job, outcome=AttemptOutcome.PENDING).update(
            outcome=AttemptOutcome.ABANDONED
        )
    logger.info("processing.cancelled job=%s by=%s", job.pk, getattr(user, "pk", "-"))
    return True


def requeue_job(job, *, user) -> bool:
    """The manual FAILED -> QUEUED transition: a new attempt (new id, next number, new expiry)
    and its outbox row. False if the job is not FAILED."""
    with transaction.atomic():
        job = _contract(getattr(job, "pk", job))
        # Only FAILED: QUEUED -> QUEUED is also a legal transition, but it is the automatic
        # retry, never a staff action.
        if job is None or job.state != JobState.FAILED:
            return False
        try:
            _set_state(job, JobState.QUEUED, manual=True)
        except InvalidTransition:
            return False
        stamp = _now()
        JobAttempt.objects.filter(job=job, outcome=AttemptOutcome.PENDING).update(
            outcome=AttemptOutcome.ABANDONED
        )
        _new_attempt(job, stamp, available_at=stamp, renew=True)
        job.error_code = ""
        job.result = None
        job.finished_at = None
        job.save()
    logger.info("processing.requeued job=%s by=%s", job.pk, getattr(user, "pk", "-"))
    _schedule_inline()
    return True


def retry_eligible(job: ProcessingJob) -> bool:
    """True when a staff requeue is allowed (the job is FAILED)."""
    if job.state != JobState.FAILED:
        return False
    try:
        check_transition(job.state, JobState.QUEUED, manual=True)
    except InvalidTransition:
        return False
    return True


def reconcile(*, dry_run: bool = False, stuck_minutes: int = 15) -> dict[str, int]:
    """Expire open jobs past `expires_at` (FAILED, `job_expired`) and count outbox rows that
    have waited unsent for more than `stuck_minutes`."""
    stamp = _now()
    due = list(
        ProcessingJob.objects.filter(
            kind__in=sorted(CONTRACT_KINDS), state__in=_OPEN_STATES, expires_at__lt=stamp
        ).values_list("pk", flat=True)
    )
    stuck = JobOutbox.objects.filter(
        sent_at__isnull=True,
        cancelled_at__isnull=True,
        available_at__lt=stamp - timedelta(minutes=stuck_minutes),
    ).count()
    report = {"expired_due": len(due), "expired": 0, "stuck_outbox": stuck}
    if stuck:
        logger.warning("processing.outbox_stuck count=%s minutes=%s", stuck, stuck_minutes)
    if dry_run:
        return report
    for job_id in due:
        with transaction.atomic():
            job = _locked(job_id)
            if job is None or job.state not in _OPEN_STATES or not job.expires_at:
                continue
            if job.expires_at >= stamp:
                continue
            _fail_job_locked(job, "job_expired", stamp)
        logger.info("processing.expired job=%s", job_id)
        report["expired"] += 1
    return report


# --- inline backend ----------------------------------------------------------------------------


def _inline_engine(storage):
    from lai_processing.core.execution import ExecutionEngine

    return ExecutionEngine(
        registry=get_registry(),
        storage=storage,
        telemetry=LoggingTelemetry(logging.getLogger("lai.processing")),
        namespace=_namespace(),
    )


def run_inline(*, max_rounds: int = 100) -> dict[str, int]:
    """Drain the in-process transport: relay outbox rows, execute every work message with the
    execution engine (the same core the Lambda worker runs), and apply every completion through
    `apply_completion`. Retries are relayed without waiting for their delay. Development and
    tests only (`LAI_PROCESSING_BACKEND=inline`); never inside a production request."""
    counts = {"sent": 0, "executed": 0, "applied": 0}
    try:
        work = transport.work_queue()
        completions = transport.completion_queue()
        storage = transport.object_storage()
        engine = _inline_engine(storage)
        for _ in range(max_rounds):
            progress = relay_outbox(work, ignore_delay=True)
            counts["sent"] += progress
            for delivery in work.receive(max_messages=10, visibility_seconds=300):
                try:
                    result = engine.decode_and_execute(delivery.body)
                    event = engine.complete(result, max_message_bytes=completions.max_message_bytes)
                except ProcessingError as error:
                    logger.warning("processing.inline work_invalid code=%s", error.code)
                    work.ack(delivery)
                    continue
                completions.send(encode(event))
                work.ack(delivery)
                counts["executed"] += 1
                progress += 1
            for delivery in completions.receive(max_messages=10, visibility_seconds=300):
                outcome = apply_completion(delivery.body, storage=storage)
                if outcome.ack:
                    completions.ack(delivery)
                counts["applied"] += 1
                progress += 1
            if not progress:
                break
    except Exception as error:  # noqa: BLE001 - inline work must never break the caller
        logger.error("processing.inline error type=%s", type(error).__name__)
    return counts
