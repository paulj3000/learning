"""`JsonLogTelemetry`: one JSON object per line, for CloudWatch Logs and local terminals.

Every field passes `lai_processing.ports.telemetry.check_fields` first (the closed `SAFE_FIELDS`
vocabulary, scalar values, no newlines), so ids, codes, counts and durations are the only things
a log line can carry: never a message body, an input, a file name or an exception message.

Line shape: `{"ts": ..., "level": ..., "logger": ..., "event": name, <fields>}` for events and
`{"ts", "level", "logger", "metric": name, "value", "unit", <fields>}` for metrics. Events
whose name signals a problem (`invalid`, `failed`, `rejected`, `error`, `interrupted`) are
written at WARNING; everything else at INFO. Lines below `level` are dropped.
"""

from __future__ import annotations

import json
import logging
import sys
import threading
from collections.abc import Callable
from datetime import UTC, datetime
from typing import IO, Final

from lai_processing.core.canonical import format_timestamp
from lai_processing.ports.telemetry import FieldValue, check_fields

__all__ = ["JsonLogTelemetry"]

_LEVELS: Final = {"DEBUG": 10, "INFO": 20, "WARNING": 30, "ERROR": 40, "CRITICAL": 50}
_WARNING_WORDS: Final = ("invalid", "failed", "rejected", "error", "interrupted")
_RESERVED: Final = frozenset({"ts", "level", "logger", "event", "metric", "value", "unit"})


def _level_of(name: str) -> str:
    return "WARNING" if any(word in name for word in _WARNING_WORDS) else "INFO"


class JsonLogTelemetry:
    """Writes JSON lines to `stream` (default standard error), or through `logger` when given
    (the line is the log record's message). Thread-safe."""

    def __init__(
        self,
        stream: IO[str] | None = None,
        *,
        logger: logging.Logger | None = None,
        level: str = "INFO",
        name: str = "lai_processing",
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        if level.upper() not in _LEVELS:
            raise ValueError("unknown log level")
        self._stream = stream
        self._logger = logger
        self._threshold = _LEVELS[level.upper()]
        self._name = name
        self._clock = clock or (lambda: datetime.now(UTC))
        self._lock = threading.Lock()

    def _write(self, level: str, head: dict[str, object], fields: dict[str, FieldValue]) -> None:
        if _LEVELS[level] < self._threshold:
            return
        line: dict[str, object] = {
            "ts": format_timestamp(self._clock()),
            "level": level,
            "logger": self._name,
            **head,
        }
        for key, value in fields.items():
            if key not in _RESERVED:
                line[key] = value
        text = json.dumps(line, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
        if self._logger is not None:
            self._logger.log(_LEVELS[level], "%s", text)
            return
        stream = self._stream if self._stream is not None else sys.stderr
        with self._lock:
            stream.write(text + "\n")
            stream.flush()

    def event(self, name: str, **fields: FieldValue) -> None:
        clean = check_fields(fields)
        self._write(_level_of(name), {"event": name}, clean)

    def metric(self, name: str, value: float, *, unit: str = "Count", **fields: FieldValue) -> None:
        clean = check_fields(fields)
        self._write("INFO", {"metric": name, "value": float(value), "unit": unit}, clean)
