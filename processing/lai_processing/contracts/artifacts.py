"""`ArtifactReference`: a durable, immutable pointer to one derived object.

An artifact is identified by its store, key, object version and checksum, never by a presigned
URL (a URL is a temporary access grant, issued by Django on demand). Its key must sit under the
producing attempt's prefix (`identifiers.artifact_prefix`), so one job's result cannot name
another job's artifact (cross-job substitution).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Final

from ..core.errors import ErrorCode, ProcessingError
from . import _fields as f
from .common import MAX_SIZE_BYTES, ObjectRef, ProcessorIdentity, ProfileRef
from .identifiers import (
    CONTENT_TYPE,
    DOTTED_NAME,
    LOGICAL_ID,
    MAX_CONTENT_TYPE,
    SHA256,
    UUID,
    StoreName,
    artifact_prefix,
)

__all__ = ["ArtifactReference"]

_KEYS: Final = frozenset(
    {
        "artifact_type",
        "logical_id",
        "ref",
        "content_type",
        "size_bytes",
        "sha256",
        "source_job_id",
        "source_attempt_id",
        "processor",
        "profile",
    }
)


@dataclass(frozen=True, slots=True)
class ArtifactReference:
    artifact_type: str
    logical_id: str
    ref: ObjectRef
    content_type: str
    size_bytes: int
    sha256: str
    source_job_id: str
    source_attempt_id: str
    processor: ProcessorIdentity
    profile: ProfileRef

    def __post_init__(self) -> None:
        f.string(self.artifact_type, "artifact.artifact_type", DOTTED_NAME)
        f.string(self.logical_id, "artifact.logical_id", LOGICAL_ID)
        if not isinstance(self.ref, ObjectRef) or self.ref.store is not StoreName.ARTIFACTS:
            raise ProcessingError(
                ErrorCode.INVALID_OBJECT_REFERENCE, {"field": "artifact.ref", "reason": "store"}
            )
        f.string(
            self.content_type, "artifact.content_type", CONTENT_TYPE, max_length=MAX_CONTENT_TYPE
        )
        f.integer(self.size_bytes, "artifact.size_bytes", minimum=0, maximum=MAX_SIZE_BYTES)
        f.string(self.sha256, "artifact.sha256", SHA256)
        f.string(self.source_job_id, "artifact.source_job_id", UUID, max_length=36)
        f.string(self.source_attempt_id, "artifact.source_attempt_id", UUID, max_length=36)
        if not isinstance(self.processor, ProcessorIdentity):
            raise f.invalid("artifact.processor")
        if not isinstance(self.profile, ProfileRef):
            raise f.invalid("artifact.profile")
        if self.ref.namespace is None:
            raise ProcessingError(
                ErrorCode.INVALID_OBJECT_REFERENCE, {"field": "artifact.ref", "reason": "namespace"}
            )
        prefix = artifact_prefix(self.ref.namespace, self.source_job_id, self.source_attempt_id)
        if not self.ref.key.startswith(prefix):
            raise ProcessingError(
                ErrorCode.INVALID_OBJECT_REFERENCE,
                {"field": "artifact.ref.key", "reason": "attempt_prefix"},
            )

    def belongs_to(self, job_id: str, attempt_id: str) -> bool:
        return self.source_job_id == job_id and self.source_attempt_id == attempt_id

    def to_dict(self) -> dict[str, Any]:
        return {
            "artifact_type": self.artifact_type,
            "logical_id": self.logical_id,
            "ref": self.ref.to_dict(),
            "content_type": self.content_type,
            "size_bytes": self.size_bytes,
            "sha256": self.sha256,
            "source_job_id": self.source_job_id,
            "source_attempt_id": self.source_attempt_id,
            "processor": self.processor.to_dict(),
            "profile": self.profile.to_dict(),
        }

    @classmethod
    def from_dict(cls, data: object, namespace: str, field: str = "artifact") -> ArtifactReference:
        d = f.obj(data, field)
        f.exact_keys(d, _KEYS, frozenset(), field)
        return cls(
            artifact_type=d["artifact_type"],
            logical_id=d["logical_id"],
            ref=ObjectRef.from_dict(d["ref"], f"{field}.ref", namespace),
            content_type=d["content_type"],
            size_bytes=d["size_bytes"],
            sha256=d["sha256"],
            source_job_id=d["source_job_id"],
            source_attempt_id=d["source_attempt_id"],
            processor=ProcessorIdentity.from_dict(d["processor"], f"{field}.processor"),
            profile=ProfileRef.from_dict(d["profile"], f"{field}.profile"),
        )
