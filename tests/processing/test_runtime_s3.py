"""S3ObjectStorage against botocore's Stubber: no network, no credentials, no AWS."""

from __future__ import annotations

import base64
import hashlib
import io
from collections.abc import Iterator
from typing import Any

import botocore.session
import pytest
from botocore.exceptions import (
    ConnectTimeoutError,
    EndpointConnectionError,
    NoCredentialsError,
    ReadTimeoutError,
)
from botocore.response import StreamingBody
from botocore.stub import ANY, Stubber

from lai_processing.contracts.common import ObjectRef
from lai_processing.contracts.identifiers import StoreName
from lai_processing.core.errors import ErrorCode, ProcessingError
from lai_processing.ports.storage import (
    ObjectExists,
    ObjectMissing,
    ObjectStorage,
    StorageError,
    StoragePermissionDenied,
    StorageUnavailable,
)
from lai_processing_runtime.s3 import S3ObjectStorage, checksum_to_hex, hex_to_checksum

NS = "dev"
JOB = "6f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f"
ATTEMPT = "0b9a8c7d-6e5f-4a3b-9c2d-1e0f2a3b4c5d"
Q_KEY = f"processing/quarantine/{NS}/{JOB}/input.bin"
A_KEY = f"processing/artifacts/{NS}/{JOB}/{ATTEMPT}/report.json"
ASSET_KEY = "assets/models/npc-pip/v1/model.glb"
PROC_BUCKET = "lai-processing-dev-123456789012-eu-west-2"
ASSET_BUCKET = "lai-assets-dev"
DATA = b"Learning makes the island grow.\n"
SHA = hashlib.sha256(DATA).hexdigest()
B64 = base64.b64encode(hashlib.sha256(DATA).digest()).decode()


_SESSION = botocore.session.get_session()


def make_client() -> Any:
    return _SESSION.create_client(
        "s3",
        region_name="eu-west-2",
        aws_access_key_id="testing",
        aws_secret_access_key="testing",  # noqa: S106 - a stub credential, never used
    )


@pytest.fixture
def s3() -> Iterator[tuple[S3ObjectStorage, Stubber]]:
    client = make_client()
    stubber = Stubber(client)
    buckets = {
        StoreName.ASSETS: ASSET_BUCKET,
        StoreName.QUARANTINE: PROC_BUCKET,
        StoreName.ARTIFACTS: PROC_BUCKET,
    }
    with stubber:
        yield S3ObjectStorage(client, buckets), stubber
        stubber.assert_no_pending_responses()


def qref(version: str | None = None) -> ObjectRef:
    return ObjectRef(StoreName.QUARANTINE, Q_KEY, version, NS)


def aref() -> ObjectRef:
    return ObjectRef(StoreName.ARTIFACTS, A_KEY, None, NS)


def body(data: bytes) -> StreamingBody:
    return StreamingBody(io.BytesIO(data), len(data))


def test_implements_the_port(s3: tuple[S3ObjectStorage, Stubber]) -> None:
    assert isinstance(s3[0], ObjectStorage)


def test_checksum_decoding() -> None:
    assert checksum_to_hex(B64) == SHA
    assert hex_to_checksum(SHA) == B64
    assert checksum_to_hex(B64 + "-3") is None  # composite multipart checksum
    assert checksum_to_hex(None) is None
    assert checksum_to_hex("") is None
    assert checksum_to_hex("not base64!") is None
    assert checksum_to_hex(base64.b64encode(b"short").decode()) is None


def test_head_uses_checksum_mode_and_decodes_sha(s3: tuple[S3ObjectStorage, Stubber]) -> None:
    storage, stub = s3
    stub.add_response(
        "head_object",
        {
            "ContentLength": len(DATA),
            "ContentType": "text/plain",
            "VersionId": "v1",
            "ChecksumSHA256": B64,
            "ChecksumType": "FULL_OBJECT",
            "ETag": '"' + hashlib.md5(DATA).hexdigest() + '"',  # noqa: S324
        },
        {"Bucket": PROC_BUCKET, "Key": Q_KEY, "ChecksumMode": "ENABLED"},
    )
    info = storage.head(qref())
    assert info.sha256 == SHA
    assert info.version_id == "v1"
    assert info.ref.version_id == "v1"
    assert info.size_bytes == len(DATA)
    assert info.content_type == "text/plain"


def test_etag_is_never_used_as_sha256(s3: tuple[S3ObjectStorage, Stubber]) -> None:
    storage, stub = s3
    # An ETag that happens to look like a hex digest, and no checksum: sha256 stays unknown.
    stub.add_response(
        "head_object",
        {"ContentLength": 3, "ETag": '"' + SHA + '"'},
        {"Bucket": PROC_BUCKET, "Key": Q_KEY, "ChecksumMode": "ENABLED"},
    )
    assert storage.head(qref()).sha256 is None


def test_composite_checksum_is_unknown(s3: tuple[S3ObjectStorage, Stubber]) -> None:
    storage, stub = s3
    stub.add_response(
        "head_object",
        {"ContentLength": 3, "ChecksumSHA256": B64 + "-2"},
        {"Bucket": PROC_BUCKET, "Key": Q_KEY, "ChecksumMode": "ENABLED"},
    )
    assert storage.head(qref()).sha256 is None
    stub.add_response(
        "head_object",
        {"ContentLength": 3, "ChecksumSHA256": B64, "ChecksumType": "COMPOSITE"},
        {"Bucket": PROC_BUCKET, "Key": Q_KEY, "ChecksumMode": "ENABLED"},
    )
    assert storage.head(qref()).sha256 is None


def test_version_pinned_head_and_open(s3: tuple[S3ObjectStorage, Stubber]) -> None:
    storage, stub = s3
    stub.add_response(
        "head_object",
        {"ContentLength": len(DATA), "VersionId": "v7", "ChecksumSHA256": B64},
        {"Bucket": PROC_BUCKET, "Key": Q_KEY, "ChecksumMode": "ENABLED", "VersionId": "v7"},
    )
    assert storage.head(qref("v7")).version_id == "v7"
    stub.add_response(
        "get_object",
        {"Body": body(DATA), "ContentLength": len(DATA), "VersionId": "v7"},
        {"Bucket": PROC_BUCKET, "Key": Q_KEY, "VersionId": "v7"},
    )
    with storage.open(qref("v7")) as stream:
        assert stream.read() == DATA


def test_a_different_version_in_the_response_is_refused(
    s3: tuple[S3ObjectStorage, Stubber],
) -> None:
    storage, stub = s3
    stub.add_response(
        "head_object",
        {"ContentLength": 3, "VersionId": "v8"},
        {"Bucket": PROC_BUCKET, "Key": Q_KEY, "ChecksumMode": "ENABLED", "VersionId": "v7"},
    )
    with pytest.raises(ObjectMissing):
        storage.head(qref("v7"))
    stub.add_response(
        "get_object",
        {"Body": body(b"abc"), "ContentLength": 3, "VersionId": "v8"},
        {"Bucket": PROC_BUCKET, "Key": Q_KEY, "VersionId": "v7"},
    )
    with pytest.raises(ObjectMissing):
        storage.open(qref("v7"))


def test_open_streams_in_bounded_chunks() -> None:
    reads: list[int] = []

    class Body:
        def __init__(self) -> None:
            self._data = io.BytesIO(b"x" * (3 * 1024 * 1024))

        def read(self, n: int = -1) -> bytes:
            reads.append(n)
            return self._data.read(n)

        def close(self) -> None:
            pass

    class Client:
        def get_object(self, **params: Any) -> dict[str, Any]:
            return {"Body": Body(), "ContentLength": 3 * 1024 * 1024}

    storage = S3ObjectStorage(Client(), {StoreName.QUARANTINE: PROC_BUCKET}, writable=frozenset())
    with storage.open(qref()) as stream:
        total = len(stream.read())
    assert total == 3 * 1024 * 1024
    assert reads and all(0 < n <= 1024 * 1024 for n in reads)


def test_read_refuses_oversize_before_reading(s3: tuple[S3ObjectStorage, Stubber]) -> None:
    storage, stub = s3
    stub.add_response(
        "get_object",
        {"Body": body(DATA), "ContentLength": len(DATA)},
        {"Bucket": PROC_BUCKET, "Key": Q_KEY},
    )
    with pytest.raises(ProcessingError) as caught:
        storage.read(qref(), max_bytes=4)
    assert caught.value.code is ErrorCode.RESOURCE_LIMIT_EXCEEDED
    stub.add_response(
        "get_object",
        {"Body": body(DATA), "ContentLength": len(DATA)},
        {"Bucket": PROC_BUCKET, "Key": Q_KEY},
    )
    assert storage.read(qref(), max_bytes=len(DATA)) == DATA


def test_read_refuses_a_body_longer_than_declared() -> None:
    class Client:
        def get_object(self, **params: Any) -> dict[str, Any]:
            return {"Body": io.BytesIO(b"y" * 100)}  # no ContentLength

    storage = S3ObjectStorage(Client(), {StoreName.QUARANTINE: PROC_BUCKET}, writable=frozenset())
    with pytest.raises(ProcessingError) as caught:
        storage.read(qref(), max_bytes=10)
    assert caught.value.code is ErrorCode.RESOURCE_LIMIT_EXCEEDED


def put_params(**overrides: Any) -> dict[str, Any]:
    params = {
        "Bucket": PROC_BUCKET,
        "Key": A_KEY,
        "Body": ANY,
        "ContentLength": len(DATA),
        "ContentType": "application/json",
        "ChecksumAlgorithm": "SHA256",
        "ChecksumSHA256": B64,
        "IfNoneMatch": "*",
        "ServerSideEncryption": "AES256",
    }
    params.update(overrides)
    return params


def do_put(storage: S3ObjectStorage, data: bytes = DATA, **kwargs: Any) -> Any:
    return storage.put(
        aref(),
        io.BytesIO(data),
        content_type="application/json",
        sha256=kwargs.get("sha256", SHA),
        size_bytes=kwargs.get("size_bytes", len(data)),
    )


def test_put_is_create_only_with_checksum(s3: tuple[S3ObjectStorage, Stubber]) -> None:
    storage, stub = s3
    stub.add_response("put_object", {"VersionId": "v1"}, put_params())
    info = do_put(storage)
    assert info.version_id == "v1"
    assert info.sha256 == SHA
    assert info.ref.version_id == "v1"


def test_put_existing_identical_is_idempotent(s3: tuple[S3ObjectStorage, Stubber]) -> None:
    storage, stub = s3
    stub.add_client_error(
        "put_object",
        service_error_code="PreconditionFailed",
        http_status_code=412,
        expected_params=put_params(),
    )
    stub.add_response(
        "head_object",
        {"ContentLength": len(DATA), "VersionId": "v1", "ChecksumSHA256": B64},
        {"Bucket": PROC_BUCKET, "Key": A_KEY, "ChecksumMode": "ENABLED"},
    )
    info = do_put(storage)
    assert info.version_id == "v1" and info.sha256 == SHA


@pytest.mark.parametrize("existing", [base64.b64encode(b"\x01" * 32).decode(), None])
def test_put_existing_different_or_unknown_is_conflict(
    s3: tuple[S3ObjectStorage, Stubber], existing: str | None
) -> None:
    storage, stub = s3
    stub.add_client_error(
        "put_object",
        service_error_code="PreconditionFailed",
        http_status_code=412,
        expected_params=put_params(),
    )
    head: dict[str, Any] = {"ContentLength": len(DATA), "ETag": '"' + SHA + '"'}
    if existing:
        head["ChecksumSHA256"] = existing
    stub.add_response(
        "head_object", head, {"Bucket": PROC_BUCKET, "Key": A_KEY, "ChecksumMode": "ENABLED"}
    )
    with pytest.raises(ObjectExists):
        do_put(storage)


def test_put_verifies_bytes_before_any_request(s3: tuple[S3ObjectStorage, Stubber]) -> None:
    storage, _ = s3  # no stubbed response: a request would fail the stubber
    with pytest.raises(ProcessingError) as caught:
        do_put(storage, sha256="0" * 64)
    assert caught.value.code is ErrorCode.CHECKSUM_MISMATCH
    with pytest.raises(ProcessingError):
        do_put(storage, size_bytes=len(DATA) + 1)
    with pytest.raises(ProcessingError):
        do_put(storage, size_bytes=len(DATA) - 1)


def test_put_and_delete_store_rules(s3: tuple[S3ObjectStorage, Stubber]) -> None:
    storage, stub = s3
    with pytest.raises(StoragePermissionDenied):
        storage.put(
            qref(), io.BytesIO(DATA), content_type="text/plain", sha256=SHA, size_bytes=len(DATA)
        )
    with pytest.raises(StoragePermissionDenied):
        storage.delete(ObjectRef(StoreName.ASSETS, ASSET_KEY, None, NS))
    with pytest.raises(StoragePermissionDenied):
        storage.delete(qref())
    stub.add_response("delete_object", {}, {"Bucket": PROC_BUCKET, "Key": A_KEY})
    storage.delete(aref())
    stub.add_client_error("delete_object", service_error_code="NoSuchKey", http_status_code=404)
    storage.delete(aref())  # missing is not an error


def test_assets_store_reads_from_the_asset_bucket(s3: tuple[S3ObjectStorage, Stubber]) -> None:
    storage, stub = s3
    stub.add_response(
        "head_object",
        {"ContentLength": 3},
        {"Bucket": ASSET_BUCKET, "Key": ASSET_KEY, "ChecksumMode": "ENABLED"},
    )
    storage.head(ObjectRef(StoreName.ASSETS, ASSET_KEY, None, NS))


def test_buckets_come_only_from_configuration() -> None:
    storage = S3ObjectStorage(object(), {StoreName.QUARANTINE: PROC_BUCKET}, writable=frozenset())
    with pytest.raises(StoragePermissionDenied):
        storage.head(aref())  # no bucket for artifacts: refused, nothing guessed
    with pytest.raises(ValueError):
        S3ObjectStorage(object(), {StoreName.QUARANTINE: PROC_BUCKET})  # artifacts writable


@pytest.mark.parametrize(
    ("code", "status", "expected"),
    [
        ("NoSuchKey", 404, ObjectMissing),
        ("404", 404, ObjectMissing),
        ("NotFound", 404, ObjectMissing),
        ("NoSuchVersion", 404, ObjectMissing),
        ("AccessDenied", 403, StoragePermissionDenied),
        ("403", 403, StoragePermissionDenied),
        ("NoSuchBucket", 404, StoragePermissionDenied),
        ("ExpiredToken", 400, StoragePermissionDenied),
        ("SlowDown", 503, StorageUnavailable),
        ("Throttling", 400, StorageUnavailable),
        ("ThrottlingException", 400, StorageUnavailable),
        ("InternalError", 500, StorageUnavailable),
        ("ServiceUnavailable", 503, StorageUnavailable),
        ("SomethingNew", 502, StorageUnavailable),
        ("InvalidArgument", 400, StorageError),
    ],
)
def test_client_error_classification(
    s3: tuple[S3ObjectStorage, Stubber], code: str, status: int, expected: type[Exception]
) -> None:
    storage, stub = s3
    stub.add_client_error(
        "head_object",
        service_error_code=code,
        http_status_code=status,
        service_message="message with secrets that must not leak",
    )
    with pytest.raises(expected) as caught:
        storage.head(qref())
    assert type(caught.value) is expected
    assert "secrets" not in repr(caught.value) and "secrets" not in str(caught.value)
    assert caught.value.details["aws_code"] == code


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        (EndpointConnectionError(endpoint_url="https://s3"), StorageUnavailable),
        (ConnectTimeoutError(endpoint_url="https://s3"), StorageUnavailable),
        (ReadTimeoutError(endpoint_url="https://s3"), StorageUnavailable),
        (NoCredentialsError(), StoragePermissionDenied),
        (ConnectionResetError(), StorageUnavailable),
    ],
)
def test_transport_error_classification(error: Exception, expected: type[Exception]) -> None:
    class Client:
        def head_object(self, **params: Any) -> dict[str, Any]:
            raise error

    storage = S3ObjectStorage(Client(), {StoreName.QUARANTINE: PROC_BUCKET}, writable=frozenset())
    with pytest.raises(expected):
        storage.head(qref())


def test_a_read_timeout_mid_stream_is_unavailable() -> None:
    class Body:
        def read(self, n: int = -1) -> bytes:
            raise ReadTimeoutError(endpoint_url="https://s3")

        def close(self) -> None:
            pass

    class Client:
        def get_object(self, **params: Any) -> dict[str, Any]:
            return {"Body": Body(), "ContentLength": 10}

    storage = S3ObjectStorage(Client(), {StoreName.QUARANTINE: PROC_BUCKET}, writable=frozenset())
    with storage.open(qref()) as stream, pytest.raises(StorageUnavailable):
        stream.read(4)


def test_programming_errors_are_not_swallowed() -> None:
    class Client:
        def head_object(self, **params: Any) -> dict[str, Any]:
            raise KeyError("bug")

    storage = S3ObjectStorage(Client(), {StoreName.QUARANTINE: PROC_BUCKET}, writable=frozenset())
    with pytest.raises(KeyError):
        storage.head(qref())


def test_server_side_encryption_is_configurable() -> None:
    client = make_client()
    stub = Stubber(client)
    storage = S3ObjectStorage(
        client, {StoreName.ARTIFACTS: PROC_BUCKET}, server_side_encryption=None
    )
    params = put_params()
    del params["ServerSideEncryption"]
    stub.add_response("put_object", {}, params)
    with stub:
        info = do_put(storage)
    assert info.version_id is None
