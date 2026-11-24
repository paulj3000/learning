"""Telemetry port: structured events, metrics and timings with a closed field vocabulary.

Privacy is enforced by construction: an event or metric may only carry fields named in
`SAFE_FIELDS`, with scalar values. A field outside the vocabulary is a programming error and
raises `ValueError`, in tests and in production alike, so file names, input text, child data or
exception messages cannot drift into logs (ADR-025).
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from typing import Final, Protocol, runtime_checkable

__all__ = [
    "SAFE_FIELDS",
    "LoggingTelemetry",
    "NullTelemetry",
    "Telemetry",
    "check_fields",
]

SAFE_FIELDS: Final = frozenset(
    {
        "job_id",
        "job_type",
        "attempt_id",
        "attempt_number",
        "correlation_id",
        "namespace",
        "processor_id",
        "processor_version",
        "profile_id",
        "profile_version",
        "status",
        "verdict",
        "error_code",
        "retry_class",
        "duration_ms",
        "size_bytes",
        "artifact_count",
        "finding_count",
        "warning_count",
        "receive_count",
        "phase",
        "exception_type",
        "limit",
    }
)
MAX_VALUE_LENGTH: Final = 128

FieldValue = str | int | float | bool | None


def check_fields(fields: Mapping[str, object]) -> dict[str, FieldValue]:
    clean: dict[str, FieldValue] = {}
    for key, value in fields.items():
        if key not in SAFE_FIELDS:
            raise ValueError(f"telemetry field not allowed: {key}")
        if not isinstance(value, (str, int, float, bool, type(None))):
            raise ValueError(f"telemetry field must be a scalar: {key}")
        if isinstance(value, str):
            if len(value) > MAX_VALUE_LENGTH or "\n" in value or "\r" in value:
                raise ValueError(f"telemetry value too long or multi-line: {key}")
        clean[key] = value
    return clean


@runtime_checkable
class Telemetry(Protocol):
    def event(self, name: str, **fields: FieldValue) -> None:
        """A structured log event such as `job.started` or `job.failed`."""
        ...

    def metric(self, name: str, value: float, *, unit: str = "Count", **fields: FieldValue) -> None:
        """A numeric measurement, e.g. `job.duration` in Milliseconds."""
        ...


class NullTelemetry:
    def event(self, name: str, **fields: FieldValue) -> None:
        check_fields(fields)

    def metric(self, name: str, value: float, *, unit: str = "Count", **fields: FieldValue) -> None:
        check_fields(fields)


class LoggingTelemetry:
    """Writes `name key=value ...` lines through stdlib logging (the repository's style)."""

    def __init__(self, logger: logging.Logger | None = None) -> None:
        self._logger = logger or logging.getLogger("lai_processing")

    def event(self, name: str, **fields: FieldValue) -> None:
        clean = check_fields(fields)
        self._logger.info("%s %s", name, " ".join(f"{k}={v}" for k, v in sorted(clean.items())))

    def metric(self, name: str, value: float, *, unit: str = "Count", **fields: FieldValue) -> None:
        clean = check_fields(fields)
        rendered = " ".join(f"{k}={v}" for k, v in sorted(clean.items()))
        self._logger.info("metric %s value=%s unit=%s %s", name, value, unit, rendered)
