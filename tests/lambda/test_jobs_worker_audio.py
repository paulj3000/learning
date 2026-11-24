"""`asset.process_audio` (LAI-LAMBDA-008 phase 1) through the packaged jobs worker
(`jobs_worker.handler`, imported from the staged zip) with fake S3 and SQS. The request is a real
ADR-061 `ProcessingJobRequest` built the way `apps.audio.inspection.inspection_request` builds it
(from `lai_processing` directly, so the test stays Django-free). Audio files come from
tests/processing/audio_builder.py."""

import hashlib
import importlib.util
import json
import sys
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

from jobs_worker_fakes import ASSET_BUCKET, RESULTS_BUCKET

ROOT = Path(__file__).resolve().parents[2]
NAMESPACE = "dev"
KIND = "asset.process_audio"


def _load_audio_builder():
    spec = importlib.util.spec_from_file_location(
        "lai_audio_builder_lambda", ROOT / "tests" / "processing" / "audio_builder.py"
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


audio = _load_audio_builder()


def audio_request(key: str, data: bytes, content_type: str, *, job_id: str) -> dict:
    from lai_processing.contracts.common import (
        AssetContext,
        InputObject,
        ObjectRef,
        ProfileRef,
        SubjectRef,
    )
    from lai_processing.contracts.jobs import ProcessingJobRequest
    from lai_processing.core.idempotency import idempotency_key
    from lai_processing.core.registry import default_registry

    version_id = str(uuid.uuid4())
    subject = SubjectRef(subject_type="asset_version", subject_id=version_id)
    profile_ref = ProfileRef("audio-inspect", 1)
    processor, profile = default_registry().resolve(KIND, profile_ref)
    options = profile.resolve_options({})
    source = InputObject(
        ref=ObjectRef("assets", key, None, NAMESPACE),
        content_type=content_type,
        size_bytes=len(data),
        sha256=hashlib.sha256(data).hexdigest(),
    )
    stamp = datetime.now(UTC).replace(microsecond=0)
    return ProcessingJobRequest(
        job_id=job_id,
        job_type=KIND,
        namespace=NAMESPACE,
        subject=subject,
        profile=profile_ref,
        idempotency_key=idempotency_key(
            namespace=NAMESPACE,
            job_type=KIND,
            subject=subject,
            profile=profile_ref,
            input=source,
            options=options,
            processor_version=processor.version,
        ),
        correlation_id=uuid.uuid4().hex,
        attempt_id=str(uuid.uuid4()),
        attempt_number=1,
        submitted_at=stamp - timedelta(minutes=1),
        input=source,
        asset=AssetContext(
            asset_id="coin-clink", asset_version_id=version_id, asset_version_number=1
        ),
        expires_at=stamp + timedelta(hours=72),
        options=options,
        limits=profile.limits,
    ).to_dict()


def submit(worker, fakes, data: bytes, content_type: str, extension: str):
    key = f"assets/audio/coin-clink/{uuid.uuid4()}/audio.{extension}"
    job_id = str(uuid.uuid4())
    fakes.s3.objects[(ASSET_BUCKET, key)] = data
    payload = audio_request(key, data, content_type, job_id=job_id)
    return job_id, json.dumps(worker.envelope.build_work(job_id, KIND, payload)), key


def result_of(fakes):
    from lai_processing.contracts.results import ProcessingJobResult

    return ProcessingJobResult.from_dict(fakes.sqs.sent[-1]["Body"]["result"])


def test_the_kind_is_a_media_kind_of_the_packaged_worker(worker):
    assert KIND in worker.envelope.kinds_for_queue("media")
    assert KIND in worker.tasks.RUNNERS


def test_each_format_is_inspected_from_the_zip(worker, fakes, make_runtime, context):
    cases = (
        (audio.wav(seconds=1.0), "audio/wav", "wav", "pcm"),
        (audio.mp3_vbr_xing(), "audio/mpeg", "mp3", "mp3"),
        (audio.ogg_opus(seconds=1.0), "audio/ogg", "ogg", "opus"),
    )
    for data, content_type, extension, codec in cases:
        job_id, body, key = submit(worker, fakes, data, content_type, extension)
        assert worker.handler.process(body, context, make_runtime("media")) == "succeeded"
        message = fakes.sqs.sent[-1]["Body"]
        assert message["job_id"] == job_id and message["kind"] == KIND
        result = result_of(fakes)
        assert result.verdict.value == "pass"
        assert result.processor.processor_id == "asset.audio_inspector"
        assert result.metadata["codec"] == codec
        assert result.input.verified and result.input.ref.key == key
        assert result.artifacts == ()
        stored = json.loads(fakes.s3.objects[(RESULTS_BUCKET, f"jobs/results/{job_id}.json")])
        assert stored == message
    # Read only: the worker wrote nothing but its own results.
    assert {(p["Bucket"], p["Key"].split("/")[0]) for p in fakes.s3.puts} == {
        (RESULTS_BUCKET, "jobs")
    }


def test_a_malformed_file_succeeds_with_verdict_fail(worker, fakes, make_runtime, context):
    _job_id, body, _key = submit(worker, fakes, audio.ogg_vorbis()[:-30], "audio/ogg", "ogg")
    assert worker.handler.process(body, context, make_runtime("media")) == "succeeded"
    result = result_of(fakes)
    assert result.verdict.value == "fail"
    assert "ogg_truncated" in {f.code for f in result.findings}


def test_audio_on_the_ai_queue_is_refused(worker, fakes, make_runtime, context):
    _job_id, body, _key = submit(worker, fakes, audio.wav(), "audio/wav", "wav")
    assert worker.handler.process(body, context, make_runtime("ai")) == "rejected"
    assert fakes.sqs.sent[-1]["Body"]["error"]["code"] == "wrong_queue"
