"""Where asset binaries live (LAI-2200 AM-4; `docs/ASSET_MANAGER.md` section 6).

`get_storage()` returns the configured `AssetStorage`:

- `s3`: a private S3 bucket (`LAI_ASSET_BUCKET`, `LAI_ASSET_REGION`). Writes send a SHA-256
  checksum, so S3 rejects corrupted bytes, and `IfNoneMatch="*"`, so an existing key is never
  overwritten. Credentials come from the runtime role, never from settings or the client.
- `local`: files under `LAI_ASSET_LOCAL_ROOT` for development.
- `memory`: a dict, for tests.

Keys are made only by `object_key`, from the asset id and the version's UUID, so a key is never
reused and a published object is never replaced. Callers never pass a key from user input.
"""

import base64
import hashlib
import io
import os
import re
import tempfile
import threading
import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import IO, Protocol

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured

KEY_PREFIX = "assets/models/"
ASSET_ID = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
CHUNK = 1024 * 1024


class StorageError(Exception):
    """The store failed. The message is safe to log: it never contains bytes or credentials."""


class ObjectExists(StorageError):
    """A write targeted a key that already exists; nothing was overwritten."""


class ObjectMissing(StorageError):
    pass


@dataclass(frozen=True)
class StoredObject:
    key: str
    size: int
    last_modified: datetime


def object_key(asset_id: str, version_id: uuid.UUID, file_format: str) -> str:
    """The only way a key is made: `assets/models/<asset id>/<version uuid>/model.<format>`."""
    if not ASSET_ID.fullmatch(asset_id or ""):
        raise ValueError("An asset id must be lowercase words joined by hyphens.")
    if not isinstance(version_id, uuid.UUID):
        raise ValueError("A version id must be a UUID.")
    if file_format not in ("glb", "gltf"):
        raise ValueError("Unsupported model format.")
    return f"{KEY_PREFIX}{asset_id}/{version_id}/model.{file_format}"


def sha256_of(stream: IO[bytes]) -> tuple[str, int]:
    """Hex SHA-256 and size of a seekable stream, read in chunks; leaves it at position 0."""
    digest = hashlib.sha256()
    size = 0
    stream.seek(0)
    while chunk := stream.read(CHUNK):
        digest.update(chunk)
        size += len(chunk)
    stream.seek(0)
    return digest.hexdigest(), size


class AssetStorage(Protocol):
    def put(self, key: str, stream: IO[bytes], *, content_type: str, sha256: str) -> None: ...

    def open(self, key: str) -> IO[bytes]: ...

    def delete(self, key: str) -> None: ...

    def exists(self, key: str) -> bool: ...

    def list(self, prefix: str = KEY_PREFIX) -> Iterator[StoredObject]: ...

    def presigned_url(self, key: str, *, expires_in: int, content_type: str) -> str: ...


def _check_key(key: str) -> None:
    if not key.startswith(KEY_PREFIX) or ".." in key or key.startswith("/") or "\\" in key:
        raise StorageError("Refusing a key outside the asset prefix.")


class MemoryAssetStorage:
    """In-process store for tests. `fail_next` makes the next call of that name raise."""

    def __init__(self):
        self.objects: dict[str, tuple[bytes, str, datetime]] = {}
        self.fail_next: set[str] = set()
        self._lock = threading.Lock()

    def _maybe_fail(self, operation: str) -> None:
        if operation in self.fail_next:
            self.fail_next.discard(operation)
            raise StorageError(f"simulated {operation} failure")

    def put(self, key, stream, *, content_type, sha256):
        _check_key(key)
        self._maybe_fail("put")
        stream.seek(0)
        data = stream.read()
        stream.seek(0)
        if hashlib.sha256(data).hexdigest() != sha256:
            raise StorageError("Checksum mismatch; nothing was stored.")
        with self._lock:
            if key in self.objects:
                raise ObjectExists(key)
            self.objects[key] = (data, content_type, datetime.now(UTC))

    def open(self, key):
        self._maybe_fail("open")
        try:
            return io.BytesIO(self.objects[key][0])
        except KeyError:
            raise ObjectMissing(key) from None

    def delete(self, key):
        _check_key(key)
        self._maybe_fail("delete")
        self.objects.pop(key, None)

    def exists(self, key):
        return key in self.objects

    def list(self, prefix=KEY_PREFIX):
        for key, (data, _type, modified) in sorted(self.objects.items()):
            if key.startswith(prefix):
                yield StoredObject(key, len(data), modified)

    def presigned_url(self, key, *, expires_in, content_type):
        raise StorageError("The memory store has no presigned URLs; use django delivery.")


class LocalAssetStorage:
    """Files on local disk, for development only. Never used by production settings."""

    def __init__(self, root: Path):
        self.root = Path(root).resolve()

    def _path(self, key: str) -> Path:
        _check_key(key)
        path = (self.root / key).resolve()
        if self.root not in path.parents:
            raise StorageError("Refusing a key outside the storage root.")
        return path

    def put(self, key, stream, *, content_type, sha256):
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        digest = hashlib.sha256()
        stream.seek(0)
        fd, temp = tempfile.mkstemp(dir=path.parent)
        try:
            with os.fdopen(fd, "wb") as out:
                while chunk := stream.read(CHUNK):
                    digest.update(chunk)
                    out.write(chunk)
            stream.seek(0)
            if digest.hexdigest() != sha256:
                raise StorageError("Checksum mismatch; nothing was stored.")
            try:
                os.link(temp, path)  # atomic and fails if the key exists: never overwrites
            except FileExistsError:
                raise ObjectExists(key) from None
        finally:
            os.unlink(temp)

    def open(self, key):
        try:
            return self._path(key).open("rb")
        except FileNotFoundError:
            raise ObjectMissing(key) from None

    def delete(self, key):
        self._path(key).unlink(missing_ok=True)

    def exists(self, key):
        return self._path(key).is_file()

    def list(self, prefix=KEY_PREFIX):
        base = self.root / prefix
        if not base.exists():
            return
        for path in sorted(base.rglob("*")):
            if path.is_file():
                stat = path.stat()
                key = path.relative_to(self.root).as_posix()
                yield StoredObject(key, stat.st_size, datetime.fromtimestamp(stat.st_mtime, UTC))

    def presigned_url(self, key, *, expires_in, content_type):
        raise StorageError("Local storage has no presigned URLs; use django delivery.")


class S3AssetStorage:
    """A private S3 bucket. `client` is injectable so tests can stub every call."""

    def __init__(self, bucket: str, region: str, client=None):
        if not bucket or not region:
            raise ImproperlyConfigured("S3 storage needs LAI_ASSET_BUCKET and LAI_ASSET_REGION.")
        self.bucket = bucket
        if client is None:
            import boto3  # imported lazily: only an s3 deployment needs it loaded

            client = boto3.client("s3", region_name=region)
        self.client = client

    def _error(self, error, key: str) -> StorageError:
        code = getattr(error, "response", {}).get("Error", {}).get("Code", "")
        if code in ("PreconditionFailed", "ConditionalRequestConflict"):
            return ObjectExists(key)
        if code in ("NoSuchKey", "404", "NotFound"):
            return ObjectMissing(key)
        return StorageError(f"S3 request failed ({code or type(error).__name__})")

    def put(self, key, stream, *, content_type, sha256):
        from botocore.exceptions import BotoCoreError, ClientError

        _check_key(key)
        stream.seek(0)
        try:
            self.client.put_object(
                Bucket=self.bucket,
                Key=key,
                Body=stream,
                ContentType=content_type,
                ChecksumSHA256=base64.b64encode(bytes.fromhex(sha256)).decode(),
                IfNoneMatch="*",
                CacheControl="private, max-age=31536000, immutable",
            )
        except (ClientError, BotoCoreError) as error:
            raise self._error(error, key) from None
        finally:
            stream.seek(0)

    def open(self, key):
        from botocore.exceptions import BotoCoreError, ClientError

        try:
            body = self.client.get_object(Bucket=self.bucket, Key=key)["Body"]
        except (ClientError, BotoCoreError) as error:
            raise self._error(error, key) from None
        spool = tempfile.SpooledTemporaryFile(max_size=8 * CHUNK)
        while chunk := body.read(CHUNK):
            spool.write(chunk)
        spool.seek(0)
        return spool

    def delete(self, key):
        from botocore.exceptions import BotoCoreError, ClientError

        _check_key(key)
        try:
            self.client.delete_object(Bucket=self.bucket, Key=key)
        except (ClientError, BotoCoreError) as error:
            raise self._error(error, key) from None

    def exists(self, key):
        from botocore.exceptions import ClientError

        try:
            self.client.head_object(Bucket=self.bucket, Key=key)
        except ClientError as error:
            if isinstance(self._error(error, key), ObjectMissing):
                return False
            raise self._error(error, key) from None
        return True

    def list(self, prefix=KEY_PREFIX):
        token = None
        while True:
            params = {"Bucket": self.bucket, "Prefix": prefix}
            if token:
                params["ContinuationToken"] = token
            page = self.client.list_objects_v2(**params)
            for item in page.get("Contents", []):
                yield StoredObject(item["Key"], item["Size"], item["LastModified"])
            if not page.get("IsTruncated"):
                return
            token = page.get("NextContinuationToken")

    def presigned_url(self, key, *, expires_in, content_type):
        _check_key(key)
        return self.client.generate_presigned_url(
            "get_object",
            Params={
                "Bucket": self.bucket,
                "Key": key,
                "ResponseContentType": content_type,
                "ResponseCacheControl": f"private, max-age={expires_in}, immutable",
            },
            ExpiresIn=expires_in,
        )


_cache: dict[tuple, AssetStorage] = {}
_cache_lock = threading.Lock()


def get_storage() -> AssetStorage:
    """The configured store, built once per configuration."""
    backend = getattr(settings, "LAI_ASSET_STORAGE", "local")
    config = (
        backend,
        getattr(settings, "LAI_ASSET_BUCKET", ""),
        getattr(settings, "LAI_ASSET_REGION", ""),
        str(getattr(settings, "LAI_ASSET_LOCAL_ROOT", "")),
    )
    with _cache_lock:
        if config not in _cache:
            if backend == "s3":
                _cache[config] = S3AssetStorage(config[1], config[2])
            elif backend == "local":
                _cache[config] = LocalAssetStorage(Path(config[3]))
            elif backend == "memory":
                _cache[config] = MemoryAssetStorage()
            else:
                raise ImproperlyConfigured("LAI_ASSET_STORAGE must be s3, local or memory.")
        return _cache[config]


def reset_storage_cache() -> None:
    """Tests only: forget built stores so the next call starts empty."""
    with _cache_lock:
        _cache.clear()
