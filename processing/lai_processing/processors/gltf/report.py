"""Finding collection for the GLB validator, and bounded text copied from a file.

Every finding message is authored here or in the checking code, never built from file content:
names, URIs and extension strings stay out of messages, which carry only a code-authored
sentence and an index path such as `accessors[3]`. Strings that metadata copies from a file
(names, the generator) go through `clean_text`, which removes control and format characters
and bounds the length, because they are shown in staff UI.
"""

from __future__ import annotations

import unicodedata
from typing import Final

from ...contracts.results import Finding, ProcessingWarning, Severity

__all__ = [
    "MAX_REPORTED_FINDINGS",
    "MAX_TEXT_CHARS",
    "Report",
    "Stop",
    "clean_text",
]

# Below the contract ceiling of 500, leaving room for the overflow finding.
MAX_REPORTED_FINDINGS: Final = 200
MAX_TEXT_CHARS: Final = 200
# Control (Cc), format (Cf, e.g. bidirectional overrides), surrogate (Cs) and private-use (Co)
# characters never reach staff UI.
_REMOVED_CATEGORIES: Final = frozenset({"Cc", "Cf", "Cs", "Co"})


class Stop(Exception):  # noqa: N818 - a control-flow signal, not an error
    """Internal: the file is unusable; stop checking (the reason is already recorded)."""


class Report:
    """Ordered findings and run warnings, bounded so a hostile file cannot flood a result.

    Findings past `MAX_REPORTED_FINDINGS` are dropped and summarised by one `too_many_findings`
    finding, whose severity is `error` when any dropped finding was an error, so the verdict
    can never turn into a pass by truncation.
    """

    def __init__(self, max_findings: int = MAX_REPORTED_FINDINGS) -> None:
        self._max = max_findings
        self._findings: list[Finding] = []
        self._warnings: dict[str, ProcessingWarning] = {}
        self._dropped = 0
        self._dropped_error = False
        self.error_count = 0

    def _add(self, severity: Severity, code: str, message: str, path: str) -> None:
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

    def note(self, code: str, message: str) -> None:
        """A run warning (about the report, not the file). One per code."""
        self._warnings.setdefault(code, ProcessingWarning(code=code, message=message))

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
                    message="The model has more problems than one report lists; fix the "
                    "listed ones and validate again.",
                )
            )
        return tuple(out)

    def warnings(self) -> tuple[ProcessingWarning, ...]:
        return tuple(self._warnings[k] for k in sorted(self._warnings))


def clean_text(value: object, limit: int = MAX_TEXT_CHARS) -> tuple[str | None, bool]:
    """`value` made safe for staff UI: (text or None when not a string, truncated?).

    Removes control, format, surrogate and private-use characters, then keeps at most `limit`
    characters. The result never contains NUL or a lone surrogate (both unstorable in jsonb).
    """
    if not isinstance(value, str):
        return None, False
    kept: list[str] = []
    for ch in value:  # stops after limit + 1 kept characters, so a huge string costs little
        if unicodedata.category(ch) in _REMOVED_CATEGORIES:
            continue
        if len(kept) == limit:
            return "".join(kept), True
        kept.append(ch)
    return "".join(kept), False
