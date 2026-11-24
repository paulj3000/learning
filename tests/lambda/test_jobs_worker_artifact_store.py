"""The worker's create-only artifact store (ADR-066): `IfNoneMatch`, 412 verification by computed
SHA-256, prefix confinement, 403 handling and the read-only asset input. Fake S3, no network."""

import hashlib
import importlib
import io
import uuid

import pytest

NS = "dev"
JOB = str(uuid.uuid4())
ATTEMPT = str(uuid.uuid4())
OTHER = str(uuid.uuid4())
BUCKET = "lai-dev-assets"
DATA = b"OggS" + b"\x01" * 100
DIGEST = hashlib.sha256(DATA).hexdigest()


class ClientError(Exception):
    def __init__(self, code, status):
        super().__init__(code)
        self.response = {"Error": {"Code": code}, "ResponseMetadata": {"HTTPStatusCode": status}}


class FakeBucket:
    """S3 with create-only semantics: `IfNoneMatch="*"` on an existing key answers 412."""

    def __init__(self):
        self.objects: dict[str, bytes] = {}
        self.puts: list[dict] = []
        self.deleted: list[str] = []
        self.fail_put: ClientError | None = None
        self.fail_head: ClientError | None = None
        self.etag_lies = False

    def put_object(self, **kwargs):
        self.puts.append(kwargs)
        if self.fail_put:
            raise self.fail_put
        if kwargs.get("IfNoneMatch") == "*" and kwargs["Key"] in self.objects:
            raise ClientError("PreconditionFailed", 412)
        self.objects[kwargs["Key"]] = kwargs["Body"]
        return {"VersionId": "v1", "ETag": '"abc"'}

    def head_object(self, Bucket, Key, **kwargs):
        if self.fail_head:
            raise self.fail_head
        if Key not in self.objects:
            raise ClientError("404", 404)
        return {
            "ContentLength": len(self.objects[Key]),
            "ContentType": "audio/ogg",
            "VersionId": "v1",
            "ETag": '"' + ("0" * 32 if self.etag_lies else "ffff") + '"',
        }

    def get_object(self, Bucket, Key, **kwargs):
        if Key not in self.objects:
            raise ClientError("NoSuchKey", 404)
        return {"Body": io.BytesIO(self.objects[Key])}

    def delete_object(self, **kwargs):  # pragma: no cover - must never be called
        self.deleted.append(kwargs["Key"])


@pytest.fixture
def mod(worker):
    from lai_processing.contracts.common import ObjectRef
    from lai_processing.contracts.identifiers import StoreName
    from lai_processing.ports import storage as port

    module = importlib.import_module("jobs_worker.artifact_store")
    return type(
        "M", (), {"store": module, "ObjectRef": ObjectRef, "Store": StoreName, "port": port}
    )


@pytest.fixture
def bucket():
    return FakeBucket()


def key(logical="opus", attempt=ATTEMPT, job=JOB, ns=NS, ext="ogg"):
    return f"processing/artifacts/{ns}/{job}/{attempt}/{logical}.{ext}"


def make(mod, bucket, *, bound=True):
    prefix = f"processing/artifacts/{NS}/{JOB}/{ATTEMPT}/" if bound else None
    return mod.store.S3ObjectStore(bucket, BUCKET, NS, attempt_prefix=prefix)


def ref(mod, k, store=None):
    return mod.ObjectRef(store or mod.Store.ARTIFACTS, k, None, NS)


def put(mod, store, k=None, data=DATA):
    return store.put(
        ref(mod, k or key()),
        io.BytesIO(data),
        content_type="audio/ogg",
        sha256=hashlib.sha256(data).hexdigest(),
        size_bytes=len(data),
    )


def test_put_is_create_only_with_checksum(mod, bucket):
    info = put(mod, make(mod, bucket))
    sent = bucket.puts[0]
    assert sent["IfNoneMatch"] == "*"
    assert sent["Key"] == key() and sent["Bucket"] == BUCKET
    assert sent["ChecksumSHA256"]
    assert sent["ContentType"] == "audio/ogg"
    assert info.sha256 == DIGEST and info.version_id == "v1"
    assert bucket.objects[key()] == DATA


def test_412_with_identical_existing_object_is_success(mod, bucket):
    store = make(mod, bucket)
    put(mod, store)
    again = put(mod, store)  # the redelivered attempt writes the same bytes
    assert again.sha256 == DIGEST
    assert len(bucket.puts) == 2 and bucket.objects[key()] == DATA


def test_412_with_different_existing_object_is_a_conflict(mod, bucket):
    bucket.objects[key()] = b"someone else's bytes"
    with pytest.raises(mod.port.ObjectExists):
        put(mod, make(mod, bucket))
    assert bucket.objects[key()] == b"someone else's bytes"  # never overwritten


def test_412_verification_computes_the_hash_and_ignores_the_etag(mod, bucket):
    bucket.objects[key()] = b"x" * len(DATA)  # same size, other bytes
    bucket.etag_lies = True
    with pytest.raises(mod.port.ObjectExists):
        put(mod, make(mod, bucket))


def test_409_conflict_is_verified_like_a_412(mod, bucket):
    bucket.objects[key()] = DATA
    bucket.fail_put = ClientError("ConditionalRequestConflict", 409)
    assert put(mod, make(mod, bucket)).sha256 == DIGEST


def test_412_when_the_object_then_vanished_is_retryable(mod, bucket):
    class Vanishing(FakeBucket):
        def put_object(self, **kwargs):
            raise ClientError("PreconditionFailed", 412)

    with pytest.raises(mod.port.StorageUnavailable):
        put(mod, make(mod, Vanishing()))


@pytest.mark.parametrize(
    "bad",
    [
        key(attempt=OTHER),
        key(job=OTHER),
        key(ns="prod"),
        f"processing/artifacts/{NS}/capture/{uuid.uuid4()}.png",
        "assets/audio/npc-pip/x/audio.ogg",
        f"processing/quarantine/{NS}/x.ogg",
        f"processing/artifacts/{NS}/{JOB}/{ATTEMPT}/../{OTHER}/opus.ogg",
    ],
)
def test_keys_outside_the_attempt_prefix_are_refused_before_any_request(mod, bucket, bad):
    with pytest.raises(Exception) as refused:
        put(mod, make(mod, bucket), bad)
    assert isinstance(refused.value, (mod.port.StoragePermissionDenied, mod.port.StorageError)) or (
        refused.value.__class__.__name__ == "ProcessingError"
    )
    assert bucket.puts == [] and bucket.objects == {}


def test_other_stores_are_never_writable(mod, bucket):
    keys = {
        mod.Store.ASSETS: "assets/audio/npc-pip/x/audio.ogg",
        mod.Store.QUARANTINE: f"processing/quarantine/{NS}/x.ogg",
    }
    for store, other_key in keys.items():
        with pytest.raises(mod.port.StoragePermissionDenied):
            make(mod, bucket).put(
                mod.ObjectRef(store, other_key, None, NS),
                io.BytesIO(DATA),
                content_type="audio/ogg",
                sha256=DIGEST,
                size_bytes=len(DATA),
            )
    assert bucket.puts == []


def test_unbound_store_still_confined_to_the_namespace_and_not_capture(mod, bucket):
    store = make(mod, bucket, bound=False)
    put(mod, store, key(attempt=OTHER))  # any attempt of this namespace, nothing else
    with pytest.raises(mod.port.StoragePermissionDenied):
        put(mod, store, f"processing/artifacts/{NS}/capture/{uuid.uuid4()}.png")


def test_wrong_bytes_or_size_never_reach_s3(mod, bucket):
    store = make(mod, bucket)
    with pytest.raises(Exception, match="checksum|not valid|valid"):
        store.put(
            ref(mod, key()),
            io.BytesIO(DATA),
            content_type="audio/ogg",
            sha256="0" * 64,
            size_bytes=len(DATA),
        )
    assert bucket.puts == []


def test_a_403_on_put_is_permission_denied_not_success_or_missing(mod, bucket):
    bucket.fail_put = ClientError("AccessDenied", 403)
    with pytest.raises(mod.port.StoragePermissionDenied):
        put(mod, make(mod, bucket))
    assert not isinstance(mod.port.StoragePermissionDenied(), mod.port.ObjectMissing)


def test_a_403_on_head_is_not_missing(mod, bucket):
    asset = mod.ObjectRef(mod.Store.ASSETS, "assets/audio/a/b/audio.ogg", None, NS)
    bucket.fail_head = ClientError("403", 403)
    with pytest.raises(mod.port.StoragePermissionDenied):
        make(mod, bucket).head(asset)
    bucket.fail_head = ClientError("404", 404)
    with pytest.raises(mod.port.ObjectMissing):
        make(mod, bucket).head(asset)


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        (ClientError("SlowDown", 503), "ProcessingError"),
        (ClientError("InternalError", 500), "StorageUnavailable"),
    ],
)
def test_transient_failures_are_retryable(mod, bucket, error, expected):
    bucket.fail_put = error
    with pytest.raises(Exception) as raised:
        put(mod, make(mod, bucket))
    assert type(raised.value).__name__ == expected
    assert raised.value.retry_class.value == "retryable"


def test_the_worker_can_never_delete(mod, bucket):
    bucket.objects[key()] = DATA
    with pytest.raises(mod.port.StoragePermissionDenied):
        make(mod, bucket).delete(ref(mod, key()))
    assert bucket.deleted == [] and key() in bucket.objects


def test_reads_assets_input_and_own_artifacts(mod, bucket):
    bucket.objects["assets/audio/a/b/audio.ogg"] = DATA
    store = make(mod, bucket)
    asset = mod.ObjectRef(mod.Store.ASSETS, "assets/audio/a/b/audio.ogg", None, NS)
    assert store.head(asset).size_bytes == len(DATA)
    assert store.read(asset, max_bytes=1000) == DATA
    with pytest.raises(Exception, match="limit|valid"):
        store.read(asset, max_bytes=10)
    put(mod, store)
    assert store.read(ref(mod, key()), max_bytes=1000) == DATA


def test_runtime_builds_an_attempt_bound_store(worker, make_runtime, mod, fakes):
    runtime = make_runtime("media", LAI_ASSET_BUCKET=BUCKET)
    store = runtime.artifact_storage(NS, JOB, ATTEMPT)
    with pytest.raises(mod.port.StoragePermissionDenied):
        put(mod, store, key(attempt=OTHER))


def test_native_queues_and_kinds_are_known_to_the_worker(worker):
    env = worker.envelope
    assert {"audio", "image", "optimize"} <= env.QUEUES
    assert env.kinds_for_queue("audio") == {"asset.transcode_audio"}
    assert env.kinds_for_queue("image") == {"asset.convert_image"}
    assert env.kinds_for_queue("optimize") == {"asset.optimize"}
    settings = worker.aws.Settings(
        {
            "LAI_WORKER_QUEUE": "audio",
            "LAI_RESULTS_QUEUE_URL": "https://sqs.us-west-1.amazonaws.com/123456789012/r",
            "LAI_RESULTS_BUCKET": "results",
        }
    )
    assert settings.allowed_kinds == {"asset.transcode_audio"}
