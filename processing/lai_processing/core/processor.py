"""The processor interface: what a processor implements and what the engine hands it.

A processor is plain code registered explicitly in `core.registry`; it is never loaded from a
message. It receives a `ProcessingContext` holding the verified input copy, the resolved
options, the effective (clamped) limits and the ports, and returns a `ProcessorOutput`. It
never builds a job result itself: the execution engine owns status, errors, timing and the
contract invariants, so a processor cannot report success for a job the engine refused.

Artifacts are written only through `ProcessingContext.write_artifact`, which confines every key
to the attempt's own prefix, enforces the artifact count and output byte limits, and records
the reference for the result. A processor has no other way to name an output location.
"""

from __future__ import annotations

import abc
import io
import threading
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from types import MappingProxyType
from typing import Any, ClassVar, Final

from ..contracts.artifacts import ArtifactReference
from ..contracts.common import ObjectRef, ProcessorIdentity
from ..contracts.events import RESULT_LOGICAL_ID
from ..contracts.identifiers import StoreName, artifact_key
from ..contracts.job_types import job_type_spec
from ..contracts.jobs import ProcessingJobRequest
from ..contracts.profiles import ProcessingProfile
from ..contracts.results import Finding, ProcessingWarning, Verdict
from ..ports.clock import Clock
from ..ports.storage import ObjectStorage
from ..ports.telemetry import Telemetry
from .canonical import sha256_hex
from .errors import ErrorCode, ProcessingError
from .limits import ResourceLimits
from .workspace import Workspace

__all__ = [
    "RESERVED_LOGICAL_IDS",
    "CancellationToken",
    "ProcessingContext",
    "Processor",
    "ProcessorOutput",
]

# Logical ids a processor may not use: `job-result` is where the engine stores an oversized
# result (`ExecutionEngine.complete`), so a processor must never pre-empt or collide with it.
RESERVED_LOGICAL_IDS: Final = frozenset({RESULT_LOGICAL_ID})


@dataclass(frozen=True, slots=True)
class ProcessorOutput:
    """What a processor concluded. Status, errors and artifacts are added by the engine.

    Findings and warnings validate themselves on construction (code-authored text only); the
    metadata must be plain JSON data and is size-checked by the engine against the job limit.
    """

    verdict: Verdict
    metadata: Mapping[str, Any] = field(default_factory=lambda: MappingProxyType({}))
    findings: tuple[Finding, ...] = ()
    warnings: tuple[ProcessingWarning, ...] = ()

    def __post_init__(self) -> None:
        object.__setattr__(self, "verdict", Verdict(self.verdict))
        if not isinstance(self.metadata, Mapping):
            raise TypeError("metadata must be a mapping")
        findings = tuple(self.findings)
        warnings = tuple(self.warnings)
        if not all(isinstance(item, Finding) for item in findings):
            raise TypeError("findings must be Finding instances")
        if not all(isinstance(item, ProcessingWarning) for item in warnings):
            raise TypeError("warnings must be ProcessingWarning instances")
        object.__setattr__(self, "findings", findings)
        object.__setattr__(self, "warnings", warnings)


class CancellationToken:
    """A thread-safe, one-way cancellation flag.

    A Lambda adapter cancels the token when the remaining invocation time runs low; a local
    runner cancels it on a signal. Processors observe it cooperatively via `context.check()`.
    """

    __slots__ = ("_event",)

    def __init__(self) -> None:
        self._event = threading.Event()

    def cancel(self) -> None:
        self._event.set()

    @property
    def cancelled(self) -> bool:
        return self._event.is_set()

    def raise_if_cancelled(self) -> None:
        if self._event.is_set():
            raise ProcessingError(ErrorCode.CANCELLED)


@dataclass
class ProcessingContext:
    """Everything one processor run may use. Built by the engine, never by a message.

    - options: the profile-resolved options (defaults filled, unknown options already refused).
    - limits: the effective limits, i.e. the request's limits clamped to the worker ceilings.
    - deadline: a `clock.monotonic()` value; `check()` raises PROCESSING_TIMEOUT once reached.
    - input_path: the verified copy of the input inside the workspace (None until verified and
      for job types without input). Processors read this copy, never the store, so they only
      ever see bytes whose size and SHA-256 matched the request.
    """

    request: ProcessingJobRequest
    profile: ProcessingProfile
    options: Mapping[str, Any]
    limits: ResourceLimits
    storage: ObjectStorage
    telemetry: Telemetry
    clock: Clock
    workspace: Workspace
    cancellation: CancellationToken
    deadline: float
    processor: ProcessorIdentity
    input_path: Path | None = None
    artifacts: list[ArtifactReference] = field(default_factory=list)
    output_bytes: int = 0

    def check(self) -> None:
        """Cooperative checkpoint: refuse to continue a cancelled or overdue job."""
        self.cancellation.raise_if_cancelled()
        if self.clock.monotonic() >= self.deadline:
            raise ProcessingError(ErrorCode.PROCESSING_TIMEOUT, {"limit": "max_execution_seconds"})

    def _check_role(self, role: str, content_type: str, extension: str, size: int) -> None:
        """The worker-side half of the artifact declaration (ADR-066): the role must be declared
        for this job type, the content type and extension allowed for it, the size within its
        bound and the count within its maximum. Django applies the same rules on the result."""
        declared = job_type_spec(self.request.job_type).role(role)
        if declared is None or declared.producer != "job":
            raise ProcessingError(
                ErrorCode.ARTIFACT_CONFLICT, {"field": "artifact_type", "reason": "role"}
            )
        if content_type not in declared.content_types or extension not in declared.extensions_for(
            content_type
        ):
            raise ProcessingError(
                ErrorCode.ARTIFACT_CONFLICT, {"field": "content_type", "reason": "role"}
            )
        if size > declared.max_size_bytes:
            raise ProcessingError(ErrorCode.RESOURCE_LIMIT_EXCEEDED, {"limit": "role_size"})
        if sum(1 for a in self.artifacts if a.artifact_type == role) >= declared.max_count:
            raise ProcessingError(ErrorCode.RESOURCE_LIMIT_EXCEEDED, {"limit": "role_count"})

    def write_artifact(
        self,
        *,
        logical_id: str,
        artifact_type: str,
        data: bytes,
        content_type: str,
        extension: str,
    ) -> ArtifactReference:
        """Store `data` as an artifact of this attempt and record its reference.

        The key is always `artifact_key(namespace, job_id, attempt_id, logical_id, extension)`:
        a processor chooses only the logical id and extension, both pattern-checked, so it can
        never write outside its attempt's prefix or into another store. Limits are checked
        before the store is touched, and the reference is validated before the write, so a
        refused artifact leaves no object behind.
        """
        self.check()
        if not isinstance(data, (bytes, bytearray)):
            raise TypeError("artifact data must be bytes")
        data = bytes(data)
        if logical_id in RESERVED_LOGICAL_IDS or any(
            a.logical_id == logical_id for a in self.artifacts
        ):
            raise ProcessingError(
                ErrorCode.ARTIFACT_CONFLICT, {"field": "logical_id", "reason": "duplicate"}
            )
        self._check_role(artifact_type, content_type, extension, len(data))
        if len(self.artifacts) >= self.limits.max_artifact_count:
            raise ProcessingError(
                ErrorCode.RESOURCE_LIMIT_EXCEEDED, {"limit": "max_artifact_count"}
            )
        if self.output_bytes + len(data) > self.limits.max_output_bytes:
            raise ProcessingError(ErrorCode.RESOURCE_LIMIT_EXCEEDED, {"limit": "max_output_bytes"})
        namespace = self.request.namespace
        key = artifact_key(
            namespace, self.request.job_id, self.request.attempt_id, logical_id, extension
        )
        digest = sha256_hex(data)
        unversioned = ObjectRef(StoreName.ARTIFACTS, key, None, namespace)
        # Validate the full reference (type, content type, prefix) before writing anything.
        ArtifactReference(
            artifact_type=artifact_type,
            logical_id=logical_id,
            ref=unversioned,
            content_type=content_type,
            size_bytes=len(data),
            sha256=digest,
            source_job_id=self.request.job_id,
            source_attempt_id=self.request.attempt_id,
            processor=self.processor,
            profile=self.profile.ref,
        )
        info = self.storage.put(
            unversioned,
            io.BytesIO(data),
            content_type=content_type,
            sha256=digest,
            size_bytes=len(data),
        )
        reference = ArtifactReference(
            artifact_type=artifact_type,
            logical_id=logical_id,
            ref=ObjectRef(StoreName.ARTIFACTS, key, info.version_id, namespace),
            content_type=content_type,
            size_bytes=len(data),
            sha256=digest,
            source_job_id=self.request.job_id,
            source_attempt_id=self.request.attempt_id,
            processor=self.processor,
            profile=self.profile.ref,
        )
        self.output_bytes += len(data)
        self.artifacts.append(reference)
        return reference


class Processor(abc.ABC):
    """Base class for every processor.

    Subclasses declare `processor_id` (dotted name), `version` (semver) and `job_types` as
    class attributes, and return their immutable profiles from `profiles()`. `validate` may
    refuse a job before processing by raising `ProcessingError`; `process` does the work;
    `cleanup` always runs afterwards (the engine swallows and reports its failures).
    """

    processor_id: ClassVar[str]
    version: ClassVar[str]
    job_types: ClassVar[frozenset[str]]

    @abc.abstractmethod
    def profiles(self) -> tuple[ProcessingProfile, ...]:
        """The profiles this processor serves. Each must name one of `job_types`."""

    def validate(self, context: ProcessingContext) -> None:  # noqa: B027 - optional hook
        """Refuse an unsuitable job by raising `ProcessingError`. Default: accept."""

    @abc.abstractmethod
    def process(self, context: ProcessingContext) -> ProcessorOutput:
        """Do the work. Call `context.check()` regularly in long loops."""

    def cleanup(self, context: ProcessingContext) -> None:  # noqa: B027 - optional hook
        """Release processor resources. The workspace itself is removed by the engine."""

    @property
    def identity(self) -> ProcessorIdentity:
        return ProcessorIdentity(processor_id=self.processor_id, processor_version=self.version)
