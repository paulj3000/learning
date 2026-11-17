"""`ProcessingJobRequest`: the work message Django sends and a worker executes.

The envelope is generic: every job has a type, a namespace, a subject, a profile, an
idempotency key, a correlation id, an attempt, limits and options. Asset jobs additionally carry
an `AssetContext`, and the job-type catalog (`job_types.py`) decides which fields a job type
requires. The request never contains file bytes, presigned URLs, child data, or credentials.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import datetime
from types import MappingProxyType
from typing import Any, Final

from ..core.canonical import format_timestamp
from ..core.errors import ErrorCode, ProcessingError
from ..core.limits import DEFAULT_LIMITS, ResourceLimits
from . import _fields as f
from .common import (
    SCHEMA_VERSION,
    AssetContext,
    InputObject,
    MessageKind,
    ProfileRef,
    SubjectRef,
    check_namespace,
    check_schema_header,
)
from .identifiers import CORRELATION_ID, IDEMPOTENCY_KEY, UUID
from .job_types import ASSET_VERSION_SUBJECT, JobTypeSpec, job_type_spec

__all__ = ["MAX_ATTEMPT_NUMBER", "ProcessingJobRequest"]

MAX_ATTEMPT_NUMBER: Final = 100

_REQUIRED: Final = frozenset(
    {
        "kind",
        "schema_version",
        "job_id",
        "job_type",
        "namespace",
        "subject",
        "asset",
        "profile",
        "input",
        "idempotency_key",
        "correlation_id",
        "attempt_id",
        "attempt_number",
        "submitted_at",
        "expires_at",
        "options",
        "limits",
    }
)


@dataclass(frozen=True, slots=True)
class ProcessingJobRequest:
    """One attempt to run one logical job.

    Identity, from most to least stable (docs/processing/LIFECYCLE.md):
    - idempotency_key: the logical work (same input, type, profile, options, namespace).
    - job_id: Django's job row for that logical work.
    - attempt_id: one execution attempt of the job; a retry gets a new attempt id.
    - correlation_id: ties logs across Django, queues and workers; carries no meaning.
    A queue message id is a transport detail and never appears in the contract.
    """

    job_id: str
    job_type: str
    namespace: str
    subject: SubjectRef
    profile: ProfileRef
    idempotency_key: str
    correlation_id: str
    attempt_id: str
    attempt_number: int
    submitted_at: datetime
    input: InputObject | None = None
    asset: AssetContext | None = None
    expires_at: datetime | None = None
    options: Mapping[str, f.OptionValue] = field(default_factory=lambda: MappingProxyType({}))
    limits: ResourceLimits = DEFAULT_LIMITS
    schema_version: int = SCHEMA_VERSION

    def __post_init__(self) -> None:
        if self.schema_version != SCHEMA_VERSION:
            raise ProcessingError(
                ErrorCode.UNSUPPORTED_SCHEMA_VERSION, {"field": "schema_version"}
            )
        f.string(self.job_id, "job_id", UUID, max_length=36)
        spec = job_type_spec(self.job_type)
        check_namespace(self.namespace)
        if not isinstance(self.subject, SubjectRef):
            raise f.invalid("subject")
        if not isinstance(self.profile, ProfileRef):
            raise f.invalid("profile")
        f.string(self.idempotency_key, "idempotency_key", IDEMPOTENCY_KEY, max_length=68)
        f.string(self.correlation_id, "correlation_id", CORRELATION_ID)
        f.string(self.attempt_id, "attempt_id", UUID, max_length=36)
        f.integer(self.attempt_number, "attempt_number", minimum=1, maximum=MAX_ATTEMPT_NUMBER)
        object.__setattr__(self, "submitted_at", f.aware(self.submitted_at, "submitted_at"))
        if self.expires_at is not None:
            expires = f.aware(self.expires_at, "expires_at")
            if expires <= self.submitted_at:
                raise f.invalid("expires_at")
            object.__setattr__(self, "expires_at", expires)
        if self.input is not None:
            if not isinstance(self.input, InputObject):
                raise f.invalid("input")
            if self.input.ref.namespace != self.namespace:
                # Rebuild against this request's namespace so namespaced keys are re-checked.
                raise ProcessingError(
                    ErrorCode.INVALID_OBJECT_REFERENCE,
                    {"field": "input.ref.key", "reason": "namespace"},
                )
        if self.asset is not None and not isinstance(self.asset, AssetContext):
            raise f.invalid("asset")
        object.__setattr__(self, "options", f.options(self.options))
        if not isinstance(self.limits, ResourceLimits):
            raise f.invalid("limits")
        if self.input is not None and self.input.size_bytes > self.limits.max_input_bytes:
            raise ProcessingError(
                ErrorCode.RESOURCE_LIMIT_EXCEEDED, {"field": "input.size_bytes"}
            )
        self._check_against_spec(spec)

    def _check_against_spec(self, spec: JobTypeSpec) -> None:
        if spec.requires_input and self.input is None:
            raise f.invalid("input")
        if spec.requires_asset and self.asset is None:
            raise f.invalid("asset")
        if spec.subject_type is not None and self.subject.subject_type != spec.subject_type:
            raise f.invalid("subject.subject_type")
        if self.asset is not None and self.subject.subject_type == ASSET_VERSION_SUBJECT:
            if self.subject.subject_id != self.asset.asset_version_id:
                raise f.invalid("subject.subject_id")

    @property
    def spec(self) -> JobTypeSpec:
        return job_type_spec(self.job_type)

    def is_expired(self, now: datetime) -> bool:
        return self.expires_at is not None and now >= self.expires_at

    def to_dict(self) -> dict[str, Any]:
        return {
            "kind": MessageKind.JOB_REQUEST,
            "schema_version": self.schema_version,
            "job_id": self.job_id,
            "job_type": self.job_type,
            "namespace": self.namespace,
            "subject": self.subject.to_dict(),
            "asset": self.asset.to_dict() if self.asset else None,
            "profile": self.profile.to_dict(),
            "input": self.input.to_dict() if self.input else None,
            "idempotency_key": self.idempotency_key,
            "correlation_id": self.correlation_id,
            "attempt_id": self.attempt_id,
            "attempt_number": self.attempt_number,
            "submitted_at": format_timestamp(self.submitted_at),
            "expires_at": format_timestamp(self.expires_at) if self.expires_at else None,
            "options": f.options_to_json(self.options),
            "limits": self.limits.to_dict(),
        }

    @classmethod
    def from_dict(cls, data: object) -> ProcessingJobRequest:
        d = f.obj(data, "request")
        check_schema_header(d, MessageKind.JOB_REQUEST)
        f.exact_keys(d, _REQUIRED, frozenset(), "")
        namespace = check_namespace(d["namespace"])
        return cls(
            schema_version=d["schema_version"],
            job_id=d["job_id"],
            job_type=d["job_type"],
            namespace=namespace,
            subject=SubjectRef.from_dict(d["subject"]),
            asset=AssetContext.from_dict(d["asset"]) if d["asset"] is not None else None,
            profile=ProfileRef.from_dict(d["profile"]),
            input=InputObject.from_dict(d["input"], namespace) if d["input"] is not None else None,
            idempotency_key=d["idempotency_key"],
            correlation_id=d["correlation_id"],
            attempt_id=d["attempt_id"],
            attempt_number=d["attempt_number"],
            submitted_at=f.timestamp(d["submitted_at"], "submitted_at"),
            expires_at=(
                f.timestamp(d["expires_at"], "expires_at") if d["expires_at"] is not None else None
            ),
            options=f.options(d["options"]),
            limits=ResourceLimits.from_dict(f.obj(d["limits"], "limits")),
        )
