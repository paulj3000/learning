"""The image worker end to end with fakes: the canonical `jobs_worker` handler, the ADR-061
engine, the real Pillow processor and A's create-only artifact store over a fake S3 bucket.
No network, no AWS."""

import hashlib
import importlib
import importlib.util
import io
import json
import sys
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest

pytest.importorskip("PIL")

from builders import encode, gradient, jpeg_with_gps, png_with_text  # noqa: E402
from PIL import Image  # noqa: E402

from lai_native.image import contract  # noqa: E402
from lai_processing.contracts.common import (  # noqa: E402
    AssetContext,
    InputObject,
    ObjectRef,
    ProfileRef,
    SubjectRef,
)
from lai_processing.contracts.jobs import ProcessingJobRequest  # noqa: E402
from lai_processing.core.idempotency import idempotency_key  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
NS = "dev"
BUCKET = "lai-assets"
RESULTS = "lai-results"
KEY = f"assets/images/hero/{uuid.UUID(int=5)}/image.jpeg"
ENV = {
    "LAI_WORKER_QUEUE": "image",
    "LAI_RESULTS_QUEUE_URL": "https://sqs.us-west-1.amazonaws.com/123456789012/results",
    "LAI_RESULTS_BUCKET": RESULTS,
    "LAI_ASSET_BUCKET": BUCKET,
}
CONTEXT = SimpleNamespace(function_name="lai-dev-jobs-image", aws_request_id="r1")


class ClientError(Exception):
    def __init__(self, code, status):
        super().__init__(code)
        self.response = {"Error": {"Code": code}, "ResponseMetadata": {"HTTPStatusCode": status}}


class FakeS3:
    """Both buckets, with S3's create-only `IfNoneMatch` semantics."""

    def __init__(self):
        self.objects: dict[tuple[str, str], bytes] = {}
        self.puts: list[dict] = []

    def get_object(self, Bucket, Key, Range=None, VersionId=None):
        if (Bucket, Key) not in self.objects:
            raise ClientError("NoSuchKey", 404)
        data = self.objects[(Bucket, Key)]
        if Range:
            start, end = (int(x) for x in Range.removeprefix("bytes=").split("-"))
            data = data[start : end + 1]
        return {"Body": io.BytesIO(data), "ContentLength": len(data)}

    def head_object(self, Bucket, Key, **kwargs):
        if (Bucket, Key) not in self.objects:
            raise ClientError("404", 404)
        return {"ContentLength": len(self.objects[(Bucket, Key)]), "VersionId": "v1"}

    def put_object(self, Bucket, Key, Body, **kwargs):
        self.puts.append({"Bucket": Bucket, "Key": Key, **kwargs})
        if kwargs.get("IfNoneMatch") == "*" and (Bucket, Key) in self.objects:
            raise ClientError("PreconditionFailed", 412)
        self.objects[(Bucket, Key)] = Body if isinstance(Body, bytes) else Body.encode()
        return {"VersionId": "v1"}


class FakeSQS:
    def __init__(self):
        self.sent: list[dict] = []

    def send_message(self, QueueUrl, MessageBody):
        self.sent.append(json.loads(MessageBody))
        return {"MessageId": "m"}


@pytest.fixture(scope="module")
def stack(tmp_path_factory):
    spec = importlib.util.spec_from_file_location(
        "lai_lambda_build_img", ROOT / "lambda" / "build.py"
    )
    build = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(build)
    staged = build.stage(tmp_path_factory.mktemp("image_worker"))
    sys.path.insert(0, str(staged))
    sys.path.append(str(ROOT / "lambda"))
    yield SimpleNamespace(
        handler=importlib.import_module("image_worker.handler"),
        jobs=importlib.import_module("jobs_worker.handler"),
        aws=importlib.import_module("jobs_worker.aws"),
        envelope=importlib.import_module("jobs_worker.vendor.jobs_core.envelope"),
    )
    sys.path.remove(str(staged))


@pytest.fixture
def world(stack):
    s3, sqs = FakeS3(), FakeSQS()
    runtime = stack.handler.ImageRuntime(stack.aws.Settings(ENV), clients={"s3": s3, "sqs": sqs})
    stack.jobs.set_runtime(runtime)
    stack.handler.set_registry(None)
    yield SimpleNamespace(s3=s3, sqs=sqs, stack=stack)
    stack.jobs.set_runtime(None)


def make_request(data, profile=contract.PROFILE_THUMBNAILS, options=None, *, attempt=None):
    declared = contract.PROFILE_DECLARATIONS[profile]
    resolved = dict(declared.resolve_options(options or {}))
    version_id = str(uuid.UUID(int=77))
    subject = SubjectRef("asset_version", version_id)
    ref = ProfileRef(*profile)
    source = InputObject(
        ObjectRef("assets", KEY, None, NS),
        "image/jpeg",
        len(data),
        hashlib.sha256(data).hexdigest(),
    )
    stamp = datetime.now(UTC).replace(microsecond=0)
    return ProcessingJobRequest(
        job_id=str(uuid.uuid4()),
        job_type=contract.JOB_TYPE,
        namespace=NS,
        subject=subject,
        profile=ref,
        idempotency_key=idempotency_key(
            namespace=NS,
            job_type=contract.JOB_TYPE,
            subject=subject,
            profile=ref,
            input=source,
            options=resolved,
            processor_version=contract.PROCESSOR_VERSION,
        ),
        correlation_id=uuid.uuid4().hex,
        attempt_id=attempt or str(uuid.uuid4()),
        attempt_number=1,
        submitted_at=stamp - timedelta(minutes=1),
        input=source,
        asset=AssetContext("hero", version_id, 1),
        expires_at=stamp + timedelta(hours=72),
        options=resolved,
        limits=contract.IMAGE_LIMITS,
    )


def event(request):
    work = {
        "schema": 1,
        "job_id": request.job_id,
        "kind": contract.JOB_TYPE,
        "attempt": 1,
        "submitted_at": "2026-11-18T00:00:00Z",
        "payload": request.to_dict(),
    }
    return {"Records": [{"messageId": "m1", "body": json.dumps(work)}]}


def run(world, data, **kwargs):
    world.s3.objects[(BUCKET, KEY)] = data
    request = make_request(data, **kwargs)
    out = world.stack.handler.handle(event(request), CONTEXT)
    final = [m for m in world.sqs.sent if m["status"] != "running"]
    return request, out, final[-1] if final else None


def artifact_objects(world):
    return {
        key: data
        for (bucket, key), data in world.s3.objects.items()
        if "processing/artifacts/" in key
    }


def test_thumbnails_are_written_create_only_and_referenced(world):
    data = jpeg_with_gps(6, 400, 300)
    request, out, final = run(world, data)
    assert out == {"batchItemFailures": []}
    assert final["status"] == "succeeded"
    result = final["result"]
    assert result["status"] == "succeeded" and result["verdict"] == "pass"
    refs = {a["logical_id"]: a for a in result["artifacts"]}
    assert set(refs) == {"thumb-128", "thumb-256", "thumb-512"}
    prefix = f"processing/artifacts/{NS}/{request.job_id}/{request.attempt_id}/"
    for logical, ref in refs.items():
        assert ref["artifact_type"] == "image.thumbnail"
        assert ref["ref"]["key"] == f"{prefix}{logical}.webp"
        assert ref["content_type"] == "image/webp"
        blob = world.s3.objects[(BUCKET, ref["ref"]["key"])]
        assert hashlib.sha256(blob).hexdigest() == ref["sha256"] and len(blob) == ref["size_bytes"]
        assert Image.open(io.BytesIO(blob)).size[0] <= 512
    puts = [p for p in world.s3.puts if p["Bucket"] == BUCKET]
    assert len(puts) == 3
    assert all(p["IfNoneMatch"] == "*" and "ChecksumSHA256" in p for p in puts)
    assert all(p["Key"].startswith(prefix) for p in puts)
    facts = result["metadata"]["artifact_facts"]["thumb-256"]
    # the original as stored, and the output with the orientation applied
    assert (facts["source_width"], facts["source_height"]) == (400, 300)
    assert (facts["width"], facts["height"]) == (192, 256) and facts["orientation"] == 6
    assert facts["sanitized"] is True and facts["format"] == "webp"
    assert result["metadata"]["source_flags"]["gpsPresent"] is True
    assert result["metadata"]["tool_versions"]["pillow"]


def test_the_original_and_other_keys_are_never_written(world):
    data = jpeg_with_gps(6, 400, 300)
    run(world, data)
    assert world.s3.objects[(BUCKET, KEY)] == data
    written = {p["Key"] for p in world.s3.puts if p["Bucket"] == BUCKET}
    assert written and all(k.startswith(f"processing/artifacts/{NS}/") for k in written)
    # the results bucket receives only the stored job result, through the shared handler
    assert {p["Key"] for p in world.s3.puts if p["Bucket"] == RESULTS} == {
        f"jobs/results/{k[1].split('/')[-1]}" for k in world.s3.objects if k[0] == RESULTS
    }


def test_no_metadata_in_stored_outputs_or_in_the_result(world):
    for data in (jpeg_with_gps(6, 200, 100), png_with_text()):
        world.s3.objects.clear()
        world.sqs.sent.clear()
        request, _out, final = run(
            world, data, profile=contract.PROFILE_CONVERT, options={"target_format": "png"}
        )
        assert final["status"] == "succeeded", final
        for blob in artifact_objects(world).values():
            for secret in (b"SecretMaker", b"SecretComment", b"SecretAuthor", b"SecretXMP", b"GPS"):
                assert secret not in blob
            image = Image.open(io.BytesIO(blob))
            assert len(image.getexif()) == 0
        wire = json.dumps(world.sqs.sent)
        for secret in ("SecretMaker", "SecretComment", "SecretAuthor", "37.0", "122.0"):
            assert secret not in wire


def test_convert_resize_and_data_options(world):
    data = encode(gradient(300, 200, "RGBA"), "PNG")
    key = f"assets/images/hero/{uuid.UUID(int=5)}/image.png"
    world.s3.objects[(BUCKET, key)] = data
    for profile, options, role, logical, size in (
        (
            contract.PROFILE_CONVERT,
            {"target_format": "jpeg"},
            "image.converted",
            "converted",
            (300, 200),
        ),
        (contract.PROFILE_RESIZE, {"max_side": 100}, "image.resized", "resized", (100, 67)),
        (
            contract.PROFILE_RESIZE,
            {"max_side": 64, "purpose": "data", "target_format": "png"},
            "image.resized",
            "resized",
            (64, 43),
        ),
    ):
        request = make_request(data, profile, options)
        request = ProcessingJobRequest.from_dict(
            {
                **request.to_dict(),
                "input": {
                    **request.to_dict()["input"],
                    "ref": {**request.to_dict()["input"]["ref"], "key": key},
                    "content_type": "image/png",
                },
            }
        )
        # the idempotency key covers the input ref: rebuild it for the PNG key
        import dataclasses

        request = dataclasses.replace(
            request,
            idempotency_key=idempotency_key(
                namespace=NS,
                job_type=contract.JOB_TYPE,
                subject=request.subject,
                profile=request.profile,
                input=request.input,
                options=dict(request.options),
                processor_version=contract.PROCESSOR_VERSION,
            ),
        )
        world.sqs.sent.clear()
        world.stack.handler.handle(event(request), CONTEXT)
        final = [m for m in world.sqs.sent if m["status"] != "running"][-1]
        assert final["status"] == "succeeded", final
        (ref,) = final["result"]["artifacts"]
        assert (ref["artifact_type"], ref["logical_id"]) == (role, logical)
        blob = world.s3.objects[(BUCKET, ref["ref"]["key"])]
        assert Image.open(io.BytesIO(blob)).size == size


def test_failures_are_classified_and_write_nothing(world):
    cases = [
        (b"\xff\xd8\xff" + bytes(300), "invalid_input"),
        (encode(Image.new("L", (4097, 4), 0), "PNG"), "resource_limit_exceeded"),
        (encode(gradient(), "GIF"), "unsupported_input"),
    ]
    for data, code in cases:
        world.s3.objects.clear()
        world.sqs.sent.clear()
        request, out, final = run(world, data)
        assert out == {"batchItemFailures": []}
        assert (final["status"], final["error"]["code"]) == ("failed", code), final
        assert artifact_objects(world) == {}


def test_a_changed_input_is_refused_by_the_engine(world):
    data = jpeg_with_gps(1, 200, 100)
    world.s3.objects[(BUCKET, KEY)] = data
    request = make_request(data)
    world.s3.objects[(BUCKET, KEY)] = data + b"x"  # replaced after the request was made
    world.stack.handler.handle(event(request), CONTEXT)
    final = [m for m in world.sqs.sent if m["status"] != "running"][-1]
    assert final["status"] == "failed" and final["error"]["code"] == "checksum_mismatch"
    assert artifact_objects(world) == {}


def test_redelivery_resends_the_stored_result_and_writes_nothing_more(world):
    data = jpeg_with_gps(1, 200, 100)
    world.s3.objects[(BUCKET, KEY)] = data
    request = make_request(data)
    world.stack.handler.handle(event(request), CONTEXT)
    puts = len(world.s3.puts)
    world.stack.handler.handle(event(request), CONTEXT)
    assert len(world.s3.puts) == puts
    assert world.sqs.sent[-1]["status"] == "succeeded"


def test_a_retry_attempt_rewrites_identical_bytes_idempotently(world):
    """The store accepts a 412 only when the existing bytes equal the new ones."""
    data = jpeg_with_gps(1, 200, 100)
    world.s3.objects[(BUCKET, KEY)] = data
    request = make_request(data)
    world.stack.handler.handle(event(request), CONTEXT)
    results = [k for k in world.s3.objects if k[1].startswith("jobs/results/")]
    for k in results:
        del world.s3.objects[k]  # the job result was lost, the artifacts remain
    world.sqs.sent.clear()
    world.stack.handler.handle(event(request), CONTEXT)
    final = [m for m in world.sqs.sent if m["status"] != "running"][-1]
    assert final["status"] == "succeeded"


def test_other_queues_and_kinds_are_refused(world, stack):
    with pytest.raises(stack.handler.TaskError):
        world.stack.jobs._runtime.ports("asset.inspect", CONTEXT)
    with pytest.raises(RuntimeError):
        stack.aws.Settings({**ENV, "LAI_WORKER_QUEUE": "nope"})


def test_payload_must_be_a_request_for_this_kind(world, stack):
    with pytest.raises(stack.handler.TaskError):
        stack.handler.run_convert({"x": 1}, None)
