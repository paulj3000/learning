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
from types import MappingProxyType

import pytest
from jobs_worker_fakes import ASSET_BUCKET, environ

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tests" / "processing_native"))
sys.path.insert(0, str(ROOT / "tests" / "processing"))
sys.path.append(str(ROOT / "lambda"))

import audio_builder as ab  # noqa: E402
import audio_jobs as jobs  # noqa: E402
from test_audio_processor import TOOL, FakeFfmpeg  # noqa: E402

KIND = jobs.KIND


@pytest.fixture
def audio(worker, monkeypatch):
    jobs.declare_job_type(monkeypatch)
    env = worker.envelope
    monkeypatch.setattr(env, "KIND_QUEUE", MappingProxyType({**env.KIND_QUEUE, KIND: "audio"}))
    monkeypatch.setattr(env, "KINDS", frozenset(env.KIND_QUEUE))
    monkeypatch.setattr(env, "QUEUES", frozenset(env.KIND_QUEUE.values()))
    handler = importlib.import_module("audio_worker.handler")
    storage = importlib.import_module("audio_worker.storage")
    from lai_native.audio.engine import AudioTranscodeProcessor
    from lai_processing.core.registry import ProcessorRegistry

    fake = FakeFfmpeg(after=[(-18.1, 2.0, -12.0, -11.5)])
    registry = ProcessorRegistry()
    registry.register(AudioTranscodeProcessor(TOOL, runner=fake, tool_version="7.1.5"))
    registry.freeze()
    handler.set_registry(registry)
    worker.tasks.RUNNERS[KIND] = handler.run_transcode
    yield handler, storage, registry, fake
    handler.set_registry(None)
    worker.tasks.RUNNERS.pop(KIND, None)


def audio_env(**extra):
    return {**environ("audio"), "LAI_FFMPEG_PATH": "/opt/bin/ffmpeg", **extra}


def make_runtime(worker, handler, fakes, puts):
    runtime = handler.AudioRuntime(
        handler.AudioSettings(audio_env()), clients={"s3": fakes.s3, "sqs": fakes.sqs}
    )

    def put_artifact(key, data, *, content_type, sha256):
        if any(k == key for k, *_ in puts):
            raise worker.tasks.TaskError("artifact_exists")
        puts.append((key, data, content_type, sha256))
        return f"ver-{len(puts)}"

    runtime.put_artifact = put_artifact
    return runtime


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


def submit(worker, fakes, registry, data):
    from lai_processing.contracts.common import ProfileRef

    processor, profile = registry.resolve(KIND, ProfileRef("audio-music", 1))
    key = f"assets/audio/coin-clink/{uuid.uuid4()}/audio.wav"
    fakes.s3.objects[(ASSET_BUCKET, key)] = data
    request = jobs.make_request(key, data, "audio/wav", "audio-music", processor, profile)
    job_id = request.job_id
    return job_id, work_body(worker, job_id, KIND, request.to_dict())


def test_settings_require_the_audio_queue_and_validate_the_pin(audio):
    handler = audio[0]
    with pytest.raises(RuntimeError):
        handler.AudioSettings(environ("media"))
    with pytest.raises(RuntimeError):
        handler.AudioSettings({**audio_env(), "LAI_FFMPEG_SHA256": "abc"})
    settings = handler.AudioSettings(audio_env(LAI_FFMPEG_SHA256="A" * 64))
    assert settings.ffmpeg_sha256 == "a" * 64 and settings.allowed_kinds == {KIND}


def test_a_job_runs_end_to_end_and_publishes_artifact_references(worker, fakes, audio, context):
    handler, _storage, registry, fake = audio
    puts: list = []
    runtime = make_runtime(worker, handler, fakes, puts)
    job_id, body = submit(worker, fakes, registry, ab.wav(seconds=6.0, rate=44_100, channels=2))
    assert worker.handler.process(body, context, runtime) == "succeeded"
    final = fakes.sqs.sent[-1]["Body"]
    assert final["job_id"] == job_id and final["kind"] == KIND and final["status"] == "succeeded"
    artifacts = final["result"]["artifacts"]
    assert {a["content_type"] for a in artifacts} == {"audio/ogg", "audio/mpeg", "application/json"}
    assert len(puts) == 3
    for key, _data, _content_type, _digest in puts:
        assert key.startswith(f"processing/artifacts/dev/{job_id}/")
    # The worker wrote nothing to the asset bucket and its stored result matches what it sent.
    assert not [p for p in fakes.s3.puts if p["Bucket"] == ASSET_BUCKET]
    assert (fakes.s3.puts[-1]["Key"]).endswith(f"{job_id}.json")


def test_redelivery_resends_the_stored_result_without_running_ffmpeg_again(worker, fakes, audio, context):
    handler, _storage, registry, fake = audio
    puts: list = []
    runtime = make_runtime(worker, handler, fakes, puts)
    _job_id, body = submit(worker, fakes, registry, ab.wav(seconds=6.0, rate=44_100, channels=2))
    assert worker.handler.process(body, context, runtime) == "succeeded"
    calls = len(fake.calls)
    assert worker.handler.process(body, context, runtime) == "resent"
    assert len(fake.calls) == calls and len(puts) == 3


def test_missing_artifact_put_fails_closed_with_a_safe_code(worker, fakes, audio, context):
    handler, _storage, registry, _fake = audio
    runtime = handler.AudioRuntime(
        handler.AudioSettings(audio_env()), clients={"s3": fakes.s3, "sqs": fakes.sqs}
    )  # no put_artifact: Workstream A's adapter is not wired
    _job_id, body = submit(worker, fakes, registry, ab.wav(seconds=6.0, rate=44_100, channels=2))
    worker.handler.process(body, context, runtime)
    final = fakes.sqs.sent[-1]["Body"]
    assert final["status"] == "failed" and final["error"]["code"] == "permission_denied"


def test_a_job_for_another_kind_is_rejected_on_this_queue(worker, fakes, audio, context):
    handler, *_ = audio
    runtime = make_runtime(worker, handler, fakes, [])
    body = work_body(worker, str(uuid.uuid4()), "asset.process_audio", {"x": 1})
    assert worker.handler.process(body, context, runtime) == "rejected"
    assert fakes.sqs.sent[-1]["Body"]["error"]["code"] == "wrong_queue"


def test_invalid_payload_is_a_permanent_failure(worker, fakes, audio, context):
    handler, *_ = audio
    runtime = make_runtime(worker, handler, fakes, [])
    body = work_body(worker, str(uuid.uuid4()), KIND, {"nonsense": 1})
    worker.handler.process(body, context, runtime)
    assert fakes.sqs.sent[-1]["Body"]["error"]["code"] == "invalid_payload"


def test_the_batch_handler_reports_unreadable_messages(worker, fakes, audio, context, monkeypatch):
    handler, *_ = audio
    worker.handler.set_runtime(make_runtime(worker, handler, fakes, []))
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
    assert {"audio_worker/handler.py", "jobs_worker/handler.py", "lai_native/runtime/runner.py",
            "lai_native/audio/processor.py", "lai_processing/__init__.py"} <= set(names)
    assert not [n for n in names if n.endswith((".so", ".exe", ".bin")) or "bin/" in n]
    assert not [n for n in names if n.startswith("lai_native/") and not n.startswith(
        ("lai_native/runtime/", "lai_native/audio/", "lai_native/__init__"))]
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
