"""A private, size-bounded temporary directory for one job attempt.

Security decisions:
- The directory is created by `tempfile.mkdtemp` (unpredictable name, created atomically) and
  set to mode 0o700, so other local users cannot read inputs or plant files in it.
- File names are a closed pattern: one path segment of letters, digits, `.`, `_` and `-`, not
  starting with a dot. Separators, `..`, empty names and hidden names are refused with
  INVALID_OBJECT_REFERENCE, and every resolved path is asserted to stay inside the root.
- Files are opened with `O_NOFOLLOW`, and a name whose resolved path leaves the root (a planted
  symlink) is refused, so the workspace never follows a link out of its directory.
- Every byte written is counted against `max_bytes` *before* it is written. The count is
  cumulative and never credited back (overwriting a file does not free budget): a simple,
  conservative bound that cannot be gamed by truncate-and-rewrite loops.
- `cleanup()` removes the whole tree, is idempotent, and is always called by the engine.
"""

from __future__ import annotations

import os
import re
import shutil
import tempfile
from pathlib import Path
from types import TracebackType
from typing import BinaryIO, Final

from .errors import ErrorCode, ProcessingError

__all__ = ["WORKSPACE_NAME", "Workspace"]

WORKSPACE_NAME: Final = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")
_OPEN_FLAGS: Final = os.O_WRONLY | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0) | getattr(
    os, "O_CLOEXEC", 0
)


def _refuse(reason: str) -> ProcessingError:
    return ProcessingError(
        ErrorCode.INVALID_OBJECT_REFERENCE, {"field": "workspace.name", "reason": reason}
    )


class Workspace:
    """A private temporary directory with a byte budget. Use `Workspace.create`."""

    def __init__(self, root: Path, max_bytes: int) -> None:
        if type(max_bytes) is not int or max_bytes <= 0:
            raise ValueError("max_bytes must be a positive integer")
        self._root = root
        self._max_bytes = max_bytes
        self._used = 0
        self._cleaned = False

    @classmethod
    def create(cls, *, max_bytes: int, root: Path | None = None) -> Workspace:
        if type(max_bytes) is not int or max_bytes <= 0:
            raise ValueError("max_bytes must be a positive integer")
        path = tempfile.mkdtemp(prefix="lai-proc-", dir=None if root is None else str(root))
        os.chmod(path, 0o700)
        # Resolve once, so containment checks compare against the real location.
        return cls(Path(os.path.realpath(path)), max_bytes)

    # Context manager -----------------------------------------------------------------------

    def __enter__(self) -> Workspace:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        self.cleanup()

    # Properties ----------------------------------------------------------------------------

    @property
    def root(self) -> Path:
        return self._root

    @property
    def max_bytes(self) -> int:
        return self._max_bytes

    @property
    def used_bytes(self) -> int:
        return self._used

    @property
    def cleaned(self) -> bool:
        return self._cleaned

    # Operations ----------------------------------------------------------------------------

    def _require_live(self) -> None:
        if self._cleaned:
            raise ProcessingError(ErrorCode.UNEXPECTED_FAILURE, {"reason": "workspace_cleaned"})

    def path(self, name: str) -> Path:
        """The path of `name` inside the workspace, after strict name and containment checks."""
        self._require_live()
        if not isinstance(name, str) or not WORKSPACE_NAME.fullmatch(name):
            raise _refuse("name")
        if name in {".", ".."} or ".." in name:
            raise _refuse("name")
        candidate = self._root / name
        resolved = Path(os.path.realpath(candidate))
        if resolved.parent != self._root or resolved.name != name:
            # A symlink (or anything else) that resolves elsewhere is refused.
            raise _refuse("outside_root")
        return candidate

    def reserve(self, n: int) -> None:
        """Account for `n` more bytes; refuse with RESOURCE_LIMIT_EXCEEDED past the budget."""
        self._require_live()
        if type(n) is not int or n < 0:
            raise ValueError("reserve() needs a non-negative integer")
        if self._used + n > self._max_bytes:
            raise ProcessingError(ErrorCode.RESOURCE_LIMIT_EXCEEDED, {"limit": "max_temp_bytes"})
        self._used += n

    def open_new(self, name: str) -> BinaryIO:
        """Open `name` for writing (created exclusively, never through a symlink).

        The caller must `reserve()` every byte before writing it; `write()` does so itself.
        """
        target = self.path(name)
        fd = os.open(target, _OPEN_FLAGS | os.O_EXCL, 0o600)
        return os.fdopen(fd, "wb")

    def write(self, name: str, data: bytes) -> Path:
        """Write `data` to `name` (replacing an existing regular file) within the budget."""
        target = self.path(name)
        if not isinstance(data, (bytes, bytearray, memoryview)):
            raise TypeError("workspace data must be bytes")
        self.reserve(len(data))
        fd = os.open(target, _OPEN_FLAGS | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
        return target

    def cleanup(self) -> None:
        """Remove the workspace and everything in it. Safe to call more than once.

        `shutil.rmtree` unlinks symlinks rather than following them, so a link planted inside
        the workspace cannot make cleanup delete anything outside it.
        """
        if self._cleaned:
            return
        if self._root.exists():
            shutil.rmtree(self._root)
        self._cleaned = True
