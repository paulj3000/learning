"""`ProcessingJobResult`: what one attempt produced.

Processing success is not asset approval. `status` says whether the worker ran the job to the
end; `verdict` says what the processor concluded about the input (for a validator: pass or
fail). Neither publishes anything: Django records the result for staff review, and only a staff
action in Django Admin publishes an asset (ADR-045, ADR-061).

Findings use the Asset Library's finding shape (`code`, `severity`, `message`, `path`), so a
model validator's result maps directly onto `AssetVersion.validation_report`.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from types import MappingProxyType
from typing import Any, Final

from ..core.canonical import canonical_json, format_timestamp
from ..core.errors import (
    ERROR_CLASSIFICATION,
    SAFE_MESSAGES,
    ErrorCode,
    ProcessingError,
    RetryClass,
    safe_details,
)
from . import _fields as f
from .artifacts import ArtifactReference
from .common import (
    MAX_SIZE_BYTES,
    SCHEMA_VERSION,
    MessageKind,
    ObjectRef,
    ProcessorIdentity,
    ProfileRef,
    check_namespace,
    check_schema_header,
)
from .identifiers import CORRELATION_ID, IDEMPOTENCY_KEY, SHA256, SNAKE, UUID
from .jobs import MAX_ATTEMPT_NUMBER
from .job_types import job_type_spec

__all__ = [
    "MAX_FINDINGS",
    "MAX_RESULT_METADATA_BYTES",
    "MAX_WARNINGS",
    "Finding",
    "InputIdentity",
    "JobError",
    "ProcessingJobResult",
    "ProcessingWarning",
    "ResultStatus",
    "Severity",
    "Verdict",
]

MAX_FINDINGS: Final = 500
MAX_WARNINGS: Final = 50
MAX_ERRORS: Final = 8
MAX_MESSAGE_TEXT: Final = 500
MAX_PATH_TEXT: Final = 200
# Absolute contract ceiling; the job's own `limits.max_metadata_bytes` is usually lower.
MAX_RESULT_METADATA_BYTES: Final = 256 * 1024


class ResultStatus(StrEnum):
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


class Verdict(StrEnum):
    PASS = "pass"
    FAIL = "fail"
    NOT_APPLICABLE = "not_applicable"


class Severity(StrEnum):
    ERROR = "error"
    WARNING = "warning"
    INFO = "info"


def _enum(enum: type[StrEnum], value: object, field: str) -> Any:
    try:
        return enum(value)  # type: ignore[arg-type]
    except ValueError:
        raise f.invalid(field) from None


@dataclass(frozen=True, slots=True)
class Finding:
    """One validation finding. Messages are authored by processor code, never input text."""

    code: str
    severity: Severity
    message: str
    path: str = ""

    def __post_init__(self) -> None:
        f.string(self.code, "finding.code", SNAKE)
        object.__setattr__(self, "severity", _enum(Severity, self.severity, "finding.severity"))
        f.text(self.message, "finding.message", max_length=MAX_MESSAGE_TEXT)
        f.text(self.path, "finding.path", max_length=MAX_PATH_TEXT)

    def to_dict(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "severity": self.severity.value,
            "message": self.message,
            "path": self.path,
        }

    @classmethod
    def from_dict(cls, data: object) -> Finding:
        d = f.obj(data, "finding")
        f.exact_keys(d, frozenset({"code", "severity", "message", "path"}), frozenset(), "finding")
        return cls(code=d["code"], severity=d["severity"], message=d["message"], path=d["path"])


@dataclass(frozen=True, slots=True)
class ProcessingWarning:
    """A note about the processing run itself (not about the input's validity)."""

    code: str
    message: str

    def __post_init__(self) -> None:
        f.string(self.code, "warning.code", SNAKE)
        f.text(self.message, "warning.message", max_length=MAX_MESSAGE_TEXT)

    def to_dict(self) -> dict[str, Any]:
        return {"code": self.code, "message": self.message}

    @classmethod
    def from_dict(cls, data: object) -> ProcessingWarning:
        d = f.obj(data, "warning")
        f.exact_keys(d, frozenset({"code", "message"}), frozenset(), "warning")
        return cls(code=d["code"], message=d["message"])


@dataclass(frozen=True, slots=True)
class JobError:
    """A classified error. Its message is always the fixed safe text for its code, and its
    retry class always the code's classification: a result cannot smuggle free text."""

    code: ErrorCode
    retry_class: RetryClass
    message: str
    details: Mapping[str, str | int | float | bool | None] = field(
        default_factory=lambda: MappingProxyType({})
    )

    def __post_init__(self) -> None:
        code = _enum(ErrorCode, self.code, "error.code")
        object.__setattr__(self, "code", code)
        retry_class = _enum(RetryClass, self.retry_class, "error.retry_class")
        if retry_class is not ERROR_CLASSIFICATION[code]:
            raise f.invalid("error.retry_class")
        object.__setattr__(self, "retry_class", retry_class)
        if self.message != SAFE_MESSAGES[code]:
            raise f.invalid("error.message")
        details = f.obj(self.details, "error.details")
        if safe_details(details) != dict(details):
            raise f.invalid("error.details")
        object.__setattr__(self, "details", MappingProxyType(dict(details)))

    @classmethod
    def from_error(cls, error: ProcessingError) -> JobError:
        return cls(
            code=error.code,
            retry_class=error.retry_class,
            message=error.safe_message,
            details=error.details,
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "code": self.code.value,
            "retry_class": self.retry_class.value,
            "message": self.message,
            "details": dict(self.details),
        }

    @classmethod
    def from_dict(cls, data: object) -> JobError:
        d = f.obj(data, "error")
        f.exact_keys(
            d, frozenset({"code", "retry_class", "message", "details"}), frozenset(), "error"
        )
        return cls(
            code=d["code"],
            retry_class=d["retry_class"],
            message=d["message"],
            details=f.obj(d["details"], "error.details"),
        )


@dataclass(frozen=True, slots=True)
class InputIdentity:
    """The input as the worker observed it. `verified` is true only when the worker read the
    whole object and its size and SHA-256 matched the request."""

    ref: ObjectRef
    sha256: str
    size_bytes: int
    verified: bool

    def __post_init__(self) -> None:
        if not isinstance(self.ref, ObjectRef):
            raise f.invalid("input.ref")
        f.string(self.sha256, "input.sha256", SHA256)
        f.integer(self.size_bytes, "input.size_bytes", minimum=0, maximum=MAX_SIZE_BYTES)
        f.boolean(self.verified, "input.verified")

    def to_dict(self) -> dict[str, Any]:
        return {
            "ref": self.ref.to_dict(),
            "sha256": self.sha256,
            "size_bytes": self.size_bytes,
            "verified": self.verified,
        }

    @classmethod
    def from_dict(cls, data: object, namespace: str) -> InputIdentity:
        d = f.obj(data, "input")
        f.exact_keys(d, frozenset({"ref", "sha256", "size_bytes", "verified"}), frozenset(), "input")
        return cls(
            ref=ObjectRef.from_dict(d["ref"], "input.ref", namespace),
            sha256=d["sha256"],
            size_bytes=d["size_bytes"],
            verified=d["verified"],
        )


_RESULT_KEYS: Final = frozenset(
    {
        "kind",
        "schema_version",
        "job_id",
        "job_type",
        "namespace",
        "idempotency_key",
        "correlation_id",
        "attempt_id",
        "attempt_number",
        "processor",
        "profile",
        "status",
        "verdict",
        "retry_class",
        "input",
        "started_at",
        "completed_at",
        "duration_ms",
        "metadata",
        "findings",
        "warnings",
        "errors",
        "artifacts",
    }
)


@dataclass(frozen=True, slots=True)
class ProcessingJobResult:
    job_id: str
    job_type: str
    namespace: str
    idempotency_key: str
    correlation_id: str
    attempt_id: str
    attempt_number: int
    profile: ProfileRef
    status: ResultStatus
    started_at: datetime
    completed_at: datetime
    duration_ms: int
    processor: ProcessorIdentity | None = None
    verdict: Verdict | None = None
    input: InputIdentity | None = None
    metadata: Mapping[str, Any] = field(default_factory=lambda: MappingProxyType({}))
    findings: tuple[Finding, ...] = ()
    warnings: tuple[ProcessingWarning, ...] = ()
    errors: tuple[JobError, ...] = ()
    artifacts: tuple[ArtifactReference, ...] = ()
    schema_version: int = SCHEMA_VERSION

    def __post_init__(self) -> None:
        if self.schema_version != SCHEMA_VERSION:
            raise ProcessingError(
                ErrorCode.UNSUPPORTED_SCHEMA_VERSION, {"field": "schema_version"}
            )
        f.string(self.job_id, "job_id", UUID, max_length=36)
        job_type_spec(self.job_type)
        check_namespace(self.namespace)
        f.string(self.idempotency_key, "idempotency_key", IDEMPOTENCY_KEY, max_length=68)
        f.string(self.correlation_id, "correlation_id", CORRELATION_ID)
        f.string(self.attempt_id, "attempt_id", UUID, max_length=36)
        f.integer(self.attempt_number, "attempt_number", minimum=1, maximum=MAX_ATTEMPT_NUMBER)
        if not isinstance(self.profile, ProfileRef):
            raise f.invalid("profile")
        if self.processor is not None and not isinstance(self.processor, ProcessorIdentity):
            raise f.invalid("processor")
        status = _enum(ResultStatus, self.status, "status")
        object.__setattr__(self, "status", status)
        if self.verdict is not None:
            object.__setattr__(self, "verdict", _enum(Verdict, self.verdict, "verdict"))
        if self.input is not None and not isinstance(self.input, InputIdentity):
            raise f.invalid("input")
        started = f.aware(self.started_at, "started_at")
        completed = f.aware(self.completed_at, "completed_at")
        if completed < started:
            raise f.invalid("completed_at")
        object.__setattr__(self, "started_at", started)
        object.__setattr__(self, "completed_at", completed)
        f.integer(self.duration_ms, "duration_ms", minimum=0, maximum=86_400_000)
        metadata = f.frozen_json_object(self.metadata, "metadata")
        if len(canonical_json(dict(metadata))) > MAX_RESULT_METADATA_BYTES:
            raise ProcessingError(ErrorCode.RESOURCE_LIMIT_EXCEEDED, {"field": "metadata"})
        object.__setattr__(self, "metadata", metadata)
        self._check_sequences()
        self._check_status_invariants()

    def _check_sequences(self) -> None:
        for name, kind, limit in (
            ("findings", Finding, MAX_FINDINGS),
            ("warnings", ProcessingWarning, MAX_WARNINGS),
            ("errors", JobError, MAX_ERRORS),
            ("artifacts", ArtifactReference, None),
        ):
            items = tuple(getattr(self, name))
            if limit is not None and len(items) > limit:
                raise ProcessingError(ErrorCode.RESOURCE_LIMIT_EXCEEDED, {"field": name})
            if not all(isinstance(item, kind) for item in items):
                raise f.invalid(name)
            object.__setattr__(self, name, items)
        seen: set[str] = set()
        for artifact in self.artifacts:
            if not artifact.belongs_to(self.job_id, self.attempt_id):
                raise ProcessingError(
                    ErrorCode.INVALID_OBJECT_REFERENCE,
                    {"field": "artifacts", "reason": "foreign_artifact"},
                )
            if artifact.ref.namespace != self.namespace:
                raise ProcessingError(
                    ErrorCode.INVALID_OBJECT_REFERENCE, {"field": "artifacts", "reason": "namespace"}
                )
            if artifact.profile != self.profile or artifact.processor != self.processor:
                raise f.invalid("artifacts")
            if artifact.logical_id in seen:
                raise f.invalid("artifacts")
            seen.add(artifact.logical_id)

    def _check_status_invariants(self) -> None:
        if self.status is ResultStatus.SUCCEEDED:
            if self.errors or self.retry_class is not None:
                raise f.invalid("errors")
            if self.verdict is None:
                raise f.invalid("verdict")
            if self.processor is None:
                raise f.invalid("processor")
            if self.verdict is Verdict.PASS and any(
                x.severity is Severity.ERROR for x in self.findings
            ):
                raise f.invalid("verdict")
        else:
            if not self.errors:
                raise f.invalid("errors")
            if self.verdict is not None:
                raise f.invalid("verdict")
            cancelled = self.errors[0].code is ErrorCode.CANCELLED
            if (self.status is ResultStatus.CANCELLED) != cancelled:
                raise f.invalid("status")

    @property
    def retry_class(self) -> RetryClass | None:
        """The retry class of the primary (first) error; None for a success."""
        return self.errors[0].retry_class if self.errors else None

    @property
    def primary_error(self) -> JobError | None:
        return self.errors[0] if self.errors else None

    def to_dict(self) -> dict[str, Any]:
        rc = self.retry_class
        return {
            "kind": MessageKind.JOB_RESULT,
            "schema_version": self.schema_version,
            "job_id": self.job_id,
            "job_type": self.job_type,
            "namespace": self.namespace,
            "idempotency_key": self.idempotency_key,
            "correlation_id": self.correlation_id,
            "attempt_id": self.attempt_id,
            "attempt_number": self.attempt_number,
            "processor": self.processor.to_dict() if self.processor else None,
            "profile": self.profile.to_dict(),
            "status": self.status.value,
            "verdict": self.verdict.value if self.verdict else None,
            "retry_class": rc.value if rc else None,
            "input": self.input.to_dict() if self.input else None,
            "started_at": format_timestamp(self.started_at),
            "completed_at": format_timestamp(self.completed_at),
            "duration_ms": self.duration_ms,
            "metadata": f.json_value(dict(self.metadata), "metadata"),
            "findings": [x.to_dict() for x in self.findings],
            "warnings": [x.to_dict() for x in self.warnings],
            "errors": [x.to_dict() for x in self.errors],
            "artifacts": [x.to_dict() for x in self.artifacts],
        }

    @classmethod
    def from_dict(cls, data: object) -> ProcessingJobResult:
        d = f.obj(data, "result")
        check_schema_header(d, MessageKind.JOB_RESULT)
        f.exact_keys(d, _RESULT_KEYS, frozenset(), "")
        namespace = check_namespace(d["namespace"])

        def seq(name: str, limit: int | None) -> list[Any]:
            value = d[name]
            if not isinstance(value, list):
                raise f.invalid(name)
            if limit is not None and len(value) > limit:
                raise ProcessingError(ErrorCode.RESOURCE_LIMIT_EXCEEDED, {"field": name})
            return value

        result = cls(
            schema_version=d["schema_version"],
            job_id=d["job_id"],
            job_type=d["job_type"],
            namespace=namespace,
            idempotency_key=d["idempotency_key"],
            correlation_id=d["correlation_id"],
            attempt_id=d["attempt_id"],
            attempt_number=d["attempt_number"],
            processor=(
                ProcessorIdentity.from_dict(d["processor"]) if d["processor"] is not None else None
            ),
            profile=ProfileRef.from_dict(d["profile"]),
            status=_enum(ResultStatus, d["status"], "status"),
            verdict=_enum(Verdict, d["verdict"], "verdict") if d["verdict"] is not None else None,
            input=InputIdentity.from_dict(d["input"], namespace) if d["input"] is not None else None,
            started_at=f.timestamp(d["started_at"], "started_at"),
            completed_at=f.timestamp(d["completed_at"], "completed_at"),
            duration_ms=d["duration_ms"],
            metadata=f.obj(d["metadata"], "metadata"),
            findings=tuple(Finding.from_dict(x) for x in seq("findings", MAX_FINDINGS)),
            warnings=tuple(ProcessingWarning.from_dict(x) for x in seq("warnings", MAX_WARNINGS)),
            errors=tuple(JobError.from_dict(x) for x in seq("errors", MAX_ERRORS)),
            artifacts=tuple(
                ArtifactReference.from_dict(x, namespace, "artifact")
                for x in seq("artifacts", None)
            ),
        )
        declared = d["retry_class"]
        actual = result.retry_class
        if declared != (actual.value if actual else None):
            raise f.invalid("retry_class")
        return result
