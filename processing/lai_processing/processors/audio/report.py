"""Findings, run warnings, limitations and bounded reads for the audio inspector.

Every message is authored here or in the format modules, never built from file content: a
finding names a code, a fixed sentence and at most an index path such as `page[3]`. Nothing
copied from the file reaches a message. Chunk ids (four printable ASCII characters) are the only
file bytes copied into metadata, and only after `chunk_label` reduces them to a closed alphabet.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import IO, Final

from ...contracts.results import Finding, ProcessingWarning, Severity

__all__ = [
    "MAX_REPORTED_FINDINGS",
    "Report",
    "Source",
    "chunk_label",
]

#: Well below the contract ceiling of 500; leaves room for the overflow finding.
MAX_REPORTED_FINDINGS: Final = 100
#: The largest single read. An Ogg page is at most 65,307 bytes; nothing else needs more.
MAX_READ_BYTES: Final = 128 * 1024
#: Reads are served from a cached window of this size (frame and page walks read small pieces).
_WINDOW: Final = 64 * 1024
#: `check()` (cancellation and deadline) runs every this many reads.
_CHECK_EVERY: Final = 512


class Report:
    """Ordered findings, run warnings and limitations, bounded so a hostile file cannot flood a
    result. Findings past `MAX_REPORTED_FINDINGS` are summarised by one `too_many_findings`
    finding whose severity is `error` when any dropped finding was an error, so truncation can
    never turn a failing verdict into a pass. Codes are reported once per (code, path)."""

    def __init__(self, max_findings: int = MAX_REPORTED_FINDINGS) -> None:
        self._max = max_findings
        self._findings: list[Finding] = []
        self._seen: set[tuple[str, str]] = set()
        self._warnings: dict[str, ProcessingWarning] = {}
        self._limitations: dict[str, str] = {}
        self._dropped = 0
        self._dropped_error = False
        self.error_count = 0

    def _add(self, severity: Severity, code: str, message: str, path: str) -> None:
        if (code, path) in self._seen:
            return
        self._seen.add((code, path))
        if severity is Severity.ERROR:
            self.error_count += 1
        if len(self._findings) >= self._max:
            self._dropped += 1
            self._dropped_error = self._dropped_error or severity is Severity.ERROR
            return
        self._findings.append(Finding(code=code, severity=severity, message=message, path=path))

    def error(self, code: str, message: str, path: str = "") -> None:
        self._add(Severity.ERROR, code, message, path)

    def warn(self, code: str, message: str, path: str = "") -> None:
        self._add(Severity.WARNING, code, message, path)

    def info(self, code: str, message: str, path: str = "") -> None:
        self._add(Severity.INFO, code, message, path)

    def note(self, code: str, message: str) -> None:
        """A run warning (about the inspection, not the file). One per code."""
        self._warnings.setdefault(code, ProcessingWarning(code=code, message=message))

    def limitation(self, code: str, message: str) -> None:
        """A limitation of what this inspection can say. One per code, in insertion order."""
        self._limitations.setdefault(code, message)

    @property
    def has_errors(self) -> bool:
        return self.error_count > 0

    def codes(self, severity: Severity | None = None) -> list[str]:
        return [f.code for f in self._findings if severity is None or f.severity is severity]

    def findings(self) -> tuple[Finding, ...]:
        out = list(self._findings)
        if self._dropped:
            out.append(
                Finding(
                    code="too_many_findings",
                    severity=Severity.ERROR if self._dropped_error else Severity.WARNING,
                    message="The file has more problems than one report lists; fix the listed "
                    "ones and inspect it again.",
                )
            )
        return tuple(out)

    def warnings(self) -> tuple[ProcessingWarning, ...]:
        return tuple(self._warnings[k] for k in sorted(self._warnings))

    def limitations(self) -> list[dict[str, str]]:
        return [{"code": code, "message": text} for code, text in self._limitations.items()]


class Source:
    """Bounded, offset-addressed reads over the verified input copy.

    `read(offset, length)` never reads past the end, never more than `MAX_READ_BYTES` at once,
    and returns fewer bytes (possibly none) at the end of the file. Reads are served from one
    cached window, so walking thousands of small frame or page headers costs few system calls.
    `check` is the engine's cooperative cancellation and deadline checkpoint.
    """

    def __init__(self, handle: IO[bytes], size: int, check: Callable[[], None]) -> None:
        self._handle = handle
        self.size = size
        self._check = check
        self._window = b""
        self._window_start = 0
        self.reads = 0

    def read(self, offset: int, length: int) -> bytes:
        if offset < 0 or length <= 0 or offset >= self.size:
            return b""
        length = min(length, MAX_READ_BYTES, self.size - offset)
        self.reads += 1
        if self.reads % _CHECK_EVERY == 0:
            self._check()
        start = self._window_start
        if start <= offset and offset + length <= start + len(self._window):
            return self._window[offset - start : offset - start + length]
        self._handle.seek(offset)
        self._window = self._handle.read(max(length, _WINDOW))
        self._window_start = offset
        return self._window[:length]

    def check(self) -> None:
        self._check()


_LABEL_CHARS: Final = frozenset("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 _-")


def chunk_label(raw: bytes) -> str:
    """A RIFF chunk id for metadata: letters, digits, space, `_` and `-` kept, anything else `?`."""
    return "".join(chr(b) if chr(b) in _LABEL_CHARS else "?" for b in raw[:4])
