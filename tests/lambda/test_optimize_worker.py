"""The optimize worker (`optimize_worker.handler`) with fake S3 and SQS and a fake gltfpack.

The jobs worker (imported from its staged zip layout by the `worker` fixture) provides envelope
handling, redelivery and result storage; the optimize worker adds its runner, ports and registry.
Artifacts go through Workstream A's real create-only store (`aws.Runtime.artifact_storage`) on the
fake S3 client. The kind and the `optimize` queue are Workstream A's real registrations."""

import hashlib
import importlib
import json
import sys
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from jobs_worker_fakes import ASSET_BUCKET, FakeClientError, FakeS3, environ

ROOT = Path(__file__).resolve().parents[2]
for extra in ("tests/native", "tests/processing"):
    if str(ROOT / extra) not in sys.path:
        sys.path.insert(0, str(ROOT / extra))
if str(ROOT / "lambda") not in sys.path:
    sys.path.append(str(ROOT / "lambda"))

from test_native_optimize_meshopt import FakeRun, compressed_grid  # noqa: E402

KIND = "asset.optimize"
NAMESPACE = "dev"


@pytest.fixture
def optimize(worker):
    handler = importlib.import_module("optimize_worker.handler")
    from lai_native.optimize import ToolPaths
    from lai_native.optimize.engine import GlbOptimizeProcessor
    from lai_processing.core.registry import ProcessorRegistry

    source, output = compressed_grid()
    fake = FakeRun(output)
    registry = ProcessorRegistry()
    registry.register(GlbOptimizeProcessor(ToolPaths(gltfpack=Path("/opt/bin/gltfpack")), run=fake))
    registry.freeze()
    handler.set_registry(registry)
    worker.tasks.RUNNERS[KIND] = handler.run_optimize
    yield handler, registry, fake, source, output
    handler.set_registry(None)


class ConditionalS3(FakeS3):
    """`FakeS3` plus what the create-only store sends: `ChecksumMode` on HEAD, `IfNoneMatch` on
    PUT (412 when the key exists) and a response dict."""

    def head_object(self, Bucket, Key, **_kwargs):
        return super().head_object(Bucket, Key)

    def put_object(self, Bucket, Key, Body, **kwargs):
        if kwargs.get("IfNoneMatch") == "*" and (Bucket, Key) in self.objects:
            raise FakeClientError("PreconditionFailed", 412)
        super().put_object(Bucket, Key, Body, **kwargs)
        return {}


@pytest.fixture
def fakes(fakes):
    fakes.s3 = ConditionalS3()
    return fakes


def make_runtime(handler, fakes, sweep_base=None):
    import tempfile

    return handler.OptimizeRuntime(
        handler.OptimizeSettings(environ("optimize")),
        clients={"s3": fakes.s3, "sqs": fakes.sqs},
        sweep_base=sweep_base or tempfile.mkdtemp(),  # never sweep the real /tmp in tests
    )


def test_init_sweeps_stale_workspaces(optimize, fakes, tmp_path):
    handler = optimize[0]
    (tmp_path / "lai-native-old").mkdir()
    (tmp_path / "keep-me").mkdir()
    runtime = make_runtime(handler, fakes, sweep_base=str(tmp_path))
    assert runtime.swept == 1
    assert not (tmp_path / "lai-native-old").exists() and (tmp_path / "keep-me").exists()


def request_for(registry, key, data, profile_id="meshopt-conservative"):
    from lai_processing.contracts.common import (
        AssetContext,
        InputObject,
        ObjectRef,
        ProfileRef,
        SubjectRef,
    )
    from lai_processing.contracts.jobs import ProcessingJobRequest
    from lai_processing.core.idempotency import idempotency_key

    processor, profile = registry.resolve(KIND, ProfileRef(profile_id, 1))
    version_id = str(uuid.uuid4())
    subject = SubjectRef(subject_type="asset_version", subject_id=version_id)
    source = InputObject(
        ref=ObjectRef("assets", key, None, NAMESPACE),
        content_type="model/gltf-binary",
        size_bytes=len(data),
        sha256=hashlib.sha256(data).hexdigest(),
    )
    options = profile.resolve_options({})
    stamp = datetime.now(UTC).replace(microsecond=0)
    return ProcessingJobRequest(
        job_id=str(uuid.uuid4()),
        job_type=KIND,
        namespace=NAMESPACE,
        subject=subject,
        profile=ProfileRef(profile_id, 1),
        idempotency_key=idempotency_key(
            namespace=NAMESPACE,
            job_type=KIND,
            subject=subject,
            profile=ProfileRef(profile_id, 1),
            input=source,
            options=options,
            processor_version=processor.version,
        ),
        correlation_id=uuid.uuid4().hex,
        attempt_id=str(uuid.uuid4()),
        attempt_number=1,
        submitted_at=stamp - timedelta(minutes=1),
        input=source,
        asset=AssetContext(asset_id="grid", asset_version_id=version_id, asset_version_number=1),
        expires_at=stamp + timedelta(hours=72),
        options=options,
        limits=profile.limits,
    )


def body_for(worker, request):
    return json.dumps(
        {
            "schema": 1,
            "job_id": request.job_id,
            "kind": KIND,
            "attempt": 1,
            "submitted_at": worker.envelope.iso_now(),
            "payload": request.to_dict(),
        }
    )


def submit(worker, fakes, registry, data, profile_id="meshopt-conservative"):
    key = f"assets/models/grid/{uuid.uuid4()}/model.glb"
    fakes.s3.objects[(ASSET_BUCKET, key)] = data
    request = request_for(registry, key, data, profile_id)
    return request, body_for(worker, request)


def test_settings_require_the_optimize_queue_and_validate_pins(optimize):
    handler = optimize[0]
    with pytest.raises(RuntimeError):
        handler.OptimizeSettings(environ("media"))
    with pytest.raises(RuntimeError):
        handler.OptimizeSettings({**environ("optimize"), "LAI_TOKTX_SHA256": "abc"})
    settings = handler.OptimizeSettings({**environ("optimize"), "LAI_GLTFPACK_SHA256": "A" * 64})
    assert settings.allowed_kinds == {KIND}
    tools = settings.tools()
    assert str(tools.gltfpack) == "/opt/bin/gltfpack" and tools.gltfpack_sha256 == "a" * 64
    assert str(tools.toktx) == "/opt/bin/toktx" and tools.library_path == "/opt/lib"


def test_a_job_writes_create_only_artifacts_under_the_attempt(worker, fakes, optimize, context):
    handler, registry, fake, source, output = optimize
    runtime = make_runtime(handler, fakes)
    request, body = submit(worker, fakes, registry, source)
    assert worker.handler.process(body, context, runtime) == "succeeded"
    final = fakes.sqs.sent[-1]["Body"]
    assert final["status"] == "succeeded" and final["kind"] == KIND
    result = final["result"]
    assert result["verdict"] == "pass"
    roles = {a["artifact_type"]: a for a in result["artifacts"]}
    assert set(roles) == {"model.optimized", "model.optimize_report"}
    prefix = f"processing/artifacts/{NAMESPACE}/{request.job_id}/{request.attempt_id}/"
    artifact_puts = [p for p in fakes.s3.puts if p["Key"].startswith("processing/artifacts/")]
    assert len(artifact_puts) == 2
    assert all(p["Key"].startswith(prefix) for p in artifact_puts)
    assert all(p.get("IfNoneMatch") == "*" for p in artifact_puts)
    assert fakes.s3.objects[(ASSET_BUCKET, prefix + "model.glb")] == output
    assert result["metadata"]["optimize"]["preserved"] is True
    assert result["processor"]["processor_id"] == "asset.glb_optimizer"
    # The source object is never written.
    assert not [p for p in fakes.s3.puts if p["Key"] == request.input.ref.key]


def test_redelivery_resends_without_running_gltfpack_again(worker, fakes, optimize, context):
    handler, registry, fake, source, _output = optimize
    runtime = make_runtime(handler, fakes)
    _request, body = submit(worker, fakes, registry, source)
    assert worker.handler.process(body, context, runtime) == "succeeded"
    calls = len(fake.calls)
    assert worker.handler.process(body, context, runtime) == "resent"
    assert len(fake.calls) == calls


def test_an_unhelpful_optimization_is_a_fail_verdict_without_artifacts(
    worker, fakes, optimize, context
):
    handler, registry, fake, source, _output = optimize
    fake.output = source  # gltfpack "output" no smaller than the source
    runtime = make_runtime(handler, fakes)
    _request, body = submit(worker, fakes, registry, source)
    assert worker.handler.process(body, context, runtime) == "succeeded"
    result = fakes.sqs.sent[-1]["Body"]["result"]
    assert result["verdict"] == "fail"
    assert result["artifacts"] == []
    assert [f["code"] for f in result["findings"]] == ["no_size_gain"]
    assert result["metadata"]["optimize"]["refused"] == "no_size_gain"
    assert not [p for p in fakes.s3.puts if p["Key"].startswith("processing/artifacts/")]


def test_a_tool_timeout_is_retried(worker, fakes, optimize, context):
    handler, registry, _fake, source, _output = optimize
    from lai_native.optimize import ToolPaths
    from lai_native.optimize.engine import GlbOptimizeProcessor
    from lai_native.runtime import NativeToolError
    from lai_processing.core.registry import ProcessorRegistry

    def timeout(*_args, **_kwargs):
        raise NativeToolError("timeout")

    slow = ProcessorRegistry()
    slow.register(GlbOptimizeProcessor(ToolPaths(gltfpack=Path("/opt/bin/gltfpack")), run=timeout))
    slow.freeze()
    handler.set_registry(slow)
    runtime = make_runtime(handler, fakes)
    _request, body = submit(worker, fakes, slow, source)
    with pytest.raises(Exception) as caught:
        worker.handler.process(body, context, runtime)
    assert getattr(caught.value, "retryable", False) is True


def test_wrong_kind_payload_is_refused(optimize, fakes):
    handler, *_ = optimize
    runtime = make_runtime(handler, fakes)
    ports = runtime.ports(KIND, None)
    with pytest.raises(Exception, match="invalid_payload"):
        handler.run_optimize({"job_type": "asset.inspect"}, ports)
    with pytest.raises(Exception, match="unknown_kind"):
        runtime.ports("asset.inspect", None)
