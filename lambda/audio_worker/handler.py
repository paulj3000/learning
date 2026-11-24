"""SQS entry point for the audio function: `audio_worker.handler.handle`.

All envelope handling, redelivery, result storage and the batch-failure contract are the jobs
worker's (`jobs_worker.handler`, imported, not copied), and so is `jobs_worker.aws.Runtime` with
its create-only artifact store (`Runtime.artifact_storage`, ADR-066). This module only:

* registers the audio runner for `asset.transcode_audio` in the jobs core `RUNNERS` table,
* builds the engine registry (one processor: `asset.audio_transcoder`) and the trusted FFmpeg
  tool from configuration: `LAI_FFMPEG_PATH` (default `/opt/bin/ffmpeg`, the layer's binary) and
  an optional `LAI_FFMPEG_SHA256` pin (see the layer's build-record.json),
* runs each request through `ExecutionEngine` with the attempt's artifact store.

Set `LAI_WORKER_QUEUE=audio` (plus the results queue, results bucket and asset bucket) as for
every worker. The kind and queue are registered in the core tables and Django by Workstream A.
"""

from __future__ import annotations

import os
from pathlib import Path

from jobs_worker import aws
from jobs_worker import handler as jobs_handler
from jobs_worker.vendor.jobs_core import envelope
from jobs_worker.vendor.jobs_core.tasks import RUNNERS, TaskError

KIND = envelope.ASSET_TRANSCODE_AUDIO
DEFAULT_FFMPEG_PATH = "/opt/bin/ffmpeg"
LAMBDA_TMP = "/tmp"  # noqa: S108 - the only writable directory in AWS Lambda

_registry = None


class AudioPorts(aws.AssetPorts):
    """The read-only asset ports plus this attempt's create-only artifact store, and the
    invocation's remaining time (`time_left_ms`) for the runner deadline."""

    def __init__(self, runtime, context=None):
        super().__init__(runtime)
        remaining = getattr(context, "get_remaining_time_in_millis", None)
        self.time_left_ms = remaining if callable(remaining) else None

    def artifact_storage(self, namespace: str, job_id: str, attempt_id: str):
        return self._runtime.artifact_storage(namespace, job_id, attempt_id)


class AudioRuntime(aws.Runtime):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # A warm container's /tmp survives killed invocations: clear their leftovers once.
        from lai_native.runtime import sweep_stale

        self.swept = sweep_stale(LAMBDA_TMP)

    def ports(self, kind: str, context):
        if kind != KIND:
            raise TaskError("unknown_kind")
        return AudioPorts(self, context)


def ffmpeg_config(environ=None) -> tuple[str, str | None]:
    """(path, optional SHA-256 pin) from the function's environment. `LAI_FFMPEG_VERSION`
    (optional, from the layer's build record) saves a `ffmpeg -version` call per container."""
    env = os.environ if environ is None else environ
    path = env.get("LAI_FFMPEG_PATH", DEFAULT_FFMPEG_PATH).strip() or DEFAULT_FFMPEG_PATH
    pin = env.get("LAI_FFMPEG_SHA256", "").strip().lower() or None
    if pin is not None and (len(pin) != 64 or any(c not in "0123456789abcdef" for c in pin)):
        raise RuntimeError("LAI_FFMPEG_SHA256 must be 64 hex characters")
    return path, pin


def engine_registry(environ=None):
    """The closed registry for this function: one processor, built once per environment."""
    global _registry
    if _registry is None:
        from lai_native.audio.engine import AudioTranscodeProcessor
        from lai_native.runtime import ToolSpec
        from lai_processing.core.registry import ProcessorRegistry

        path, pin = ffmpeg_config(environ)
        env = os.environ if environ is None else environ
        registry = ProcessorRegistry()
        registry.register(
            AudioTranscodeProcessor(
                ToolSpec("ffmpeg", path, sha256=pin),
                workspace_base=LAMBDA_TMP,
                tool_version=env.get("LAI_FFMPEG_VERSION", "").strip() or None,
            )
        )
        registry.freeze()
        _registry = registry
    return _registry


def set_registry(value) -> None:
    """Test seam."""
    global _registry
    _registry = value


def run_transcode(payload: dict, ports) -> dict:
    """The audio counterpart of `contract.run`: decode the ADR-061 request, run the engine with
    the attempt's create-only artifact store, return the result dict or raise `TaskError`."""
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
    storage = ports.artifact_storage(request.namespace, request.job_id, request.attempt_id)
    registry = engine_registry()
    engine = ExecutionEngine(
        registry=registry,
        storage=storage,
        namespace=request.namespace,
        workspace_root=Path(LAMBDA_TMP),
    )
    processors = registry.processors()
    for processor in processors:  # the Lambda deadline reaches the runner (one job at a time)
        processor.set_time_source(getattr(ports, "time_left_ms", None))
    try:
        result = engine.execute(request)
    finally:
        for processor in processors:
            processor.set_time_source(None)
    if result.status is ResultStatus.SUCCEEDED:
        return result.to_dict()
    error = result.primary_error
    code = error.code.value if error is not None else "processing_failed"
    raise TaskError(code, retryable=result.retry_class is RetryClass.RETRYABLE)


RUNNERS[KIND] = run_transcode  # picked up by jobs_worker.handler.process via tasks.run


def handle(event, context):
    if jobs_handler._runtime is None:  # noqa: SLF001 - one runtime per warm container
        jobs_handler.set_runtime(AudioRuntime())
    return jobs_handler.handle(event, context)
