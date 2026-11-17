"""The one factory for contract-job transport (WAVE2_INTERFACES sections 3 to 5).

`work_queue()`, `completion_queue()` and `object_storage()` build the ports
(`lai_processing.ports.MessageQueue` and `ObjectStorage`) from `LAI_PROCESSING_BACKEND`:

- `sqs`: `lai_processing_runtime.SqsMessageQueue` on the work and completion queue URLs and
  `S3ObjectStorage` with the logical stores mapped to buckets (`assets` -> `LAI_ASSET_BUCKET`,
  `quarantine` and `artifacts` -> `LAI_PROCESSING_BUCKET`). Django only reads storage.
- `local`: `LocalDirectoryQueue` under `LAI_PROCESSING_LOCAL_ROOT/queues/{work,completions}` and
  `FilesystemObjectStorage` with `assets` at `LAI_ASSET_LOCAL_ROOT` and the processing stores at
  `LAI_PROCESSING_LOCAL_ROOT` (a local worker process runs the jobs).
- `inline`: in-memory queues held per process (`lai_processing.testing.MemoryQueue`) and a
  store whose `assets` reads go through Django's own asset storage, so an uploaded version can be
  processed in-process; `quarantine` and `artifacts` live in memory.
- `disabled`: `ProcessingTransportDisabled`.

The runtime adapters and boto3 are imported lazily, so Django (and every test) runs without
them. `set_transport_for_tests` installs fakes; `reset_transport` drops everything cached.
"""

from __future__ import annotations

import io
import threading
import time
from pathlib import Path
from typing import IO, Any

from django.conf import settings

from lai_processing.contracts.codec import DEFAULT_MAX_MESSAGE_BYTES
from lai_processing.contracts.common import ObjectRef
from lai_processing.contracts.identifiers import StoreName
from lai_processing.core.errors import ErrorCode, ProcessingError
from lai_processing.ports.storage import (
    ObjectInfo,
    ObjectMissing,
    StoragePermissionDenied,
    StorageUnavailable,
)
from lai_processing.testing import MemoryObjectStorage, MemoryQueue

WORK = "work"
COMPLETIONS = "completions"
STORAGE = "storage"

_lock = threading.Lock()
_cache: dict[tuple[str, str], Any] = {}
_overrides: dict[str, Any] = {}


class ProcessingTransportDisabled(Exception):
    code = "processing_disabled"


def set_transport_for_tests(*, work=None, completions=None, storage=None) -> None:
    """Test seam: install fake ports. A port left as None is built from settings as usual."""
    with _lock:
        _overrides.clear()
        _cache.clear()
        for name, value in ((WORK, work), (COMPLETIONS, completions), (STORAGE, storage)):
            if value is not None:
                _overrides[name] = value


def reset_transport() -> None:
    with _lock:
        _overrides.clear()
        _cache.clear()


def work_queue():
    return _get(WORK)


def completion_queue():
    return _get(COMPLETIONS)


def object_storage():
    return _get(STORAGE)


def _get(name: str):
    if name in _overrides:
        return _overrides[name]
    mode = settings.LAI_PROCESSING_BACKEND
    if mode == "disabled":
        raise ProcessingTransportDisabled
    builder = _BUILDERS.get(mode)
    if builder is None:
        raise ProcessingTransportDisabled
    with _lock:
        key = (mode, name)
        if key not in _cache:
            _cache[key] = builder(name)
        return _cache[key]


# --- sqs ---------------------------------------------------------------------------------------


def _aws_client(service: str, region: str | None):
    """A boto3 client with bounded timeouts (a seam: tests replace it)."""
    import boto3
    from botocore.config import Config

    return boto3.client(
        service,
        region_name=region,
        config=Config(
            connect_timeout=5,
            read_timeout=30,  # long polls wait up to 20 s
            retries={"max_attempts": 3, "mode": "standard"},
        ),
    )


def _build_sqs(name: str):
    from lai_processing_runtime import S3ObjectStorage, SqsMessageQueue

    from .services import queue_region

    region = queue_region(settings.LAI_PROCESSING_WORK_QUEUE_URL)
    if name == STORAGE:
        buckets = {
            StoreName.ASSETS: settings.LAI_ASSET_BUCKET,
            StoreName.QUARANTINE: settings.LAI_PROCESSING_BUCKET,
            StoreName.ARTIFACTS: settings.LAI_PROCESSING_BUCKET,
        }
        return S3ObjectStorage(_aws_client("s3", region), buckets, writable=frozenset())
    url = (
        settings.LAI_PROCESSING_WORK_QUEUE_URL
        if name == WORK
        else settings.LAI_PROCESSING_COMPLETION_QUEUE_URL
    )
    return SqsMessageQueue(
        _aws_client("sqs", queue_region(url)), url, max_message_bytes=DEFAULT_MAX_MESSAGE_BYTES
    )


# --- local -------------------------------------------------------------------------------------


def _build_local(name: str):
    from lai_processing_runtime import FilesystemObjectStorage, LocalDirectoryQueue

    root = Path(settings.LAI_PROCESSING_LOCAL_ROOT)
    if name == STORAGE:
        roots = {
            StoreName.ASSETS: Path(settings.LAI_ASSET_LOCAL_ROOT),
            StoreName.QUARANTINE: root,
            StoreName.ARTIFACTS: root,
        }
        return FilesystemObjectStorage(roots, writable=frozenset())
    return LocalDirectoryQueue(root / "queues" / ("work" if name == WORK else "completions"))


# --- inline ------------------------------------------------------------------------------------


class DjangoAssetObjectStorage:
    """`ObjectStorage` for the inline backend: `assets` reads go through Django's configured
    asset storage (read-only, never written or deleted); every other store is in memory."""

    def __init__(self, memory: MemoryObjectStorage | None = None) -> None:
        self.memory = memory or MemoryObjectStorage()

    @staticmethod
    def _open_asset(ref: ObjectRef) -> IO[bytes]:
        from apps.assets import storage as asset_storage

        if ref.version_id is not None:  # the asset library keeps one object per key
            raise ObjectMissing({"store": ref.store.value, "reason": "version"})
        try:
            return asset_storage.get_storage().open(ref.key)
        except asset_storage.ObjectMissing:
            raise ObjectMissing({"store": ref.store.value}) from None
        except asset_storage.StorageError:
            raise StorageUnavailable({"store": ref.store.value}) from None

    def head(self, ref: ObjectRef) -> ObjectInfo:
        if ref.store is not StoreName.ASSETS:
            return self.memory.head(ref)
        with self._open_asset(ref) as stream:
            size = stream.seek(0, io.SEEK_END)
        return ObjectInfo(ref=ref, size_bytes=size, content_type=None, version_id=None, sha256=None)

    def open(self, ref: ObjectRef) -> IO[bytes]:
        if ref.store is not StoreName.ASSETS:
            return self.memory.open(ref)
        return self._open_asset(ref)

    def read(self, ref: ObjectRef, *, max_bytes: int) -> bytes:
        if ref.store is not StoreName.ASSETS:
            return self.memory.read(ref, max_bytes=max_bytes)
        with self._open_asset(ref) as stream:
            data = stream.read(max_bytes + 1)
        if len(data) > max_bytes:
            raise ProcessingError(ErrorCode.RESOURCE_LIMIT_EXCEEDED, {"limit": "read_bytes"})
        return data

    def put(self, ref: ObjectRef, data: IO[bytes], **kwargs) -> ObjectInfo:
        if ref.store is StoreName.ASSETS:
            raise StoragePermissionDenied({"store": ref.store.value})
        return self.memory.put(ref, data, **kwargs)

    def delete(self, ref: ObjectRef) -> None:
        if ref.store is StoreName.ASSETS:
            raise StoragePermissionDenied({"store": ref.store.value})
        self.memory.delete(ref)


def _build_inline(name: str):
    if name == STORAGE:
        return DjangoAssetObjectStorage()
    return MemoryQueue(max_message_bytes=DEFAULT_MAX_MESSAGE_BYTES, clock=time.monotonic)


_BUILDERS = {"sqs": _build_sqs, "local": _build_local, "inline": _build_inline}
