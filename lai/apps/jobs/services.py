"""Submit background jobs and apply their results (the Django side of the jobs contract).

`submit(kind, payload, user=, subject=)` records a `ProcessingJob` and runs it according to
`LAI_JOBS_BACKEND`:

- `inline`: in this process, through the same task code the Lambda worker runs
  (`apps.jobs.core.tasks`) with in-process ports (the configured model client, fake or real
  Polly, the configured storages). The result goes through `apply_result` like any other.
- `sqs`: a transactional outbox (ADR-064). The committed PENDING row is the durable intent; a
  schema-1 work envelope goes to the kind's work queue after the surrounding transaction commits
  (so a worker never sees a job Django has not stored), and `dispatched_at` records the send. A
  send that fails, or a process that dies before sending, leaves the row undispatched; `relay()`
  (run by the results consumer about once a minute) re-sends it, and after `DISPATCH_ATTEMPTS`
  failed sends the job fails (`submit_failed`). Delivery is at-least-once: workers write results
  to S3 first and `apply_result` ignores duplicates.
- `disabled`: `JobsDisabled`.

`apply_result(message)` validates a result envelope strictly, fetches an S3-held result, locks
the job row, ignores duplicates and anything for a finished job, records `running`, and hands a
final result to the handler registered for the kind, inside the same transaction.

Logs carry job ids, kinds and codes only: never payloads, prompts, text or model output.
"""

import json
import logging
import re
import uuid
from datetime import timedelta
from importlib import import_module

from django.apps import apps as django_apps
from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models, transaction
from django.db.models import ProtectedError, Q
from django.utils.timezone import now

from . import workloads
from .core import envelope, tasks
from .models import JobStatus, ProcessingJob

logger = logging.getLogger("lai.jobs")

#: The Django module that applies each kind's results and builds its inline ports. Each module
#: defines `apply(job)` (called once, inside the job's transaction, after the job reached
#: COMPLETED or FAILED) and `inline_ports(job)`.
HANDLER_MODULES = {
    envelope.STUDIO_GENERATE_CHUNK: "apps.question_studio.jobs",
    envelope.SPEECH_SYNTHESIZE: "apps.speech.jobs",
    envelope.ASSET_INSPECT: "apps.assets.jobs",
    envelope.ASSET_VALIDATE_MODEL: "apps.assets.processing",
    envelope.REFERENCE_CHECKSUM: "apps.jobs.reference",
    envelope.ASSET_ANALYZE_ANIMATION: "apps.npcs.animation_inspection",
    envelope.ASSET_PROCESS_AUDIO: "apps.audio.inspection",
    # Derived-artifact workloads (ADR-066): the shared handler records and verifies artifacts.
    # A workload's own module may replace its entry to add subject-specific behaviour, and
    # should call `apps.assets.artifact_results.apply_artifact_result` for the artifacts.
    envelope.ASSET_TRANSCODE_AUDIO: "apps.assets.artifact_results",
    envelope.ASSET_CONVERT_IMAGE: "apps.assets.artifact_results",
    envelope.ASSET_OPTIMIZE: "apps.assets.artifact_results",
}
#: The largest work message accepted (SQS allows 256 KiB).
MAX_WORK_BYTES = 240 * 1024
#: Failed sends after which an undispatched job fails with `submit_failed`.
DISPATCH_ATTEMPTS = 5
#: Undispatched rows younger than this are left to their own on-commit send.
RELAY_GRACE = timedelta(seconds=30)

# Outcomes of `apply_result`, for the consumer and tests.
APPLIED = "applied"
RUNNING = "running"
DUPLICATE = "duplicate"
INVALID = "invalid"
UNKNOWN_JOB = "unknown_job"


class JobsError(Exception):
    code = "jobs_error"

    def __init__(self, code: str | None = None):
        super().__init__(code or self.code)
        if code:
            self.code = code


class JobsDisabled(JobsError):
    code = "jobs_disabled"


class WorkloadUnavailable(JobsError):
    """A derived-artifact workload is switched off or has no queue (apps.jobs.workloads). Nothing
    was recorded or queued. `message` is safe to show staff."""

    code = workloads.WORKLOAD_DISABLED

    def __init__(self, code: str | None = None):
        super().__init__(code)
        self.message = workloads.MESSAGES.get(
            self.code, workloads.MESSAGES[workloads.WORKLOAD_DISABLED]
        )


class ResultUnavailable(JobsError):
    """A result held in S3 could not be read. Retryable: the message is left on the queue."""

    code = "result_unavailable"


def backend() -> str:
    return settings.LAI_JOBS_BACKEND


def handler(kind: str):
    return import_module(HANDLER_MODULES[kind])


# --- AWS clients (lazy; tests install fakes) ---------------------------------------------------

_clients: dict[str, object] = {}


def set_aws_clients(*, sqs=None, s3=None) -> None:
    """Test seam: install fake clients (None rebuilds from settings on next use)."""
    _clients.clear()
    if sqs is not None:
        _clients["sqs"] = sqs
    if s3 is not None:
        _clients["s3"] = s3


def queue_region(url: str) -> str | None:
    match = re.match(r"https://sqs\.([a-z0-9-]+)\.amazonaws\.com/", url or "")
    return match.group(1) if match else None


def _client(name: str):
    if name not in _clients:
        import boto3
        from botocore.config import Config

        region = queue_region(settings.LAI_JOBS_RESULTS_QUEUE_URL)
        _clients[name] = boto3.client(
            name,
            region_name=region,
            config=Config(
                connect_timeout=5,
                # Long polls wait up to 20 s; the read timeout must outlast them.
                read_timeout=30,
                retries={"max_attempts": 3, "mode": "standard"},
            ),
        )
    return _clients[name]


def queue_url_for(kind: str) -> str:
    """The work queue URL of `kind`. Raises `WorkloadUnavailable` for a workload with none."""
    queue = envelope.KIND_QUEUE[kind]
    url = {
        "ai": settings.LAI_JOBS_AI_QUEUE_URL,
        "media": settings.LAI_JOBS_MEDIA_QUEUE_URL,
        "audio": settings.LAI_JOBS_AUDIO_QUEUE_URL,
        "image": settings.LAI_JOBS_IMAGE_QUEUE_URL,
        "optimize": settings.LAI_JOBS_OPTIMIZE_QUEUE_URL,
    }[queue]
    if not url:
        raise WorkloadUnavailable(workloads.WORKLOAD_QUEUE_MISSING)
    return url


def require_workload(kind: str, *, variant: str | None = None) -> None:
    """Raise `WorkloadUnavailable` unless `kind` may be submitted now (see `apps.jobs.workloads`).
    Kinds that are not derived-artifact workloads always pass."""
    code = workloads.refusal_code(kind, variant=variant)
    if code is not None:
        logger.info("jobs.workload refused kind=%s code=%s", kind, code)
        raise WorkloadUnavailable(code)


# --- submit -----------------------------------------------------------------------------------


def _subject_ref(subject) -> tuple[str, str]:
    if subject is None:
        return "", ""
    if isinstance(subject, tuple):
        kind, ident = subject
        return str(kind)[:64], str(ident)[:64]
    meta = subject._meta
    return f"{meta.app_label}.{meta.model_name}", str(subject.pk)


def submit(
    kind: str,
    payload: dict,
    *,
    user=None,
    subject=None,
    job_id=None,
    idempotency_key: str = "",
) -> ProcessingJob:
    """Record and dispatch one job. `subject` is a model instance or a (type, id) pair.

    `job_id` and `idempotency_key` are for contract kinds, whose payload (an ADR-061 request)
    names its own job id and logical key (core/contract.py)."""
    if kind not in envelope.KINDS:
        raise JobsError("unknown_kind")
    mode = backend()
    if mode == "disabled":
        raise JobsDisabled
    require_workload(kind)  # a switched-off or unqueued workload leaves no row and no message
    try:
        size = len(json.dumps(payload, separators=(",", ":")).encode())
    except (TypeError, ValueError):
        raise JobsError("payload_not_json") from None
    if size > MAX_WORK_BYTES:
        raise JobsError("payload_too_large")
    subject_type, subject_id = _subject_ref(subject)
    try:
        # Normalized so the returned job compares equal to the same row read back (a UUID pk on
        # every backend, not the caller's str).
        extra = {"id": uuid.UUID(str(job_id))} if job_id is not None else {}
    except ValueError:
        raise JobsError("invalid_job_id") from None
    job = ProcessingJob.objects.create(
        **extra,
        idempotency_key=idempotency_key,
        kind=kind,
        queue=envelope.KIND_QUEUE[kind],
        backend=mode,
        payload=payload,
        submitted_by=user if getattr(user, "pk", None) else None,
        subject_type=subject_type,
        subject_id=subject_id,
    )
    logger.info("jobs.submit id=%s kind=%s backend=%s", job.pk, kind, mode)
    if mode == "inline":
        _run_inline(job)
        job.refresh_from_db()
    else:
        job_id = job.pk
        transaction.on_commit(lambda: _send(job_id))
    return job


def _send(job_id) -> str:
    """Send one committed, undispatched job's work message. Returns sent, skipped, deferred or
    failed. The row stays locked while the message is sent, so the on-commit send and the relay
    never both send the same job."""
    with transaction.atomic():
        job = (
            ProcessingJob.objects.select_for_update(skip_locked=True)
            .filter(pk=job_id, status=JobStatus.PENDING, dispatched_at__isnull=True)
            .first()
        )
        if job is None:
            return "skipped"  # already sent, finished, or being sent by another process
        refusal = workloads.refusal_code(
            job.kind, variant=workloads.dispatch_variant(job.kind, job.payload), backend="sqs"
        )
        if refusal is not None:
            # The control was switched off (or the queue unset) after this job was committed:
            # emit nothing (the RELEASE invariant) and finish the job so it is not stranded.
            _finalize(job, JobStatus.FAILED, error_code=refusal)
            return "failed"
        try:
            body = envelope.encode(envelope.build_work(str(job.pk), job.kind, job.payload))
            _client("sqs").send_message(QueueUrl=queue_url_for(job.kind), MessageBody=body)
        except Exception as error:  # noqa: BLE001 - classified by type only (ADR-025)
            job.dispatch_attempts += 1
            logger.warning(
                "jobs.send failed id=%s kind=%s attempt=%s type=%s",
                job.pk,
                job.kind,
                job.dispatch_attempts,
                type(error).__name__,
            )
            if job.dispatch_attempts >= DISPATCH_ATTEMPTS:
                _finalize(job, JobStatus.FAILED, error_code="submit_failed")
                return "failed"
            job.save(update_fields=["dispatch_attempts"])
            return "deferred"
        job.dispatched_at = now()
        job.save(update_fields=["dispatched_at"])
    return "sent"


def relay(*, limit: int = 50) -> dict[str, int]:
    """Re-send committed SQS jobs that were never dispatched (the outbox relay)."""
    ids = list(
        ProcessingJob.objects.filter(
            status=JobStatus.PENDING,
            dispatched_at__isnull=True,
            backend="sqs",
            created_at__lt=now() - RELAY_GRACE,
        )
        .order_by("created_at")
        .values_list("pk", flat=True)[:limit]
    )
    counts = {"sent": 0, "skipped": 0, "deferred": 0, "failed": 0}
    for job_id in ids:
        counts[_send(job_id)] += 1
    if ids:
        logger.info("jobs.relay %s", " ".join(f"{k}={v}" for k, v in counts.items()))
    return counts


def _run_inline(job: ProcessingJob) -> None:
    common = {"function": "django-inline", "request_id": str(job.pk)}
    apply_result(envelope.build_result(str(job.pk), job.kind, envelope.RUNNING, **common))
    try:
        result = tasks.run(job.kind, job.payload, handler(job.kind).inline_ports(job))
        final = envelope.build_result(
            str(job.pk), job.kind, envelope.SUCCEEDED, result=result, **common
        )
    except tasks.TaskError as error:
        final = envelope.build_result(
            str(job.pk),
            job.kind,
            envelope.FAILED,
            error_code=error.code,
            retryable=error.retryable,
            **common,
        )
    except Exception as error:  # noqa: BLE001 - a bug must not leave the job pending
        logger.error("jobs.inline internal_error id=%s type=%s", job.pk, type(error).__name__)
        final = envelope.build_result(
            str(job.pk), job.kind, envelope.FAILED, error_code="internal_error", **common
        )
    apply_result(final)


# --- results ----------------------------------------------------------------------------------


def _fetch_stored(data: dict) -> dict:
    key = data["result_s3_key"]
    try:
        response = _client("s3").get_object(Bucket=settings.LAI_JOBS_RESULTS_BUCKET, Key=key)
        stored = envelope.parse_result(response["Body"].read())
    except envelope.EnvelopeError:
        raise
    except Exception as error:  # noqa: BLE001
        logger.warning(
            "jobs.result fetch failed id=%s type=%s", data["job_id"], type(error).__name__
        )
        raise ResultUnavailable from None
    if (
        stored["job_id"] != data["job_id"]
        or stored["kind"] != data["kind"]
        or stored["status"] != data["status"]
        or stored["result"] is None
    ):
        raise envelope.EnvelopeError("result_s3_key")
    return stored


def apply_result(raw) -> str:
    """Apply one result message. Returns APPLIED, RUNNING, DUPLICATE, INVALID or UNKNOWN_JOB.

    Raises `ResultUnavailable` when an S3-held result cannot be read (try again later), and
    lets a handler's exception propagate after rolling the whole application back.
    """
    try:
        data = envelope.parse_result(raw)
        if data["result_s3_key"] is not None:
            data = _fetch_stored(data)
    except envelope.EnvelopeError as error:
        job_hint = raw.get("job_id") if isinstance(raw, dict) else None
        job_hint = job_hint if isinstance(job_hint, str) and len(job_hint) <= 40 else "-"
        logger.warning("jobs.result invalid id=%s field=%s", job_hint, error)
        return INVALID
    with transaction.atomic():
        job = ProcessingJob.objects.select_for_update().filter(pk=data["job_id"]).first()
        if job is None:
            logger.warning("jobs.result unknown id=%s", data["job_id"])
            return UNKNOWN_JOB
        if job.kind != data["kind"]:
            logger.warning("jobs.result kind_mismatch id=%s", job.pk)
            return INVALID
        job.deliveries += 1
        if job.is_terminal or (data["status"] == envelope.RUNNING and job.status == "running"):
            job.save(update_fields=["deliveries"])
            logger.info("jobs.result duplicate id=%s status=%s", job.pk, data["status"])
            return DUPLICATE
        job.worker_function = data["worker"]["function"]
        job.worker_request_id = data["worker"]["request_id"]
        if data["status"] == envelope.RUNNING:
            job.status = JobStatus.RUNNING
            job.started_at = now()
            job.attempts += 1
            job.save(
                update_fields=[
                    "status",
                    "started_at",
                    "attempts",
                    "deliveries",
                    "worker_function",
                    "worker_request_id",
                ]
            )
            return RUNNING
        if data["status"] == envelope.SUCCEEDED:
            _finalize(job, JobStatus.COMPLETED, result=data["result"])
        else:
            _finalize(job, JobStatus.FAILED, error_code=data["error"]["code"])
    return APPLIED


def _finalize(job: ProcessingJob, status: str, *, result=None, error_code: str = "") -> None:
    """Mark a locked, unfinished job finished and run its kind's handler (same transaction)."""
    job.status = status
    job.result = result
    job.error_code = error_code
    job.finished_at = now()
    job.started_at = job.started_at or job.finished_at
    job.save()
    logger.info(
        "jobs.finished id=%s kind=%s status=%s code=%s", job.pk, job.kind, status, error_code or "-"
    )
    handler(job.kind).apply(job)


def fail_job(job_id, code: str) -> bool:
    """Fail an unfinished job (timeout, a failed send, an operator). False if it had finished."""
    with transaction.atomic():
        job = ProcessingJob.objects.select_for_update().filter(pk=job_id).first()
        if job is None or job.is_terminal:
            return False
        _finalize(job, JobStatus.FAILED, error_code=code)
    return True


def results_backlog() -> int | None:
    """Messages waiting on (or in flight from) the results queue; None when unknown."""
    if backend() != "sqs":
        return 0
    try:
        attributes = _client("sqs").get_queue_attributes(
            QueueUrl=settings.LAI_JOBS_RESULTS_QUEUE_URL,
            AttributeNames=["ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible"],
        )["Attributes"]
        return int(attributes["ApproximateNumberOfMessages"]) + int(
            attributes["ApproximateNumberOfMessagesNotVisible"]
        )
    except Exception as error:  # noqa: BLE001 - unknown backlog: be conservative
        logger.warning("jobs.sweep backlog_unknown type=%s", type(error).__name__)
        return None


#: Kinds whose completed jobs are kept for their own period instead of `LAI_JOBS_RETENTION_DAYS`:
#: a model validation job is the evidence the asset publication gate reads.
RETENTION_SETTINGS = {envelope.ASSET_VALIDATE_MODEL: "LAI_ASSET_VALIDATION_JOB_RETENTION_DAYS"}


def retention_days(kind: str) -> int:
    """Days a completed job of `kind` is kept before `sweep` deletes it."""
    return int(getattr(settings, RETENTION_SETTINGS.get(kind, "LAI_JOBS_RETENTION_DAYS")))


def prunable(stamp):
    """Completed jobs `sweep` deletes at `stamp`: finished strictly more than their kind's
    retention period before it (a job finished exactly that long ago is kept). Pending and
    running jobs are never pruned, whatever their age. Failed jobs: see `prunable_failed`."""
    # A job that still has a derived artifact row is that artifact's evidence (ADR-066): it is kept
    # until retention expires the artifact and clears the link (DerivedArtifact.job is PROTECT).
    return ProcessingJob.objects.filter(_expired(stamp), status=JobStatus.COMPLETED).exclude(
        derived_artifacts__isnull=False
    )


def _expired(stamp) -> Q:
    """Rows finished strictly more than their kind's retention period before `stamp`."""
    special = list(RETENTION_SETTINGS)
    expired = Q(
        ~Q(kind__in=special),
        finished_at__lt=stamp - timedelta(days=settings.LAI_JOBS_RETENTION_DAYS),
    )
    for kind in special:
        expired |= Q(kind=kind, finished_at__lt=stamp - timedelta(days=retention_days(kind)))
    return expired


def _protected_references() -> list[Q]:
    """Filters that match a job another table still points at through a PROTECT foreign key
    (for example a derived artifact's `job`). Generic on purpose: any model that protects its
    job is honoured with no code here, so a new reference can never be silently severed."""
    from django.db.models import Exists, OuterRef

    out = []
    for rel in ProcessingJob._meta.related_objects:
        if not rel.one_to_many or rel.on_delete is not models.PROTECT:
            continue
        child = rel.related_model._default_manager.filter(**{rel.field.name: OuterRef("pk")})
        out.append(Exists(child))
    return out


def _subject_exists(job: ProcessingJob) -> bool:
    """True when the record a job worked for still exists, or cannot be resolved (unknown means
    keep): a retry of that work counts this job's attempt (`attempts_exhausted` in
    apps.assets.processing counts the logical work's jobs)."""
    try:
        model = django_apps.get_model(job.subject_type)
        return model._default_manager.filter(pk=job.subject_id).exists()
    except (LookupError, ValueError, TypeError, ValidationError):
        return True


def prunable_failed_ids(stamp) -> list:
    """Ids of FAILED jobs `sweep` deletes at `stamp`: finished strictly more than their kind's
    retention period before it (`retention_days`: 30 days, 90 for model validation), and none of
    - a job a PROTECT foreign key references (derived artifacts),
    - a keyed (contract-kind) job whose subject record still exists: submitting the same logical
      work again counts its jobs (a bounded number of attempts), so deleting one would hand back
      an attempt. Once the subject is deleted the work cannot be retried, and the job goes,
    - any job while the results queue holds (or may hold) messages: a late result for a failed
      job must still find it.
    Pending and running jobs are never candidates. The sweep re-checks each row under its lock."""
    if results_backlog() != 0:
        return []
    candidates = ProcessingJob.objects.filter(_expired(stamp), status=JobStatus.FAILED)
    for reference in _protected_references():
        candidates = candidates.exclude(reference)
    return [job.pk for job in candidates.iterator() if not _keeps_attempt(job)]


def _keeps_attempt(job: ProcessingJob) -> bool:
    return bool(job.idempotency_key) and _subject_exists(job)


def _delete_failed(job_id, stamp) -> bool:
    """Delete one failed job if it is still prunable, under its row lock (a concurrent result or
    resubmission wins). A PROTECT reference that appeared meanwhile keeps the row."""
    try:
        with transaction.atomic():
            job = ProcessingJob.objects.select_for_update().filter(pk=job_id).first()
            if (
                job is None
                or job.status != JobStatus.FAILED
                or not ProcessingJob.objects.filter(_expired(stamp), pk=job.pk).exists()
                or _keeps_attempt(job)
            ):
                return False
            job.delete()
        return True
    except ProtectedError:
        return False


def sweep(*, dry_run: bool = False) -> dict[str, int]:
    """Fail stale unfinished jobs (`timeout`), delete old completed ones (`prunable`) and old
    terminal failed ones (`prunable_failed_ids`).

    Timeouts wait while the results queue holds messages (or its depth cannot be read): after the
    overnight stop or a database outage, completions for "stale" jobs may still be queued, and
    failing those jobs first would turn valid results into ignored duplicates."""
    stamp = now()
    stale_ids = list(
        ProcessingJob.objects.filter(
            status__in=[JobStatus.PENDING, JobStatus.RUNNING],
            created_at__lt=stamp - timedelta(minutes=settings.LAI_JOBS_STALE_MINUTES),
        ).values_list("pk", flat=True)
    )
    old = prunable(stamp)
    report = {
        "stale": len(stale_ids),
        "timed_out": 0,
        "deferred": 0,
        "pruned": old.count(),
        "pruned_failed": 0,
    }
    if dry_run:
        report["pruned_failed"] = len(prunable_failed_ids(stamp))
        return report
    if stale_ids:
        backlog = results_backlog()
        if backlog != 0:
            report["deferred"] = len(stale_ids)
            stale_ids = []
    for job_id in stale_ids:
        if fail_job(job_id, "timeout"):
            report["timed_out"] += 1
    # Failed jobs are chosen before the timeouts above fail more jobs, and at the same `stamp`:
    # a job failed in this run is brand new and is never old enough to be deleted by it.
    failed_ids = prunable_failed_ids(stamp)
    _delete_completed(old)
    report["pruned_failed"] = sum(1 for job_id in failed_ids if _delete_failed(job_id, stamp))
    return report


def _delete_completed(old) -> None:
    """Delete the completed jobs one by one, skipping any a PROTECT reference still holds."""
    try:
        old.delete()
    except ProtectedError:
        for reference in _protected_references():
            old = old.exclude(reference)
        old.delete()


def latest_for(subject) -> ProcessingJob | None:
    subject_type, subject_id = _subject_ref(subject)
    return (
        ProcessingJob.objects.filter(subject_type=subject_type, subject_id=subject_id)
        .order_by("-created_at")
        .first()
    )


def unfinished_for(subject) -> bool:
    subject_type, subject_id = _subject_ref(subject)
    return ProcessingJob.objects.filter(
        subject_type=subject_type,
        subject_id=subject_id,
        status__in=[JobStatus.PENDING, JobStatus.RUNNING],
    ).exists()
