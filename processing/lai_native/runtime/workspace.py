"""A private per-job working directory for a native tool.

Created 0700 under a trusted base (the Lambda `/tmp`), holds the input copy and the outputs, and
is removed in `close()` (also on error). File names inside are chosen by code, never taken from
a job. `safe_path` is the only way to build a path to hand to a tool.
"""

from __future__ import annotations

import os
import re
import shutil
import stat
import tempfile
from pathlib import Path

from .errors import NativeToolError

_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$")


class Workspace:
    def __init__(self, base: str | os.PathLike[str] | None = None):
        try:
            root = tempfile.mkdtemp(prefix="lai-native-", dir=None if base is None else str(base))
            os.chmod(root, 0o700)
        except OSError:
            raise NativeToolError("workspace_error") from None
        self.root = Path(root).resolve()

    def safe_path(self, name: str) -> Path:
        """An absolute path inside the workspace for a code-chosen file name."""
        if not isinstance(name, str) or not _NAME.match(name) or name in {".", ".."}:
            raise NativeToolError("invalid_argument")
        return self.root / name

    def write(self, name: str, data: bytes) -> Path:
        path = self.safe_path(name)
        try:
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "wb") as handle:
                handle.write(data)
        except OSError:
            raise NativeToolError("workspace_error") from None
        return path

    def read(self, name: str, max_bytes: int) -> bytes:
        """Read a file produced by a tool, refusing symlinks and anything above `max_bytes`."""
        path = self.safe_path(name)
        try:
            if path.is_symlink() or not path.is_file():
                raise NativeToolError("workspace_error")
            if path.stat().st_size > max_bytes:
                raise NativeToolError("output_too_large")
            return path.read_bytes()
        except OSError:
            raise NativeToolError("workspace_error") from None

    def used_bytes(self) -> int:
        """Bytes of every regular file below the workspace, subdirectories included (a tool
        could otherwise hide output in a directory). Symlinks are never followed or counted."""
        total = 0
        for directory, _names, files in os.walk(self.root, followlinks=False):
            for name in files:
                try:
                    info = os.lstat(os.path.join(directory, name))
                except OSError:
                    continue
                if stat.S_ISREG(info.st_mode):
                    total += info.st_size
        return total

    def close(self) -> None:
        shutil.rmtree(self.root, ignore_errors=True)

    def __enter__(self) -> Workspace:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()


#: Directory name prefixes this repository's workspaces use (`Workspace` here, and the
#: engine's `lai_processing.core.workspace`).
WORKSPACE_PREFIXES = ("lai-native-", "lai-proc-")


#: Where Lambda workspaces live (the only writable directory in AWS Lambda).
DEFAULT_SWEEP_BASE = "/tmp"  # noqa: S108


def sweep_stale(
    base: str | os.PathLike[str] = DEFAULT_SWEEP_BASE,
    prefixes: tuple[str, ...] = WORKSPACE_PREFIXES,
) -> int:
    """Remove leftover workspaces under `base`; returns how many. Call once at worker init: a
    Lambda container runs one invocation at a time, so any such directory found then belongs to an
    earlier invocation that was killed before its cleanup (the 512 MB `/tmp` is reused across
    invocations of a warm container). Symlinks and non-directories are left alone."""
    removed = 0
    try:
        entries = list(os.scandir(base))
    except OSError:
        return 0
    for entry in entries:
        if entry.name.startswith(prefixes) and entry.is_dir(follow_symlinks=False):
            shutil.rmtree(entry.path, ignore_errors=True)
            removed += 1
    return removed
