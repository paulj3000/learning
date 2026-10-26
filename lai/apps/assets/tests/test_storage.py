"""AM-4: the storage abstraction (LAI-2200). Memory and local stores, S3 with a stub client."""

import base64
import datetime
import hashlib
import io
import uuid

import pytest
from botocore.stub import ANY, Stubber

from apps.assets.storage import (
    LocalAssetStorage,
    MemoryAssetStorage,
    ObjectExists,
    S3AssetStorage,
    StorageError,
    object_key,
    sha256_of,
)

DATA = b"glTF model bytes"
SHA = hashlib.sha256(DATA).hexdigest()
VERSION = uuid.UUID("7c0e1c5e-0000-4000-8000-000000000001")
KEY = f"assets/models/npc-pip/{VERSION}/model.glb"


def test_keys_are_server_made_from_the_id_and_version_uuid():
    assert object_key("npc-pip", VERSION, "glb") == KEY
    for bad_id in ("", "NPC Pip", "../etc", "npc/pip", "npc-pip/../../x"):
        with pytest.raises(ValueError):
            object_key(bad_id, VERSION, "glb")
    with pytest.raises(ValueError):
        object_key("npc-pip", "not-a-uuid", "glb")
    with pytest.raises(ValueError):
        object_key("npc-pip", VERSION, "fbx")


def test_checksums_are_streamed_and_rewind():
    stream = io.BytesIO(DATA)
    assert sha256_of(stream) == (SHA, len(DATA))
    assert stream.tell() == 0


@pytest.mark.parametrize("make", [MemoryAssetStorage, lambda: None])
def test_memory_and_local_stores_never_overwrite_and_verify_checksums(make, tmp_path):
    store = make() or LocalAssetStorage(tmp_path)
    store.put(KEY, io.BytesIO(DATA), content_type="model/gltf-binary", sha256=SHA)
    assert store.exists(KEY) and store.open(KEY).read() == DATA
    with pytest.raises(ObjectExists):
        other_sha = hashlib.sha256(b"other bytes").hexdigest()
        store.put(KEY, io.BytesIO(b"other bytes"), content_type="x", sha256=other_sha)
    assert store.open(KEY).read() == DATA  # unchanged
    other = KEY.replace("model.glb", "other.glb")
    with pytest.raises(StorageError, match="Checksum"):
        store.put(other, io.BytesIO(DATA), content_type="x", sha256="0" * 64)
    assert not store.exists(other)
    assert [item.key for item in store.list()] == [KEY]
    store.delete(KEY)
    assert not store.exists(KEY)


@pytest.mark.parametrize("key", ["../outside", "/etc/passwd", "assets/models/../../x", "other/key"])
def test_keys_outside_the_prefix_are_refused(key, tmp_path):
    for store in (MemoryAssetStorage(), LocalAssetStorage(tmp_path)):
        with pytest.raises(StorageError):
            store.put(key, io.BytesIO(DATA), content_type="x", sha256=SHA)


# --- S3, against a stubbed client (no network, no credentials) ---------------------------------


@pytest.fixture
def s3():
    import boto3

    client = boto3.client(
        "s3", region_name="us-test-1", aws_access_key_id="test", aws_secret_access_key="test"
    )
    stubber = Stubber(client)
    stubber.activate()
    yield S3AssetStorage("lai-assets-test", "us-test-1", client=client), stubber
    stubber.deactivate()


def test_s3_put_sends_the_checksum_and_never_overwrites(s3):
    store, stubber = s3
    stubber.add_response(
        "put_object",
        {},
        {
            "Bucket": "lai-assets-test",
            "Key": KEY,
            "Body": ANY,
            "ContentType": "model/gltf-binary",
            "ChecksumSHA256": base64.b64encode(bytes.fromhex(SHA)).decode(),
            "IfNoneMatch": "*",
            "CacheControl": "private, max-age=31536000, immutable",
        },
    )
    store.put(KEY, io.BytesIO(DATA), content_type="model/gltf-binary", sha256=SHA)
    stubber.add_client_error("put_object", "PreconditionFailed", http_status_code=412)
    with pytest.raises(ObjectExists):
        store.put(KEY, io.BytesIO(DATA), content_type="model/gltf-binary", sha256=SHA)
    stubber.add_client_error("put_object", "AccessDenied", "secret detail", http_status_code=403)
    with pytest.raises(StorageError) as error:
        store.put(KEY, io.BytesIO(DATA), content_type="model/gltf-binary", sha256=SHA)
    assert "secret detail" not in str(error.value) and "AccessDenied" in str(error.value)
    stubber.assert_no_pending_responses()


def test_s3_reads_lists_and_deletes(s3):
    from botocore.response import StreamingBody

    store, stubber = s3
    stubber.add_response(
        "get_object",
        {"Body": StreamingBody(io.BytesIO(DATA), len(DATA))},
        {"Bucket": "lai-assets-test", "Key": KEY},
    )
    assert store.open(KEY).read() == DATA
    stubber.add_response("head_object", {}, {"Bucket": "lai-assets-test", "Key": KEY})
    assert store.exists(KEY)
    stubber.add_client_error("head_object", "404", http_status_code=404)
    assert not store.exists(KEY)
    when = datetime.datetime(2026, 10, 1, tzinfo=datetime.UTC)
    stubber.add_response(
        "list_objects_v2",
        {
            "Contents": [{"Key": KEY, "Size": 16, "LastModified": when}],
            "IsTruncated": True,
            "NextContinuationToken": "t1",
        },
        {"Bucket": "lai-assets-test", "Prefix": "assets/models/"},
    )
    stubber.add_response(
        "list_objects_v2",
        {"Contents": [], "IsTruncated": False},
        {"Bucket": "lai-assets-test", "Prefix": "assets/models/", "ContinuationToken": "t1"},
    )
    assert [item.key for item in store.list()] == [KEY]
    stubber.add_response("delete_object", {}, {"Bucket": "lai-assets-test", "Key": KEY})
    store.delete(KEY)
    stubber.assert_no_pending_responses()


def test_s3_presigned_urls_are_private_and_short_lived(s3):
    store, _stubber = s3
    url = store.presigned_url(KEY, expires_in=600, content_type="model/gltf-binary")
    assert url.startswith("https://lai-assets-test.s3.") and "X-Amz-Expires=600" in url
    assert "response-content-type=model%2Fgltf-binary" in url
    with pytest.raises(StorageError):
        store.presigned_url("../outside", expires_in=600, content_type="x")


def test_s3_needs_a_bucket_and_region():
    from django.core.exceptions import ImproperlyConfigured

    with pytest.raises(ImproperlyConfigured):
        S3AssetStorage("", "us-test-1", client=object())
