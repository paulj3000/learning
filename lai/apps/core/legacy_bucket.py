"""Read-only access to the legacy Amplify Storage bucket (AMP-04).

Runbook: docs/platform/AMPLIFY_STORAGE_CUTOVER.md. Used by `migrate_amplify_child_photos`
(apps/users) and `migrate_amplify_asset_objects` (apps/assets) to inventory and copy the objects
an Amplify build stored in `learningAdventureIslandMedia` (amplify/storage/resource.ts).

`LegacyBucket` only lists, reads and checksums. It has no put, copy or delete method, so nothing
that uses it can change or remove a source object: the Amplify bucket is preserved until the
owner approves its retirement (docs/platform/AMPLIFY_EXIT_MATRIX.md section 5). Error messages
carry the S3 error code only, never a key (a photo key carries a parent's identity id).
"""

import hashlib
import json
import os
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

CHUNK = 1024 * 1024


class LegacyBucketError(Exception):
    """A read of the legacy bucket failed. Safe to log: no key, bytes or credentials."""


@dataclass(frozen=True)
class LegacyObject:
    key: str
    size: int
    etag: str
    last_modified: datetime


@dataclass(frozen=True)
class LegacyRead:
    sha256: str
    md5: str
    size: int
    version_id: str | None
    data: bytes | None  # the bytes, when they fit the caller's `keep_up_to`


def make_client(region: str):
    """A boto3 S3 client for the owner's read-only credentials. Tests replace this."""
    import boto3  # imported lazily: only a real migration run needs it loaded

    return boto3.client("s3", region_name=region)


def _code(error) -> str:
    return getattr(error, "response", {}).get("Error", {}).get("Code", "") or type(error).__name__


class LegacyBucket:
    """List, read and checksum objects under one prefix of the Amplify bucket. Never writes."""

    def __init__(self, bucket: str, region: str, *, prefix: str, client=None):
        if not bucket or not region:
            raise LegacyBucketError("The legacy bucket name and region are both required.")
        if not prefix.endswith("/") or prefix.startswith("/"):
            raise LegacyBucketError("The prefix must be a relative folder ending in '/'.")
        self.bucket = bucket
        self.prefix = prefix
        self.client = client if client is not None else make_client(region)

    def _check_key(self, key: str) -> None:
        if not key.startswith(self.prefix) or ".." in key.split("/") or "\x00" in key:
            raise LegacyBucketError("Refusing a key outside the migration prefix.")

    def list(self) -> Iterator[LegacyObject]:
        """Every current object under the prefix, following pagination."""
        from botocore.exceptions import BotoCoreError, ClientError

        token = None
        while True:
            params = {"Bucket": self.bucket, "Prefix": self.prefix}
            if token:
                params["ContinuationToken"] = token
            try:
                page = self.client.list_objects_v2(**params)
            except (ClientError, BotoCoreError) as error:
                raise LegacyBucketError(f"S3 list failed ({_code(error)})") from None
            for item in page.get("Contents", []):
                if item["Key"].endswith("/"):
                    continue  # a console-created "folder" placeholder, not an object
                yield LegacyObject(
                    key=item["Key"],
                    size=int(item["Size"]),
                    etag=str(item.get("ETag", "")).strip('"'),
                    last_modified=item["LastModified"],
                )
            if not page.get("IsTruncated"):
                return
            token = page.get("NextContinuationToken")

    def version_summary(self) -> dict:
        """How many noncurrent versions and delete markers the prefix holds (read-only).

        These are never copied: a noncurrent version or a delete marker is a photo or model the
        Amplify app already replaced or removed. They are counted so the owner can see what the
        bucket still retains before deciding on its retirement.
        """
        from botocore.exceptions import BotoCoreError, ClientError

        summary = {"available": True, "noncurrentVersions": 0, "deleteMarkers": 0}
        key_marker = version_marker = None
        while True:
            params = {"Bucket": self.bucket, "Prefix": self.prefix}
            if key_marker:
                params["KeyMarker"] = key_marker
            if version_marker:
                params["VersionIdMarker"] = version_marker
            try:
                page = self.client.list_object_versions(**params)
            except (ClientError, BotoCoreError) as error:
                return {"available": False, "reason": _code(error)}
            summary["noncurrentVersions"] += sum(
                1 for item in page.get("Versions", []) if not item.get("IsLatest")
            )
            summary["deleteMarkers"] += len(page.get("DeleteMarkers", []))
            if not page.get("IsTruncated"):
                return summary
            key_marker = page.get("NextKeyMarker")
            version_marker = page.get("NextVersionIdMarker")

    def read(self, key: str, *, keep_up_to: int = 0, into: Path | None = None) -> LegacyRead:
        """Stream one object, hashing it. Keeps the bytes when the object is at most `keep_up_to`
        bytes, and writes them to `into` when given (a new file, created owner-only)."""
        from botocore.exceptions import BotoCoreError, ClientError

        self._check_key(key)
        digest = hashlib.sha256()
        md5 = hashlib.md5(usedforsecurity=False)  # only to compare with S3's single-part ETag
        size = 0
        kept = bytearray()
        out = None
        try:
            response = self.client.get_object(Bucket=self.bucket, Key=key)
            body = response["Body"]
            if into is not None:
                into.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                out = os.fdopen(os.open(into, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb")
            while chunk := body.read(CHUNK):
                digest.update(chunk)
                md5.update(chunk)
                size += len(chunk)
                if size <= keep_up_to:
                    kept += chunk
                if out is not None:
                    out.write(chunk)
        except (ClientError, BotoCoreError) as error:
            raise LegacyBucketError(f"S3 read failed ({_code(error)})") from None
        finally:
            if out is not None:
                out.close()
        return LegacyRead(
            sha256=digest.hexdigest(),
            md5=md5.hexdigest(),
            size=size,
            version_id=response.get("VersionId"),
            data=bytes(kept) if size <= keep_up_to else None,
        )


def etag_matches(etag: str, md5: str) -> bool | None:
    """Whether a single-part object's ETag is the MD5 of the bytes read; None when the ETag is not
    an MD5 (a multipart upload's `<md5>-<parts>`, or none at all). Amplify's bucket uses SSE-S3,
    where a single-part ETag is the MD5."""
    etag = (etag or "").strip('"').lower()
    if not etag or "-" in etag or len(etag) != 32:
        return None
    return etag == md5


def write_manifest(path: Path, body: dict) -> None:
    """Write a migration manifest owner-only (0600): it holds child and identity ids."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as out:
        out.write(json.dumps(body, indent=2, sort_keys=True, default=str) + "\n")


def read_manifest(path: Path) -> dict:
    try:
        body = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise LegacyBucketError(f"Cannot read the manifest ({type(error).__name__}).") from None
    if not isinstance(body, dict):
        raise LegacyBucketError("The manifest must be a JSON object.")
    return body
