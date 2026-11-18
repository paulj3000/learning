"""The image worker, through the canonical `jobs_worker` handler, with fake AWS clients.

The `asset.convert_image` kind and the `image` queue are registered in the envelope by
Workstream A; these tests simulate that registration (and check that without it nothing runs)."""

import pytest

pytest.importorskip("PIL")

import hashlib  # noqa: E402
import importlib  # noqa: E402
import importlib.util  # noqa: E402
import io  # noqa: E402
import json  # noqa: E402
import sys  # noqa: E402
import uuid  # noqa: E402
from pathlib import Path  # noqa: E402
from types import SimpleNamespace  # noqa: E402

from builders import jpeg_with_gps  # noqa: E402
from PIL import Image  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
KEY = f"assets/images/hero/{uuid.UUID(int=5)}/image.jpeg"
JOB = str(uuid.UUID(int=9))


def _fakes():
    spec = importlib.util.spec_from_file_location(
        "native_image_fakes", ROOT / "tests" / "lambda" / "jobs_worker_fakes.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


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
    handler = importlib.import_module("image_worker.handler")
    task = importlib.import_module("image_worker.task")
    envelope = importlib.import_module("jobs_worker.vendor.jobs_core.envelope")
    yield SimpleNamespace(handler=handler, task=task, envelope=envelope, fakes=_fakes())
    sys.path.remove(str(staged))


@pytest.fixture
def registered(stack, monkeypatch):
    kind = stack.handler.KIND
    monkeypatch.setattr(stack.envelope, "KINDS", stack.envelope.KINDS | {kind})
    monkeypatch.setattr(stack.envelope, "KIND_QUEUE", {**stack.envelope.KIND_QUEUE, kind: "image"})
    stack.handler.register()
    yield
    stack.handler.tasks.RUNNERS.pop(kind, None)


def make(stack, data=None, sink=None, **env):
    fakes = stack.fakes
    s3, sqs = fakes.FakeS3(), fakes.FakeSQS()
    data = data if data is not None else jpeg_with_gps(6, 400, 300)
    s3.objects[(fakes.ASSET_BUCKET, KEY)] = data
    environment = {**fakes.environ("image"), **env}
    runtime = stack.handler.ImageRuntime(
        stack.handler.ImageSettings(environment), clients={"s3": s3, "sqs": sqs}, sink=sink
    )
    stack.handler.set_runtime(runtime)
    return s3, sqs, data


def message(stack, data, **payload):
    body = {
        "storage_key": KEY,
        "format": "jpeg",
        "size_bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "profiles": ["thumbnail-128", "convert-png"],
        **payload,
    }
    # built by hand: build_work binds the default `allowed_kinds` when it is defined
    work = {
        "schema": 1,
        "job_id": JOB,
        "kind": stack.handler.KIND,
        "attempt": 1,
        "submitted_at": "2026-11-18T00:00:00Z",
        "payload": body,
    }
    return {"Records": [{"messageId": "m1", "body": json.dumps(work)}]}


CONTEXT = SimpleNamespace(function_name="lai-dev-jobs-image", aws_request_id="r1")


def test_converts_and_reports_value_free_results(stack, registered):
    sink = stack.task.MemorySink()
    s3, sqs, data = make(stack, sink=sink)
    out = stack.handler.handle(message(stack, data), CONTEXT)
    assert out == {"batchItemFailures": []}
    final = sqs.sent[-1]["Body"]
    assert final["status"] == "succeeded" and final["error"] is None
    result = final["result"]
    assert result["verdict"] == "pass"
    assert [o["logicalId"] for o in result["outputs"]] == ["thumbnail-128", "convert-png"]
    assert result["source"]["gpsPresent"] is True and result["source"]["orientation"] == 6
    assert set(sink.objects) == {"thumbnail-128", "convert-png"}
    wire = json.dumps(sqs.sent)
    for secret in ("SecretMaker", "SecretComment", "37.0"):
        assert secret not in wire
    for _content_type, blob in sink.objects.values():
        assert Image.open(io.BytesIO(blob)).format in ("WEBP", "PNG")
    # the original object is untouched and nothing else was written to the asset bucket
    assert s3.objects[(stack.fakes.ASSET_BUCKET, KEY)] == data
    assert all(put["Bucket"] == stack.fakes.RESULTS_BUCKET for put in s3.puts)


def test_without_an_artifact_store_the_job_fails_safely(stack, registered):
    s3, sqs, data = make(stack)
    stack.handler.handle(message(stack, data), CONTEXT)
    final = sqs.sent[-1]["Body"]
    assert final["status"] == "failed"
    assert final["error"]["code"] == "artifact_store_unconfigured"


@pytest.mark.parametrize(
    ("change", "code"),
    [
        ({"sha256": "0" * 64}, "checksum_mismatch"),
        ({"size_bytes": 5}, "size_mismatch"),
        ({"format": "png"}, "invalid_payload"),
        ({"profiles": ["no-such"]}, "invalid_profile"),
        ({"profiles": []}, "invalid_payload"),
        ({"options": {"colour": "x"}}, "invalid_payload"),
        ({"options": {"max_side": 99999}}, "invalid_profile"),
    ],
)
def test_bad_requests_fail_without_converting(stack, registered, change, code):
    sink = stack.task.MemorySink()
    s3, sqs, data = make(stack, sink=sink)
    stack.handler.handle(message(stack, data, **change), CONTEXT)
    final = sqs.sent[-1]["Body"]
    assert (final["status"], final["error"]["code"]) == ("failed", code)
    assert sink.objects == {}


def test_malformed_and_missing_inputs(stack, registered):
    sink = stack.task.MemorySink()
    s3, sqs, data = make(stack, data=b"\xff\xd8\xff" + bytes(200), sink=sink)
    stack.handler.handle(message(stack, s3.objects[(stack.fakes.ASSET_BUCKET, KEY)]), CONTEXT)
    assert sqs.sent[-1]["Body"]["error"]["code"] == "malformed_image"
    del s3.objects[(stack.fakes.ASSET_BUCKET, KEY)]
    s3.objects.pop(
        (stack.fakes.RESULTS_BUCKET, f"jobs/results/{JOB}.json")
    )  # a new job, not a redelivery
    sqs.sent.clear()
    stack.handler.handle(message(stack, data), CONTEXT)
    assert sqs.sent[-1]["Body"]["error"]["code"] == "object_missing"


def test_redelivery_resends_the_stored_result_without_converting_again(stack, registered):
    sink = stack.task.MemorySink()
    s3, sqs, data = make(stack, sink=sink)
    event = message(stack, data)
    stack.handler.handle(event, CONTEXT)
    sink.objects.clear()
    stack.handler.handle(event, CONTEXT)
    assert sink.objects == {}  # no second conversion
    assert sqs.sent[-1]["Body"]["status"] == "succeeded"


def test_without_envelope_registration_nothing_runs(stack):
    s3, sqs, data = make(stack)
    stack.handler.tasks.RUNNERS.pop(stack.handler.KIND, None)
    out = stack.handler.handle(
        {"Records": [{"messageId": "m1", "body": json.dumps({"kind": "asset.convert_image"})}]},
        CONTEXT,
    )
    assert out == {"batchItemFailures": [{"itemIdentifier": "m1"}]}
    assert sqs.sent == []


def test_settings_require_the_image_queue_and_buckets(stack):
    environ = stack.fakes.environ("image")
    stack.handler.ImageSettings(environ)
    with pytest.raises(RuntimeError):
        stack.handler.ImageSettings({**environ, "LAI_WORKER_QUEUE": "media"})
    with pytest.raises(RuntimeError):
        stack.handler.ImageSettings({**environ, "LAI_ASSET_BUCKET": ""})


def test_runtime_refuses_other_kinds(stack):
    s3, sqs, data = make(stack)
    with pytest.raises(stack.handler.TaskError):
        stack.handler.runtime().ports("asset.inspect", CONTEXT)


def test_a_function_that_reads_only_never_needs_write_access_to_assets(stack, registered):
    # the asset ports expose reads only; there is no put on the asset bucket
    s3, sqs, data = make(stack)
    ports = stack.handler.runtime().ports(stack.handler.KIND, CONTEXT)
    assert not hasattr(ports, "put_asset")
    assert hasattr(ports, "artifacts")
