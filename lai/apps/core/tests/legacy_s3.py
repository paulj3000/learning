"""A read-only stub of the legacy Amplify bucket for the AMP-04 migration tests.

It has list, get and list-versions operations only: no put, copy or delete method exists, so any
attempt to write to the source bucket fails the test that made it.
"""

import hashlib
import io
from datetime import UTC, datetime

READ_OPERATIONS = {"list_objects_v2", "get_object", "list_object_versions"}


class LegacyS3:
    """A read-only stub of the Amplify bucket. Pages `page_size` keys at a time."""

    def __init__(self, objects: dict[str, bytes], *, page_size: int = 2, versions=None):
        self.objects = dict(objects)
        self.page_size = page_size
        self.versions = versions
        self.tampered: dict[str, bytes] = {}  # served by get_object instead of the listed bytes
        self.calls: list[str] = []

    def list_objects_v2(self, *, Bucket, Prefix, ContinuationToken=None):  # noqa: N803
        self.calls.append("list_objects_v2")
        keys = sorted(key for key in self.objects if key.startswith(Prefix))
        start = int(ContinuationToken or 0)
        page = keys[start : start + self.page_size]
        body = {
            "Contents": [
                {
                    "Key": key,
                    "Size": len(self.objects[key]),
                    "ETag": f'"{hashlib.md5(self.objects[key]).hexdigest()}"',  # noqa: S324
                    "LastModified": datetime(2026, 9, 1, tzinfo=UTC),
                }
                for key in page
            ],
            "IsTruncated": start + self.page_size < len(keys),
        }
        if body["IsTruncated"]:
            body["NextContinuationToken"] = str(start + self.page_size)
        return body

    def get_object(self, *, Bucket, Key):  # noqa: N803
        self.calls.append("get_object")
        if Key not in self.objects:
            from botocore.exceptions import ClientError

            raise ClientError({"Error": {"Code": "NoSuchKey"}}, "GetObject")
        body = self.tampered.get(Key, self.objects[Key])
        return {"Body": io.BytesIO(body), "VersionId": "v-current"}

    def list_object_versions(self, **params):
        self.calls.append("list_object_versions")
        if self.versions is None:
            from botocore.exceptions import ClientError

            raise ClientError({"Error": {"Code": "AccessDenied"}}, "ListObjectVersions")
        return {**self.versions, "IsTruncated": False}
