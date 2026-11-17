"""The execution engine: runs one job attempt and always returns a contract-valid result.

`execute()` never raises for a job-level failure. Every refusal and exception becomes a FAILED
(or CANCELLED) `ProcessingJobResult` whose error carries only the fixed safe message for its
code and short scalar details (`error_from_exception`): an exception's own text, a traceback,
input bytes or a file name never reach the result or the telemetry.

Order of work (each step can only fail closed):
1. namespace (NAMESPACE_MISMATCH), expiry (JOB_EXPIRED), cancellation;
2. processor and profile resolution (UNSUPPORTED_PROCESSOR / INVALID_PROCESSING_PROFILE);
3. option resolution against the profile; limits clamped to the worker ceilings;
4. a private workspace bounded by `max_temp_bytes`;
5. input verification: `head` first (size against the limit and the request, version pin,
   recorded checksum), then a chunked stream of *that exact version* into the workspace,
   hashed and counted as it is read, so an oversized or substituted object is never fully
   consumed and the processor only ever sees bytes matching the request's SHA-256;
6. `validate`, `process`, a final deadline/cancellation check, the metadata size limit, and
   the verdict invariant (an error finding cannot pass);
7. always: `processor.cleanup` then `workspace.cleanup`, failures swallowed and reported.

A version mismatch between the request's pinned `version_id` and the stored object is
reported as CHECKSUM_MISMATCH (PERMANENT): the bytes on offer are not the bytes the request
describes, which is a content-identity failure rather than a missing object.
"""

from __future__ import annotations

import hashlib
import io
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Final

from ..contracts.artifacts import ArtifactReference
from ..contracts.codec import DEFAULT_MAX_MESSAGE_BYTES, decode_request, decode_result
from ..contracts.common import ObjectRef, ProcessorIdentity
from ..contracts.events import (
    RESULT_ARTIFACT_TYPE,
    RESULT_LOGICAL_ID,
    CompletionEvent,
    build_completion_event,
    result_digest,
)
from ..contracts.identifiers import StoreName, artifact_key
from ..contracts.jobs import ProcessingJobRequest
from ..contracts.profiles import ProcessingProfile
from ..contracts.results import (
    InputIdentity,
    JobError,
    ProcessingJobResult,
    ProcessingWarning,
    ResultStatus,
    Severity,
    Verdict,
)
from ..ports.clock import Clock, SystemClock
from ..ports.storage import ObjectExists, ObjectStorage
from ..ports.telemetry import NullTelemetry, Telemetry
from .canonical import CHUNK_BYTES, canonical_json
from .errors import ErrorCode, ProcessingError, error_from_exception
from .idempotency import verify_idempotency_key
from .limits import PLATFORM_CEILINGS, ResourceLimits, effective_limits
from .processor import CancellationToken, ProcessingContext, Processor, ProcessorOutput
from .registry import ProcessorRegistry
from .workspace import Workspace

__all__ = ["INPUT_FILE_NAME", "ExecutionEngine"]

INPUT_FILE_NAME: Final = "input.bin"
# The largest stored `job-result` read back on a redelivery (matches Django's read bound).
MAX_RESULT_BYTES: Final = 4 * 1024 * 1024
MAX_DURATION_MS: Final = 86_400_000
VERDICT_ADJUSTED: Final = ProcessingWarning(
    code="verdict_adjusted",
    message="The verdict was changed to fail because an error finding was reported.",
)


def _new_id() -> str:
    return str(uuid.uuid4())


@dataclass
class _Run:
    """Mutable state of one attempt, kept so a failure result can report what was known."""

    request: ProcessingJobRequest
    started_at: datetime
    started_mono: float
    processor: Processor | None = None
    profile: ProcessingProfile | None = None
    workspace: Workspace | None = None
    context: ProcessingContext | None = None
    input_identity: InputIdentity | None = None

    @property
    def identity(self) -> ProcessorIdentity | None:
        return self.processor.identity if self.processor is not None else None

    @property
    def artifacts(self) -> tuple[ArtifactReference, ...]:
        return tuple(self.context.artifacts) if self.context is not None else ()


@dataclass
class ExecutionEngine:
    registry: ProcessorRegistry
    storage: ObjectStorage
    telemetry: Telemetry = field(default_factory=NullTelemetry)
    clock: Clock = field(default_factory=SystemClock)
    ceilings: ResourceLimits = PLATFORM_CEILINGS
    namespace: str | None = None
    workspace_root: Path | None = None
    id_factory: Callable[[], str] = _new_id
    # Recompute and compare each request's idempotency key (ADR-061). Disable only in tests
    # that exercise other behaviour with hand-written keys.
    verify_idempotency_keys: bool = True

    # Public API ----------------------------------------------------------------------------

    def decode_and_execute(
        self, body: bytes, *, max_message_bytes: int | None = None
    ) -> ProcessingJobResult:
        """Decode a work message, then execute it.

        An undecodable message raises `ProcessingError`: without a valid job id and attempt
        there is no job to report a result for, so the transport layer must dead-letter it.
        """
        limit = max_message_bytes
        if limit is None:
            limit = min(DEFAULT_MAX_MESSAGE_BYTES, self.ceilings.max_message_bytes)
        request = decode_request(body, max_bytes=limit)
        return self.execute(request)

    def execute(
        self,
        request: ProcessingJobRequest,
        *,
        cancellation: CancellationToken | None = None,
    ) -> ProcessingJobResult:
        token = cancellation if cancellation is not None else CancellationToken()
        run = _Run(request=request, started_at=self.clock.now(), started_mono=self._mono())
        self._emit(
            "job.started",
            job_id=request.job_id,
            attempt_id=request.attempt_id,
            attempt_number=request.attempt_number,
            job_type=request.job_type,
            namespace=request.namespace,
        )
        outcome: ProcessorOutput | ProcessingError
        try:
            outcome = self._run(run, token)
        except Exception as exc:  # noqa: BLE001 - every failure becomes a classified result
            outcome = error_from_exception(exc)
        finally:
            self._cleanup(run)
        result = self._finish(run, outcome)
        self._report(result)
        return result

    def complete(self, result: ProcessingJobResult, *, max_message_bytes: int) -> CompletionEvent:
        """The completion event for `result`, inline when it fits, else by reference.

        An oversized result is stored as the attempt's `job-result` artifact. A result with no
        processor (the job was refused before resolution) cannot name a producing processor,
        and inventing one would forge provenance, so it is refused with MESSAGE_TOO_LARGE.
        Unlike `execute`, this may raise: the caller decides whether to retry the publish.

        The `job-result` key is fixed per attempt and create-only. A redelivered attempt whose
        first completion was stored but never sent reruns with new timestamps, so its result
        bytes differ and the write conflicts. The stored object is then this worker's own
        earlier result for the same attempt: it is read back, checked to decode as a result of
        the same job and attempt, and the completion is rebuilt from it, which resends the
        original completion instead of failing the attempt forever.
        """
        try:
            return self._completion(result, max_message_bytes)
        except ObjectExists:
            stored = self._stored_result(result)
            if stored is None:
                raise
            self._emit(
                "job.result_reused",
                job_id=result.job_id,
                attempt_id=result.attempt_id,
                status=stored.status.value,
            )
            return self._completion(stored, max_message_bytes)

    def _completion(self, result: ProcessingJobResult, max_message_bytes: int) -> CompletionEvent:
        return build_completion_event(
            result,
            event_id=self.id_factory(),
            emitted_at=self.clock.now(),
            max_message_bytes=max_message_bytes,
            store_result=lambda data, digest: self._store_result(result, data, digest),
        )

    @staticmethod
    def _result_ref(result: ProcessingJobResult, version_id: str | None) -> ObjectRef:
        key = artifact_key(
            result.namespace, result.job_id, result.attempt_id, RESULT_LOGICAL_ID, "json"
        )
        return ObjectRef(StoreName.ARTIFACTS, key, version_id, result.namespace)

    def _store_result(
        self, result: ProcessingJobResult, data: bytes, digest: str
    ) -> ArtifactReference:
        if result.processor is None:
            raise ProcessingError(ErrorCode.MESSAGE_TOO_LARGE, {"field": "event"})
        info = self.storage.put(
            self._result_ref(result, None),
            io.BytesIO(data),
            content_type="application/json",
            sha256=digest,
            size_bytes=len(data),
        )
        return ArtifactReference(
            artifact_type=RESULT_ARTIFACT_TYPE,
            logical_id=RESULT_LOGICAL_ID,
            ref=self._result_ref(result, info.version_id),
            content_type="application/json",
            size_bytes=len(data),
            sha256=digest,
            source_job_id=result.job_id,
            source_attempt_id=result.attempt_id,
            processor=result.processor,
            profile=result.profile,
        )

    def _stored_result(self, result: ProcessingJobResult) -> ProcessingJobResult | None:
        """The attempt's already stored `job-result`, when it is a valid result of the same
        job and attempt whose bytes are exactly its canonical form; otherwise None (the
        conflict stands). Any read or decode failure also leaves the conflict standing."""
        try:
            data = self.storage.read(self._result_ref(result, None), max_bytes=MAX_RESULT_BYTES)
            stored = decode_result(data, max_bytes=MAX_RESULT_BYTES)
        except Exception:  # noqa: BLE001 - an unreadable object is still a conflict
            return None
        if hashlib.sha256(data).hexdigest() != result_digest(stored):
            return None
        same = all(
            getattr(stored, name) == getattr(result, name)
            for name in (
                "job_id",
                "attempt_id",
                "attempt_number",
                "job_type",
                "namespace",
                "idempotency_key",
                "correlation_id",
            )
        )
        if not same or stored.processor is None:
            return None
        return stored

    # Steps ---------------------------------------------------------------------------------

    def _run(self, run: _Run, token: CancellationToken) -> ProcessorOutput:
        request = run.request
        if self.namespace is not None and request.namespace != self.namespace:
            raise ProcessingError(ErrorCode.NAMESPACE_MISMATCH, {"field": "namespace"})
        if request.is_expired(run.started_at):
            raise ProcessingError(ErrorCode.JOB_EXPIRED, {"field": "expires_at"})
        token.raise_if_cancelled()

        processor, profile = self.registry.resolve(request.job_type, request.profile)
        run.processor, run.profile = processor, profile
        if self.verify_idempotency_keys and not (
            verify_idempotency_key(request)
            or verify_idempotency_key(request, processor_version=processor.version)
        ):
            # The key must be derived from the request's own stable fields; a key that is not
            # (a forged or hand-edited message, or a Django bug) fails closed before any input
            # is read, so two different jobs can never share one logical identity.
            raise ProcessingError(ErrorCode.INVALID_INPUT, {"field": "idempotency_key"})
        options = profile.resolve_options(request.options)
        limits = effective_limits(request.limits, self.ceilings)

        run.workspace = Workspace.create(max_bytes=limits.max_temp_bytes, root=self.workspace_root)
        context = ProcessingContext(
            request=request,
            profile=profile,
            options=options,
            limits=limits,
            storage=self.storage,
            telemetry=self.telemetry,
            clock=self.clock,
            workspace=run.workspace,
            cancellation=token,
            deadline=run.started_mono + limits.max_execution_seconds,
            processor=processor.identity,
        )
        run.context = context
        context.check()

        if request.input is not None:
            context.input_path = self._fetch_input(run, context)

        context.check()
        processor.validate(context)
        context.check()
        output = processor.process(context)
        if not isinstance(output, ProcessorOutput):
            raise ProcessingError(ErrorCode.UNEXPECTED_FAILURE, {"field": "output"})
        context.check()
        return self._check_output(output, limits)

    def _fetch_input(self, run: _Run, context: ProcessingContext) -> Path:
        """Verify the input against the request and copy it into the workspace."""
        expected = run.request.input
        assert expected is not None  # noqa: S101 - guarded by the caller
        limits = context.limits
        ref = expected.ref
        info = self.storage.head(ref)
        if info.size_bytes > limits.max_input_bytes:
            raise ProcessingError(ErrorCode.RESOURCE_LIMIT_EXCEEDED, {"limit": "max_input_bytes"})
        if info.size_bytes != expected.size_bytes:
            raise ProcessingError(ErrorCode.CHECKSUM_MISMATCH, {"field": "input.size_bytes"})
        if ref.version_id is not None and info.version_id != ref.version_id:
            raise ProcessingError(ErrorCode.CHECKSUM_MISMATCH, {"field": "input.version_id"})
        if info.sha256 is not None and info.sha256 != expected.sha256:
            raise ProcessingError(ErrorCode.CHECKSUM_MISMATCH, {"field": "input.sha256"})

        # Read exactly the version `head` described, so a concurrent overwrite of the key
        # cannot substitute different bytes between the check and the read.
        pinned = ObjectRef(ref.store, ref.key, info.version_id or ref.version_id, ref.namespace)
        digest = hashlib.sha256()
        size = 0
        workspace = context.workspace
        stream = self.storage.open(pinned)
        try:
            with workspace.open_new(INPUT_FILE_NAME) as target:
                while True:
                    context.check()
                    chunk = stream.read(CHUNK_BYTES)
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > limits.max_input_bytes:
                        raise ProcessingError(
                            ErrorCode.RESOURCE_LIMIT_EXCEEDED, {"limit": "max_input_bytes"}
                        )
                    if size > expected.size_bytes:
                        raise ProcessingError(
                            ErrorCode.CHECKSUM_MISMATCH, {"field": "input.size_bytes"}
                        )
                    workspace.reserve(len(chunk))
                    target.write(chunk)
                    digest.update(chunk)
        finally:
            stream.close()

        observed = digest.hexdigest()
        verified = size == expected.size_bytes and observed == expected.sha256
        run.input_identity = InputIdentity(
            ref=pinned, sha256=observed, size_bytes=size, verified=verified
        )
        if not verified:
            raise ProcessingError(ErrorCode.CHECKSUM_MISMATCH, {"field": "input.sha256"})
        return workspace.path(INPUT_FILE_NAME)

    def _check_output(self, output: ProcessorOutput, limits: ResourceLimits) -> ProcessorOutput:
        try:
            encoded = canonical_json(dict(output.metadata))
        except (TypeError, ValueError):
            raise ProcessingError(ErrorCode.UNEXPECTED_FAILURE, {"field": "metadata"}) from None
        if len(encoded) > limits.max_metadata_bytes:
            raise ProcessingError(
                ErrorCode.RESOURCE_LIMIT_EXCEEDED, {"limit": "max_metadata_bytes"}
            )
        if output.verdict is Verdict.PASS and any(
            item.severity is Severity.ERROR for item in output.findings
        ):
            return ProcessorOutput(
                verdict=Verdict.FAIL,
                metadata=output.metadata,
                findings=output.findings,
                warnings=(*output.warnings, VERDICT_ADJUSTED),
            )
        return output

    def _cleanup(self, run: _Run) -> None:
        if run.processor is not None and run.context is not None:
            try:
                run.processor.cleanup(run.context)
            except Exception as exc:  # noqa: BLE001 - cleanup must not change the outcome
                self._emit(
                    "job.cleanup_failed",
                    job_id=run.request.job_id,
                    attempt_id=run.request.attempt_id,
                    phase="processor",
                    exception_type=type(exc).__name__,
                )
        if run.workspace is not None:
            try:
                run.workspace.cleanup()
            except Exception as exc:  # noqa: BLE001
                self._emit(
                    "job.cleanup_failed",
                    job_id=run.request.job_id,
                    attempt_id=run.request.attempt_id,
                    phase="workspace",
                    exception_type=type(exc).__name__,
                )

    # Results -------------------------------------------------------------------------------

    def _finish(self, run: _Run, outcome: ProcessorOutput | ProcessingError) -> ProcessingJobResult:
        completed_at = self.clock.now()
        if completed_at < run.started_at:
            completed_at = run.started_at
        elapsed = (self._mono() - run.started_mono) * 1000
        duration_ms = min(max(int(round(elapsed)), 0), MAX_DURATION_MS)
        if isinstance(outcome, ProcessorOutput):
            try:
                return self._result(run, completed_at, duration_ms, output=outcome)
            except Exception as exc:  # noqa: BLE001 - e.g. too many findings
                outcome = error_from_exception(exc)
        try:
            return self._result(run, completed_at, duration_ms, error=outcome)
        except Exception:  # noqa: BLE001 - a contract bug must still yield a result
            return self._fallback(run, completed_at, duration_ms)

    def _result(
        self,
        run: _Run,
        completed_at: datetime,
        duration_ms: int,
        *,
        output: ProcessorOutput | None = None,
        error: ProcessingError | None = None,
    ) -> ProcessingJobResult:
        request = run.request
        common: dict[str, Any] = {
            "job_id": request.job_id,
            "job_type": request.job_type,
            "namespace": request.namespace,
            "idempotency_key": request.idempotency_key,
            "correlation_id": request.correlation_id,
            "attempt_id": request.attempt_id,
            "attempt_number": request.attempt_number,
            "profile": request.profile,
            "started_at": run.started_at,
            "completed_at": completed_at,
            "duration_ms": duration_ms,
            "processor": run.identity,
            "input": run.input_identity,
            "artifacts": run.artifacts,
        }
        if output is not None:
            return ProcessingJobResult(
                **common,
                status=ResultStatus.SUCCEEDED,
                verdict=output.verdict,
                metadata=output.metadata,
                findings=output.findings,
                warnings=output.warnings,
            )
        assert error is not None  # noqa: S101
        status = (
            ResultStatus.CANCELLED if error.code is ErrorCode.CANCELLED else ResultStatus.FAILED
        )
        return ProcessingJobResult(**common, status=status, errors=(JobError.from_error(error),))

    def _fallback(self, run: _Run, completed_at: datetime, duration_ms: int) -> ProcessingJobResult:
        """The minimal FAILED result, built only from the already-validated request."""
        request = run.request
        error = ProcessingError(ErrorCode.UNEXPECTED_FAILURE, {"reason": "result_build"})
        return ProcessingJobResult(
            job_id=request.job_id,
            job_type=request.job_type,
            namespace=request.namespace,
            idempotency_key=request.idempotency_key,
            correlation_id=request.correlation_id,
            attempt_id=request.attempt_id,
            attempt_number=request.attempt_number,
            profile=request.profile,
            status=ResultStatus.FAILED,
            started_at=run.started_at,
            completed_at=completed_at,
            duration_ms=duration_ms,
            errors=(JobError.from_error(error),),
        )

    # Telemetry -----------------------------------------------------------------------------

    def _report(self, result: ProcessingJobResult) -> None:
        error = result.primary_error
        retry_class = result.retry_class
        fields: dict[str, str | int | None] = {
            "job_id": result.job_id,
            "attempt_id": result.attempt_id,
            "job_type": result.job_type,
            "namespace": result.namespace,
            "status": result.status.value,
            "verdict": result.verdict.value if result.verdict else None,
            "error_code": error.code.value if error else None,
            "retry_class": retry_class.value if retry_class else None,
            "duration_ms": result.duration_ms,
            "artifact_count": len(result.artifacts),
            "finding_count": len(result.findings),
        }
        self._emit(f"job.{result.status.value}", **fields)
        try:
            self.telemetry.metric(
                "job.duration",
                float(result.duration_ms),
                unit="Milliseconds",
                job_type=result.job_type,
                status=result.status.value,
            )
        except Exception:  # noqa: BLE001, S110 - telemetry must never fail a job
            pass

    def _emit(self, name: str, **fields: str | int | None) -> None:
        """Emit an event; a broken telemetry adapter must never change a job's outcome."""
        try:
            self.telemetry.event(name, **fields)
        except Exception:  # noqa: BLE001, S110
            pass

    def _mono(self) -> float:
        return float(self.clock.monotonic())
