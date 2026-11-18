"""TEMPORARY native tool runner for `lai_native.optimize`. REPLACE WITH `lai_native.runtime`.

Workstream C owns the native runtime adapter (`processing/lai_native/runtime/`, branch
`feature/lambda-native-audio`). Until it lands, the optimizer runs tools through this minimal
shim with the agreed interface:

    run_tool(executable, argv, *, timeout_s, max_output_bytes, workdir, env=None) -> ToolResult

At integration the principal swaps the import in `lai_native/optimize/runner.py` (the only
importer) for C's adapter and deletes this file. Keep it small and obviously replaceable: no
other module imports from here.

Behaviour: argv list only (never a shell), a minimal environment, the working directory fixed,
stdout and stderr captured to bounded size, a hard timeout that kills the process, and the
child's own peak RSS from `os.wait4` (Linux reports KiB).
"""

from __future__ import annotations

import os
import signal
import subprocess  # noqa: S404 - native tool execution is this package's purpose; argv only
import tempfile
import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

__all__ = ["ToolError", "ToolResult", "run_tool"]

_POLL_SECONDS = 0.01


class ToolError(RuntimeError):
    """The tool could not be run to completion (not found, timed out). `code` is stable."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True, slots=True)
class ToolResult:
    returncode: int
    stdout: bytes
    stderr: bytes
    wall_seconds: float
    peak_rss_kib: int | None
    truncated: bool


def _bounded(handle, limit: int) -> tuple[bytes, bool]:  # type: ignore[no-untyped-def]
    handle.seek(0, os.SEEK_END)
    size = handle.tell()
    handle.seek(0)
    return handle.read(limit), size > limit


def run_tool(
    executable: str | Path,
    argv: Sequence[str],
    *,
    timeout_s: float,
    max_output_bytes: int,
    workdir: str | Path,
    env: Mapping[str, str] | None = None,
) -> ToolResult:
    """Run `executable argv...` in `workdir`. Raises `ToolError` for not found and timeout; a
    non-zero exit is a normal result (the caller decides)."""
    path = Path(executable)
    if not path.is_file() or not os.access(path, os.X_OK):
        raise ToolError("tool_not_found", "The optimization tool is not installed.")
    environment = {"PATH": "/usr/bin:/bin", "LC_ALL": "C"}
    if env:
        environment.update(env)
    with tempfile.TemporaryFile() as out, tempfile.TemporaryFile() as err:
        started = time.monotonic()
        process = subprocess.Popen(  # noqa: S603 - argv list, no shell, fixed executable
            [str(path), *argv],
            cwd=str(workdir),
            env=environment,
            stdin=subprocess.DEVNULL,
            stdout=out,
            stderr=err,
            start_new_session=True,
        )
        deadline = started + timeout_s
        rusage = None
        status = 0
        while True:
            pid, status, rusage = os.wait4(process.pid, os.WNOHANG)
            if pid:
                break
            if time.monotonic() > deadline:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                os.wait4(process.pid, 0)
                process.returncode = -9
                raise ToolError("tool_timeout", "The optimization tool took too long.")
            time.sleep(_POLL_SECONDS)
        process.returncode = os.waitstatus_to_exitcode(status)
        wall = time.monotonic() - started
        stdout, cut_out = _bounded(out, max_output_bytes)
        stderr, cut_err = _bounded(err, max_output_bytes)
    return ToolResult(
        returncode=process.returncode,
        stdout=stdout,
        stderr=stderr,
        wall_seconds=wall,
        peak_rss_kib=int(rusage.ru_maxrss) if rusage is not None else None,
        truncated=cut_out or cut_err,
    )
