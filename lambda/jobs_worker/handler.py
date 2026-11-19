"""SQS-triggered entry point: `jobs_worker.handler.handle` (ReportBatchItemFailures).

For each work message:

1. Validate the schema-1 envelope strictly; the kind must belong to this function's queue
   (`LAI_WORKER_QUEUE`). A known kind on the wrong queue gets a `failed` result (`wrong_queue`);
   an envelope that cannot be read at all is reported as a batch item failure, so SQS retries it
   and then moves it to the DLQ.
2. If `jobs/results/<job_id>.json` already exists this is a redelivery: re-send that result and
   stop. No second model or Polly call.
3. Send `running`, run the task (the vendored `jobs_core.tasks`), store the final envelope in S3,
   then send it (inline, or as an S3 pointer when it is larger than 200 KB).

A retryable error raises (the message is retried, and lands in the DLQ after three receives); a
non-retryable one becomes a `failed` result. Logs carry job ids, kinds and codes only.
"""

import json

from . import aws
from .vendor.jobs_core import envelope, tasks

_runtime: aws.Runtime | None = None


def runtime() -> aws.Runtime:
    global _runtime
    if _runtime is None:
        _runtime = aws.Runtime()
    return _runtime


def set_runtime(value: aws.Runtime | None) -> None:
    """Test seam."""
    global _runtime
    _runtime = value


def _worker(context) -> dict:
    return {
        "function": str(getattr(context, "function_name", "") or "")[:140],
        "request_id": str(getattr(context, "aws_request_id", "") or "")[:100],
    }


def _salvage(body: str) -> tuple[str | None, str | None]:
    """The job id and kind of an envelope that failed validation only on its queue."""
    try:
        data = json.loads(body)
        work = envelope.parse_work(data)  # every kind allowed: is it otherwise valid?
    except (ValueError, envelope.EnvelopeError):
        return None, None
    return work["job_id"], work["kind"]


def process(body: str, context, rt: aws.Runtime | None = None) -> str:
    """Handle one work message. Returns an outcome label; raises to have SQS retry it."""
    rt = rt or runtime()
    worker = _worker(context)
    try:
        work = envelope.parse_work(body, allowed_kinds=rt.settings.allowed_kinds)
    except envelope.EnvelopeError as error:
        if str(error) == "queue":
            job_id, kind = _salvage(body)
            if job_id:
                final = envelope.build_result(
                    job_id, kind, envelope.FAILED, error_code="wrong_queue", **worker
                )
                rt.store_result(final)
                rt.send_result(envelope.for_message(final))
                aws.log("job.rejected", job=job_id, kind=kind, code="wrong_queue")
                return "rejected"
        aws.log("job.invalid_envelope", field=str(error))
        raise
    job_id, kind = work["job_id"], work["kind"]
    stored = rt.load_result(job_id)
    if stored is not None:
        rt.send_result(envelope.for_message(stored))
        aws.log("job.redelivered", job=job_id, kind=kind, status=stored["status"])
        return "resent"
    rt.send_result(envelope.build_result(job_id, kind, envelope.RUNNING, **worker))
    try:
        result = tasks.run(kind, work["payload"], rt.ports(kind, context))
        final = envelope.build_result(job_id, kind, envelope.SUCCEEDED, result=result, **worker)
    except tasks.TaskError as error:
        if error.retryable:
            aws.log("job.retry", job=job_id, kind=kind, code=error.code)
            raise
        final = envelope.build_result(
            job_id, kind, envelope.FAILED, error_code=error.code, **worker
        )
    rt.store_result(final)
    rt.send_result(envelope.for_message(final))
    code = final["error"]["code"] if final["error"] else None
    aws.log("job.finished", job=job_id, kind=kind, status=final["status"], code=code)
    return final["status"]


def handle(event, context):
    failures = []
    for record in (event or {}).get("Records", []):
        message_id = record.get("messageId", "")
        try:
            process(record.get("body", ""), context)
        except Exception as error:  # noqa: BLE001 - retried by SQS; never logs the message
            aws.log(
                "message.failed",
                message=str(message_id)[:100],
                type=type(error).__name__,
                code=getattr(error, "code", None),
            )
            failures.append({"itemIdentifier": message_id})
    return {"batchItemFailures": failures}
