"""Where generated speech lives (SM-P8-05): a dedicated store, never the asset library.

Generated speech is cache, not content: it is not versioned, published or promoted to the Sound
Library, and it expires. Keys are `speech/<2 hex>/<64 hex cache key>.mp3`, made from a hash only,
so no child id, name or text is ever part of a key. `get_speech_storage()` returns:

- `s3`: the private speech bucket (`LAI_SPEECH_BUCKET`); credentials come from the runtime role.
- `local`: files under `LAI_SPEECH_LOCAL_ROOT`, development only.
- `memory`: a dict, for tests.
"""

import re
import threading
from pathlib import Path
from typing import Protocol

from django.conf import settings

_KEY = re.compile(r"^speech/[0-9a-f]{2}/[0-9a-f]{64}\.mp3$")


class SpeechStorageError(Exception):
    """The store failed. Safe to log: no key, no bytes."""


def storage_key(cache_key: str) -> str:
    if not re.fullmatch(r"[0-9a-f]{64}", cache_key):
        raise ValueError("a cache key is a SHA-256 hex digest")
    return f"speech/{cache_key[:2]}/{cache_key}.mp3"


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

            self._client = boto3.client("s3")
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
        return self._s3().generate_presigned_url(
            "get_object",
            Params={"Bucket": self.bucket, "Key": key, "ResponseContentType": "audio/mpeg"},
            ExpiresIn=expires_in,
        )


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
