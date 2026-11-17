"""Contract kinds on the canonical jobs path (ADR-064, docs/processing/CANONICAL_PATH.md).

`asset.validate_model` and `reference.checksum` are ordinary `apps.jobs` kinds on the media
queue. Their schema-1 work `payload` is an ADR-061 `ProcessingJobRequest` (as a dict) and a
successful schema-1 `result` is the `ProcessingJobResult` (as a dict). The work itself runs in
the standard-library `lai_processing` execution engine, vendored into the jobs worker zip by
`lambda/build.py` and imported by Django from `processing/` beside `lai/`.

`run(kind, payload, ports)` decodes the request, executes it against the task ports (the same
`asset_object_size` and `read_asset` ports `asset.inspect` uses, read only) and returns the result
dict. A retryable failure raises `TaskError(code, retryable=True)` so SQS redelivers the work (the
same attempt: same job id, attempt id and artifact keys); a permanent, cancelled or manual failure
raises a non-retryable `TaskError` with the contract's error code, which becomes a schema-1
`failed` result. A model that fails validation is a successful job with verdict `fail`.

Vendored into the worker zip: no Django or `apps.*` imports (lambda/build.py refuses them).
"""

import io

from . import envelope

#: The contract kinds and the media-queue kinds they are (envelope.KIND_QUEUE).
CONTRACT_KINDS = frozenset({envelope.ASSET_VALIDATE_MODEL, envelope.REFERENCE_CHECKSUM})
#: Reads for one window of an asset object (the engine copies the input into its workspace).
READ_CHUNK = 1024 * 1024


class _PortStream(io.RawIOBase):
    """A forward-only binary stream over `read_asset(key, start, length)`."""

    def __init__(self, ports, key: str, size: int):
        self._ports, self._key, self._size, self._position = ports, key, size, 0

    def readable(self) -> bool:
        return True

    def readinto(self, buffer) -> int:
        if self._position >= self._size:
            return 0
        from lai_processing.ports.storage import StorageUnavailable

        from .tasks import TaskError

        length = min(len(buffer), READ_CHUNK, self._size - self._position)
        try:
            data = self._ports.read_asset(self._key, self._position, length)
        except TaskError:
            # A transient read fault is a storage failure (retryable), not an unexpected one.
            raise StorageUnavailable({"store": "assets"}) from None
        if not data:
            return 0
        buffer[: len(data)] = data
        self._position += len(data)
        return len(data)


class PortStorage:
    """`lai_processing.ports.storage.ObjectStorage` over the task ports, for the `assets` store
    only, read only. The worker never writes artifacts on this path: a processor that asks to
    (for example `write_report: true`) gets a permission error, classified by the engine."""

    def __init__(self, ports):
        self._ports = ports

    def _key(self, ref) -> str:
        from lai_processing.contracts.identifiers import StoreName
        from lai_processing.ports.storage import StoragePermissionDenied

        if ref.store is not StoreName.ASSETS:
            raise StoragePermissionDenied({"store": ref.store.value})
        return ref.key

    def head(self, ref):
        from lai_processing.ports.storage import ObjectInfo, ObjectMissing

        size = self._size(self._key(ref))
        if size is None:
            raise ObjectMissing({"store": ref.store.value})
        return ObjectInfo(ref=ref, size_bytes=size, content_type=None, version_id=None, sha256=None)

    def open(self, ref):
        from lai_processing.ports.storage import ObjectMissing

        key = self._key(ref)
        size = self._size(key)
        if size is None:
            raise ObjectMissing({"store": ref.store.value})
        return io.BufferedReader(_PortStream(self._ports, key, size), buffer_size=READ_CHUNK)

    def read(self, ref, *, max_bytes: int) -> bytes:
        from lai_processing.core.errors import ErrorCode, ProcessingError

        info = self.head(ref)
        if info.size_bytes > max_bytes:
            raise ProcessingError(ErrorCode.RESOURCE_LIMIT_EXCEEDED, {"limit": "read"})
        with self.open(ref) as stream:
            return stream.read()

    def put(self, ref, data, *, content_type: str, sha256: str, size_bytes: int):
        from lai_processing.ports.storage import StoragePermissionDenied

        raise StoragePermissionDenied({"store": ref.store.value})

    def delete(self, ref) -> None:
        from lai_processing.ports.storage import StoragePermissionDenied

        raise StoragePermissionDenied({"store": ref.store.value})

    def _size(self, key: str) -> int | None:
        from lai_processing.ports.storage import StorageUnavailable

        from .tasks import TaskError

        try:
            return self._ports.asset_object_size(key)
        except TaskError:
            raise StorageUnavailable({"store": "assets"}) from None


def run(kind: str, payload: dict, ports) -> dict:
    """Execute one contract job. See the module docstring for the outcomes."""
    from lai_processing.contracts.jobs import ProcessingJobRequest
    from lai_processing.contracts.results import ResultStatus
    from lai_processing.core.errors import ProcessingError, RetryClass
    from lai_processing.core.execution import ExecutionEngine
    from lai_processing.core.registry import default_registry

    from .tasks import TaskError

    try:
        request = ProcessingJobRequest.from_dict(payload)
    except (ProcessingError, KeyError, TypeError, ValueError):
        raise TaskError("invalid_payload") from None
    if request.job_type != kind:
        raise TaskError("invalid_payload")
    engine = ExecutionEngine(
        registry=default_registry(), storage=PortStorage(ports), namespace=request.namespace
    )
    result = engine.execute(request)
    if result.status is ResultStatus.SUCCEEDED:
        return result.to_dict()
    error = result.primary_error
    code = error.code.value if error is not None else "processing_failed"
    retryable = result.retry_class is RetryClass.RETRYABLE
    raise TaskError(code, retryable=retryable)
