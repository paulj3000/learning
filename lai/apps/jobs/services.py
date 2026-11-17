"""Submit background jobs and apply their results (the Django side of the jobs contract).

`submit(kind, payload, user=, subject=)` records a `ProcessingJob` and runs it according to
`LAI_JOBS_BACKEND`:

- `inline`: in this process, through the same task code the Lambda worker runs
  (`apps.jobs.core.tasks`) with in-process ports (the configured model client, fake or real
  Polly, the configured storages). The result goes through `apply_result` like any other.
- `sqs`: a schema-1 work envelope to the work queue for the kind, sent after the surrounding
  transaction commits (so a worker never sees a job Django has not stored). A send that fails
  fails the job (`submit_failed`).
- `disabled`: `JobsDisabled`.

`apply_result(message)` validates a result envelope strictly, fetches an S3-held result, locks
the job row, ignores duplicates and anything for a finished job, records `running`, and hands a
final result to the handler registered for the kind, inside the same transaction.

Logs carry job ids, kinds and codes only: never payloads, prompts, text or model output.
"""

import json
import logging
import re
from datetime import timedelta
from importlib import import_module

from django.conf import settings
from django.db import transaction
from django.utils.timezone import now

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
}
#: The largest work message accepted (SQS allows 256 KiB).
MAX_WORK_BYTES = 240 * 1024

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
    queue = envelope.KIND_QUEUE[kind]
    return {
        "ai": settings.LAI_JOBS_AI_QUEUE_URL,
        "media": settings.LAI_JOBS_MEDIA_QUEUE_URL,
    }[queue]


# --- submit -----------------------------------------------------------------------------------


def _subject_ref(subject) -> tuple[str, str]:
    if subject is None:
        return "", ""
    if isinstance(subject, tuple):
        kind, ident = subject
        return str(kind)[:64], str(ident)[:64]
    meta = subject._meta
    return f"{meta.app_label}.{meta.model_name}", str(subject.pk)


def submit(kind: str, payload: dict, *, user=None, subject=None) -> ProcessingJob:
    """Record and dispatch one job. `subject` is a model instance or a (type, id) pair."""
    if kind not in envelope.KINDS:
        raise JobsError("unknown_kind")
    mode = backend()
    if mode == "disabled":
        raise JobsDisabled
    try:
        size = len(json.dumps(payload, separators=(",", ":")).encode())
    except (TypeError, ValueError):
        raise JobsError("payload_not_json") from None
    if size > MAX_WORK_BYTES:
        raise JobsError("payload_too_large")
    subject_type, subject_id = _subject_ref(subject)
    job = ProcessingJob.objects.create(
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


def _send(job_id) -> None:
    job = ProcessingJob.objects.filter(pk=job_id).first()
    if job is None or job.status != JobStatus.PENDING:
        return
    try:
        body = envelope.encode(envelope.build_work(str(job.pk), job.kind, job.payload))
        _client("sqs").send_message(QueueUrl=queue_url_for(job.kind), MessageBody=body)
    except Exception as error:  # noqa: BLE001 - classified by type only (ADR-025)
        logger.warning(
            "jobs.send failed id=%s kind=%s type=%s", job.pk, job.kind, type(error).__name__
        )
        fail_job(job.pk, "submit_failed")


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


def sweep(*, dry_run: bool = False) -> dict[str, int]:
    """Fail stale unfinished jobs (`timeout`) and delete old completed ones."""
    stamp = now()
    stale_ids = list(
        ProcessingJob.objects.filter(
            status__in=[JobStatus.PENDING, JobStatus.RUNNING],
            created_at__lt=stamp - timedelta(minutes=settings.LAI_JOBS_STALE_MINUTES),
        ).values_list("pk", flat=True)
    )
    old = ProcessingJob.objects.filter(
        status=JobStatus.COMPLETED,
        finished_at__lt=stamp - timedelta(days=settings.LAI_JOBS_RETENTION_DAYS),
    )
    report = {"stale": len(stale_ids), "timed_out": 0, "pruned": old.count()}
    if dry_run:
        return report
    for job_id in stale_ids:
        if fail_job(job_id, "timeout"):
            report["timed_out"] += 1
    old.delete()
    return report


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
