"""The audio worker function (`audio_worker.handler`) with fake S3 and SQS and a fake FFmpeg.

The jobs worker (imported from its staged zip layout by the `worker` fixture) provides envelope
handling, redelivery and result storage; the audio worker only adds its runner, ports and
registry. Workstream A's kind, queue and artifact put are stood in for locally (patched tables
and a fake `put_artifact`), exactly the seams the worker documents."""

import importlib
import json
import sys
import uuid
import zipfile
from pathlib import Path

import pytest
from jobs_worker_fakes import ASSET_BUCKET, FakeClientError, FakeS3, environ

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tests" / "processing_native"))
sys.path.insert(0, str(ROOT / "tests" / "processing"))
sys.path.append(str(ROOT / "lambda"))

import audio_builder as ab  # noqa: E402
import audio_jobs as jobs  # noqa: E402
from test_audio_processor import TOOL, FakeFfmpeg  # noqa: E402

KIND = jobs.KIND


class CreateOnlyS3(FakeS3):
    """Fake S3 with the conditional create the artifact store relies on (`IfNoneMatch="*"`)."""

    def put_object(self, Bucket, Key, Body, **kwargs):
        if kwargs.get("IfNoneMatch") == "*" and (Bucket, Key) in self.objects:
            raise FakeClientError("PreconditionFailed", 412)
        super().put_object(Bucket, Key, Body, **kwargs)
        return {"VersionId": f"v{len(self.puts)}"}

    def head_object(self, Bucket, Key, **kwargs):
        out = super().head_object(Bucket, Key)
        out["VersionId"] = "v1"
        return out

    def get_object(self, Bucket, Key, Range=None, **kwargs):
        return super().get_object(Bucket, Key, Range=Range)


@pytest.fixture
def audio(worker, fakes):
    fakes.s3 = CreateOnlyS3()
    handler = importlib.import_module("audio_worker.handler")
    from lai_native.audio.engine import AudioTranscodeProcessor
    from lai_processing.core.registry import ProcessorRegistry

    fake = FakeFfmpeg(after=[(-18.1, 2.0, -12.0, -11.5)])
    registry = ProcessorRegistry()
    registry.register(AudioTranscodeProcessor(TOOL, runner=fake, tool_version="7.1.5"))
    registry.freeze()
    handler.set_registry(registry)
    worker.tasks.RUNNERS[KIND] = handler.run_transcode
    yield handler, registry, fake
    handler.set_registry(None)
    worker.tasks.RUNNERS.pop(KIND, None)


def audio_env(**extra):
    return {**environ("audio"), **extra}


def make_runtime(worker, handler, fakes):
    return handler.AudioRuntime(
        worker.aws.Settings(audio_env()), clients={"s3": fakes.s3, "sqs": fakes.sqs}
    )


def work_body(worker, job_id, kind, payload):
    # `build_work` binds its default `allowed_kinds` at definition time, so build the envelope
    # by hand: the same fields, validated by the worker's own `parse_work` when it is read.
    return json.dumps(
        {
            "schema": 1,
            "job_id": job_id,
            "kind": kind,
            "attempt": 1,
            "submitted_at": worker.envelope.iso_now(),
            "payload": payload,
        }
    )


def submit(worker, fakes, registry, data, normalize=True):
    from lai_processing.contracts.common import ProfileRef

    processor, profile = registry.resolve(KIND, ProfileRef("audio-music", 1))
    key = f"assets/audio/coin-clink/{uuid.uuid4()}/audio.wav"
    fakes.s3.objects[(ASSET_BUCKET, key)] = data
    request = jobs.make_request(
        key, data, "audio/wav", "audio-music", processor, profile, options={"normalize": normalize}
    )
    job_id = request.job_id
    return job_id, work_body(worker, job_id, KIND, request.to_dict())


def test_ffmpeg_config_defaults_and_validates_the_pin(audio):
    handler = audio[0]
    assert handler.ffmpeg_config({}) == ("/opt/bin/ffmpeg", None)
    assert handler.ffmpeg_config(
        {"LAI_FFMPEG_PATH": "/x/ffmpeg", "LAI_FFMPEG_SHA256": "A" * 64}
    ) == (
        "/x/ffmpeg",
        "a" * 64,
    )
    with pytest.raises(RuntimeError):
        handler.ffmpeg_config({"LAI_FFMPEG_SHA256": "abc"})


def test_the_real_tables_know_the_kind_and_queue(worker):
    assert KIND in worker.envelope.KINDS
    assert worker.envelope.kinds_for_queue("audio") == {KIND}
    assert worker.aws.Settings(environ("audio")).allowed_kinds == {KIND}


def artifact_keys(fakes):
    return sorted(k for (b, k) in fakes.s3.objects if k.startswith("processing/artifacts/"))


def test_a_job_runs_end_to_end_through_the_real_artifact_store(worker, fakes, audio, context):
    handler, registry, fake = audio
    runtime = make_runtime(worker, handler, fakes)
    job_id, body = submit(worker, fakes, registry, ab.wav(seconds=6.0, rate=44_100, channels=2))
    assert worker.handler.process(body, context, runtime) == "succeeded"
    final = fakes.sqs.sent[-1]["Body"]
    assert final["job_id"] == job_id and final["kind"] == KIND and final["status"] == "succeeded"
    artifacts = final["result"]["artifacts"]
    assert {a["content_type"] for a in artifacts} == {"audio/ogg", "audio/mpeg", "application/json"}
    keys = artifact_keys(fakes)
    assert len(keys) == 3 and all(k.startswith(f"processing/artifacts/dev/{job_id}/") for k in keys)
    puts = [p for p in fakes.s3.puts if p["Key"].startswith("processing/artifacts/")]
    assert all(p.get("IfNoneMatch") == "*" and p.get("ChecksumSHA256") for p in puts)
    # Nothing but artifacts and the stored result was written; the input is untouched.
    assert {p["Key"] for p in fakes.s3.puts} == set(keys) | {f"jobs/results/{job_id}.json"}
    assert not [
        p
        for p in fakes.s3.puts
        if p["Bucket"] == ASSET_BUCKET and not p["Key"].startswith("processing/")
    ]


def test_normalize_false_reaches_the_processor(worker, fakes, audio, context):
    handler, registry, fake = audio
    runtime = make_runtime(worker, handler, fakes)
    _job_id, body = submit(
        worker, fakes, registry, ab.wav(seconds=6.0, rate=44_100, channels=2), normalize=False
    )
    assert worker.handler.process(body, context, runtime) == "succeeded"
    result = fakes.sqs.sent[-1]["Body"]["result"]
    assert result["metadata"]["normalize"] is False
    encodes = [c for c in fake.calls if "-c:a" in c]
    assert encodes and all("volume=" not in c[c.index("-af") + 1] for c in encodes)


def test_redelivery_resends_the_stored_result_without_running_ffmpeg_again(
    worker, fakes, audio, context
):
    handler, registry, fake = audio
    runtime = make_runtime(worker, handler, fakes)
    _job_id, body = submit(worker, fakes, registry, ab.wav(seconds=6.0, rate=44_100, channels=2))
    assert worker.handler.process(body, context, runtime) == "succeeded"
    calls, keys = len(fake.calls), artifact_keys(fakes)
    assert worker.handler.process(body, context, runtime) == "resent"
    assert len(fake.calls) == calls and artifact_keys(fakes) == keys


def test_a_retried_attempt_with_the_same_bytes_is_idempotent_and_other_bytes_conflict(
    worker, fakes, audio, context
):
    handler, registry, fake = audio
    runtime = make_runtime(worker, handler, fakes)
    job_id, body = submit(worker, fakes, registry, ab.wav(seconds=6.0, rate=44_100, channels=2))
    assert worker.handler.process(body, context, runtime) == "succeeded"
    # Lose the stored result so the same attempt runs again: identical bytes are a success.
    fakes.s3.objects.pop(
        (worker.aws.Settings(audio_env()).results_bucket, f"jobs/results/{job_id}.json")
    )
    assert worker.handler.process(body, context, runtime) == "succeeded"
    assert len(artifact_keys(fakes)) == 3
    # A different encoder output under an existing key is refused, never overwritten.
    fakes.s3.objects.pop(
        (worker.aws.Settings(audio_env()).results_bucket, f"jobs/results/{job_id}.json")
    )
    key = next(k for k in artifact_keys(fakes) if k.endswith("opus.ogg"))
    original = fakes.s3.objects[(ASSET_BUCKET, key)] = b"OggS-different-bytes-from-an-earlier-run"
    worker.handler.process(body, context, runtime)
    assert fakes.s3.objects[(ASSET_BUCKET, key)] == original
    assert fakes.sqs.sent[-1]["Body"]["status"] == "failed"
    assert fakes.sqs.sent[-1]["Body"]["error"]["code"] == "artifact_conflict"


def test_a_denied_artifact_write_is_a_permanent_failure(worker, fakes, audio, context):
    handler, registry, _fake = audio
    runtime = make_runtime(worker, handler, fakes)
    original = fakes.s3.put_object

    def deny(Bucket, Key, Body, **kwargs):
        if Key.startswith("processing/artifacts/"):
            raise FakeClientError("AccessDenied", 403)
        return original(Bucket, Key, Body, **kwargs)

    fakes.s3.put_object = deny
    _job_id, body = submit(worker, fakes, registry, ab.wav(seconds=6.0, rate=44_100, channels=2))
    worker.handler.process(body, context, runtime)
    final = fakes.sqs.sent[-1]["Body"]
    assert final["status"] == "failed" and final["error"]["code"] == "permission_denied"
    assert artifact_keys(fakes) == []


def test_a_job_for_another_kind_is_rejected_on_this_queue(worker, fakes, audio, context):
    handler, *_ = audio
    runtime = make_runtime(worker, handler, fakes)
    body = work_body(worker, str(uuid.uuid4()), "asset.process_audio", {"x": 1})
    assert worker.handler.process(body, context, runtime) == "rejected"
    assert fakes.sqs.sent[-1]["Body"]["error"]["code"] == "wrong_queue"


def test_invalid_payload_is_a_permanent_failure(worker, fakes, audio, context):
    handler, *_ = audio
    runtime = make_runtime(worker, handler, fakes)
    body = work_body(worker, str(uuid.uuid4()), KIND, {"nonsense": 1})
    worker.handler.process(body, context, runtime)
    assert fakes.sqs.sent[-1]["Body"]["error"]["code"] == "invalid_payload"


def test_the_batch_handler_reports_unreadable_messages(worker, fakes, audio, context):
    handler, *_ = audio
    worker.handler.set_runtime(make_runtime(worker, handler, fakes))
    try:
        out = handler.handle({"Records": [{"messageId": "m1", "body": "{not json"}]}, context)
    finally:
        worker.handler.set_runtime(None)
    assert out == {"batchItemFailures": [{"itemIdentifier": "m1"}]}


def test_the_zip_is_deterministic_and_has_no_binaries(tmp_path):
    build = importlib.import_module("audio_worker.build")
    assert build.zip_bytes() == build.zip_bytes()
    path = build.build(tmp_path)
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
    assert names == sorted(names)
    assert {
        "audio_worker/handler.py",
        "jobs_worker/handler.py",
        "lai_native/runtime/runner.py",
        "lai_native/audio/processor.py",
        "lai_processing/__init__.py",
    } <= set(names)
    assert not [n for n in names if n.endswith((".so", ".exe", ".bin")) or "bin/" in n]
    assert not [
        n
        for n in names
        if n.startswith("lai_native/")
        and not n.startswith(("lai_native/runtime/", "lai_native/audio/", "lai_native/__init__"))
    ]
    assert path.name.startswith("audio-worker-") and len(path.stem) == len("audio-worker-") + 16


def test_layer_check_accepts_a_valid_layer_and_refuses_gpl_or_tampering(tmp_path):
    import hashlib

    build = importlib.import_module("audio_worker.build")

    def make(record_patch=None, binary=b"ELF"):
        record = {
            "ffmpeg_version_line": "ffmpeg version 7.1.5",
            "arch": "aarch64",
            "ffmpeg_configuration": "configuration: --disable-autodetect",
            "files_sha256": {"bin/ffmpeg": hashlib.sha256(b"ELF").hexdigest()},
            **(record_patch or {}),
        }
        target = tmp_path / f"layer-{len(list(tmp_path.iterdir()))}.zip"
        with zipfile.ZipFile(target, "w") as z:
            z.writestr("bin/ffmpeg", binary)
            z.writestr("share/lai-ffmpeg/NOTICE.txt", "x")
            z.writestr("share/lai-ffmpeg/sbom.cdx.json", json.dumps({"bomFormat": "CycloneDX"}))
            z.writestr("share/lai-ffmpeg/build-record.json", json.dumps(record))
        return target

    assert build.check_layer(make())["arch"] == "aarch64"
    with pytest.raises(build.BuildError):
        build.check_layer(make({"ffmpeg_configuration": "--enable-gpl"}))
    with pytest.raises(build.BuildError):
        build.check_layer(make(binary=b"tampered"))


def test_worker_ports_carry_the_invocation_remaining_time_into_the_engine(
    worker, fakes, audio, context
):
    handler, registry, fake = audio
    runtime = make_runtime(worker, handler, fakes)
    ports = runtime.ports(KIND, context)
    assert ports.time_left_ms() == 290_000
    assert runtime.ports(KIND, object()).time_left_ms is None
    seen = []
    processor = registry.processors()[0]
    original = processor.set_time_source
    processor.set_time_source = lambda fn: (seen.append(fn), original(fn))[1]
    _job, body = submit(worker, fakes, registry, ab.wav(seconds=6.0, rate=44_100, channels=2))
    assert worker.handler.process(body, context, runtime) == "succeeded"
    assert seen[0] is not None and seen[0]() == 290_000 and seen[-1] is None  # set, then cleared


def test_the_cold_start_sweeps_leftover_workspaces(worker, fakes, audio, monkeypatch, tmp_path):
    handler, *_ = audio
    import lai_native.runtime as native

    swept = []
    monkeypatch.setattr(native, "sweep_stale", lambda base: swept.append(base) or 2)
    runtime = handler.AudioRuntime(
        worker.aws.Settings(audio_env()), clients={"s3": fakes.s3, "sqs": fakes.sqs}
    )
    assert swept == [handler.LAMBDA_TMP] and runtime.swept == 2


def test_the_worker_build_runs_the_import_policy_audit(monkeypatch):
    build = importlib.import_module("audio_worker.build")
    assert build.entries()
    jobs_build = build._jobs_build()
    monkeypatch.setattr(jobs_build, "audit_imports", lambda files=None: ["x.py: boto3 not allowed"])
    monkeypatch.setattr(build, "_jobs_build", lambda: jobs_build)
    with pytest.raises(build.BuildError):
        build.entries()
