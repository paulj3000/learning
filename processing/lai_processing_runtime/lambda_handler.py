"""AWS Lambda entry point: `lai_processing_runtime.lambda_handler.handler`.

The function is triggered by an SQS event source mapping on the processing work queue with
`ReportBatchItemFailures` (WAVE2_INTERFACES.md, sections 5 and 7). For each record it runs the
shared worker core (`process_work_message`) and returns
`{"batchItemFailures": [{"itemIdentifier": <messageId>}, ...]}` for every record that must be
redelivered. A record succeeds only after its completion was sent.

- **Deadline:** before each record the handler reads `context.get_remaining_time_in_millis()`.
  When less than the cleanup margin remains it starts nothing more and reports that record and
  every later one as failures. A started record's job is clamped to `remaining - margin`.
- **Malformed invocation:** an event that is not an SQS batch (not a mapping, no `Records`
  list, a record without a `messageId`) raises `ValueError`. There is no item identifier to
  report, and a function error makes the event source return the whole batch to the queue,
  where the DLQ policy applies. A record whose `eventSource` is not `aws:sqs` is a batch item
  failure.
- **Construction:** boto3 clients, adapters, registry and engine are built lazily on the first
  invocation from `RuntimeConfig.from_env(os.environ)` and cached for the life of the execution
  environment. The engine's namespace is pinned to the configured namespace, so a request for
  another environment is refused (`namespace_mismatch`). Buckets and queue URLs come only from
  the configuration.
- **/tmp:** job workspaces live under one directory in the temporary area; at the start of
  every invocation anything left there by an earlier, killed invocation is removed (Lambda
  reuses `/tmp` across invocations of one execution environment and runs one at a time).
- **Logs:** structured JSON through `JsonLogTelemetry` only; never a message body.
"""

from __future__ import annotations

import os
import shutil
import tempfile
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Final

from lai_processing.contracts.identifiers import StoreName
from lai_processing.core.execution import ExecutionEngine
from lai_processing.core.registry import default_registry
from lai_processing.ports.queue import MessageQueue
from lai_processing.ports.storage import ObjectStorage
from lai_processing.ports.telemetry import Telemetry

from .config import RuntimeConfig
from .telemetry import JsonLogTelemetry
from .worker import process_work_message

__all__ = [
    "LambdaRuntime",
    "build_runtime",
    "clean_workspace_root",
    "handler",
    "runtime",
    "set_runtime",
]

WORKSPACE_DIR_NAME: Final = "lai-processing-workspaces"
MAX_RECEIVE_COUNT_FIELD: Final = 1_000_000


@dataclass
class LambdaRuntime:
    config: RuntimeConfig
    engine: ExecutionEngine
    completions: MessageQueue
    telemetry: Telemetry
    workspace_root: Path
    invocations: int = field(default=0)


_runtime: LambdaRuntime | None = None


def _client_config() -> Any:
    from botocore.config import Config

    return Config(
        retries={"mode": "standard", "max_attempts": 3},
        connect_timeout=5,
        read_timeout=60,
        user_agent_extra="lai-processing-worker",
    )


def build_runtime(
    config: RuntimeConfig,
    *,
    s3_client: Any = None,
    sqs_client: Any = None,
    storage: ObjectStorage | None = None,
    completions: MessageQueue | None = None,
    telemetry: Telemetry | None = None,
    workspace_root: Path | None = None,
) -> LambdaRuntime:
    """Wire the adapters for `config`. Clients and adapters may be injected (tests)."""
    from .s3 import S3ObjectStorage
    from .sqs import SqsMessageQueue

    log = telemetry if telemetry is not None else JsonLogTelemetry(level=config.log_level)
    if storage is None:
        if s3_client is None:
            import boto3

            s3_client = boto3.client("s3", config=_client_config())
        storage = S3ObjectStorage(
            s3_client, config.buckets(), writable=frozenset({StoreName.ARTIFACTS})
        )
    if completions is None:
        if sqs_client is None:
            import boto3

            sqs_client = boto3.client("sqs", config=_client_config())
        completions = SqsMessageQueue(sqs_client, config.completion_queue_url, wait_seconds=0)
    root = workspace_root or Path(tempfile.gettempdir()) / WORKSPACE_DIR_NAME
    engine = ExecutionEngine(
        registry=default_registry(),
        storage=storage,
        telemetry=log,
        namespace=config.namespace,
        workspace_root=root,
    )
    return LambdaRuntime(config, engine, completions, log, root)


def runtime() -> LambdaRuntime:
    global _runtime
    if _runtime is None:
        _runtime = build_runtime(RuntimeConfig.from_env(os.environ))
    return _runtime


def set_runtime(value: LambdaRuntime | None) -> None:
    """Test seam: install (or clear) the cached runtime."""
    global _runtime
    _runtime = value


def clean_workspace_root(root: Path) -> int:
    """Remove everything under `root` (leftovers of a killed invocation); create it 0700.
    Returns the number of entries removed. Never follows a symlinked entry."""
    removed = 0
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    for entry in os.scandir(root):
        try:
            if entry.is_dir(follow_symlinks=False):
                shutil.rmtree(entry.path, ignore_errors=True)
            else:
                os.unlink(entry.path)
            removed += 1
        except OSError:
            pass
    return removed


def _remaining_seconds(context: Any) -> float:
    getter = getattr(context, "get_remaining_time_in_millis", None)
    if getter is None:
        raise ValueError("the Lambda context has no remaining-time function")
    return float(getter()) / 1000.0


def _records(event: object) -> list[Mapping[str, Any]]:
    if not isinstance(event, Mapping):
        raise ValueError("not an SQS event")
    records = event.get("Records")
    if not isinstance(records, list):
        raise ValueError("not an SQS event")
    for record in records:
        if not isinstance(record, Mapping):
            raise ValueError("not an SQS record")
        message_id = record.get("messageId")
        if not isinstance(message_id, str) or not message_id:
            raise ValueError("an SQS record has no messageId")
    return records


def _receive_count(record: Mapping[str, Any]) -> int | None:
    attributes = record.get("attributes")
    if not isinstance(attributes, Mapping):
        return None
    try:
        count = int(attributes.get("ApproximateReceiveCount", ""))
    except (TypeError, ValueError):
        return None
    return count if 0 < count <= MAX_RECEIVE_COUNT_FIELD else None


def handler(event: object, context: Any) -> dict[str, list[dict[str, str]]]:
    records = _records(event)
    rt = runtime()
    rt.invocations += 1
    margin = rt.config.cleanup_margin_seconds
    leftovers = clean_workspace_root(rt.workspace_root)
    if leftovers:
        _event(rt.telemetry, "worker.tmp_cleaned", phase="invocation_start")

    failures: list[dict[str, str]] = []
    stop = False
    for record in records:
        message_id = str(record["messageId"])
        count = _receive_count(record)
        if stop:
            failures.append({"itemIdentifier": message_id})
            continue
        remaining = _remaining_seconds(context)
        if remaining < margin:
            stop = True
            _event(rt.telemetry, "work.skipped", phase="deadline", receive_count=count)
            failures.append({"itemIdentifier": message_id})
            continue
        if record.get("eventSource", "aws:sqs") != "aws:sqs":
            _event(rt.telemetry, "work.invalid", phase="event_source", receive_count=count)
            failures.append({"itemIdentifier": message_id})
            continue
        body = record.get("body")
        if not isinstance(body, str):
            _event(rt.telemetry, "work.invalid", phase="body", receive_count=count)
            failures.append({"itemIdentifier": message_id})
            continue
        try:
            outcome = process_work_message(
                body.encode("utf-8"),
                engine=rt.engine,
                completions_queue=rt.completions,
                deadline_seconds=remaining,
                margin=margin,
                telemetry=rt.telemetry,
                receive_count=count,
            )
        except Exception as exc:  # noqa: BLE001 - an unexpected bug fails only this record
            _event(
                rt.telemetry,
                "work.failed",
                phase="worker",
                exception_type=type(exc).__name__,
                receive_count=count,
            )
            failures.append({"itemIdentifier": message_id})
            continue
        if not outcome.success:
            failures.append({"itemIdentifier": message_id})
    clean_workspace_root(rt.workspace_root)
    return {"batchItemFailures": failures}


def _event(telemetry: Telemetry, name: str, **fields: str | int | None) -> None:
    try:
        telemetry.event(name, **fields)
    except Exception:  # noqa: BLE001, S110
        pass
