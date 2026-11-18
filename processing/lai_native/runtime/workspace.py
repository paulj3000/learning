"""A private per-job working directory for a native tool.

Created 0700 under a trusted base (the Lambda `/tmp`), holds the input copy and the outputs, and
is removed in `close()` (also on error). File names inside are chosen by code, never taken from
a job. `safe_path` is the only way to build a path to hand to a tool.
"""

from __future__ import annotations

import os
import re
import shutil
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
        total = 0
        try:
            for entry in os.scandir(self.root):
                if entry.is_file(follow_symlinks=False):
                    total += entry.stat(follow_symlinks=False).st_size
        except OSError:
            return total
        return total

    def close(self) -> None:
        shutil.rmtree(self.root, ignore_errors=True)

    def __enter__(self) -> Workspace:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()
