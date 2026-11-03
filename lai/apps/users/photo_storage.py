"""Where child profile photos live (LAI-0904, ADR-042; docs/platform/CHILD_PHOTO_STORAGE.md).

A separate store from the asset library (`apps/assets/storage.py`) on purpose: game assets are
published content, a child's photo is personal data. They never share a bucket, a key prefix, a
policy, a publication workflow or a CDN.

`get_photo_storage()` returns the configured `PhotoStorage`:

- `s3`: the private bucket `LaiChildPhotos-<env>` (`LAI_CHILD_PHOTOS_BUCKET`, `..._REGION`).
  Writes send a SHA-256 checksum, so S3 rejects corrupted bytes, and `IfNoneMatch="*"`, so a key
  is never overwritten. Credentials come from the runtime role, never from settings or a client.
- `local`: files under `LAI_CHILD_PHOTO_LOCAL_ROOT`, for development only.
- `memory`: a dict, for tests.
- `disabled`: every call raises `PhotoStorageUnavailable`.

Keys are made only by `photo_key`, from two UUIDs: `children/<child uuid>/<photo uuid>`. No name,
e-mail, Cognito id or file name is ever part of a key, and callers never pass a key from input.
Error messages never contain a key either, because a key carries the child's id.
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
from typing import Protocol

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured

KEY_PREFIX = "children/"
_UUID = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
KEY_PATTERN = re.compile(rf"^children/({_UUID})/({_UUID})$")
CONTENT_TYPE = "image/jpeg"


class PhotoStorageError(Exception):
    """The store failed. The message is safe to log: no key, bytes or credentials."""


class PhotoStorageUnavailable(PhotoStorageError):
    """Photo storage is turned off in this environment."""


class PhotoObjectExists(PhotoStorageError):
    pass


class PhotoObjectMissing(PhotoStorageError):
    pass


@dataclass(frozen=True)
class StoredPhoto:
    key: str
    size: int
    last_modified: datetime


def photo_key(child_id: uuid.UUID, photo_id: uuid.UUID) -> str:
    """The only way a key is made: `children/<child uuid>/<photo uuid>`."""
    if not isinstance(child_id, uuid.UUID) or not isinstance(photo_id, uuid.UUID):
        raise ValueError("Photo keys are made from UUIDs only.")
    return f"{KEY_PREFIX}{child_id}/{photo_id}"


def parse_key(key: str) -> tuple[uuid.UUID, uuid.UUID] | None:
    """(child id, photo id) for a well-formed key, else None."""
    match = KEY_PATTERN.fullmatch(key or "")
    return (uuid.UUID(match[1]), uuid.UUID(match[2])) if match else None


def _check_key(key: str) -> None:
    if parse_key(key) is None:
        raise PhotoStorageError("Refusing a key that is not a child photo key.")


class PhotoStorage(Protocol):
    def put(self, key: str, data: bytes, *, sha256: str) -> None: ...

    def read(self, key: str) -> bytes: ...

    def delete(self, key: str) -> None: ...

    def list(self) -> Iterator[StoredPhoto]: ...

    def presigned_url(self, key: str, *, expires_in: int) -> str | None:
        """A short-lived GET URL, or None when this store has none (Django streams instead)."""
        ...


class DisabledPhotoStorage:
    def _off(self, *args, **kwargs):
        raise PhotoStorageUnavailable("Child photo storage is disabled.")

    put = read = delete = presigned_url = _off

    def list(self):
        return iter(())


class MemoryPhotoStorage:
    """In-process store for tests. `fail_next` makes the next call of that name raise."""

    def __init__(self):
        self.objects: dict[str, tuple[bytes, datetime]] = {}
        self.fail_next: set[str] = set()
        self._lock = threading.Lock()

    def _maybe_fail(self, operation: str) -> None:
        if operation in self.fail_next:
            self.fail_next.discard(operation)
            raise PhotoStorageError(f"simulated {operation} failure")

    def put(self, key, data, *, sha256):
        _check_key(key)
        self._maybe_fail("put")
        if hashlib.sha256(data).hexdigest() != sha256:
            raise PhotoStorageError("Checksum mismatch; nothing was stored.")
        with self._lock:
            if key in self.objects:
                raise PhotoObjectExists("A photo object already exists.")
            self.objects[key] = (bytes(data), datetime.now(UTC))

    def read(self, key):
        _check_key(key)
        self._maybe_fail("read")
        try:
            return self.objects[key][0]
        except KeyError:
            raise PhotoObjectMissing("The photo object is missing.") from None

    def delete(self, key):
        _check_key(key)
        self._maybe_fail("delete")
        self.objects.pop(key, None)

    def list(self):
        for key, (data, modified) in sorted(self.objects.items()):
            yield StoredPhoto(key, len(data), modified)

    def presigned_url(self, key, *, expires_in):
        _check_key(key)
        return None


class LocalPhotoStorage:
    """Files on local disk, for development only. production.py never allows it."""

    def __init__(self, root: Path):
        self.root = Path(root).resolve()

    def _path(self, key: str) -> Path:
        _check_key(key)
        return self.root / key  # the key pattern admits no separators beyond its own

    def put(self, key, data, *, sha256):
        if hashlib.sha256(data).hexdigest() != sha256:
            raise PhotoStorageError("Checksum mismatch; nothing was stored.")
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        fd, temp = tempfile.mkstemp(dir=path.parent)
        try:
            with os.fdopen(fd, "wb") as out:
                out.write(data)
            try:
                os.link(temp, path)  # atomic, and fails if the key exists: never overwrites
            except FileExistsError:
                raise PhotoObjectExists("A photo object already exists.") from None
        finally:
            os.unlink(temp)

    def read(self, key):
        try:
            return self._path(key).read_bytes()
        except FileNotFoundError:
            raise PhotoObjectMissing("The photo object is missing.") from None

    def delete(self, key):
        self._path(key).unlink(missing_ok=True)

    def list(self):
        base = self.root / KEY_PREFIX
        if not base.exists():
            return
        for path in sorted(base.rglob("*")):
            key = path.relative_to(self.root).as_posix()
            if path.is_file() and parse_key(key):
                stat = path.stat()
                yield StoredPhoto(key, stat.st_size, datetime.fromtimestamp(stat.st_mtime, UTC))

    def presigned_url(self, key, *, expires_in):
        _check_key(key)
        return None


class S3PhotoStorage:
    """The private photo bucket. `client` is injectable so tests can stub every call."""

    def __init__(self, bucket: str, region: str, client=None):
        if not bucket or not region:
            raise ImproperlyConfigured(
                "S3 photo storage needs LAI_CHILD_PHOTOS_BUCKET and LAI_CHILD_PHOTOS_REGION."
            )
        self.bucket = bucket
        if client is None:
            import boto3  # imported lazily: only an s3 deployment needs it loaded

            client = boto3.client("s3", region_name=region)
        self.client = client

    @staticmethod
    def _error(error) -> PhotoStorageError:
        code = getattr(error, "response", {}).get("Error", {}).get("Code", "")
        if code in ("PreconditionFailed", "ConditionalRequestConflict"):
            return PhotoObjectExists("A photo object already exists.")
        if code in ("NoSuchKey", "404", "NotFound"):
            return PhotoObjectMissing("The photo object is missing.")
        return PhotoStorageError(f"S3 request failed ({code or type(error).__name__})")

    def put(self, key, data, *, sha256):
        from botocore.exceptions import BotoCoreError, ClientError

        _check_key(key)
        try:
            self.client.put_object(
                Bucket=self.bucket,
                Key=key,
                Body=io.BytesIO(data),
                ContentType=CONTENT_TYPE,
                ChecksumSHA256=base64.b64encode(bytes.fromhex(sha256)).decode(),
                IfNoneMatch="*",
                CacheControl="private, no-store",
            )
        except (ClientError, BotoCoreError) as error:
            raise self._error(error) from None

    def read(self, key):
        from botocore.exceptions import BotoCoreError, ClientError

        _check_key(key)
        try:
            return self.client.get_object(Bucket=self.bucket, Key=key)["Body"].read()
        except (ClientError, BotoCoreError) as error:
            raise self._error(error) from None

    def delete(self, key):
        from botocore.exceptions import BotoCoreError, ClientError

        _check_key(key)
        try:
            self.client.delete_object(Bucket=self.bucket, Key=key)
        except (ClientError, BotoCoreError) as error:
            raise self._error(error) from None

    def list(self):
        from botocore.exceptions import BotoCoreError, ClientError

        token = None
        while True:
            params = {"Bucket": self.bucket, "Prefix": KEY_PREFIX}
            if token:
                params["ContinuationToken"] = token
            try:
                page = self.client.list_objects_v2(**params)
            except (ClientError, BotoCoreError) as error:
                raise self._error(error) from None
            for item in page.get("Contents", []):
                yield StoredPhoto(item["Key"], item["Size"], item["LastModified"])
            if not page.get("IsTruncated"):
                return
            token = page.get("NextContinuationToken")

    def presigned_url(self, key, *, expires_in):
        _check_key(key)
        return self.client.generate_presigned_url(
            "get_object",
            Params={
                "Bucket": self.bucket,
                "Key": key,
                "ResponseContentType": CONTENT_TYPE,
                "ResponseCacheControl": f"private, max-age={expires_in}",
            },
            ExpiresIn=expires_in,
        )


_cache: dict[tuple, PhotoStorage] = {}
_cache_lock = threading.Lock()


def get_photo_storage() -> PhotoStorage:
    """The configured store, built once per configuration."""
    backend = getattr(settings, "LAI_CHILD_PHOTO_STORAGE", "disabled")
    config = (
        backend,
        getattr(settings, "LAI_CHILD_PHOTOS_BUCKET", ""),
        getattr(settings, "LAI_CHILD_PHOTOS_REGION", ""),
        str(getattr(settings, "LAI_CHILD_PHOTO_LOCAL_ROOT", "")),
    )
    with _cache_lock:
        if config not in _cache:
            if backend == "s3":
                _cache[config] = S3PhotoStorage(config[1], config[2])
            elif backend == "local":
                _cache[config] = LocalPhotoStorage(Path(config[3]))
            elif backend == "memory":
                _cache[config] = MemoryPhotoStorage()
            elif backend == "disabled":
                _cache[config] = DisabledPhotoStorage()
            else:
                raise ImproperlyConfigured(
                    "LAI_CHILD_PHOTO_STORAGE must be s3, local, memory or disabled."
                )
        return _cache[config]


def reset_photo_storage_cache() -> None:
    """Tests only: forget built stores so the next call starts empty."""
    with _cache_lock:
        _cache.clear()
