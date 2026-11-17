"""Error codes, retry classification, safe messages and exception conversion (core/errors.py)."""

from __future__ import annotations

import pytest
from lai_processing.core.errors import (
    ERROR_CLASSIFICATION,
    SAFE_MESSAGES,
    ErrorCode,
    ProcessingError,
    RetryClass,
    error_from_exception,
    safe_details,
)

SECRET = "AKIAIOSFODNN7EXAMPLE child=Ana /home/user/secret.glb"


def test_every_code_has_exactly_one_classification_and_message() -> None:
    assert set(ERROR_CLASSIFICATION) == set(ErrorCode)
    assert set(SAFE_MESSAGES) == set(ErrorCode)
    assert all(isinstance(v, RetryClass) for v in ERROR_CLASSIFICATION.values())


@pytest.mark.parametrize("code", list(ErrorCode))
def test_safe_messages_are_short_plain_sentences(code: ErrorCode) -> None:
    message = SAFE_MESSAGES[code]
    assert message and message.isascii() and message.endswith(".")
    assert len(message) <= 120
    assert "—" not in message and "\n" not in message


def test_safe_messages_are_distinct() -> None:
    assert len(set(SAFE_MESSAGES.values())) == len(SAFE_MESSAGES)


def test_only_cancelled_code_has_cancelled_class() -> None:
    cancelled = [c for c, rc in ERROR_CLASSIFICATION.items() if rc is RetryClass.CANCELLED]
    assert cancelled == [ErrorCode.CANCELLED]


@pytest.mark.parametrize(
    "code",
    [ErrorCode.PROCESSING_TIMEOUT, ErrorCode.TEMPORARY_FAILURE, ErrorCode.THROTTLED,
     ErrorCode.STORAGE_FAILURE],
)
def test_transient_codes_are_retryable(code: ErrorCode) -> None:
    assert ProcessingError(code).retryable


@pytest.mark.parametrize(
    "code",
    [ErrorCode.INVALID_INPUT, ErrorCode.CHECKSUM_MISMATCH, ErrorCode.UNEXPECTED_FAILURE,
     ErrorCode.PERMISSION_DENIED, ErrorCode.CANCELLED, ErrorCode.ARTIFACT_CONFLICT],
)
def test_input_bugs_permissions_and_cancel_are_not_retryable(code: ErrorCode) -> None:
    assert not ProcessingError(code).retryable


@pytest.mark.parametrize("code", list(ErrorCode))
def test_processing_error_str_is_the_safe_message(code: ErrorCode) -> None:
    error = ProcessingError(code, {"field": "x"})
    assert str(error) == SAFE_MESSAGES[code] == error.safe_message
    assert error.retry_class is ERROR_CLASSIFICATION[code]
    assert error.args == (SAFE_MESSAGES[code],)


def test_processing_error_accepts_code_value_and_refuses_unknown() -> None:
    assert ProcessingError("throttled").code is ErrorCode.THROTTLED  # type: ignore[arg-type]
    with pytest.raises(ValueError):
        ProcessingError("not_a_code")  # type: ignore[arg-type]


def test_repr_never_contains_message_text_beyond_details() -> None:
    error = ProcessingError(ErrorCode.INVALID_INPUT, {"field": "job_id"})
    assert repr(error) == "ProcessingError(code='invalid_input', details={'field': 'job_id'})"


@pytest.mark.parametrize(
    ("exc", "code"),
    [
        (TimeoutError(SECRET), ErrorCode.PROCESSING_TIMEOUT),
        (MemoryError(SECRET), ErrorCode.RESOURCE_LIMIT_EXCEEDED),
        (PermissionError(SECRET), ErrorCode.PERMISSION_DENIED),
        (ConnectionResetError(SECRET), ErrorCode.TEMPORARY_FAILURE),
        (ConnectionError(SECRET), ErrorCode.TEMPORARY_FAILURE),
        (ValueError(SECRET), ErrorCode.UNEXPECTED_FAILURE),
        (KeyError(SECRET), ErrorCode.UNEXPECTED_FAILURE),
        (RuntimeError(SECRET), ErrorCode.UNEXPECTED_FAILURE),
        (OSError(SECRET), ErrorCode.UNEXPECTED_FAILURE),
        (KeyboardInterrupt(SECRET), ErrorCode.UNEXPECTED_FAILURE),
    ],
)
def test_error_from_exception_classifies_without_leaking(
    exc: BaseException, code: ErrorCode
) -> None:
    error = error_from_exception(exc)
    assert error.code is code
    assert error.details == {"exception_type": type(exc).__name__}
    rendered = f"{error} {error!r} {error.args} {error.details}"
    assert "AKIA" not in rendered and "Ana" not in rendered and "secret" not in rendered


def test_unexpected_failures_are_manual_not_retried_in_a_loop() -> None:
    assert error_from_exception(ValueError("x")).retry_class is RetryClass.MANUAL


def test_error_from_exception_passes_processing_errors_through() -> None:
    original = ProcessingError(ErrorCode.THROTTLED, {"phase": "read"})
    assert error_from_exception(original) is original


def test_error_from_exception_handles_subclassed_processing_error() -> None:
    class Custom(ProcessingError):
        pass

    custom = Custom(ErrorCode.STORAGE_FAILURE)
    assert error_from_exception(custom) is custom


@pytest.mark.parametrize(
    ("details", "expected"),
    [
        (None, {}),
        ({}, {}),
        ({"field": "job_id", "count": 3, "ratio": 0.5, "ok": True, "none": None},
         {"field": "job_id", "count": 3, "ratio": 0.5, "ok": True, "none": None}),
        ({"multi_line": "a\nb\rc"}, {"multi_line": "a b c"}),
        ({"long": "x" * 500}, {"long": "x" * 200}),
        ({"free text": "child said hi"}, {}),
        ({"dash-key": 1}, {}),
        ({"": 1}, {}),
        ({"k" * 65: 1}, {}),
        ({"k" * 64: 1}, {"k" * 64: 1}),
        ({"nested": {"a": 1}}, {}),
        ({"listy": [1, 2]}, {}),
        ({"obj": object()}, {}),
        ({1: "int key"}, {}),
        ({"b": b"bytes"}, {}),
    ],
)
def test_safe_details_filters(
    details: dict[object, object] | None, expected: dict[str, object]
) -> None:
    assert safe_details(details) == expected  # type: ignore[arg-type]


def test_safe_details_keeps_at_most_sixteen_entries() -> None:
    details = {f"k{i:02d}": i for i in range(40)}
    assert len(safe_details(details)) == 16


def test_processing_error_details_are_filtered() -> None:
    error = ProcessingError(ErrorCode.INVALID_INPUT, {"field": "x", "content": {"text": SECRET}})
    assert error.details == {"field": "x"}


def test_safe_details_refuses_non_ascii_keys() -> None:
    assert safe_details({"clé": 1, "٣": 2}) == {}
