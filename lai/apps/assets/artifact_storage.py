"""Django's side of the derived-artifact store (ADR-066, docs/processing/DERIVED_ARTIFACTS.md).

Uses the Asset Library's storage abstraction (`apps.assets.storage.get_storage()`, private S3 or
the local and memory stores) for HEAD, bounded reads, streamed views and deletes. Nothing here is
public: there is no CDN path, no presigned URL and no resolver entry for an artifact key.

Failure semantics (never blurred):

- `ArtifactObjectMissing`: the store answered that the key does not exist (404).
- `ArtifactStorageUnavailable`: anything else, a 403 and a 5xx included. A caller never reads a
  403 as "missing", because without ListBucket S3 also answers 403 for an absent key; the right
  response is to fail the operation and retry later, never to record or delete based on it.
- `ArtifactMismatch`: the object exists but its size or SHA-256 is not what was claimed.

Keys are made only by `lai_processing.contracts.identifiers.artifact_key` (job outputs, built by
the worker) and `capture_key` (staff capture, built here), from trusted identifiers.
"""

import hashlib
import re
import uuid
from collections.abc import Iterator
from typing import IO

from lai_processing.contracts.identifiers import (
    ARTIFACT_KEY_PREFIX,
    EXTENSION,
    NAMESPACE,
    UUID,
    artifact_prefix,
    check_object_key,
)
from lai_processing.contracts.identifiers import StoreName as ContractStore

from .storage import CHUNK, ObjectMissing, StorageError, StoredObject, get_storage

CAPTURE_SEGMENT = "capture"
_KEY = re.compile(
    rf"^{re.escape(ARTIFACT_KEY_PREFIX)}(?P<ns>[a-z][a-z0-9]*(?:-[a-z0-9]+)*)/"
    r"(?P<a>[0-9a-f-]{36})/(?P<b>[0-9a-f-]{36})/(?P<logical>[a-z0-9]+(?:[-_][a-z0-9]+)*)"
    r"\.(?P<ext>[a-z0-9]{1,10})$"
)


class ArtifactObjectMissing(Exception):
    """The artifact object does not exist (the store said 404)."""


class ArtifactStorageUnavailable(Exception):
    """The store could not answer (403, 5xx, timeout). Retry later; never treat as missing."""


class ArtifactMismatch(Exception):
    """The stored object's size or checksum is not the recorded one."""


def namespace() -> str:
    from .processing import namespace as contract_namespace

    return contract_namespace()


def job_prefix(job_id: str, attempt_id: str) -> str:
    """The directory of one job attempt in this environment."""
    return artifact_prefix(namespace(), str(job_id), str(attempt_id))


def namespace_prefix() -> str:
    return f"{ARTIFACT_KEY_PREFIX}{namespace()}/"


def capture_key(artifact_id: uuid.UUID, extension: str) -> str:
    """`processing/artifacts/<env>/capture/<artifact id>.<ext>` from a UUID Django generated."""
    if not isinstance(artifact_id, uuid.UUID):
        raise ValueError("A capture key needs a UUID.")
    if not EXTENSION.fullmatch(extension or ""):
        raise ValueError("Invalid extension.")
    space = namespace()
    if not NAMESPACE.fullmatch(space):
        raise ValueError("Invalid namespace.")
    key = f"{ARTIFACT_KEY_PREFIX}{space}/{CAPTURE_SEGMENT}/{artifact_id}.{extension}"
    return check_object_key(key, ContractStore.ARTIFACTS, space, "key")


def is_capture_key(key: str) -> bool:
    return key.startswith(f"{namespace_prefix()}{CAPTURE_SEGMENT}/")


def parse_job_key(key: str) -> dict | None:
    """The parts of a job-output key in this environment, or None when it is not one (a capture
    key, another environment, or any other shape)."""
    match = _KEY.fullmatch(key or "")
    if not match or match["ns"] != namespace():
        return None
    if not (UUID.fullmatch(match["a"]) and UUID.fullmatch(match["b"])):
        return None
    return {
        "job_id": match["a"],
        "attempt_id": match["b"],
        "logical_id": match["logical"],
        "extension": match["ext"],
    }


# --- operations --------------------------------------------------------------------------------


def head(key: str) -> StoredObject:
    """Metadata of the object. Raises `ArtifactObjectMissing` or `ArtifactStorageUnavailable`."""
    try:
        return get_storage().head(key)
    except ObjectMissing:
        raise ArtifactObjectMissing from None
    except (StorageError, ValueError):
        raise ArtifactStorageUnavailable from None


def verify(key: str, *, sha256: str, size_bytes: int, max_bytes: int) -> None:
    """HEAD for the size, then a bounded streamed read for the SHA-256. Returns None, or raises.

    The object is refused before it is read when its size is not `size_bytes` or is above
    `max_bytes`, and the read stops at one byte over `size_bytes`, so a forged or oversized
    object is never consumed whole."""
    info = head(key)
    if info.size != size_bytes or info.size > max_bytes:
        raise ArtifactMismatch
    digest, count = hashlib.sha256(), 0
    try:
        with get_storage().open(key) as stream:
            while chunk := stream.read(CHUNK):
                count += len(chunk)
                if count > size_bytes:
                    raise ArtifactMismatch
                digest.update(chunk)
    except ObjectMissing:
        raise ArtifactObjectMissing from None
    except (StorageError, ValueError, OSError):
        raise ArtifactStorageUnavailable from None
    if count != size_bytes or digest.hexdigest() != sha256:
        raise ArtifactMismatch


def open_object(key: str) -> IO[bytes]:
    """A readable stream of the object (the caller closes it). No verification."""
    try:
        return get_storage().open(key)
    except ObjectMissing:
        raise ArtifactObjectMissing from None
    except (StorageError, ValueError):
        raise ArtifactStorageUnavailable from None


def put_create_only(key: str, data: bytes, *, content_type: str, sha256: str) -> None:
    """Create-only write of staff-capture bytes (the store refuses an existing key)."""
    import io

    from .storage import ObjectExists

    try:
        get_storage().put(key, io.BytesIO(data), content_type=content_type, sha256=sha256)
    except ObjectExists:
        raise ArtifactMismatch from None
    except (StorageError, ValueError):
        raise ArtifactStorageUnavailable from None


class ArtifactKeyOutsideNamespace(ValueError):
    """A delete was asked for a key that is not under this environment's artifact prefix."""


def delete_object(key: str) -> None:
    """Remove an object (the retention cleanup path only). Missing is not an error.

    The key must be under THIS environment's `processing/artifacts/<env>/` prefix (and contain no
    `..` or empty segment): a row or listing holding any other key, another environment's, an
    `assets/` key or a speech key, is refused with `ArtifactKeyOutsideNamespace` and nothing is
    sent to the store."""
    if (
        not isinstance(key, str)
        or not key.startswith(namespace_prefix())
        or len(key) <= len(namespace_prefix())
        or ".." in key.split("/")
        or "" in key.split("/")
    ):
        raise ArtifactKeyOutsideNamespace("The key is outside this environment's artifacts.")
    try:
        get_storage().delete(key)
    except ObjectMissing:
        return
    except (StorageError, ValueError):
        raise ArtifactStorageUnavailable from None


def list_objects(prefix: str | None = None) -> Iterator[StoredObject]:
    """Objects under this environment's artifact prefix (or a narrower `prefix`)."""
    base = namespace_prefix()
    wanted = prefix or base
    if not wanted.startswith(base):
        raise ValueError("Refusing a prefix outside this environment's artifacts.")
    try:
        yield from get_storage().list(wanted)
    except (StorageError, ValueError):
        raise ArtifactStorageUnavailable from None
