"""Structured error codes, retry classification, and exception-to-error conversion.

Every failure a processing job can report is one `ErrorCode`. Each code has exactly one
`RetryClass` and one fixed, safe message. A `ProcessingError` never carries an exception's own
message, a stack trace, a credential, or child data into a job result: the message a result
holds is always the fixed text for its code (ADR-025's logging rule applied to results).

Retry classes:
- RETRYABLE: a transient condition; the same attempt input may succeed later, within a bounded
  retry policy (`lai_processing.core.retry`).
- PERMANENT: the input or request is wrong; retrying cannot help.
- CANCELLED: the job was cancelled on purpose; never retried.
- MANUAL: an operator must act (configuration, permissions, a processor bug); not retried
  automatically, surfaced for review.
"""

from __future__ import annotations

from collections.abc import Mapping
from enum import StrEnum
from typing import Final

__all__ = [
    "ERROR_CLASSIFICATION",
    "SAFE_MESSAGES",
    "ErrorCode",
    "ProcessingError",
    "RetryClass",
    "error_from_exception",
    "safe_details",
]


class RetryClass(StrEnum):
    RETRYABLE = "retryable"
    PERMANENT = "permanent"
    CANCELLED = "cancelled"
    MANUAL = "manual"


class ErrorCode(StrEnum):
    INVALID_INPUT = "invalid_input"
    UNSUPPORTED_INPUT = "unsupported_input"
    UNSUPPORTED_SCHEMA_VERSION = "unsupported_schema_version"
    UNSUPPORTED_JOB_TYPE = "unsupported_job_type"
    UNSUPPORTED_PROCESSOR = "unsupported_processor"
    INVALID_PROCESSING_PROFILE = "invalid_processing_profile"
    INVALID_OBJECT_REFERENCE = "invalid_object_reference"
    CHECKSUM_MISMATCH = "checksum_mismatch"
    INPUT_MISSING = "input_missing"
    PERMISSION_DENIED = "permission_denied"
    RESOURCE_LIMIT_EXCEEDED = "resource_limit_exceeded"
    MESSAGE_TOO_LARGE = "message_too_large"
    PROCESSING_TIMEOUT = "processing_timeout"
    TEMPORARY_FAILURE = "temporary_failure"
    THROTTLED = "throttled"
    STORAGE_FAILURE = "storage_failure"
    ARTIFACT_CONFLICT = "artifact_conflict"
    DUPLICATE_REQUEST = "duplicate_request"
    JOB_EXPIRED = "job_expired"
    NAMESPACE_MISMATCH = "namespace_mismatch"
    UNEXPECTED_FAILURE = "unexpected_failure"
    CANCELLED = "cancelled"


ERROR_CLASSIFICATION: Final[Mapping[ErrorCode, RetryClass]] = {
    ErrorCode.INVALID_INPUT: RetryClass.PERMANENT,
    ErrorCode.UNSUPPORTED_INPUT: RetryClass.PERMANENT,
    ErrorCode.UNSUPPORTED_SCHEMA_VERSION: RetryClass.PERMANENT,
    ErrorCode.UNSUPPORTED_JOB_TYPE: RetryClass.PERMANENT,
    ErrorCode.UNSUPPORTED_PROCESSOR: RetryClass.MANUAL,
    ErrorCode.INVALID_PROCESSING_PROFILE: RetryClass.PERMANENT,
    ErrorCode.INVALID_OBJECT_REFERENCE: RetryClass.PERMANENT,
    ErrorCode.CHECKSUM_MISMATCH: RetryClass.PERMANENT,
    ErrorCode.INPUT_MISSING: RetryClass.MANUAL,
    ErrorCode.PERMISSION_DENIED: RetryClass.MANUAL,
    ErrorCode.RESOURCE_LIMIT_EXCEEDED: RetryClass.PERMANENT,
    ErrorCode.MESSAGE_TOO_LARGE: RetryClass.PERMANENT,
    ErrorCode.PROCESSING_TIMEOUT: RetryClass.RETRYABLE,
    ErrorCode.TEMPORARY_FAILURE: RetryClass.RETRYABLE,
    ErrorCode.THROTTLED: RetryClass.RETRYABLE,
    ErrorCode.STORAGE_FAILURE: RetryClass.RETRYABLE,
    ErrorCode.ARTIFACT_CONFLICT: RetryClass.MANUAL,
    ErrorCode.DUPLICATE_REQUEST: RetryClass.PERMANENT,
    ErrorCode.JOB_EXPIRED: RetryClass.PERMANENT,
    ErrorCode.NAMESPACE_MISMATCH: RetryClass.PERMANENT,
    ErrorCode.UNEXPECTED_FAILURE: RetryClass.MANUAL,
    ErrorCode.CANCELLED: RetryClass.CANCELLED,
}

SAFE_MESSAGES: Final[Mapping[ErrorCode, str]] = {
    ErrorCode.INVALID_INPUT: "The job request or its input is not valid.",
    ErrorCode.UNSUPPORTED_INPUT: "The input file type is not supported by this processor.",
    ErrorCode.UNSUPPORTED_SCHEMA_VERSION: "The message schema version is not supported.",
    ErrorCode.UNSUPPORTED_JOB_TYPE: "The job type is not known.",
    ErrorCode.UNSUPPORTED_PROCESSOR: "No registered processor handles this job.",
    ErrorCode.INVALID_PROCESSING_PROFILE: "The processing profile is not valid for this job.",
    ErrorCode.INVALID_OBJECT_REFERENCE: "An object reference is malformed or not allowed.",
    ErrorCode.CHECKSUM_MISMATCH: "The input does not match its recorded checksum or size.",
    ErrorCode.INPUT_MISSING: "The input object does not exist.",
    ErrorCode.PERMISSION_DENIED: "The worker is not allowed to access a required object.",
    ErrorCode.RESOURCE_LIMIT_EXCEEDED: "The job exceeded a processing limit.",
    ErrorCode.MESSAGE_TOO_LARGE: "The message exceeds the maximum allowed size.",
    ErrorCode.PROCESSING_TIMEOUT: "The job did not finish within its time limit.",
    ErrorCode.TEMPORARY_FAILURE: "A temporary failure interrupted the job.",
    ErrorCode.THROTTLED: "A dependent service throttled the job.",
    ErrorCode.STORAGE_FAILURE: "The storage service failed.",
    ErrorCode.ARTIFACT_CONFLICT: "A different artifact already exists at the target location.",
    ErrorCode.DUPLICATE_REQUEST: "This job attempt was already processed.",
    ErrorCode.JOB_EXPIRED: "The job expired before it could be processed.",
    ErrorCode.NAMESPACE_MISMATCH: "The job belongs to a different environment.",
    ErrorCode.UNEXPECTED_FAILURE: "The processor failed unexpectedly.",
    ErrorCode.CANCELLED: "The job was cancelled.",
}

_SAFE_DETAIL_VALUE = (str, int, float, bool, type(None))
MAX_DETAIL_ENTRIES: Final = 16
MAX_DETAIL_STRING: Final = 200


DetailValue = str | int | float | bool | None


def safe_details(details: Mapping[str, object] | None) -> dict[str, DetailValue]:
    """Keep only short scalar details with identifier-like keys. Never free text from inputs."""
    if not details:
        return {}
    clean: dict[str, DetailValue] = {}
    for key, value in list(details.items())[:MAX_DETAIL_ENTRIES]:
        if not isinstance(key, str) or not key.replace("_", "").isalnum() or len(key) > 64:
            continue
        if not isinstance(value, _SAFE_DETAIL_VALUE):
            continue
        if isinstance(value, str):
            value = value.replace("\n", " ").replace("\r", " ")[:MAX_DETAIL_STRING]
        clean[key] = value
    return clean


class ProcessingError(Exception):
    """A classified job failure. `str(error)` is the fixed safe message for its code.

    `details` holds short scalar facts that are safe to persist and log, such as a field path,
    a limit name, or a byte count. Callers must never put input content, file names supplied by
    staff, credentials, or child data into details.
    """

    code: ErrorCode
    details: dict[str, str | int | float | bool | None]

    def __init__(self, code: ErrorCode, details: Mapping[str, object] | None = None) -> None:
        self.code = ErrorCode(code)
        self.details = safe_details(details)
        super().__init__(SAFE_MESSAGES[self.code])

    @property
    def retry_class(self) -> RetryClass:
        return ERROR_CLASSIFICATION[self.code]

    @property
    def retryable(self) -> bool:
        return self.retry_class is RetryClass.RETRYABLE

    @property
    def safe_message(self) -> str:
        return SAFE_MESSAGES[self.code]

    def __repr__(self) -> str:
        return f"ProcessingError(code={self.code.value!r}, details={self.details!r})"


def error_from_exception(exc: BaseException) -> ProcessingError:
    """Convert any exception into a classified `ProcessingError` without leaking its message.

    Known processing errors pass through. Standard transient conditions map to their codes.
    Everything else is `UNEXPECTED_FAILURE` (MANUAL): an unknown bug is not retried in a loop.
    Only the exception's type name is kept, as a detail, never its message or traceback.
    """
    if isinstance(exc, ProcessingError):
        return exc
    exc_type = type(exc).__name__
    if isinstance(exc, TimeoutError):
        return ProcessingError(ErrorCode.PROCESSING_TIMEOUT, {"exception_type": exc_type})
    if isinstance(exc, MemoryError):
        return ProcessingError(ErrorCode.RESOURCE_LIMIT_EXCEEDED, {"exception_type": exc_type})
    if isinstance(exc, PermissionError):
        return ProcessingError(ErrorCode.PERMISSION_DENIED, {"exception_type": exc_type})
    if isinstance(exc, ConnectionError):
        return ProcessingError(ErrorCode.TEMPORARY_FAILURE, {"exception_type": exc_type})
    return ProcessingError(ErrorCode.UNEXPECTED_FAILURE, {"exception_type": exc_type})
