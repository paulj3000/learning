"""`CompletionEvent`: the message a worker sends to the completion queue.

The event carries the result inline when it fits the message limit, and otherwise a reference
to the result stored as an artifact (`artifact_type == "report.job_result"`). Either way it
carries `result_sha256`, the SHA-256 of the result's canonical JSON, so the consumer can check
that the result it reads is the one the worker emitted.

The event is not trusted on its own. Django accepts it only when the job, attempt, idempotency
key, namespace and input checksum match its own record (docs/processing/LIFECYCLE.md). Queue
permissions (only the worker role may send) are the transport-level control (Wave 2, LAI-LAMBDA-005).
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Final

from ..core.canonical import canonical_json, format_timestamp, sha256_hex
from ..core.errors import ErrorCode, ProcessingError, RetryClass
from . import _fields as f
from .artifacts import ArtifactReference
from .common import SCHEMA_VERSION, MessageKind, check_namespace, check_schema_header
from .identifiers import CORRELATION_ID, IDEMPOTENCY_KEY, SHA256, UUID
from .jobs import MAX_ATTEMPT_NUMBER
from .job_types import job_type_spec
from .results import ProcessingJobResult, ResultStatus

__all__ = ["RESULT_ARTIFACT_TYPE", "CompletionEvent", "build_completion_event"]

RESULT_ARTIFACT_TYPE: Final = "report.job_result"
RESULT_LOGICAL_ID: Final = "job-result"

_KEYS: Final = frozenset(
    {
        "kind",
        "schema_version",
        "event_id",
        "emitted_at",
        "job_id",
        "job_type",
        "namespace",
        "idempotency_key",
        "correlation_id",
        "attempt_id",
        "attempt_number",
        "status",
        "retry_class",
        "result_sha256",
        "result",
        "result_ref",
    }
)

# The envelope fields that must equal the same fields of the result they describe.
_MIRRORED: Final = (
    "job_id",
    "job_type",
    "namespace",
    "idempotency_key",
    "correlation_id",
    "attempt_id",
    "attempt_number",
    "status",
)


def result_digest(result: ProcessingJobResult) -> str:
    return sha256_hex(canonical_json(result.to_dict()))


@dataclass(frozen=True, slots=True)
class CompletionEvent:
    event_id: str
    emitted_at: datetime
    job_id: str
    job_type: str
    namespace: str
    idempotency_key: str
    correlation_id: str
    attempt_id: str
    attempt_number: int
    status: ResultStatus
    result_sha256: str
    result: ProcessingJobResult | None = None
    result_ref: ArtifactReference | None = None
    schema_version: int = SCHEMA_VERSION

    def __post_init__(self) -> None:
        if self.schema_version != SCHEMA_VERSION:
            raise ProcessingError(
                ErrorCode.UNSUPPORTED_SCHEMA_VERSION, {"field": "schema_version"}
            )
        f.string(self.event_id, "event_id", UUID, max_length=36)
        object.__setattr__(self, "emitted_at", f.aware(self.emitted_at, "emitted_at"))
        f.string(self.job_id, "job_id", UUID, max_length=36)
        job_type_spec(self.job_type)
        check_namespace(self.namespace)
        f.string(self.idempotency_key, "idempotency_key", IDEMPOTENCY_KEY, max_length=68)
        f.string(self.correlation_id, "correlation_id", CORRELATION_ID)
        f.string(self.attempt_id, "attempt_id", UUID, max_length=36)
        f.integer(self.attempt_number, "attempt_number", minimum=1, maximum=MAX_ATTEMPT_NUMBER)
        try:
            object.__setattr__(self, "status", ResultStatus(self.status))
        except ValueError:
            raise f.invalid("status") from None
        f.string(self.result_sha256, "result_sha256", SHA256)
        if (self.result is None) == (self.result_ref is None):
            raise f.invalid("result")
        if self.result is not None:
            if not isinstance(self.result, ProcessingJobResult):
                raise f.invalid("result")
            self.verify_result(self.result)
        if self.result_ref is not None:
            ref = self.result_ref
            if not isinstance(ref, ArtifactReference) or ref.artifact_type != RESULT_ARTIFACT_TYPE:
                raise f.invalid("result_ref")
            if not ref.belongs_to(self.job_id, self.attempt_id) or ref.sha256 != self.result_sha256:
                raise f.invalid("result_ref")
            if ref.ref.namespace != self.namespace:
                raise f.invalid("result_ref")

    @property
    def retry_class(self) -> RetryClass | None:
        return self.result.retry_class if self.result is not None else None

    def verify_result(self, result: ProcessingJobResult) -> None:
        """Check that `result` is exactly the result this event describes (used for inline
        results here, and by the consumer after it reads a referenced result)."""
        for name in _MIRRORED:
            if getattr(result, name) != getattr(self, name):
                raise f.invalid(f"result.{name}")
        if result_digest(result) != self.result_sha256:
            raise ProcessingError(ErrorCode.CHECKSUM_MISMATCH, {"field": "result_sha256"})

    def to_dict(self) -> dict[str, Any]:
        rc = self.retry_class
        return {
            "kind": MessageKind.JOB_COMPLETED,
            "schema_version": self.schema_version,
            "event_id": self.event_id,
            "emitted_at": format_timestamp(self.emitted_at),
            "job_id": self.job_id,
            "job_type": self.job_type,
            "namespace": self.namespace,
            "idempotency_key": self.idempotency_key,
            "correlation_id": self.correlation_id,
            "attempt_id": self.attempt_id,
            "attempt_number": self.attempt_number,
            "status": self.status.value,
            "retry_class": rc.value if rc else None,
            "result_sha256": self.result_sha256,
            "result": self.result.to_dict() if self.result else None,
            "result_ref": self.result_ref.to_dict() if self.result_ref else None,
        }

    @classmethod
    def from_dict(cls, data: object) -> CompletionEvent:
        d = f.obj(data, "event")
        check_schema_header(d, MessageKind.JOB_COMPLETED)
        f.exact_keys(d, _KEYS, frozenset(), "")
        namespace = check_namespace(d["namespace"])
        event = cls(
            schema_version=d["schema_version"],
            event_id=d["event_id"],
            emitted_at=f.timestamp(d["emitted_at"], "emitted_at"),
            job_id=d["job_id"],
            job_type=d["job_type"],
            namespace=namespace,
            idempotency_key=d["idempotency_key"],
            correlation_id=d["correlation_id"],
            attempt_id=d["attempt_id"],
            attempt_number=d["attempt_number"],
            status=d["status"],
            result_sha256=d["result_sha256"],
            result=(
                ProcessingJobResult.from_dict(d["result"]) if d["result"] is not None else None
            ),
            result_ref=(
                ArtifactReference.from_dict(d["result_ref"], namespace, "result_ref")
                if d["result_ref"] is not None
                else None
            ),
        )
        declared = d["retry_class"]
        if event.result is not None:
            actual = event.retry_class
            if declared != (actual.value if actual else None):
                raise f.invalid("retry_class")
        elif declared is not None:
            try:
                RetryClass(declared)
            except ValueError:
                raise f.invalid("retry_class") from None
        return event


def build_completion_event(
    result: ProcessingJobResult,
    *,
    event_id: str,
    emitted_at: datetime,
    max_message_bytes: int,
    store_result: Callable[[bytes, str], ArtifactReference] | None = None,
) -> CompletionEvent:
    """Build the event, inlining the result when the encoded event fits `max_message_bytes`.

    Otherwise `store_result(result_bytes, sha256)` must store the canonical result JSON as an
    artifact of the same attempt and return its reference. Without it, an oversized result is
    refused with MESSAGE_TOO_LARGE: large data never travels on the queue.
    """
    digest = result_digest(result)
    common: dict[str, Any] = {
        "event_id": event_id,
        "emitted_at": emitted_at,
        "job_id": result.job_id,
        "job_type": result.job_type,
        "namespace": result.namespace,
        "idempotency_key": result.idempotency_key,
        "correlation_id": result.correlation_id,
        "attempt_id": result.attempt_id,
        "attempt_number": result.attempt_number,
        "status": result.status,
        "result_sha256": digest,
    }
    inline = CompletionEvent(**common, result=result)
    if len(canonical_json(inline.to_dict())) <= max_message_bytes:
        return inline
    if store_result is None:
        raise ProcessingError(ErrorCode.MESSAGE_TOO_LARGE, {"field": "event"})
    ref = store_result(canonical_json(result.to_dict()), digest)
    by_ref = CompletionEvent(**common, result_ref=ref)
    if len(canonical_json(by_ref.to_dict())) > max_message_bytes:
        raise ProcessingError(ErrorCode.MESSAGE_TOO_LARGE, {"field": "event"})
    return by_ref
