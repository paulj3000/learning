"""SQS entry point for the image function: `image_worker.handler.handle`.

All envelope handling, redelivery, result storage and the batch-failure contract are the jobs
worker's (`jobs_worker.handler.process`, imported, not copied). This module only:

* registers the image runner for `asset.convert_image` in the jobs core `RUNNERS` table,
* supplies a `Runtime` whose ports add the create-only artifact store for the request's attempt,
* runs the request through the ADR-061 `ExecutionEngine` with the `asset.image_converter`
  processor (`lai_native.image.engine`), which verifies the input copy (size and SHA-256), applies
  the limits and the deadline, and records every artifact reference in the result.

Settings are `jobs_worker.aws.Settings` (queue `image`). No database, Bedrock or Polly access.
"""

from __future__ import annotations

from jobs_worker import aws
from jobs_worker import handler as jobs_handler
from jobs_worker.vendor.jobs_core import envelope
from jobs_worker.vendor.jobs_core.tasks import RUNNERS, TaskError

KIND = envelope.ASSET_CONVERT_IMAGE
QUEUE = "image"


class ImagePorts(aws.AssetPorts):
    """The asset ports plus the create-only artifact store of one attempt."""

    def artifact_storage(self, namespace: str, job_id: str, attempt_id: str):
        return self._runtime.artifact_storage(namespace, job_id, attempt_id)


class ImageRuntime(aws.Runtime):
    def ports(self, kind: str, context):
        if kind != KIND:
            raise TaskError("unknown_kind")
        return ImagePorts(self)


_registry = None


def engine_registry():
    """The closed registry of this function: one processor, built once per container."""
    global _registry
    if _registry is None:
        from lai_native.image.engine import registry

        _registry = registry()
    return _registry


def set_registry(value) -> None:
    """Test seam."""
    global _registry
    _registry = value


def run_convert(payload: dict, ports) -> dict:
    """Decode the ADR-061 request, run the engine with this function's registry and the attempt's
    artifact store, return the result dict or raise `TaskError`."""
    from lai_processing.contracts.jobs import ProcessingJobRequest
    from lai_processing.contracts.results import ResultStatus
    from lai_processing.core.errors import ProcessingError, RetryClass
    from lai_processing.core.execution import ExecutionEngine

    try:
        request = ProcessingJobRequest.from_dict(payload)
    except (ProcessingError, KeyError, TypeError, ValueError):
        raise TaskError("invalid_payload") from None
    if request.job_type != KIND:
        raise TaskError("invalid_payload")
    engine = ExecutionEngine(
        registry=engine_registry(),
        storage=ports.artifact_storage(request.namespace, request.job_id, request.attempt_id),
        namespace=request.namespace,
    )
    result = engine.execute(request)
    if result.status is ResultStatus.SUCCEEDED:
        return result.to_dict()
    error = result.primary_error
    code = error.code.value if error is not None else "processing_failed"
    raise TaskError(code, retryable=result.retry_class is RetryClass.RETRYABLE)


RUNNERS[KIND] = run_convert  # picked up by jobs_worker.handler.process via tasks.run


def handle(event, context):
    if jobs_handler._runtime is None:  # noqa: SLF001 - one runtime per warm container
        jobs_handler.set_runtime(ImageRuntime(aws.Settings()))
    return jobs_handler.handle(event, context)
