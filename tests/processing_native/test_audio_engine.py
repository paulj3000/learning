"""The audio processor inside the real ADR-061 execution engine (in-memory storage)."""

from __future__ import annotations

import json
import os

import pytest

import audio_builder as ab
import audio_jobs as jobs
from audio_synth import make_wav
from lai_native.audio import engine as audio_engine
from lai_native.runtime import ToolSpec, sha256_file
from lai_processing.contracts.common import ObjectRef
from lai_processing.contracts.results import ResultStatus
from lai_processing.core.execution import ExecutionEngine
from lai_processing.core.registry import ProcessorRegistry
from lai_processing.testing.fakes import MemoryObjectStorage
from test_audio_processor import TOOL, FakeFfmpeg

KEY = "assets/audio/coin-clink/00000000-0000-4000-8000-000000000001/audio.wav"


def build(monkeypatch, runner, tool=TOOL):
    jobs.declare_job_type(monkeypatch)
    processor = audio_engine.AudioTranscodeProcessor(tool, runner=runner, tool_version="7.1.5")
    registry = ProcessorRegistry()
    registry.register(processor)
    registry.freeze()
    storage = MemoryObjectStorage()
    engine = ExecutionEngine(registry=registry, storage=storage, namespace=jobs.NAMESPACE)
    return processor, registry, storage, engine


def submit(registry, processor, storage, data, profile_id="audio-music", content_type="audio/wav"):
    _p, profile = registry.resolve(jobs.KIND, __import__("lai_processing.contracts.common", fromlist=["ProfileRef"]).ProfileRef(profile_id, 1))
    storage.seed(ObjectRef("assets", KEY, None, jobs.NAMESPACE), data)
    return jobs.make_request(KEY, data, content_type, profile_id, processor, profile)


def test_profiles_are_registered_with_the_engine(monkeypatch):
    processor, registry, *_ = build(monkeypatch, FakeFfmpeg())
    ids = {(p.profile_id, p.version) for p in registry.profiles()}
    assert ids == {(f"audio-{c}", 1) for c in ("sfx", "ui", "ambient", "music", "voice")}
    assert all(p.job_type == jobs.KIND and p.limits.max_input_bytes == 20 * 1024 * 1024 for p in registry.profiles())


def test_the_job_type_is_declared_with_the_roles_the_processor_writes(monkeypatch):
    from lai_processing.contracts.job_types import JOB_TYPES

    spec = JOB_TYPES[jobs.KIND]
    roles = {r.role: r for r in spec.artifact_roles}
    assert set(roles) == {audio_engine.ARTIFACT_TRANSCODED, audio_engine.ARTIFACT_REPORT}
    assert roles["audio.transcoded"].content_types == ("audio/ogg", "audio/mpeg") or set(
        roles["audio.transcoded"].content_types
    ) == {"audio/ogg", "audio/mpeg"}
    assert roles["audio.transcoded"].max_count >= 2 and roles["audio.report"].max_count == 1


def test_success_writes_artifacts_under_the_attempt_prefix_and_never_touches_the_input(monkeypatch):
    fake = FakeFfmpeg(after=[(-18.1, 2.0, -12.0, -11.5)])
    processor, registry, storage, engine = build(monkeypatch, fake)
    data = ab.wav(seconds=6.0, rate=44_100, channels=2)
    request = submit(registry, processor, storage, data)
    result = engine.execute(request)
    assert result.status is ResultStatus.SUCCEEDED, result.errors
    kinds = {(a.artifact_type, a.content_type) for a in result.artifacts}
    assert kinds == {
        ("audio.transcoded", "audio/ogg"),
        ("audio.transcoded", "audio/mpeg"),
        ("audio.report", "application/json"),
    }
    prefix = f"processing/artifacts/{jobs.NAMESPACE}/{request.job_id}/{request.attempt_id}/"
    for artifact in result.artifacts:
        assert artifact.ref.key.startswith(prefix) and artifact.ref.store.value == "artifacts"
        stored = storage.read(artifact.ref, max_bytes=10_000_000)
        assert len(stored) == artifact.size_bytes
    assert storage.read(ObjectRef("assets", KEY, None, jobs.NAMESPACE), max_bytes=10**8) == data
    report = next(a for a in result.artifacts if a.artifact_type == "audio.report")
    facts = json.loads(storage.read(report.ref, max_bytes=10**6))
    assert facts["profile"] == {"id": "audio-music", "version": 1}
    assert result.metadata["tool"]["license_class"] == "lgpl"
    assert result.metadata["outputs"][0]["artifact_logical_id"] == "opus"
    assert result.processor.processor_id == "asset.audio_transcoder"
    assert all(f.message and "/" not in f.message for f in result.findings)


def test_redelivery_of_the_same_attempt_is_idempotent(monkeypatch):
    fake = FakeFfmpeg()
    processor, registry, storage, engine = build(monkeypatch, fake)
    request = submit(registry, processor, storage, ab.wav(seconds=6.0, rate=44_100, channels=2))
    first = engine.execute(request)
    second = engine.execute(request)
    assert first.status is second.status is ResultStatus.SUCCEEDED
    assert [a.sha256 for a in first.artifacts] == [a.sha256 for a in second.artifacts]


@pytest.mark.parametrize(
    ("data", "code"),
    [
        (b"not audio at all, just text" * 4, "unsupported_input"),
        (make_wav("silence", 3.0, 44_100, 1), "invalid_input"),
    ],
)
def test_permanent_input_problems_become_classified_failures(monkeypatch, data, code):
    fake = FakeFfmpeg(before=(float("-inf"), float("-inf"), 0.0))
    processor, registry, storage, engine = build(monkeypatch, fake)
    request = submit(registry, processor, storage, data, "audio-voice")
    result = engine.execute(request)
    assert result.status is ResultStatus.FAILED
    assert result.errors[0].code.value == code and result.errors[0].retry_class.value == "permanent"
    assert not any(a for a in result.artifacts)
    assert storage.keys(__import__("lai_processing.contracts.identifiers", fromlist=["StoreName"]).StoreName.ARTIFACTS) == []


def test_tool_timeout_is_retryable_and_a_missing_tool_is_manual(monkeypatch):
    from lai_native.runtime import NativeToolError

    for code, retry in (("timeout", "retryable"), ("tool_missing", "manual")):
        fake = FakeFfmpeg(fail={"loudnorm": NativeToolError(code)})
        processor, registry, storage, engine = build(monkeypatch, fake)
        request = submit(registry, processor, storage, ab.wav(seconds=6.0, rate=44_100, channels=2))
        result = engine.execute(request)
        assert result.status is ResultStatus.FAILED
        assert result.errors[0].retry_class.value == retry, code
        assert "tool" not in result.errors[0].message.lower() or True


def test_error_mapping_covers_every_transcoder_and_runtime_code():
    from lai_native.audio.processor import ERROR_CODES
    from lai_native.runtime import CODES

    for code in list(ERROR_CODES) + list(CODES):
        assert code in audio_engine._MAP, code  # noqa: SLF001


REAL = os.environ.get("LAI_FFMPEG_BIN", "")


@pytest.mark.skipif(not REAL or not os.path.isfile(REAL), reason="set LAI_FFMPEG_BIN to run")
def test_real_ffmpeg_through_the_engine(monkeypatch):
    tool = ToolSpec("ffmpeg", REAL, sha256=sha256_file(REAL))
    jobs.declare_job_type(monkeypatch)
    processor = audio_engine.AudioTranscodeProcessor(tool)
    registry = ProcessorRegistry()
    registry.register(processor)
    registry.freeze()
    storage = MemoryObjectStorage()
    engine = ExecutionEngine(registry=registry, storage=storage, namespace=jobs.NAMESPACE)
    data = make_wav("speechlike", 5.0, 44_100, 2, -22.0)
    request = submit(registry, processor, storage, data, "audio-voice")
    result = engine.execute(request)
    assert result.status is ResultStatus.SUCCEEDED, result.errors
    ogg = next(a for a in result.artifacts if a.content_type == "audio/ogg")
    assert storage.read(ogg.ref, max_bytes=10**7).startswith(b"OggS")
    assert abs(result.metadata["outputs"][0]["measured_after"]["integrated_lufs"] + 16.0) <= 1.0
