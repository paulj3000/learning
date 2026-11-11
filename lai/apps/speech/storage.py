"""Where generated speech lives (SM-P8-05): a dedicated store, never the asset library.

Generated speech is cache, not content: it is not versioned, published or promoted to the Sound
Library, and it expires. Keys are `speech/<scope>/<2 hex>/<64 hex cache key>.mp3` (scope `shared`
for authored lines, `child` for a child's own approved text), made from a hash only, so no child
id, name or text is ever part of a key. The scope prefix lets the bucket carry a short lifecycle
expiry on `speech/child/` (a backstop for `speech_cleanup`) without ever expiring authored clips,
whose rows do not expire. Keys from before SM-P8-LIVE (`speech/<2 hex>/<hash>.mp3`) stay readable.
`get_speech_storage()` returns:

- `s3`: the private speech bucket (`LAI_SPEECH_BUCKET`); credentials come from the runtime role.
- `local`: files under `LAI_SPEECH_LOCAL_ROOT`, development only.
- `memory`: a dict, for tests.
"""

import re
import threading
from pathlib import Path
from typing import Protocol

from django.conf import settings

_KEY = re.compile(r"^speech/(?:(?:shared|child)/)?[0-9a-f]{2}/[0-9a-f]{64}\.mp3$")
SCOPE_PREFIXES = {"authored": "shared", "child": "child"}


class SpeechStorageError(Exception):
    """The store failed. Safe to log: no key, no bytes."""


def storage_key(cache_key: str, scope: str = "authored") -> str:
    """The object key for a clip. `scope` is a `ClipScope` value (`authored` or `child`)."""
    if not re.fullmatch(r"[0-9a-f]{64}", cache_key):
        raise ValueError("a cache key is a SHA-256 hex digest")
    prefix = SCOPE_PREFIXES.get(scope)
    if prefix is None:
        raise ValueError("unknown clip scope")
    return f"speech/{prefix}/{cache_key[:2]}/{cache_key}.mp3"


def _check(key: str) -> None:
    if not _KEY.fullmatch(key):
        raise SpeechStorageError("invalid speech key")


class SpeechStorage(Protocol):
    def put(self, key: str, data: bytes) -> None: ...

    def read(self, key: str) -> bytes: ...

    def delete(self, key: str) -> None: ...

    def presigned_url(self, key: str, *, expires_in: int) -> str | None: ...


class MemorySpeechStorage:
    def __init__(self):
        self.objects: dict[str, bytes] = {}
        self._lock = threading.Lock()

    def put(self, key, data):
        _check(key)
        with self._lock:
            self.objects[key] = data

    def read(self, key):
        _check(key)
        try:
            return self.objects[key]
        except KeyError:
            raise SpeechStorageError("speech object missing") from None

    def delete(self, key):
        _check(key)
        with self._lock:
            self.objects.pop(key, None)

    def presigned_url(self, key, *, expires_in):
        return None


class LocalSpeechStorage:
    def __init__(self, root: Path):
        self.root = root

    def _path(self, key: str) -> Path:
        _check(key)
        return self.root / key

    def put(self, key, data):
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def read(self, key):
        try:
            return self._path(key).read_bytes()
        except FileNotFoundError:
            raise SpeechStorageError("speech object missing") from None

    def delete(self, key):
        self._path(key).unlink(missing_ok=True)

    def presigned_url(self, key, *, expires_in):
        return None


class S3SpeechStorage:
    def __init__(self, bucket: str, client=None):
        self.bucket = bucket
        self._client = client

    def _s3(self):
        if self._client is None:
            import boto3
            from botocore.config import Config

            timeout = settings.LAI_SPEECH_TIMEOUT_SECONDS
            region = settings.LAI_SPEECH_S3_REGION or None
            # An explicit region, its regional endpoint and SigV4, so presigned URLs are valid in
            # every region. Without the endpoint, botocore signs for the global host
            # `<bucket>.s3.amazonaws.com`; outside us-east-1 (and always for a new bucket) S3
            # redirects that host to the regional one, and the redirected request fails with
            # `SignatureDoesNotMatch` because the signature covers the original host.
            self._client = boto3.client(
                "s3",
                region_name=region,
                endpoint_url=f"https://s3.{region}.amazonaws.com" if region else None,
                config=Config(
                    signature_version="s3v4",
                    s3={"addressing_style": "virtual"},
                    connect_timeout=timeout,
                    read_timeout=timeout,
                    retries={"max_attempts": 3, "mode": "standard"},
                ),
            )
        return self._client

    def put(self, key, data):
        _check(key)
        try:
            self._s3().put_object(
                Bucket=self.bucket,
                Key=key,
                Body=data,
                ContentType="audio/mpeg",
                ServerSideEncryption="AES256",
            )
        except Exception:  # noqa: BLE001
            raise SpeechStorageError("could not store speech") from None

    def read(self, key):
        _check(key)
        try:
            return self._s3().get_object(Bucket=self.bucket, Key=key)["Body"].read()
        except Exception:  # noqa: BLE001
            raise SpeechStorageError("speech object missing") from None

    def delete(self, key):
        _check(key)
        try:
            self._s3().delete_object(Bucket=self.bucket, Key=key)
        except Exception:  # noqa: BLE001
            raise SpeechStorageError("could not delete speech") from None

    def presigned_url(self, key, *, expires_in):
        _check(key)
        try:
            return self._s3().generate_presigned_url(
                "get_object",
                Params={
                    "Bucket": self.bucket,
                    "Key": key,
                    "ResponseContentType": "audio/mpeg",
                    "ResponseCacheControl": "private, no-store",
                },
                ExpiresIn=expires_in,
            )
        except Exception:  # noqa: BLE001 - e.g. no credentials; the caller falls back
            raise SpeechStorageError("could not sign a speech url") from None


_storage: SpeechStorage | None = None


def get_speech_storage() -> SpeechStorage:
    global _storage
    if _storage is None:
        kind = settings.LAI_SPEECH_STORAGE
        if kind == "s3":
            _storage = S3SpeechStorage(settings.LAI_SPEECH_BUCKET)
        elif kind == "local":
            _storage = LocalSpeechStorage(Path(settings.LAI_SPEECH_LOCAL_ROOT))
        else:
            _storage = MemorySpeechStorage()
    return _storage


def reset_speech_storage_cache() -> None:
    global _storage
    _storage = None
