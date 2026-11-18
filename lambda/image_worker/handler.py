"""SQS-triggered entry point: `image_worker.handler.handle` (ReportBatchItemFailures).

Reuses `jobs_worker.handler.process` for everything except the work itself: strict envelope
validation, wrong-queue rejection, redelivery from the stored result, `running` and final result
messages, S3 result storage and pointers. This module adds only the runtime that knows the
image queue and the runner for `asset.convert_image`.

Registration is explicit and idempotent (`register()`): the runner goes into the vendored
`tasks.RUNNERS`. The envelope must already know the kind and queue (Workstream A registers
`asset.convert_image` on the `image` queue); until it does, every message is a batch item failure
and nothing is converted. No message is processed for a kind this build does not run.
"""

from __future__ import annotations

from jobs_worker import aws
from jobs_worker import handler as base

from .settings import KIND, ImageSettings
from .task import ArtifactSink, UnconfiguredSink, run_convert_image
from .vendor_tasks import TaskError, tasks


class ImagePorts(aws.AssetPorts):
    """Read-only asset ports plus the artifact sink (stubbed until Workstream A's put lands)."""

    def __init__(self, runtime: aws.Runtime, sink: ArtifactSink | None = None):
        super().__init__(runtime)
        self.artifacts = sink or UnconfiguredSink()


class ImageRuntime(aws.Runtime):
    def __init__(self, settings=None, clients=None, sink: ArtifactSink | None = None, **kwargs):
        super().__init__(settings or ImageSettings(), clients, **kwargs)
        self._sink = sink

    def ports(self, kind: str, context):
        if kind != KIND:
            raise TaskError("unknown_kind")
        return ImagePorts(self, self._sink)


def register() -> None:
    tasks.RUNNERS.setdefault(KIND, run_convert_image)


_runtime: ImageRuntime | None = None


def runtime() -> ImageRuntime:
    global _runtime
    if _runtime is None:
        _runtime = ImageRuntime()
    return _runtime


def set_runtime(value: ImageRuntime | None) -> None:
    """Test seam."""
    global _runtime
    _runtime = value


def handle(event, context):
    register()
    failures = []
    for record in (event or {}).get("Records", []):
        message_id = record.get("messageId", "")
        try:
            base.process(record.get("body", ""), context, runtime())
        except Exception as error:  # noqa: BLE001 - retried by SQS; never logs the message
            aws.log(
                "message.failed",
                message=str(message_id)[:100],
                type=type(error).__name__,
                code=getattr(error, "code", None),
            )
            failures.append({"itemIdentifier": message_id})
    return {"batchItemFailures": failures}
