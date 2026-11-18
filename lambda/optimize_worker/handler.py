"""SQS entry point skeleton for `asset.optimize`: `optimize_worker.handler.handle`.

It follows `jobs_worker.handler.process` step for step (the same envelope, the same stored-result
redelivery check, `running` then a final result on the one results queue, ReportBatchItemFailures)
and differs only in the task it runs (`task.run_optimize`) and the ports it needs (the existing
read-only asset ports plus the create-only artifact port).

Skeleton status, by design:
- `asset.optimize` and the `optimize` queue are registered by Workstream A
  (`lai/apps/jobs/core/envelope.py`), so the envelope module and the runtime are injected
  (`bind(...)`): in the packaged function they are `jobs_worker.vendor.jobs_core.envelope` and a
  `jobs_worker.aws.Runtime` whose `ports(kind, context)` adds `put_artifact`;
- `StubArtifactPort` stands in for A's create-only artifact writer and is used only by tests and
  local runs. It never touches S3.
- No packaging: which runtime runs gltfpack and toktx in production is an open decision
  (ADR-070, "Open decisions").
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from typing import Any

from . import task

__all__ = ["StubArtifactPort", "bind", "handle", "process"]

_bound: dict[str, Any] = {}


def bind(*, envelope: Any, runtime: Any, log: Any = None) -> None:
    """Install the envelope module, the runtime and the log function (test seam and the place
    the packaged function wires `jobs_worker`'s)."""
    _bound.update(envelope=envelope, runtime=runtime, log=log or (lambda *_a, **_k: None))


@dataclass
class StubArtifactPort:
    """In-memory create-only artifact port. Mirrors the agreed key layout
    `processing/artifacts/<env>/<job id>/<attempt id>/<logical id>.<ext>`; refuses overwrites."""

    env: str = "dev"
    job_id: str = "job"
    attempt_id: str = "attempt"
    objects: dict[str, tuple[str, str, bytes]] = field(default_factory=dict)

    def put_artifact(self, *, role: str, content_type: str, data: bytes, logical_id: str) -> str:
        extension = {"model/gltf-binary": "glb", "application/json": "json", "image/ktx2": "ktx2"}[
            content_type
        ]
        key = (
            f"processing/artifacts/{self.env}/{self.job_id}/{self.attempt_id}/"
            f"{logical_id}.{extension}"
        )
        if key in self.objects:
            raise task.OptimizeTaskError("artifact_exists")
        self.objects[key] = (role, content_type, bytes(data))
        return key

    def sha256(self, key: str) -> str:
        return hashlib.sha256(self.objects[key][2]).hexdigest()


def _worker(context: Any) -> dict[str, str]:
    return {
        "function": str(getattr(context, "function_name", "") or "")[:140],
        "request_id": str(getattr(context, "aws_request_id", "") or "")[:100],
    }


def _deadline(context: Any) -> Any:
    """Lambda's remaining time, minus a reserve, bounds every tool run (lai_native.runtime)."""
    remaining = getattr(context, "get_remaining_time_in_millis", None)
    if remaining is None:
        return None
    from lai_native.runtime import Deadline

    return Deadline(remaining, reserve_seconds=15.0)


def process(body: str, context: Any) -> str:
    envelope, rt, log = _bound["envelope"], _bound["runtime"], _bound["log"]
    worker = _worker(context)
    work = envelope.parse_work(body, allowed_kinds=rt.settings.allowed_kinds)
    job_id, kind = work["job_id"], work["kind"]
    stored = rt.load_result(job_id)
    if stored is not None:
        rt.send_result(envelope.for_message(stored))
        log("job.redelivered", job=job_id, kind=kind, status=stored["status"])
        return "resent"
    rt.send_result(envelope.build_result(job_id, kind, envelope.RUNNING, **worker))
    try:
        result = task.run_optimize(
            work["payload"], rt.ports(kind, context), deadline=_deadline(context)
        )
        final = envelope.build_result(job_id, kind, envelope.SUCCEEDED, result=result, **worker)
    except task.OptimizeTaskError as error:
        if error.retryable:
            log("job.retry", job=job_id, kind=kind, code=error.code)
            raise
        final = envelope.build_result(
            job_id, kind, envelope.FAILED, error_code=error.code, **worker
        )
    rt.store_result(final)
    rt.send_result(envelope.for_message(final))
    code = final["error"]["code"] if final.get("error") else None
    log("job.finished", job=job_id, kind=kind, status=final["status"], code=code)
    return final["status"]


def handle(event: dict | None, context: Any) -> dict[str, list[dict[str, str]]]:
    failures = []
    for record in (event or {}).get("Records", []):
        message_id = record.get("messageId", "")
        try:
            process(record.get("body", ""), context)
        except Exception as error:  # noqa: BLE001 - retried by SQS; never logs the message
            _bound.get("log", lambda *_a, **_k: None)(
                "message.failed",
                message=str(message_id)[:100],
                type=type(error).__name__,
                code=getattr(error, "code", None),
            )
            failures.append({"itemIdentifier": message_id})
    return {"batchItemFailures": failures}
