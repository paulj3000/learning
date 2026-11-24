"""Run one trusted native executable with bounded time, memory, files and output.

The adapter is shared by every native workload (FFmpeg now; gltfpack and toktx later). It is the
only module under `lai_native` that starts a process (a guard test enforces it). Rules:

* Memory: `RLIMIT_AS` bounds the tool's *virtual* size. On Lambda the real ceiling is the
  function's cgroup memory: a tool that exhausts it is killed by the kernel OOM killer with
  SIGKILL, which is reported as `tool_crashed` (retryable), not as a limit. Keep `RLIMIT_AS`
  above the function memory so it is a runaway guard only, and size the function from
  measured peak RSS (`ToolResult.peak_rss_kb`).
* The executable is a fixed absolute path from configuration (for example `/opt/bin/ffmpeg`),
  never resolved from `PATH`, never taken from a job. Its SHA-256 can be pinned.
* `argv` is a list; `shell=False`; the child gets a scrubbed environment (no AWS credentials,
  queue URLs or `PATH`) and a private working directory.
* RLIMIT_CPU, RLIMIT_AS, RLIMIT_FSIZE, RLIMIT_NOFILE (and RLIMIT_NPROC when configured) are set
  on the child; the child is its own session so a timeout kills the whole group.
* stdout and stderr are read incrementally into bounded buffers (excess is dropped and counted),
  and the workspace size is watched while the tool runs.
* A wall-clock timeout, a deadline (`Deadline`: the Lambda context's
  `get_remaining_time_in_millis` minus a reserve; the native workers build it from the invocation
  context) and a cancellation callback are checked every poll.
* Errors are stable codes (`NativeToolError`); stderr is returned to the caller for numeric
  parsing and is never put into an error or a log by this module.
"""

from __future__ import annotations

import hashlib
import os
import resource
import selectors
import signal
import subprocess
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Final

from .errors import NativeToolError
from .workspace import Workspace

__all__ = [
    "Deadline",
    "ToolLimits",
    "ToolResult",
    "ToolSpec",
    "check_argv",
    "run_tool",
    "sha256_file",
]

POLL_SECONDS: Final = 0.05
_READ_CHUNK: Final = 64 * 1024
#: Child environment: only these keys, with fixed values, plus the spec's `extra_env`.
_BASE_ENV: Final = {"LC_ALL": "C", "LANG": "C", "TZ": "UTC"}


@dataclass(frozen=True)
class ToolLimits:
    timeout_seconds: float = 120.0
    cpu_seconds: int = 120
    address_space_bytes: int = 1536 * 1024 * 1024
    max_file_bytes: int = 32 * 1024 * 1024  # RLIMIT_FSIZE: largest single file the tool may write
    max_workspace_bytes: int = 96 * 1024 * 1024  # all files in the workspace together
    max_stdout_bytes: int = 64 * 1024
    max_stderr_bytes: int = 256 * 1024
    max_open_files: int = 64
    #: RLIMIT_NPROC counts every process and thread of the user, so a low value breaks FFmpeg's
    #: worker threads on a busy host. Off by default; set it only for a tool run as its own user.
    max_processes: int | None = None


#: The limits a run gets when the caller names none (immutable, so one shared instance is safe).
DEFAULT_TOOL_LIMITS = ToolLimits()


@dataclass(frozen=True)
class ToolSpec:
    """A trusted executable. Built from configuration, never from a job."""

    name: str
    path: str
    sha256: str | None = None
    #: Extra fixed environment (for example `LD_LIBRARY_PATH` for a relocated layer in tests).
    extra_env: Mapping[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class ToolResult:
    returncode: int
    stdout: bytes
    stderr: bytes
    stderr_truncated: bool
    elapsed_seconds: float
    peak_rss_kb: int


class Deadline:
    """A cooperative deadline: `remaining_ms` is Lambda's `get_remaining_time_in_millis`."""

    def __init__(
        self,
        remaining_ms: Callable[[], int | float] | None = None,
        reserve_seconds: float = 5.0,
        clock: Callable[[], float] = time.monotonic,
    ):
        self._remaining_ms = remaining_ms
        self.reserve_seconds = reserve_seconds
        self._clock = clock

    def seconds_left(self) -> float:
        if self._remaining_ms is None:
            return float("inf")
        return float(self._remaining_ms()) / 1000.0 - self.reserve_seconds


def sha256_file(path: str | os.PathLike[str]) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def check_argv(argv: Sequence[str]) -> list[str]:
    """Every element a non-empty string without NUL bytes; returns a fresh list."""
    out = []
    for item in argv:
        if not isinstance(item, str) or "\x00" in item or not item:
            raise NativeToolError("invalid_argument")
        out.append(item)
    return out


def _limiter(limits: ToolLimits) -> Callable[[], None]:
    def apply() -> None:  # runs in the child between fork and exec
        os.umask(0o077)
        # Soft limit one second under the hard one: the soft limit raises SIGXCPU (mapped to
        # `resource_limit`); the hard limit would kill with an uncatchable SIGKILL (`tool_crashed`).
        cpu = limits.cpu_seconds
        resource.setrlimit(resource.RLIMIT_CPU, (max(1, cpu - 1), cpu))
        pairs = [
            (resource.RLIMIT_AS, limits.address_space_bytes),
            (resource.RLIMIT_FSIZE, limits.max_file_bytes),
            (resource.RLIMIT_NOFILE, limits.max_open_files),
            (resource.RLIMIT_CORE, 0),
        ]
        if limits.max_processes is not None:
            pairs.append((resource.RLIMIT_NPROC, limits.max_processes))
        for which, value in pairs:
            resource.setrlimit(which, (value, value))

    return apply


def _take(buffers, dropped, caps, name: str, chunk: bytes) -> None:
    """Bounded capture. stdout keeps the head (an overflow fails the run). stderr keeps the TAIL
    (a ring): FFmpeg prints its summaries and errors last, and a hostile input tag printed at the
    start must not crowd them out. Dropped bytes are counted either way."""
    buf = buffers[name]
    if name == "err":
        buf.extend(chunk)
        extra = len(buf) - caps[name]
        if extra > 0:
            del buf[:extra]
            dropped[name] += extra
        return
    room = caps[name] - len(buf)
    if room > 0:
        buf.extend(chunk[:room])
    dropped[name] += max(0, len(chunk) - max(room, 0))


def _kill(pgid: int) -> None:
    """SIGKILL the tool's process group. The tool is its own session and group leader
    (`start_new_session`), so its pid is the group id. Only `killpg` is ever used: after the
    leader is reaped the group may still hold grandchildren (this kills them) and, while any member
    lives, the kernel does not reuse the id; signalling a bare pid after it was reaped could hit an
    unrelated reused process and is never used."""
    try:
        os.killpg(pgid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        pass


def run_tool(
    spec: ToolSpec,
    args: Sequence[str],
    workspace: Workspace,
    limits: ToolLimits = DEFAULT_TOOL_LIMITS,
    *,
    deadline: Deadline | None = None,
    cancelled: Callable[[], bool] | None = None,
    clock: Callable[[], float] = time.monotonic,
) -> ToolResult:
    """Run `spec.path args...` in `workspace`. Raises `NativeToolError`; never returns on failure
    to start. A nonzero exit is returned (not raised) so the caller can map it with its own
    knowledge of the tool; use `raise_for_exit` style checks in the workload module."""
    if not spec.path or not os.path.isabs(spec.path):
        raise NativeToolError("tool_not_configured")
    if not os.path.isfile(spec.path):
        raise NativeToolError("tool_missing")
    if not os.access(spec.path, os.X_OK):
        raise NativeToolError("tool_not_executable")
    if spec.sha256 is not None and sha256_file(spec.path) != spec.sha256:
        raise NativeToolError("tool_checksum_mismatch")
    argv = [spec.path, *check_argv(args)]
    env = dict(_BASE_ENV)
    env.update({"HOME": str(workspace.root), "TMPDIR": str(workspace.root)})
    env.update(spec.extra_env)

    timeout = limits.timeout_seconds
    if deadline is not None:
        left = deadline.seconds_left()
        if left <= 0:
            raise NativeToolError("deadline_exceeded")
        timeout = min(timeout, left)

    started = clock()
    try:
        proc = subprocess.Popen(  # noqa: S603 - fixed trusted path, argv list, shell=False
            argv,
            shell=False,
            cwd=str(workspace.root),
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            close_fds=True,
            start_new_session=True,
            preexec_fn=_limiter(limits),  # noqa: PLW1509 - single-threaded worker
        )
    except OSError:
        raise NativeToolError("spawn_failed") from None

    selector = selectors.DefaultSelector()
    buffers = {"out": bytearray(), "err": bytearray()}
    caps = {"out": limits.max_stdout_bytes, "err": limits.max_stderr_bytes}
    dropped = {"out": 0, "err": 0}
    if proc.stdout is None or proc.stderr is None:
        raise RuntimeError("native tool started without its output pipes")
    for name, stream in (("out", proc.stdout), ("err", proc.stderr)):
        os.set_blocking(stream.fileno(), False)
        selector.register(stream, selectors.EVENT_READ, name)

    failure: str | None = None
    status: int | None = None
    rusage = None
    try:
        while True:
            for key, _ in selector.select(timeout=POLL_SECONDS):
                name = key.data
                try:
                    chunk = os.read(key.fileobj.fileno(), _READ_CHUNK)
                except BlockingIOError:
                    continue
                except OSError:
                    chunk = b""
                if not chunk:
                    selector.unregister(key.fileobj)
                    continue
                _take(buffers, dropped, caps, name, chunk)
            if failure is None:
                now = clock()
                if cancelled is not None and cancelled():
                    failure = "cancelled"
                elif now - started > timeout:
                    failure = (
                        "deadline_exceeded"
                        if deadline is not None and timeout < limits.timeout_seconds
                        else "timeout"
                    )
                elif workspace.used_bytes() > limits.max_workspace_bytes:
                    failure = "output_too_large"
                elif dropped["out"] > 0:
                    failure = "stdout_too_large"
                if failure:
                    _kill(proc.pid)
            done, status_value, rusage_value = os.wait4(proc.pid, os.WNOHANG)
            if done:
                status, rusage = status_value, rusage_value
                break
        # Drain what the pipes still hold (bounded by the same caps).
        for key in list(selector.get_map().values()):
            name = key.data
            while True:
                try:
                    chunk = os.read(key.fileobj.fileno(), _READ_CHUNK)
                except (BlockingIOError, OSError):
                    break
                if not chunk:
                    break
                _take(buffers, dropped, caps, name, chunk)
    finally:
        _kill(proc.pid)
        selector.close()
        for stream in (proc.stdout, proc.stderr):
            try:
                stream.close()
            except OSError:
                pass
        proc.returncode = 0  # reaped by wait4 above; stop Popen from waiting again

    if failure:
        raise NativeToolError(failure)
    if status is None or rusage is None:
        raise RuntimeError("native tool finished without an exit status")
    if os.WIFSIGNALED(status):
        sig = os.WTERMSIG(status)
        if sig in (signal.SIGXCPU,):
            raise NativeToolError("resource_limit")
        if sig == signal.SIGXFSZ:
            raise NativeToolError("output_too_large")
        raise NativeToolError("tool_crashed")
    code = os.WEXITSTATUS(status)
    if workspace.used_bytes() > limits.max_workspace_bytes:
        raise NativeToolError("output_too_large")
    if dropped["out"] > 0:
        raise NativeToolError("stdout_too_large")
    return ToolResult(
        returncode=code,
        stdout=bytes(buffers["out"]),
        stderr=bytes(buffers["err"]),
        stderr_truncated=dropped["err"] > 0,
        elapsed_seconds=round(clock() - started, 3),
        peak_rss_kb=int(rusage.ru_maxrss),
    )
