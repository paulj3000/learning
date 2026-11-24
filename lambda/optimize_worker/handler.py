"""SQS entry point for the optimize function: `optimize_worker.handler.handle`.

All envelope handling, redelivery, result storage and the batch-failure contract are the jobs
worker's (`jobs_worker.handler.process`, imported, not copied). This module only:

* registers the optimize runner for `asset.optimize` in the jobs core `RUNNERS` table,
* supplies a `Runtime` whose settings name the `optimize` queue,
* runs the ADR-061 engine with a closed registry (one processor: `asset.glb_optimizer`) whose
  storage is Workstream A's create-only artifact store for this attempt
  (`aws.Runtime.artifact_storage`): inputs are read from the asset bucket, artifacts are written
  only under `processing/artifacts/<env>/<job>/<attempt>/` through
  `ProcessingContext.write_artifact`,
* builds the trusted tools from configuration: `LAI_GLTFPACK_PATH` (default `/opt/bin/gltfpack`),
  `LAI_TOKTX_PATH` (default `/opt/bin/toktx`), `LAI_KTX_LIBRARY_PATH` (default `/opt/lib`) and
  optional SHA-256 pins `LAI_GLTFPACK_SHA256` / `LAI_TOKTX_SHA256` (read by the shared
  `ToolPaths.from_environment`), and `LAI_KTX2_TEXTURE_PREPARER` (only `pillow` is accepted).

The worker never reads Django settings. Whether a variant may run is decided at submission
(`LAI_GLB_MESHOPT`, `LAI_GLB_KTX2`); dispatch re-checks and fails a job whose control was switched
off after it was committed.
"""

from __future__ import annotations

import os

from jobs_worker import aws
from jobs_worker import handler as jobs_handler
from jobs_worker.vendor.jobs_core import envelope
from jobs_worker.vendor.jobs_core.tasks import RUNNERS, TaskError

KIND = "asset.optimize"
QUEUE = "optimize"
DEFAULT_GLTFPACK_PATH = "/opt/bin/gltfpack"
DEFAULT_TOKTX_PATH = "/opt/bin/toktx"
DEFAULT_KTX_LIBRARY_PATH = "/opt/lib"
TOOL_DEFAULTS = {
    "LAI_GLTFPACK_PATH": DEFAULT_GLTFPACK_PATH,
    "LAI_TOKTX_PATH": DEFAULT_TOKTX_PATH,
    "LAI_KTX_LIBRARY_PATH": DEFAULT_KTX_LIBRARY_PATH,
}


class OptimizeSettings:
    """The function's environment (a subset of `jobs_worker.aws.Settings`; same field names)."""

    def __init__(self, environ=None):
        env = os.environ if environ is None else environ
        self.queue = env.get("LAI_WORKER_QUEUE", "").strip()
        self.results_queue_url = env.get("LAI_RESULTS_QUEUE_URL", "").strip()
        self.results_bucket = env.get("LAI_RESULTS_BUCKET", "").strip()
        self.asset_bucket = env.get("LAI_ASSET_BUCKET", "").strip()
        self.speech_bucket = ""
        self.ssm_prefix = ""
        from lai_native.optimize import ToolPaths

        try:
            self._tools = ToolPaths.from_environment(env, defaults=TOOL_DEFAULTS)
        except ValueError as error:
            raise RuntimeError(str(error)) from None
        self.gltfpack_sha256 = self._tools.gltfpack_sha256
        self.toktx_sha256 = self._tools.toktx_sha256
        # The worker accepts only the Pillow preparer (Workstream D): KTX2 without colour and
        # orientation handling must fail, never run (F13).
        self.texture_preparer = env.get("LAI_KTX2_TEXTURE_PREPARER", "pillow").strip()
        if self.texture_preparer != "pillow":
            raise RuntimeError("LAI_KTX2_TEXTURE_PREPARER must be pillow")
        if self.queue != QUEUE:
            raise RuntimeError("LAI_WORKER_QUEUE must be optimize")
        if not (self.results_queue_url and self.results_bucket and self.asset_bucket):
            raise RuntimeError("results queue, results bucket and asset bucket are required")

    @property
    def allowed_kinds(self) -> frozenset[str]:
        return frozenset({KIND})

    def tools(self):
        return self._tools


class OptimizePorts(aws.AssetPorts):
    """Read-only asset ports plus the runtime, for the attempt's artifact store."""

    @property
    def runtime(self) -> aws.Runtime:
        return self._runtime


class OptimizeRuntime(aws.Runtime):
    def __init__(self, *args, sweep_base: str = "/tmp", **kwargs):  # noqa: S108 - Lambda /tmp
        super().__init__(*args, **kwargs)
        # A warm container's /tmp survives killed invocations: clear their leftover workspaces
        # (lai-native-*) once per container, as the audio worker does.
        from lai_native.runtime import sweep_stale

        self.swept = sweep_stale(sweep_base)

    def ports(self, kind: str, context):
        if kind != KIND:
            raise TaskError("unknown_kind")
        return OptimizePorts(self)


_registry = None


def engine_registry(settings: OptimizeSettings):
    """The closed registry for this function: one processor, built once per environment."""
    global _registry
    if _registry is None:
        from lai_native.optimize.engine import GlbOptimizeProcessor
        from lai_processing.core.registry import ProcessorRegistry

        registry = ProcessorRegistry()
        registry.register(
            GlbOptimizeProcessor(
                settings.tools(),
                workspace_base="/tmp",  # noqa: S108 - Lambda's writable directory
                preparer=settings.texture_preparer,
            )
        )
        registry.freeze()
        _registry = registry
    return _registry


def set_registry(value) -> None:
    """Test seam."""
    global _registry
    _registry = value


def run_optimize(payload: dict, ports) -> dict:
    """Decode the ADR-061 request, run the engine against the attempt's create-only artifact
    store, return the result dict or raise `TaskError`."""
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
    storage = ports.runtime.artifact_storage(request.namespace, request.job_id, request.attempt_id)
    engine = ExecutionEngine(
        registry=_registry if _registry is not None else engine_registry(OptimizeSettings()),
        storage=storage,
        namespace=request.namespace,
    )
    result = engine.execute(request)
    if result.status is ResultStatus.SUCCEEDED:
        return result.to_dict()
    error = result.primary_error
    code = error.code.value if error is not None else "processing_failed"
    raise TaskError(code, retryable=result.retry_class is RetryClass.RETRYABLE)


RUNNERS[KIND] = run_optimize  # picked up by jobs_worker.handler.process via tasks.run


def handle(event, context):
    if jobs_handler._runtime is None:  # noqa: SLF001 - one runtime per warm container
        jobs_handler.set_runtime(OptimizeRuntime(OptimizeSettings()))
    return jobs_handler.handle(event, context)


# Referenced so a packaging mistake (a renamed envelope helper) fails at import, not at runtime.
_ = envelope.kinds_for_queue
