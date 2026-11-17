"""Object storage port.

Adapters (memory and local filesystem in Wave 1 testing; S3 in Wave 2, LAI-LAMBDA-003) map a
logical `ObjectRef` (store + key + version) to physical storage for one namespace. Errors are
`ProcessingError` subclasses whose codes keep missing objects, permission problems and transient
failures apart, because each has a different retry class.

Artifact writes are create-only: writing to an existing key with different content raises
`ObjectExists` (ARTIFACT_CONFLICT); writing identical content (same SHA-256) is an idempotent
success, which makes a redelivered attempt harmless.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import IO, Protocol, runtime_checkable

from ..contracts.common import ObjectRef
from ..core.errors import ErrorCode, ProcessingError

__all__ = [
    "ObjectExists",
    "ObjectInfo",
    "ObjectMissing",
    "ObjectStorage",
    "StorageError",
    "StoragePermissionDenied",
    "StorageUnavailable",
]


class StorageError(ProcessingError):
    """Base class for storage failures. Default classification: STORAGE_FAILURE (retryable)."""

    default_code = ErrorCode.STORAGE_FAILURE

    def __init__(self, details: dict[str, object] | None = None) -> None:
        super().__init__(self.default_code, details)


class ObjectMissing(StorageError):
    default_code = ErrorCode.INPUT_MISSING


class StoragePermissionDenied(StorageError):
    default_code = ErrorCode.PERMISSION_DENIED


class StorageUnavailable(StorageError):
    """A transient failure (network, 5xx, throttling) that a retry may cure."""

    default_code = ErrorCode.STORAGE_FAILURE


class ObjectExists(StorageError):
    default_code = ErrorCode.ARTIFACT_CONFLICT


@dataclass(frozen=True, slots=True)
class ObjectInfo:
    """What the store knows about an object without reading its body.

    `sha256` is the store's recorded checksum when it has one (S3 `ChecksumSHA256`, decoded to
    hex); callers must still verify the bytes they read, because a recorded checksum is
    metadata, not proof."""

    ref: ObjectRef
    size_bytes: int
    content_type: str | None
    version_id: str | None
    sha256: str | None


@runtime_checkable
class ObjectStorage(Protocol):
    def head(self, ref: ObjectRef) -> ObjectInfo:
        """Metadata for `ref`. Raises ObjectMissing, StoragePermissionDenied, StorageUnavailable.
        When `ref.version_id` is set, that exact object version is described or ObjectMissing
        is raised: a newer version of the same key is never silently substituted."""
        ...

    def open(self, ref: ObjectRef) -> IO[bytes]:
        """A readable binary stream of `ref` (exact version when given). The caller closes it."""
        ...

    def read(self, ref: ObjectRef, *, max_bytes: int) -> bytes:
        """The whole object, refused with RESOURCE_LIMIT_EXCEEDED if larger than `max_bytes`."""
        ...

    def put(
        self, ref: ObjectRef, data: IO[bytes], *, content_type: str, sha256: str, size_bytes: int
    ) -> ObjectInfo:
        """Create-only write of an artifact. Must verify that the bytes written match `sha256`
        and `size_bytes`. Only the ARTIFACTS store is writable by workers."""
        ...

    def delete(self, ref: ObjectRef) -> None:
        """Delete an object the caller owns (temporary or orphaned artifacts only). Missing
        objects are not an error. Never used on the ASSETS store by a worker."""
        ...
