"""`ObjectStorage` on Amazon S3 (docs/processing/WAVE2_INTERFACES.md, section 3).

- Buckets come from configuration only (`RuntimeConfig.buckets()`); a message names a logical
  store and a key, never a bucket.
- Integrity: objects are written with `ChecksumAlgorithm='SHA256'` and an explicit
  `ChecksumSHA256`, and described with `ChecksumMode='ENABLED'`. The recorded checksum is base64
  decoded to hex; a composite multipart checksum (`...-N`, or `ChecksumType == 'COMPOSITE'`) or a
  missing one is reported as `sha256=None` ("unknown"), and the engine's streamed hash decides.
  **An ETag is never treated as a SHA-256.**
- Version-aware: `head` and `open` pass `VersionId` when the reference pins one, and a response
  for a different version is refused, so a newer version is never silently substituted.
- `put` is create-only (`IfNoneMatch='*'`). A `412 PreconditionFailed` means the key exists: the
  existing object's recorded SHA-256 is compared, so an identical rewrite (a redelivered
  attempt) is an idempotent success and anything else, including an object whose checksum is
  unknown, is `ObjectExists`. The body is spooled and verified locally before the upload, so a
  short or altered stream is refused before any request is made.
- Errors are classified from botocore codes into `ObjectMissing`, `StoragePermissionDenied` and
  `StorageUnavailable` (`classify_error`); AWS error messages are never kept or logged, only the
  error code as a short detail.

boto3 and botocore are imported lazily; the client is injected (tests use `botocore.stub`).
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import io
import tempfile
from collections.abc import Mapping
from typing import IO, Any, Final

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

__all__ = [
    "MISSING_CODES",
    "PERMISSION_CODES",
    "TRANSIENT_CODES",
    "S3ObjectStorage",
    "checksum_to_hex",
    "classify_error",
    "hex_to_checksum",
]

MISSING_CODES: Final = frozenset({"NoSuchKey", "404", "NotFound", "NoSuchVersion"})
PERMISSION_CODES: Final = frozenset(
    {
        "AccessDenied",
        "403",
        "Forbidden",
        "AllAccessDisabled",
        "InvalidAccessKeyId",
        "SignatureDoesNotMatch",
        "ExpiredToken",
        "InvalidToken",
        "AccountProblem",
        # A misconfigured bucket name is an operator problem, not a missing input.
        "NoSuchBucket",
    }
)
TRANSIENT_CODES: Final = frozenset(
    {
        "SlowDown",
        "Throttling",
        "ThrottlingException",
        "RequestThrottled",
        "RequestLimitExceeded",
        "TooManyRequestsException",
        "RequestTimeout",
        "RequestTimeoutException",
        "InternalError",
        "ServiceUnavailable",
        "503",
        "500",
        "502",
        "504",
        "OperationAborted",
        "ConditionalRequestConflict",
    }
)
PRECONDITION_CODES: Final = frozenset({"PreconditionFailed", "412"})
SPOOL_MEMORY_BYTES: Final = 8 * 1024 * 1024
MAX_CODE_LENGTH: Final = 64


def checksum_to_hex(value: object) -> str | None:
    """Hex SHA-256 from an S3 `ChecksumSHA256` header, or None when it is not a full-object
    SHA-256 (absent, composite `...-N`, malformed or the wrong length)."""
    if not isinstance(value, str) or not value or "-" in value:
        return None
    try:
        raw = base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError):
        return None
    if len(raw) != 32:
        return None
    return raw.hex()


def hex_to_checksum(sha256: str) -> str:
    return base64.b64encode(bytes.fromhex(sha256)).decode("ascii")


def _error_code(exc: BaseException) -> tuple[str, int]:
    response = getattr(exc, "response", None)
    if not isinstance(response, Mapping):
        return "", 0
    error = response.get("Error") or {}
    code = str(error.get("Code", "") or "")[:MAX_CODE_LENGTH]
    meta = response.get("ResponseMetadata") or {}
    try:
        status = int(meta.get("HTTPStatusCode", 0) or 0)
    except (TypeError, ValueError):
        status = 0
    return code, status


def classify_error(exc: BaseException, store: StoreName, operation: str) -> StorageError:
    """The port error for a botocore failure. Only the AWS error code is kept."""
    from botocore.exceptions import (
        BotoCoreError,
        ClientError,
        NoCredentialsError,
        PartialCredentialsError,
        ReadTimeoutError,
        ResponseStreamingError,
    )
    from botocore.exceptions import (
        ConnectionError as BotoConnectionError,
    )

    details: dict[str, object] = {"store": store.value, "operation": operation}
    if isinstance(exc, ClientError):
        code, status = _error_code(exc)
        details["aws_code"] = code or str(status)
        if code in MISSING_CODES or (not code and status == 404):
            return ObjectMissing(details)
        if code in PERMISSION_CODES or (not code and status == 403):
            return StoragePermissionDenied(details)
        if code in TRANSIENT_CODES or status >= 500 or status == 429:
            return StorageUnavailable(details)
        return StorageError(details)
    details["exception_type"] = type(exc).__name__
    if isinstance(exc, (NoCredentialsError, PartialCredentialsError)):
        return StoragePermissionDenied(details)
    if isinstance(exc, (BotoConnectionError, ReadTimeoutError, ResponseStreamingError)):
        return StorageUnavailable(details)
    if isinstance(exc, BotoCoreError):
        return StorageUnavailable(details)
    if isinstance(exc, (ConnectionError, TimeoutError)):
        return StorageUnavailable(details)
    return StorageError(details)


def _is_aws_error(exc: BaseException) -> bool:
    from botocore.exceptions import BotoCoreError, ClientError

    return isinstance(exc, (BotoCoreError, ClientError, ConnectionError, TimeoutError))


class _BodyStream(io.RawIOBase):
    """A read-only stream over a botocore `StreamingBody`: each read asks for at most
    `CHUNK_BYTES`, stops at `limit` bytes, and maps transport errors to `StorageUnavailable`."""

    def __init__(self, body: Any, store: StoreName, limit: int | None) -> None:
        super().__init__()
        self._body = body
        self._store = store
        self._remaining = limit

    def readable(self) -> bool:
        return True

    def readinto(self, buffer: Any) -> int:
        want = min(len(buffer), CHUNK_BYTES)
        if self._remaining is not None:
            want = min(want, self._remaining)
        if want <= 0:
            return 0
        try:
            chunk = self._body.read(want)
        except Exception as exc:  # noqa: BLE001 - classified, never echoed
            if _is_aws_error(exc):
                raise classify_error(exc, self._store, "read") from None
            raise StorageUnavailable({"store": self._store.value, "operation": "read"}) from None
        count = len(chunk)
        buffer[:count] = chunk
        if self._remaining is not None:
            self._remaining -= count
        return count

    def close(self) -> None:
        try:
            self._body.close()
        except Exception:  # noqa: BLE001, S110 - closing must not mask the real outcome
            pass
        super().close()


class S3ObjectStorage:
    """S3-backed `ObjectStorage`. `writable` names the stores `put` may write (a worker:
    ARTIFACTS only); `delete` never touches ASSETS."""

    def __init__(
        self,
        client: Any,
        buckets: Mapping[StoreName, str],
        *,
        writable: frozenset[StoreName] = frozenset({StoreName.ARTIFACTS}),
        server_side_encryption: str | None = "AES256",
    ) -> None:
        self._client = client
        self._buckets = {StoreName(store): bucket for store, bucket in buckets.items()}
        self._writable = frozenset(StoreName(s) for s in writable)
        if self._writable - set(self._buckets):
            raise ValueError("a writable store has no bucket")
        self._sse = server_side_encryption

    @property
    def writable(self) -> frozenset[StoreName]:
        return self._writable

    def _target(self, ref: ObjectRef, operation: str) -> tuple[str, str]:
        bucket = self._buckets.get(ref.store)
        if bucket is None:
            raise StoragePermissionDenied(
                {"store": ref.store.value, "operation": operation, "reason": "store"}
            )
        return bucket, check_object_key(ref.key, ref.store, ref.namespace, "ref.key")

    def _call(self, ref: ObjectRef, operation: str, method: str, **params: Any) -> Any:
        try:
            return getattr(self._client, method)(**params)
        except Exception as exc:  # noqa: BLE001 - classified, never echoed
            if _is_aws_error(exc):
                raise classify_error(exc, ref.store, operation) from None
            raise

    def _check_version(self, ref: ObjectRef, response: Mapping[str, Any], operation: str) -> None:
        if ref.version_id is not None and response.get("VersionId") != ref.version_id:
            raise ObjectMissing(
                {"store": ref.store.value, "operation": operation, "reason": "version"}
            )

    @staticmethod
    def _sha256(response: Mapping[str, Any]) -> str | None:
        if str(response.get("ChecksumType", "") or "").upper() == "COMPOSITE":
            return None
        return checksum_to_hex(response.get("ChecksumSHA256"))

    def _info(self, ref: ObjectRef, response: Mapping[str, Any]) -> ObjectInfo:
        version = response.get("VersionId") or None
        if version is not None and not isinstance(version, str):
            version = None
        content_type = response.get("ContentType")
        return ObjectInfo(
            ref=ObjectRef(ref.store, ref.key, version, ref.namespace),
            size_bytes=int(response.get("ContentLength", 0) or 0),
            content_type=content_type if isinstance(content_type, str) else None,
            version_id=version,
            sha256=self._sha256(response),
        )

    # ObjectStorage -------------------------------------------------------------------------

    def head(self, ref: ObjectRef) -> ObjectInfo:
        bucket, key = self._target(ref, "head")
        params: dict[str, Any] = {"Bucket": bucket, "Key": key, "ChecksumMode": "ENABLED"}
        if ref.version_id is not None:
            params["VersionId"] = ref.version_id
        response = self._call(ref, "head", "head_object", **params)
        self._check_version(ref, response, "head")
        return self._info(ref, response)

    def _get(self, ref: ObjectRef, operation: str) -> Mapping[str, Any]:
        bucket, key = self._target(ref, operation)
        params: dict[str, Any] = {"Bucket": bucket, "Key": key}
        if ref.version_id is not None:
            params["VersionId"] = ref.version_id
        response = self._call(ref, operation, "get_object", **params)
        try:
            self._check_version(ref, response, operation)
        except ObjectMissing:
            body = response.get("Body")
            if body is not None:
                body.close()
            raise
        return response

    def open(self, ref: ObjectRef) -> IO[bytes]:
        response = self._get(ref, "open")
        stream = _BodyStream(response["Body"], ref.store, None)
        return io.BufferedReader(stream, buffer_size=CHUNK_BYTES)  # type: ignore[return-value]

    def read(self, ref: ObjectRef, *, max_bytes: int) -> bytes:
        response = self._get(ref, "read")
        body = response["Body"]
        length = response.get("ContentLength")
        if isinstance(length, int) and length > max_bytes:
            body.close()
            raise ProcessingError(ErrorCode.RESOURCE_LIMIT_EXCEEDED, {"limit": "read_bytes"})
        with _BodyStream(body, ref.store, max_bytes + 1) as stream:
            data = stream.read()
        assert data is not None  # noqa: S101 - a blocking raw stream never returns None
        if len(data) > max_bytes:
            raise ProcessingError(ErrorCode.RESOURCE_LIMIT_EXCEEDED, {"limit": "read_bytes"})
        return data

    def put(
        self, ref: ObjectRef, data: IO[bytes], *, content_type: str, sha256: str, size_bytes: int
    ) -> ObjectInfo:
        if ref.store not in self._writable:
            raise StoragePermissionDenied(
                {"store": ref.store.value, "operation": "put", "reason": "read_only"}
            )
        bucket, key = self._target(ref, "put")
        with tempfile.SpooledTemporaryFile(max_size=SPOOL_MEMORY_BYTES) as spool:
            written = 0
            digest = hashlib.sha256()
            while True:
                chunk = data.read(CHUNK_BYTES)
                if not chunk:
                    break
                written += len(chunk)
                if written > size_bytes:
                    break
                digest.update(chunk)
                spool.write(chunk)
            if written != size_bytes or digest.hexdigest() != sha256:
                raise ProcessingError(ErrorCode.CHECKSUM_MISMATCH, {"field": "artifact"})
            spool.seek(0)
            params: dict[str, Any] = {
                "Bucket": bucket,
                "Key": key,
                "Body": spool,
                "ContentLength": size_bytes,
                "ContentType": content_type,
                "ChecksumAlgorithm": "SHA256",
                "ChecksumSHA256": hex_to_checksum(sha256),
                "IfNoneMatch": "*",
            }
            if self._sse:
                params["ServerSideEncryption"] = self._sse
            try:
                response = self._client.put_object(**params)
            except Exception as exc:  # noqa: BLE001 - classified, never echoed
                if not _is_aws_error(exc):
                    raise
                code, status = _error_code(exc)
                if code in PRECONDITION_CODES or (not code and status == 412):
                    return self._existing(ref, sha256)
                raise classify_error(exc, ref.store, "put") from None
        version = response.get("VersionId") or None
        return ObjectInfo(
            ref=ObjectRef(ref.store, ref.key, version, ref.namespace),
            size_bytes=size_bytes,
            content_type=content_type,
            version_id=version,
            sha256=sha256,
        )

    def _existing(self, ref: ObjectRef, sha256: str) -> ObjectInfo:
        info = self.head(ObjectRef(ref.store, ref.key, None, ref.namespace))
        if info.sha256 is None or info.sha256 != sha256:
            raise ObjectExists({"store": ref.store.value, "operation": "put"})
        return info

    def delete(self, ref: ObjectRef) -> None:
        if ref.store is StoreName.ASSETS or ref.store not in self._writable:
            raise StoragePermissionDenied(
                {"store": ref.store.value, "operation": "delete", "reason": "read_only"}
            )
        bucket, key = self._target(ref, "delete")
        params: dict[str, Any] = {"Bucket": bucket, "Key": key}
        if ref.version_id is not None:
            params["VersionId"] = ref.version_id
        try:
            self._call(ref, "delete", "delete_object", **params)
        except ObjectMissing:
            return
