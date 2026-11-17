"""Building blocks shared by requests, results, artifacts and events.

All contracts are frozen dataclasses that validate themselves on construction, whether built in
code or decoded from JSON (`from_dict`). `from_dict` refuses unknown and missing keys; `to_dict`
returns plain JSON data that `canonical_json` encodes deterministically.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Final

from ..core.errors import ErrorCode, ProcessingError
from . import _fields as f
from .identifiers import (
    ASSET_ID,
    CONTENT_TYPE,
    DOTTED_NAME,
    INPUT_STORES,
    MAX_CONTENT_TYPE,
    NAMESPACE,
    OBJECT_VERSION_ID,
    SEMVER,
    SHA256,
    SLUG,
    SNAKE,
    SUBJECT_ID,
    UUID,
    StoreName,
    check_object_key,
)

__all__ = [
    "SCHEMA_VERSION",
    "SUPPORTED_SCHEMA_VERSIONS",
    "AssetContext",
    "InputObject",
    "MessageKind",
    "ObjectRef",
    "ProcessorIdentity",
    "ProfileRef",
    "SubjectRef",
]

# Contract schema version. Readers accept every version in SUPPORTED_SCHEMA_VERSIONS and refuse
# the rest with UNSUPPORTED_SCHEMA_VERSION. Any change to required fields, field meaning, or
# validation that would reject a previously valid message is a new version (docs/processing/
# CONTRACTS.md, "Compatibility").
SCHEMA_VERSION: Final = 1
SUPPORTED_SCHEMA_VERSIONS: Final = frozenset({1})

MAX_SIZE_BYTES: Final = 2**53


class MessageKind:
    JOB_REQUEST: Final = "lai.processing.job_request"
    JOB_RESULT: Final = "lai.processing.job_result"
    JOB_COMPLETED: Final = "lai.processing.job_completed"
    ALL: Final = frozenset({JOB_REQUEST, JOB_RESULT, JOB_COMPLETED})


def _store(value: object, field: str) -> StoreName:
    try:
        return StoreName(value)  # type: ignore[arg-type]
    except ValueError:
        raise ProcessingError(
            ErrorCode.INVALID_OBJECT_REFERENCE, {"field": field, "reason": "store"}
        ) from None


@dataclass(frozen=True, slots=True)
class ObjectRef:
    """A logical object location: store + key (+ object version where the store has one).

    `namespace` is not serialised; it is the namespace the key was validated against, supplied
    by the enclosing message, so that QUARANTINE and ARTIFACTS keys must sit inside it.
    """

    store: StoreName
    key: str
    version_id: str | None = None
    namespace: str | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "store", _store(self.store, "ref.store"))
        check_object_key(self.key, self.store, self.namespace, "ref.key")
        if self.version_id is not None and (
            not isinstance(self.version_id, str) or not OBJECT_VERSION_ID.fullmatch(self.version_id)
        ):
            raise ProcessingError(
                ErrorCode.INVALID_OBJECT_REFERENCE, {"field": "ref.version_id", "reason": "format"}
            )

    def to_dict(self) -> dict[str, Any]:
        return {"store": self.store.value, "key": self.key, "version_id": self.version_id}

    @classmethod
    def from_dict(cls, data: object, field: str, namespace: str | None) -> ObjectRef:
        d = f.obj(data, field)
        f.exact_keys(d, frozenset({"store", "key", "version_id"}), frozenset(), field)
        return cls(
            store=_store(d["store"], f"{field}.store"),
            key=d["key"],
            version_id=d["version_id"],
            namespace=namespace,
        )


@dataclass(frozen=True, slots=True)
class InputObject:
    """The input a job reads: where it is, and what it must be (type, size, checksum)."""

    ref: ObjectRef
    content_type: str
    size_bytes: int
    sha256: str

    def __post_init__(self) -> None:
        if not isinstance(self.ref, ObjectRef) or self.ref.store not in INPUT_STORES:
            raise ProcessingError(
                ErrorCode.INVALID_OBJECT_REFERENCE, {"field": "input.ref.store", "reason": "store"}
            )
        f.string(self.content_type, "input.content_type", CONTENT_TYPE, max_length=MAX_CONTENT_TYPE)
        f.integer(self.size_bytes, "input.size_bytes", minimum=0, maximum=MAX_SIZE_BYTES)
        f.string(self.sha256, "input.sha256", SHA256)

    def to_dict(self) -> dict[str, Any]:
        return {
            "ref": self.ref.to_dict(),
            "content_type": self.content_type,
            "size_bytes": self.size_bytes,
            "sha256": self.sha256,
        }

    @classmethod
    def from_dict(cls, data: object, namespace: str) -> InputObject:
        d = f.obj(data, "input")
        f.exact_keys(
            d, frozenset({"ref", "content_type", "size_bytes", "sha256"}), frozenset(), "input"
        )
        return cls(
            ref=ObjectRef.from_dict(d["ref"], "input.ref", namespace),
            content_type=d["content_type"],
            size_bytes=d["size_bytes"],
            sha256=d["sha256"],
        )


@dataclass(frozen=True, slots=True)
class SubjectRef:
    """What the job is about, generically: e.g. ("asset_version", "<uuid>")."""

    subject_type: str
    subject_id: str

    def __post_init__(self) -> None:
        f.string(self.subject_type, "subject.subject_type", SNAKE)
        f.string(self.subject_id, "subject.subject_id", SUBJECT_ID, max_length=128)

    def to_dict(self) -> dict[str, Any]:
        return {"subject_type": self.subject_type, "subject_id": self.subject_id}

    @classmethod
    def from_dict(cls, data: object) -> SubjectRef:
        d = f.obj(data, "subject")
        f.exact_keys(d, frozenset({"subject_type", "subject_id"}), frozenset(), "subject")
        return cls(subject_type=d["subject_type"], subject_id=d["subject_id"])


@dataclass(frozen=True, slots=True)
class AssetContext:
    """Asset-specific identity, required by asset job types (`AssetVersion` in Django)."""

    asset_id: str
    asset_version_id: str
    asset_version_number: int

    def __post_init__(self) -> None:
        f.string(self.asset_id, "asset.asset_id", ASSET_ID, max_length=100)
        f.string(self.asset_version_id, "asset.asset_version_id", UUID, max_length=36)
        f.integer(self.asset_version_number, "asset.asset_version_number", minimum=1)

    def to_dict(self) -> dict[str, Any]:
        return {
            "asset_id": self.asset_id,
            "asset_version_id": self.asset_version_id,
            "asset_version_number": self.asset_version_number,
        }

    @classmethod
    def from_dict(cls, data: object) -> AssetContext:
        d = f.obj(data, "asset")
        f.exact_keys(
            d,
            frozenset({"asset_id", "asset_version_id", "asset_version_number"}),
            frozenset(),
            "asset",
        )
        return cls(
            asset_id=d["asset_id"],
            asset_version_id=d["asset_version_id"],
            asset_version_number=d["asset_version_number"],
        )


@dataclass(frozen=True, slots=True)
class ProfileRef:
    """A processing profile by id and integer version (profiles are immutable per version)."""

    profile_id: str
    version: int

    def __post_init__(self) -> None:
        f.string(self.profile_id, "profile.profile_id", SLUG)
        f.integer(self.version, "profile.version", minimum=1, maximum=1_000_000)

    def to_dict(self) -> dict[str, Any]:
        return {"profile_id": self.profile_id, "version": self.version}

    @classmethod
    def from_dict(cls, data: object, field: str = "profile") -> ProfileRef:
        d = f.obj(data, field)
        f.exact_keys(d, frozenset({"profile_id", "version"}), frozenset(), field)
        return cls(profile_id=d["profile_id"], version=d["version"])


@dataclass(frozen=True, slots=True)
class ProcessorIdentity:
    """Which processor (and which release of it) produced a result."""

    processor_id: str
    processor_version: str

    def __post_init__(self) -> None:
        f.string(self.processor_id, "processor.processor_id", DOTTED_NAME)
        f.string(self.processor_version, "processor.processor_version", SEMVER, max_length=32)

    def to_dict(self) -> dict[str, Any]:
        return {"processor_id": self.processor_id, "processor_version": self.processor_version}

    @classmethod
    def from_dict(cls, data: object, field: str = "processor") -> ProcessorIdentity:
        d = f.obj(data, field)
        f.exact_keys(d, frozenset({"processor_id", "processor_version"}), frozenset(), field)
        return cls(processor_id=d["processor_id"], processor_version=d["processor_version"])


def check_namespace(value: object, field: str = "namespace") -> str:
    return f.string(value, field, NAMESPACE, max_length=32)


def check_schema_header(data: Mapping[str, Any], expected_kind: str) -> int:
    """Check `kind` and `schema_version` first, so an unknown version is reported as such."""
    if data.get("kind") != expected_kind:
        raise f.invalid("kind")
    version = data.get("schema_version")
    if type(version) is not int:
        raise f.invalid("schema_version")
    if version not in SUPPORTED_SCHEMA_VERSIONS:
        raise ProcessingError(
            ErrorCode.UNSUPPORTED_SCHEMA_VERSION, {"field": "schema_version", "version": version}
        )
    return version
