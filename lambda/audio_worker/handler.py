"""SQS entry point for the audio function: `audio_worker.handler.handle`.

All envelope handling, redelivery, result storage and the batch-failure contract are the jobs
worker's (`jobs_worker.handler.process`, imported, not copied). This module only:

* registers the audio runner for `asset.transcode_audio` in the jobs core `RUNNERS` table,
* supplies a `Runtime` whose settings name the `audio` queue and whose ports add the artifact put,
* builds the engine registry (one processor: `asset.audio_transcoder`) and the trusted FFmpeg
  tool from configuration: `LAI_FFMPEG_PATH` (default `/opt/bin/ffmpeg`, the layer's binary) and
  an optional `LAI_FFMPEG_SHA256` pin (see the layer's build-record.json).

The kind and the `audio` queue are registered in the Django and core tables by Workstream A; the
tests here patch those tables locally until that lands.
"""

from __future__ import annotations

import os

from jobs_worker import aws
from jobs_worker import handler as jobs_handler
from jobs_worker.vendor.jobs_core import envelope
from jobs_worker.vendor.jobs_core.tasks import RUNNERS, TaskError

from .storage import AudioPorts, AudioStorage

KIND = "asset.transcode_audio"
QUEUE = "audio"
DEFAULT_FFMPEG_PATH = "/opt/bin/ffmpeg"


class AudioSettings:
    """The function's environment (a subset of `jobs_worker.aws.Settings`; same field names)."""

    def __init__(self, environ=None):
        env = os.environ if environ is None else environ
        self.queue = env.get("LAI_WORKER_QUEUE", "").strip()
        self.results_queue_url = env.get("LAI_RESULTS_QUEUE_URL", "").strip()
        self.results_bucket = env.get("LAI_RESULTS_BUCKET", "").strip()
        self.asset_bucket = env.get("LAI_ASSET_BUCKET", "").strip()
        self.speech_bucket = ""
        self.ssm_prefix = ""
        self.ffmpeg_path = env.get("LAI_FFMPEG_PATH", DEFAULT_FFMPEG_PATH).strip()
        self.ffmpeg_sha256 = env.get("LAI_FFMPEG_SHA256", "").strip().lower() or None
        if self.queue != QUEUE:
            raise RuntimeError("LAI_WORKER_QUEUE must be audio")
        if not (self.results_queue_url and self.results_bucket and self.asset_bucket):
            raise RuntimeError("results queue, results bucket and asset bucket are required")
        if self.ffmpeg_sha256 and len(self.ffmpeg_sha256) != 64:
            raise RuntimeError("LAI_FFMPEG_SHA256 must be 64 hex characters")

    @property
    def allowed_kinds(self) -> frozenset[str]:
        return frozenset({KIND})


class AudioRuntime(aws.Runtime):
    def ports(self, kind: str, context):
        if kind != KIND:
            raise TaskError("unknown_kind")
        return AudioPorts(self)


_registry = None


def engine_registry(settings: AudioSettings):
    """The closed registry for this function: one processor, built once per environment."""
    global _registry
    if _registry is None:
        from lai_native.audio.engine import AudioTranscodeProcessor
        from lai_native.runtime import ToolSpec
        from lai_processing.core.registry import ProcessorRegistry

        registry = ProcessorRegistry()
        registry.register(
            AudioTranscodeProcessor(
                ToolSpec("ffmpeg", settings.ffmpeg_path, sha256=settings.ffmpeg_sha256),
                workspace_base="/tmp",
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
    this function's registry and storage, return the result dict or raise `TaskError`."""
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
        registry=_registry if _registry is not None else engine_registry(AudioSettings()),
        storage=AudioStorage(ports),
        namespace=request.namespace,
    )
    result = engine.execute(request)
    if result.status is ResultStatus.SUCCEEDED:
        return result.to_dict()
    error = result.primary_error
    code = error.code.value if error is not None else "processing_failed"
    raise TaskError(code, retryable=result.retry_class is RetryClass.RETRYABLE)


RUNNERS[KIND] = run_transcode  # picked up by jobs_worker.handler.process via tasks.run


def handle(event, context):
    if jobs_handler._runtime is None:  # noqa: SLF001 - one runtime per warm container
        jobs_handler.set_runtime(AudioRuntime(AudioSettings()))
    return jobs_handler.handle(event, context)


# Referenced so a packaging mistake (a renamed envelope helper) fails at import, not at runtime.
_ = envelope.kinds_for_queue
