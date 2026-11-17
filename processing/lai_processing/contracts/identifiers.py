"""Identifier formats and object-reference safety rules shared by every contract.

Every identifier in a message is checked against an anchored pattern with a length bound, so a
malformed or hostile message is rejected before any processor sees it. Object references name a
logical store, never a bucket: adapters map (namespace, store) to a physical location, so a
forged message cannot point a worker at an arbitrary bucket or another environment's data.
"""

from __future__ import annotations

import re
from enum import StrEnum
from typing import Final

from ..core.errors import ErrorCode, ProcessingError

__all__ = [
    "ARTIFACT_KEY_PREFIX",
    "ASSET_KEY_PREFIX",
    "QUARANTINE_KEY_PREFIX",
    "StoreName",
    "artifact_key",
    "artifact_prefix",
    "check_object_key",
    "check_pattern",
    "is_uuid",
]

UUID: Final = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
NAMESPACE: Final = re.compile(r"^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$")
DOTTED_NAME: Final = re.compile(r"^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$")
SLUG: Final = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
SNAKE: Final = re.compile(r"^[a-z][a-z0-9_]*$")
# The asset id rule from lai/apps/assets/storage.py (ASSET_ID), copied, not imported.
ASSET_ID: Final = SLUG
SEMVER: Final = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")
SHA256: Final = re.compile(r"^[0-9a-f]{64}$")
# The request-id rule from lai/apps/core/request_context.py (VALID_REQUEST_ID).
CORRELATION_ID: Final = re.compile(r"^[A-Za-z0-9._-]{8,64}$")
IDEMPOTENCY_KEY: Final = re.compile(r"^ik1:[0-9a-f]{64}$")
SUBJECT_ID: Final = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")
CONTENT_TYPE: Final = re.compile(r"^[a-z]+/[a-z0-9][a-z0-9.+-]*$")
OBJECT_VERSION_ID: Final = re.compile(r"^[A-Za-z0-9._=+-]{1,1024}$")
LOGICAL_ID: Final = re.compile(r"^[a-z0-9]+(?:[-_][a-z0-9]+)*$")
KEY_CHARS: Final = re.compile(r"^[A-Za-z0-9._=/-]+$")
EXTENSION: Final = re.compile(r"^[a-z0-9]{1,10}$")

MAX_KEY_LENGTH: Final = 1024
MAX_SHORT: Final = 64
MAX_CONTENT_TYPE: Final = 100


class StoreName(StrEnum):
    """Logical object stores. Inputs come from ASSETS or QUARANTINE; outputs go to ARTIFACTS."""

    ASSETS = "assets"
    QUARANTINE = "quarantine"
    ARTIFACTS = "artifacts"


INPUT_STORES: Final = frozenset({StoreName.ASSETS, StoreName.QUARANTINE})
OUTPUT_STORES: Final = frozenset({StoreName.ARTIFACTS})

# Key prefixes per store. ASSETS keys are the Asset Library's existing keys (the environment is
# the bucket). QUARANTINE and ARTIFACTS keys also carry the namespace, so they stay separated even
# if two environments ever shared a bucket.
ASSET_KEY_PREFIX: Final = "assets/"
QUARANTINE_KEY_PREFIX: Final = "processing/quarantine/"
ARTIFACT_KEY_PREFIX: Final = "processing/artifacts/"
_STORE_PREFIX: Final = {
    StoreName.ASSETS: ASSET_KEY_PREFIX,
    StoreName.QUARANTINE: QUARANTINE_KEY_PREFIX,
    StoreName.ARTIFACTS: ARTIFACT_KEY_PREFIX,
}


def is_uuid(value: object) -> bool:
    return isinstance(value, str) and bool(UUID.fullmatch(value))


def check_pattern(
    value: object, pattern: re.Pattern[str], field: str, *, max_length: int = MAX_SHORT
) -> str:
    """Return `value` if it is a string matching `pattern` within `max_length`, else refuse."""
    if not isinstance(value, str) or len(value) > max_length or not pattern.fullmatch(value):
        raise ProcessingError(ErrorCode.INVALID_INPUT, {"field": field})
    return value


def _refuse_key(field: str, reason: str) -> ProcessingError:
    return ProcessingError(ErrorCode.INVALID_OBJECT_REFERENCE, {"field": field, "reason": reason})


def check_object_key(key: object, store: StoreName, namespace: str | None, field: str) -> str:
    """Validate an object key for `store`. Refuses traversal, absolute paths, empty or dot
    segments, backslashes, control characters, characters outside a conservative set, and keys
    outside the store's prefix (and, for namespaced stores, outside `namespace`)."""
    if not isinstance(key, str) or not key:
        raise _refuse_key(field, "empty")
    if len(key) > MAX_KEY_LENGTH:
        raise _refuse_key(field, "too_long")
    if not KEY_CHARS.fullmatch(key):
        raise _refuse_key(field, "characters")
    if key.startswith("/") or key.endswith("/"):
        raise _refuse_key(field, "slash")
    segments = key.split("/")
    if any(segment in {"", ".", ".."} for segment in segments):
        raise _refuse_key(field, "segment")
    prefix = _STORE_PREFIX[store]
    if not key.startswith(prefix):
        raise _refuse_key(field, "prefix")
    if store is not StoreName.ASSETS:
        if namespace is None or not key.startswith(f"{prefix}{namespace}/"):
            raise _refuse_key(field, "namespace")
    return key


def artifact_prefix(namespace: str, job_id: str, attempt_id: str) -> str:
    """The only directory a job attempt may write artifacts into. Keys are immutable per attempt:
    a retry gets a new attempt id and therefore new keys, never an overwrite."""
    check_pattern(namespace, NAMESPACE, "namespace", max_length=32)
    if not is_uuid(job_id):
        raise ProcessingError(ErrorCode.INVALID_INPUT, {"field": "job_id"})
    if not is_uuid(attempt_id):
        raise ProcessingError(ErrorCode.INVALID_INPUT, {"field": "attempt_id"})
    return f"{ARTIFACT_KEY_PREFIX}{namespace}/{job_id}/{attempt_id}/"


def artifact_key(
    namespace: str, job_id: str, attempt_id: str, logical_id: str, extension: str
) -> str:
    """`processing/artifacts/<namespace>/<job id>/<attempt id>/<logical id>.<extension>`."""
    check_pattern(logical_id, LOGICAL_ID, "logical_id")
    check_pattern(extension, EXTENSION, "extension", max_length=10)
    return f"{artifact_prefix(namespace, job_id, attempt_id)}{logical_id}.{extension}"
