"""`ObjectStorage` on local directories: one root per logical store, path = root/key.

Used by the local worker and by Django's `local` processing backend. Security decisions:

- Every key is re-validated with `check_object_key` (store prefix, namespace, no traversal) and
  the joined path is asserted to stay inside the store root.
- No symlink is ever followed below a root. The path is walked one directory at a time with
  `openat(O_DIRECTORY | O_NOFOLLOW)` relative to the parent's descriptor, and the object itself
  is opened with `O_NOFOLLOW`, so a link planted anywhere on the path (a parent directory or
  the final file) is refused with `StoragePermissionDenied` (reason `symlink`), and a directory
  swapped for a link between checks cannot redirect the open. The root itself is resolved once
  at construction, so a configured root may live behind a symlink (for example macOS `/tmp`).
- Writes are create-only and atomic: the bytes go to a temporary file in the target directory
  (`O_EXCL`), are counted and hashed while written, `fsync`ed and verified against the expected
  size and SHA-256, then published with `link()`, which fails if the key exists. An existing key
  is therefore never overwritten, two concurrent writers cannot both win, and a reader never
  sees a partial object. Identical content is an idempotent success; different content is
  `ObjectExists`. This needs a filesystem with hard links (ext4, xfs, APFS).
- Version ids are content-addressed: `sha256-<hex>` of the object's bytes. They are
  deterministic across processes and hosts (a redelivered attempt reports the same version),
  and a pinned read of a key whose bytes changed is `ObjectMissing`, as for a missing S3
  version. (The contract's version-id alphabet has no `:`, hence the `-`.) Digests are cached
  per (device, inode, size, mtime, ctime), so repeated heads do not rehash.
- Content types are not stored; `head` reports `None`.

Residual risk: a hard link to a file outside the root cannot be detected cheaply. Store roots
must not be writable by untrusted local users (the local worker runs as the developer).
"""

from __future__ import annotations

import errno
import hashlib
import os
import stat
import threading
import uuid
from collections.abc import Mapping
from pathlib import Path
from typing import IO, Final

from lai_processing.contracts.common import ObjectRef
from lai_processing.contracts.identifiers import StoreName, check_object_key
from lai_processing.core.canonical import CHUNK_BYTES
from lai_processing.core.errors import ErrorCode, ProcessingError
from lai_processing.ports.storage import (
    ObjectExists,
    ObjectInfo,
    ObjectMissing,
    StorageError,
    StoragePermissionDenied,
    StorageUnavailable,
)

__all__ = ["VERSION_PREFIX", "FilesystemObjectStorage", "content_version_id"]

VERSION_PREFIX: Final = "sha256-"
_NOFOLLOW: Final = getattr(os, "O_NOFOLLOW", 0)
_CLOEXEC: Final = getattr(os, "O_CLOEXEC", 0)
_DIRECTORY: Final = getattr(os, "O_DIRECTORY", 0)
_DIR_FLAGS: Final = os.O_RDONLY | _DIRECTORY | _NOFOLLOW | _CLOEXEC
# O_NONBLOCK keeps a planted FIFO from blocking the open; the regular-file check refuses it.
_READ_FLAGS: Final = os.O_RDONLY | _NOFOLLOW | _CLOEXEC | getattr(os, "O_NONBLOCK", 0)
_TEMP_FLAGS: Final = os.O_WRONLY | os.O_CREAT | os.O_EXCL | _NOFOLLOW | _CLOEXEC
_TEMP_PREFIX: Final = ".lai-put-"
_CACHE_LIMIT: Final = 4096


def content_version_id(sha256_hex: str) -> str:
    return f"{VERSION_PREFIX}{sha256_hex}"


def _details(ref: ObjectRef, operation: str, **extra: object) -> dict[str, object]:
    return {"store": ref.store.value, "operation": operation, **extra}


def _map_os_error(exc: OSError, ref: ObjectRef, operation: str) -> StorageError:
    if exc.errno == errno.ELOOP:
        return StoragePermissionDenied(_details(ref, operation, reason="symlink"))
    if isinstance(exc, (FileNotFoundError, NotADirectoryError)):
        return ObjectMissing(_details(ref, operation))
    if isinstance(exc, PermissionError):
        return StoragePermissionDenied(_details(ref, operation))
    name = errno.errorcode.get(exc.errno or 0, "unknown")
    return StorageUnavailable(_details(ref, operation, errno=name))


def _is_link(name: str, dir_fd: int) -> bool:
    try:
        return stat.S_ISLNK(os.stat(name, dir_fd=dir_fd, follow_symlinks=False).st_mode)
    except OSError:
        return False


class FilesystemObjectStorage:
    """Directory-backed `ObjectStorage`. `writable` names the stores `put` may write; `delete`
    additionally never touches the ASSETS store."""

    def __init__(
        self,
        roots: Mapping[StoreName, Path | str],
        *,
        writable: frozenset[StoreName] = frozenset({StoreName.ARTIFACTS}),
        file_mode: int = 0o600,
    ) -> None:
        self._roots: dict[StoreName, Path] = {
            StoreName(store): Path(os.path.realpath(os.fspath(path)))
            for store, path in roots.items()
        }
        self._writable = frozenset(StoreName(s) for s in writable)
        unknown = self._writable - set(self._roots)
        if unknown:
            raise ValueError("a writable store has no root")
        self._file_mode = file_mode
        self._digests: dict[tuple[int, ...], str] = {}
        self._lock = threading.Lock()

    @property
    def writable(self) -> frozenset[StoreName]:
        return self._writable

    def root(self, store: StoreName) -> Path:
        return self._roots[store]

    # Paths ---------------------------------------------------------------------------------

    def _segments(self, ref: ObjectRef, operation: str) -> tuple[Path, list[str]]:
        root = self._roots.get(ref.store)
        if root is None:
            raise StoragePermissionDenied(_details(ref, operation, reason="store"))
        check_object_key(ref.key, ref.store, ref.namespace, "ref.key")
        segments = ref.key.split("/")
        joined = os.path.normpath(os.path.join(root, *segments))
        if not joined.startswith(str(root) + os.sep):
            raise ProcessingError(
                ErrorCode.INVALID_OBJECT_REFERENCE, {"field": "ref.key", "reason": "root"}
            )
        return root, segments

    def _open_parent(self, ref: ObjectRef, operation: str, *, create: bool) -> tuple[int, str]:
        """A descriptor of the key's parent directory, walked without following links."""
        root, segments = self._segments(ref, operation)
        try:
            if create:
                os.makedirs(root, mode=0o700, exist_ok=True)
            fd = os.open(root, _DIR_FLAGS)
        except OSError as exc:
            raise _map_os_error(exc, ref, operation) from None
        try:
            for segment in segments[:-1]:
                try:
                    child = os.open(segment, _DIR_FLAGS, dir_fd=fd)
                except NotADirectoryError:
                    # O_DIRECTORY | O_NOFOLLOW on a link reports ENOTDIR on Linux: tell a
                    # planted link apart from a plain file in the way.
                    if _is_link(segment, fd):
                        raise OSError(errno.ELOOP, "symlink") from None
                    raise
                except FileNotFoundError:
                    if not create:
                        raise
                    try:
                        os.mkdir(segment, 0o700, dir_fd=fd)
                    except FileExistsError:
                        pass
                    child = os.open(segment, _DIR_FLAGS, dir_fd=fd)
                os.close(fd)
                fd = child
        except OSError as exc:
            os.close(fd)
            raise _map_os_error(exc, ref, operation) from None
        return fd, segments[-1]

    def _open_object(self, ref: ObjectRef, operation: str) -> tuple[int, os.stat_result]:
        parent, name = self._open_parent(ref, operation, create=False)
        try:
            fd = os.open(name, _READ_FLAGS, dir_fd=parent)
        except OSError as exc:
            raise _map_os_error(exc, ref, operation) from None
        finally:
            os.close(parent)
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode):
                raise ObjectMissing(_details(ref, operation, reason="not_file"))
            os.set_blocking(fd, True)
        except OSError as exc:
            os.close(fd)
            raise _map_os_error(exc, ref, operation) from None
        except BaseException:
            os.close(fd)
            raise
        return fd, info

    # Digests -------------------------------------------------------------------------------

    @staticmethod
    def _cache_key(info: os.stat_result) -> tuple[int, ...]:
        return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)

    def _digest(self, fd: int, info: os.stat_result) -> str:
        key = self._cache_key(info)
        with self._lock:
            cached = self._digests.get(key)
        if cached is not None:
            return cached
        digest = hashlib.sha256()
        offset = 0
        while True:
            chunk = os.pread(fd, CHUNK_BYTES, offset)
            if not chunk:
                break
            digest.update(chunk)
            offset += len(chunk)
        value = digest.hexdigest()
        with self._lock:
            if len(self._digests) >= _CACHE_LIMIT:
                self._digests.pop(next(iter(self._digests)))
            self._digests[key] = value
        return value

    def _info(self, ref: ObjectRef, size: int, sha256: str, content_type: str | None) -> ObjectInfo:
        version = content_version_id(sha256)
        return ObjectInfo(
            ref=ObjectRef(ref.store, ref.key, version, ref.namespace),
            size_bytes=size,
            content_type=content_type,
            version_id=version,
            sha256=sha256,
        )

    # ObjectStorage -------------------------------------------------------------------------

    def head(self, ref: ObjectRef) -> ObjectInfo:
        fd, info = self._open_object(ref, "head")
        try:
            sha256 = self._digest(fd, info)
        except OSError as exc:
            raise _map_os_error(exc, ref, "head") from None
        finally:
            os.close(fd)
        if ref.version_id is not None and ref.version_id != content_version_id(sha256):
            raise ObjectMissing(_details(ref, "head", reason="version"))
        return self._info(ref, info.st_size, sha256, None)

    def open(self, ref: ObjectRef) -> IO[bytes]:
        fd, info = self._open_object(ref, "open")
        try:
            if ref.version_id is not None:
                if ref.version_id != content_version_id(self._digest(fd, info)):
                    raise ObjectMissing(_details(ref, "open", reason="version"))
            return os.fdopen(fd, "rb")
        except OSError as exc:
            os.close(fd)
            raise _map_os_error(exc, ref, "open") from None
        except BaseException:
            os.close(fd)
            raise

    def read(self, ref: ObjectRef, *, max_bytes: int) -> bytes:
        with self.open(ref) as stream:
            data = stream.read(max_bytes + 1)
        if len(data) > max_bytes:
            raise ProcessingError(ErrorCode.RESOURCE_LIMIT_EXCEEDED, {"limit": "read_bytes"})
        return data

    def put(
        self, ref: ObjectRef, data: IO[bytes], *, content_type: str, sha256: str, size_bytes: int
    ) -> ObjectInfo:
        if ref.store not in self._writable:
            raise StoragePermissionDenied(_details(ref, "put", reason="read_only"))
        parent, name = self._open_parent(ref, "put", create=True)
        temp = f"{_TEMP_PREFIX}{uuid.uuid4().hex}"
        try:
            try:
                fd = os.open(temp, _TEMP_FLAGS, self._file_mode, dir_fd=parent)
            except OSError as exc:
                raise _map_os_error(exc, ref, "put") from None
            try:
                written, digest = self._write_temp(fd, data, size_bytes)
                os.fsync(fd)
            except OSError as exc:
                raise _map_os_error(exc, ref, "put") from None
            finally:
                os.close(fd)
            if written != size_bytes or digest != sha256:
                raise ProcessingError(ErrorCode.CHECKSUM_MISMATCH, {"field": "artifact"})
            try:
                os.link(temp, name, src_dir_fd=parent, dst_dir_fd=parent, follow_symlinks=False)
            except FileExistsError:
                return self._existing(ref, parent, name, sha256, content_type)
            except OSError as exc:
                raise _map_os_error(exc, ref, "put") from None
            try:
                os.fsync(parent)
            except OSError:  # pragma: no cover - some filesystems refuse a directory fsync
                pass
            return self._info(ref, size_bytes, sha256, content_type)
        finally:
            try:
                os.unlink(temp, dir_fd=parent)
            except OSError:
                pass
            os.close(parent)

    @staticmethod
    def _write_temp(fd: int, data: IO[bytes], size_bytes: int) -> tuple[int, str]:
        digest = hashlib.sha256()
        written = 0
        while True:
            chunk = data.read(CHUNK_BYTES)
            if not chunk:
                break
            written += len(chunk)
            if written > size_bytes:  # never write more than was promised
                break
            digest.update(chunk)
            view = memoryview(chunk)
            while view:
                count = os.write(fd, view)
                view = view[count:]
        return written, digest.hexdigest()

    def _existing(
        self, ref: ObjectRef, parent: int, name: str, sha256: str, content_type: str
    ) -> ObjectInfo:
        try:
            fd = os.open(name, _READ_FLAGS, dir_fd=parent)
        except OSError as exc:
            raise _map_os_error(exc, ref, "put") from None
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode):
                raise ObjectExists(_details(ref, "put"))
            existing = self._digest(fd, info)
        except OSError as exc:
            raise _map_os_error(exc, ref, "put") from None
        finally:
            os.close(fd)
        if existing != sha256:
            raise ObjectExists(_details(ref, "put"))
        return self._info(ref, info.st_size, sha256, content_type)

    def delete(self, ref: ObjectRef) -> None:
        if ref.store is StoreName.ASSETS or ref.store not in self._writable:
            raise StoragePermissionDenied(_details(ref, "delete", reason="read_only"))
        try:
            parent, name = self._open_parent(ref, "delete", create=False)
        except ObjectMissing:
            return
        try:
            info = os.stat(name, dir_fd=parent, follow_symlinks=False)
            if stat.S_ISLNK(info.st_mode):
                raise StoragePermissionDenied(_details(ref, "delete", reason="symlink"))
            if not stat.S_ISREG(info.st_mode):
                raise StoragePermissionDenied(_details(ref, "delete", reason="not_file"))
            os.unlink(name, dir_fd=parent)
        except FileNotFoundError:
            return
        except OSError as exc:
            raise _map_os_error(exc, ref, "delete") from None
        finally:
            os.close(parent)
