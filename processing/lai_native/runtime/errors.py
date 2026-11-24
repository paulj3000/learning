"""Stable, log-safe error codes for native tool execution.

An error carries a code from `CODES` and nothing else: never a path, a stderr line, a file name or
any other text that came from the input or the tool. Callers map codes to job outcomes with
`retryable`.
"""

from __future__ import annotations

from typing import Final

#: code -> retryable. A timeout or a lost workspace may succeed on another attempt; a refused
#: input, a decode failure or a missing binary will not.
CODES: Final = {
    "tool_not_configured": False,
    "tool_missing": False,
    "tool_not_executable": False,
    "tool_checksum_mismatch": False,
    "invalid_argument": False,
    "workspace_error": True,
    "spawn_failed": True,
    "timeout": True,
    "deadline_exceeded": True,
    "cancelled": True,
    "output_too_large": False,
    "stdout_too_large": False,
    "resource_limit": False,  # CPU exhaustion repeats on the same input
    "tool_crashed": True,
    "tool_failed": False,
}


class NativeToolError(Exception):
    """A native tool run failed. `str(error)` is the code."""

    def __init__(self, code: str):
        if code not in CODES:
            code = "tool_failed"
        super().__init__(code)
        self.code = code

    @property
    def retryable(self) -> bool:
        return CODES[self.code]
