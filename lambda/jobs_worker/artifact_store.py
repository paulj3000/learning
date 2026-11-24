"""The worker's create-only artifact store (ADR-066, docs/processing/DERIVED_ARTIFACTS.md 4).

`S3ObjectStore` implements `lai_processing.ports.storage.ObjectStorage` over the one asset bucket
for a native worker (audio, image, optimize):

- reads (`head`, `open`, `read`) work for the `assets` store (the job's input) and the
  `artifacts` store (to verify its own write);
- `put` writes only the `artifacts` store, only inside this deployment's namespace, only inside the
  attempt's own prefix when one is bound, and never under `capture/` (staff captures are Django's).
  It sends `IfNoneMatch="*"` and a SHA-256 checksum. On 412 `PreconditionFailed` (or 409
  `ConditionalRequestConflict`) it reads the existing object and **computes** its SHA-256, never
  trusting the ETag: identical bytes are an idempotent success (a redelivered attempt), different
  bytes raise `ObjectExists`;
- `delete` always raises `StoragePermissionDenied`: workers cannot delete (orphans are removed by
  Django's retention command).

A 403 is `StoragePermissionDenied`, never "missing" and never success: without ListBucket S3
answers 403 for an absent key, and a policy problem needs a fix and a deploy, not a retry.
Errors are classified to the engine's storage errors by code only; AWS messages are never kept.

Standard library plus `lai_processing`; the client is injected (boto3 in Lambda, a fake in tests).
"""

import base64
import hashlib
from typing import IO

from lai_processing.contracts.common import ObjectRef
from lai_processing.contracts.identifiers import (
    ARTIFACT_KEY_PREFIX,
    NAMESPACE,
    StoreName,
    check_object_key,
    check_pattern,
)
from lai_processing.core.errors import ErrorCode, ProcessingError
from lai_processing.ports.storage import (
    ObjectExists,
    ObjectInfo,
    ObjectMissing,
    StoragePermissionDenied,
    StorageUnavailable,
)

CHUNK = 1024 * 1024
CAPTURE_SEGMENT = "capture"

_MISSING = frozenset({"NoSuchKey", "404", "NotFound", "NoSuchVersion"})
_DENIED = frozenset(
    {
        "AccessDenied",
        "403",
        "Forbidden",
        "AllAccessDisabled",
        "AccountProblem",
        "InvalidAccessKeyId",
        "SignatureDoesNotMatch",
    }
)
_CONDITION_FAILED = frozenset({"PreconditionFailed", "412", "ConditionalRequestConflict", "409"})
_BAD_CHECKSUM = frozenset({"BadDigest", "InvalidDigest", "XAmzContentSHA256Mismatch"})


def _code(error: BaseException) -> str:
    response = getattr(error, "response", None)
    if isinstance(response, dict):
        return str(response.get("Error", {}).get("Code", ""))
    return ""


def _status(error: BaseException) -> int | None:
    response = getattr(error, "response", None)
    if isinstance(response, dict):
        status = response.get("ResponseMetadata", {}).get("HTTPStatusCode")
        return status if isinstance(status, int) else None
    return None


def _classify(error: BaseException, store: str):
    """The engine's storage error for one S3 failure (by code only; the message is dropped)."""
    code, status = _code(error), _status(error)
    details = {"store": store}
    if code in _MISSING or status == 404:
        return ObjectMissing(details)
    if code in _DENIED or status == 403:
        return StoragePermissionDenied(details)
    if code in _BAD_CHECKSUM:
        return ProcessingError(ErrorCode.CHECKSUM_MISMATCH, {"field": "artifact"})
    if code in {"SlowDown", "Throttling", "ThrottlingException", "RequestLimitExceeded"} or (
        status in (429, 503)
    ):
        return ProcessingError(ErrorCode.THROTTLED, details)
    return StorageUnavailable(details)


def _decode_checksum(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    try:
        raw = base64.b64decode(value, validate=True)
    except ValueError:
        return None
    return raw.hex() if len(raw) == 32 else None


class S3ObjectStore:
    """Create-only artifact writes and read-only asset reads over one bucket."""

    def __init__(self, client, bucket: str, namespace: str, *, attempt_prefix: str | None = None):
        if not bucket:
            raise ValueError("an asset bucket is required")
        check_pattern(namespace, NAMESPACE, "namespace", max_length=32)
        base = f"{ARTIFACT_KEY_PREFIX}{namespace}/"
        if attempt_prefix is not None and (
            not attempt_prefix.startswith(base)
            or not attempt_prefix.endswith("/")
            or attempt_prefix.startswith(f"{base}{CAPTURE_SEGMENT}/")
            or attempt_prefix == base
        ):
            raise ValueError("the attempt prefix must be one attempt directory of this namespace")
        self._client, self._bucket, self._namespace = client, bucket, namespace
        self._base = base
        self._prefix = attempt_prefix or base

    # --- guards ---

    def _readable(self, ref: ObjectRef) -> str:
        if ref.store not in (StoreName.ASSETS, StoreName.ARTIFACTS):
            raise StoragePermissionDenied({"store": ref.store.value})
        if ref.store is StoreName.ARTIFACTS and ref.namespace != self._namespace:
            raise StoragePermissionDenied({"store": ref.store.value})
        return check_object_key(ref.key, ref.store, self._namespace, "ref.key")

    def _writable(self, ref: ObjectRef) -> str:
        """The key of `ref` when this store may create it; anything else is refused before any
        request is made (another store, another namespace, another attempt, a capture key)."""
        if ref.store is not StoreName.ARTIFACTS or ref.namespace != self._namespace:
            raise StoragePermissionDenied({"store": ref.store.value})
        key = check_object_key(ref.key, StoreName.ARTIFACTS, self._namespace, "ref.key")
        if not key.startswith(self._prefix) or key.startswith(f"{self._base}{CAPTURE_SEGMENT}/"):
            raise StoragePermissionDenied({"store": ref.store.value})
        return key

    # --- reads ---

    def head(self, ref: ObjectRef) -> ObjectInfo:
        key = self._readable(ref)
        params = {"Bucket": self._bucket, "Key": key, "ChecksumMode": "ENABLED"}
        if ref.version_id is not None:
            params["VersionId"] = ref.version_id
        try:
            response = self._client.head_object(**params)
        except Exception as error:  # noqa: BLE001 - classified by code, never kept
            raise _classify(error, ref.store.value) from None
        return self._info(ref, response)

    @staticmethod
    def _info(ref: ObjectRef, response: dict) -> ObjectInfo:
        version = response.get("VersionId") or ref.version_id
        return ObjectInfo(
            ref=ObjectRef(ref.store, ref.key, version, ref.namespace),
            size_bytes=int(response.get("ContentLength", 0)),
            content_type=response.get("ContentType"),
            version_id=version,
            sha256=_decode_checksum(response.get("ChecksumSHA256")),
        )

    def open(self, ref: ObjectRef) -> IO[bytes]:
        key = self._readable(ref)
        params = {"Bucket": self._bucket, "Key": key}
        if ref.version_id is not None:
            params["VersionId"] = ref.version_id
        try:
            return self._client.get_object(**params)["Body"]
        except Exception as error:  # noqa: BLE001
            raise _classify(error, ref.store.value) from None

    def read(self, ref: ObjectRef, *, max_bytes: int) -> bytes:
        info = self.head(ref)
        if info.size_bytes > max_bytes:
            raise ProcessingError(ErrorCode.RESOURCE_LIMIT_EXCEEDED, {"limit": "read"})
        stream = self.open(ObjectRef(ref.store, ref.key, info.version_id, ref.namespace))
        try:
            return stream.read(max_bytes + 1)
        finally:
            close = getattr(stream, "close", None)
            if callable(close):
                close()

    # --- the one write ---

    def put(
        self, ref: ObjectRef, data: IO[bytes], *, content_type: str, sha256: str, size_bytes: int
    ) -> ObjectInfo:
        key = self._writable(ref)
        body = data.read()
        if len(body) != size_bytes or hashlib.sha256(body).hexdigest() != sha256:
            raise ProcessingError(ErrorCode.CHECKSUM_MISMATCH, {"field": "artifact"})
        try:
            response = self._client.put_object(
                Bucket=self._bucket,
                Key=key,
                Body=body,
                ContentType=content_type,
                ChecksumSHA256=base64.b64encode(bytes.fromhex(sha256)).decode(),
                IfNoneMatch="*",
                CacheControl="private, max-age=31536000, immutable",
            )
        except Exception as error:  # noqa: BLE001
            if _code(error) in _CONDITION_FAILED or _status(error) in (409, 412):
                return self._existing_matches(ref, key, sha256, size_bytes)
            raise _classify(error, ref.store.value) from None
        return ObjectInfo(
            ref=ObjectRef(ref.store, ref.key, response.get("VersionId"), ref.namespace),
            size_bytes=size_bytes,
            content_type=content_type,
            version_id=response.get("VersionId"),
            sha256=sha256,
        )

    def _existing_matches(self, ref: ObjectRef, key: str, sha256: str, size: int) -> ObjectInfo:
        """After a 412: success only if the object already there has exactly these bytes. The
        digest is computed from the bytes read; the ETag and any recorded checksum are metadata."""
        try:
            head = self._client.head_object(Bucket=self._bucket, Key=key)
            version = head.get("VersionId")
            params = {"Bucket": self._bucket, "Key": key}
            if version:
                params["VersionId"] = version
            stream = self._client.get_object(**params)["Body"]
        except Exception as error:  # noqa: BLE001
            failure = _classify(error, ref.store.value)
            if isinstance(failure, ObjectMissing):
                # It vanished between the 412 and the read: ask SQS to deliver the work again.
                raise StorageUnavailable({"store": ref.store.value}) from None
            raise failure from None
        digest, count = hashlib.sha256(), 0
        try:
            while chunk := stream.read(CHUNK):
                count += len(chunk)
                if count > size:
                    break
                digest.update(chunk)
        except Exception as error:  # noqa: BLE001
            raise _classify(error, ref.store.value) from None
        finally:
            close = getattr(stream, "close", None)
            if callable(close):
                close()
        if count != size or digest.hexdigest() != sha256:
            raise ObjectExists({"store": ref.store.value})
        return ObjectInfo(
            ref=ObjectRef(ref.store, ref.key, version, ref.namespace),
            size_bytes=size,
            content_type=head.get("ContentType"),
            version_id=version,
            sha256=sha256,
        )

    def delete(self, ref: ObjectRef) -> None:
        """Workers never delete. Orphans are removed by Django's retention command."""
        raise StoragePermissionDenied({"store": ref.store.value})


__all__ = ["S3ObjectStore"]
