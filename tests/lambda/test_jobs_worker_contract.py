"""The ADR-064 contract kinds (`asset.validate_model`, `reference.checksum`) through the packaged
jobs worker (`jobs_worker.handler`) with fake S3 and SQS. Requests are real ADR-061
`ProcessingJobRequest`s built the way `apps.assets.processing.model_validation_request` builds
them (here from `lai_processing` directly, so the test stays Django-free); the models are real
GLBs from tests/processing/glb_builder.py. Outcomes follow docs/processing/CANONICAL_PATH.md and
lai/apps/jobs/core/contract.py: a refused model is a succeeded job with verdict `fail`, a missing
input is a permanent `failed` result, a transient storage fault is retried by SQS."""

import hashlib
import importlib.util
import json
import sys
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from jobs_worker_fakes import ASSET_BUCKET, RESULTS_BUCKET, FakeClientError

ROOT = Path(__file__).resolve().parents[2]


def _load_glb_builder():
    spec = importlib.util.spec_from_file_location(
        "lai_glb_builder", ROOT / "tests" / "processing" / "glb_builder.py"
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module  # dataclasses look their module up while decorating
    spec.loader.exec_module(module)
    return module


glb_builder = _load_glb_builder()
NAMESPACE = "dev"
PROFILES = {
    "asset.validate_model": ("glb-default", 1),
    "reference.checksum": ("reference-default", 1),
    "asset.analyze_animation": ("animation-default", 1),
}


def asset_key() -> str:
    return f"assets/models/pip-boat/{uuid.uuid4()}/model.glb"


def contract_request(kind: str, key: str, data: bytes, *, job_id: str, expires_in=None) -> dict:
    """An ADR-061 request dict, as `apps.assets.processing.model_validation_request` builds it."""
    # Imported after the `worker` fixture put the staged zip first on sys.path.
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
    profile_ref = ProfileRef(*PROFILES[kind])
    processor, profile = default_registry().resolve(kind, profile_ref)
    options = profile.resolve_options({})
    source = InputObject(
        ref=ObjectRef("assets", key, None, NAMESPACE),
        content_type="model/gltf-binary",
        size_bytes=len(data),
        sha256=hashlib.sha256(data).hexdigest(),
    )
    stamp = datetime.now(UTC).replace(microsecond=0)
    request = ProcessingJobRequest(
        job_id=job_id,
        job_type=kind,
        namespace=NAMESPACE,
        subject=subject,
        profile=profile_ref,
        idempotency_key=idempotency_key(
            namespace=NAMESPACE,
            job_type=kind,
            subject=subject,
            profile=profile_ref,
            input=source,
            options=options,
            processor_version=processor.version,
        ),
        correlation_id=uuid.uuid4().hex,
        attempt_id=str(uuid.uuid4()),
        attempt_number=1,
        submitted_at=stamp - timedelta(minutes=5),
        input=source,
        asset=AssetContext(
            asset_id="pip-boat", asset_version_id=version_id, asset_version_number=1
        ),
        expires_at=stamp + (expires_in if expires_in is not None else timedelta(hours=72)),
        options=options,
        limits=profile.limits,
    )
    return request.to_dict()


def submit(worker, fakes, kind="asset.validate_model", data=None, *, store=True, **kwargs):
    """(job_id, work body, key) for one contract job whose input is `data` in the asset bucket."""
    data = glb_builder.skinned_glb() if data is None else data
    key, job_id = asset_key(), str(uuid.uuid4())
    if store:
        fakes.s3.objects[(ASSET_BUCKET, key)] = data
    payload = contract_request(kind, key, data, job_id=job_id, **kwargs)
    return job_id, json.dumps(worker.envelope.build_work(job_id, kind, payload)), key


def statuses(fakes):
    return [m["Body"]["status"] for m in fakes.sqs.sent]


def decode(result: dict):
    from lai_processing.contracts.results import ProcessingJobResult

    return ProcessingJobResult.from_dict(result)


def results_stored(fakes):
    return [k for (_b, k) in fakes.s3.objects if k.startswith("jobs/results/")]


# --- asset.validate_model ------------------------------------------------------------------------


def test_a_valid_model_succeeds_with_verdict_pass_and_exact_clip_names(
    worker, fakes, make_runtime, context
):
    clips = (glb_builder.MIXAMO_CLIP, "Walk")
    job_id, body, key = submit(worker, fakes, data=glb_builder.skinned_glb(clips))
    assert worker.handler.process(body, context, make_runtime("media")) == "succeeded"
    assert statuses(fakes) == ["running", "succeeded"]
    message = fakes.sqs.sent[-1]["Body"]
    assert message["job_id"] == job_id and message["kind"] == "asset.validate_model"
    assert message["error"] is None and message["result_s3_key"] is None
    result = decode(message["result"])  # a valid ADR-061 ProcessingJobResult
    assert result.job_id == job_id and result.status.value == "succeeded"
    assert result.verdict.value == "pass"
    assert result.processor.processor_id == "asset.glb_validator"
    assert [a["name"] for a in result.metadata["animations"]] == list(clips)
    assert result.input.verified and result.input.ref.key == key
    stored = json.loads(fakes.s3.objects[(RESULTS_BUCKET, f"jobs/results/{job_id}.json")])
    assert stored == message
    # Read only: the worker wrote nothing but its own result.
    assert {(p["Bucket"], p["Key"].split("/")[0]) for p in fakes.s3.puts} == {
        (RESULTS_BUCKET, "jobs")
    }


def test_a_model_the_validator_refuses_succeeds_with_verdict_fail(
    worker, fakes, make_runtime, context
):
    broken = glb_builder.glb(*glb_builder.static_model(), version=1)
    _job_id, body, _key = submit(worker, fakes, data=broken)
    assert worker.handler.process(body, context, make_runtime("media")) == "succeeded"
    result = decode(fakes.sqs.sent[-1]["Body"]["result"])
    assert result.verdict.value == "fail"
    assert "glb_version" in {finding.code for finding in result.findings}


def test_a_missing_object_is_a_permanent_failed_result(worker, fakes, make_runtime, context):
    # ObjectMissing -> input_missing (RetryClass.MANUAL): not retried by SQS (CANONICAL_PATH:
    # "a permanent, cancelled or manual failure ... becomes a schema-1 failed result").
    job_id, body, _key = submit(worker, fakes, store=False)
    assert worker.handler.process(body, context, make_runtime("media")) == "failed"
    message = fakes.sqs.sent[-1]["Body"]
    assert statuses(fakes) == ["running", "failed"]
    assert message["error"]["code"] == "input_missing" and message["result"] is None
    assert results_stored(fakes) == [f"jobs/results/{job_id}.json"]


def test_an_expired_request_is_a_permanent_failed_result(worker, fakes, make_runtime, context):
    _job_id, body, _key = submit(worker, fakes, expires_in=timedelta(minutes=-1))
    assert worker.handler.process(body, context, make_runtime("media")) == "failed"
    assert fakes.sqs.sent[-1]["Body"]["error"]["code"] == "job_expired"


def test_a_changed_object_is_a_checksum_mismatch(worker, fakes, make_runtime, context):
    _job_id, body, key = submit(worker, fakes)
    data = fakes.s3.objects[(ASSET_BUCKET, key)]
    fakes.s3.objects[(ASSET_BUCKET, key)] = data[:-4] + b"\xff\xff\xff\xff"
    assert worker.handler.process(body, context, make_runtime("media")) == "failed"
    assert fakes.sqs.sent[-1]["Body"]["error"]["code"] == "checksum_mismatch"


def test_storage_unavailable_on_head_is_retried_by_sqs(worker, fakes, make_runtime, context):
    # StorageUnavailable -> storage_failure (RETRYABLE): the work raises, nothing is stored.
    _job_id, body, _key = submit(worker, fakes)

    def head_fails(Bucket, Key):
        raise FakeClientError("InternalError", 500)

    fakes.s3.head_object = head_fails
    with pytest.raises(worker.tasks.TaskError) as raised:
        worker.handler.process(body, context, make_runtime("media"))
    assert raised.value.code == "storage_failure" and raised.value.retryable
    assert statuses(fakes) == ["running"] and results_stored(fakes) == []


def test_a_read_failure_while_copying_the_input_is_retried_by_sqs(
    worker, fakes, make_runtime, context
):
    # A transient GET error in the middle of the copy is a storage fault, not an unexpected one.
    _job_id, body, _key = submit(worker, fakes)
    original = fakes.s3.get_object

    def get_fails_for_assets(Bucket, Key, Range=None):
        if Bucket == ASSET_BUCKET:
            raise FakeClientError("InternalError", 500)
        return original(Bucket=Bucket, Key=Key, Range=Range)

    fakes.s3.get_object = get_fails_for_assets
    with pytest.raises(worker.tasks.TaskError) as raised:
        worker.handler.process(body, context, make_runtime("media"))
    assert raised.value.code == "storage_failure" and raised.value.retryable
    assert results_stored(fakes) == []
    fakes.s3.get_object = original  # the redelivery then succeeds
    assert worker.handler.process(body, context, make_runtime("media")) == "succeeded"


def test_a_redelivery_resends_the_stored_result_without_a_second_run(
    worker, fakes, make_runtime, context
):
    _job_id, body, _key = submit(worker, fakes)
    rt = make_runtime("media")
    worker.handler.process(body, context, rt)
    heads = {"n": 0}
    original = fakes.s3.head_object

    def counting(Bucket, Key):
        heads["n"] += 1
        return original(Bucket=Bucket, Key=Key)

    fakes.s3.head_object = counting
    assert worker.handler.process(body, context, rt) == "resent"
    assert heads["n"] == 0  # the asset was not read again
    assert statuses(fakes) == ["running", "succeeded", "succeeded"]
    assert fakes.sqs.sent[1]["Body"] == fakes.sqs.sent[2]["Body"]


def test_a_contract_kind_on_the_ai_queue_is_wrong_queue(worker, fakes, make_runtime, context):
    for kind in ("asset.validate_model", "reference.checksum"):
        _job_id, body, _key = submit(worker, fakes, kind)
        assert worker.handler.process(body, context, make_runtime("ai")) == "rejected"
        message = fakes.sqs.sent[-1]["Body"]
        assert message["kind"] == kind and message["error"]["code"] == "wrong_queue"
    assert "running" not in statuses(fakes)


def test_a_request_of_another_kind_is_an_invalid_payload(worker, fakes, make_runtime, context):
    data = glb_builder.skinned_glb()
    key, job_id = asset_key(), str(uuid.uuid4())
    fakes.s3.objects[(ASSET_BUCKET, key)] = data
    payload = contract_request("reference.checksum", key, data, job_id=job_id)
    body = json.dumps(worker.envelope.build_work(job_id, "asset.validate_model", payload))
    assert worker.handler.process(body, context, make_runtime("media")) == "failed"
    assert fakes.sqs.sent[-1]["Body"]["error"]["code"] == "invalid_payload"


# --- reference.checksum ---------------------------------------------------------------------------


def test_reference_checksum_through_the_worker(worker, fakes, make_runtime, context):
    data = b"Learning makes the island grow.\n" * 64
    job_id, body, _key = submit(worker, fakes, "reference.checksum", data)
    assert worker.handler.process(body, context, make_runtime("media")) == "succeeded"
    result = decode(fakes.sqs.sent[-1]["Body"]["result"])
    assert result.job_id == job_id and result.verdict.value == "pass"
    assert result.metadata["sha256"] == hashlib.sha256(data).hexdigest()
    assert result.metadata["byte_count"] == len(data)
    assert result.metadata["checksum_verified"] is True


# --- asset.analyze_animation (LAI-LAMBDA-009) -------------------------------------------------


def test_animation_inspection_runs_in_the_packaged_worker(worker, fakes, make_runtime, context):
    clips = (glb_builder.MIXAMO_CLIP, "Idle")
    job_id, body, key = submit(
        worker, fakes, "asset.analyze_animation", glb_builder.skinned_glb(clips)
    )
    assert worker.handler.process(body, context, make_runtime("media")) == "succeeded"
    assert statuses(fakes) == ["running", "succeeded"]
    message = fakes.sqs.sent[-1]["Body"]
    assert message["kind"] == "asset.analyze_animation" and message["job_id"] == job_id
    result = decode(message["result"])
    assert result.processor.processor_id == "asset.animation_inspector"
    assert result.verdict.value == "pass" and result.input.verified
    assert [c["name"] for c in result.metadata["clips"]] == list(clips)
    assert [c["generic_name"] for c in result.metadata["clips"]] == [True, False]
    assert result.metadata["skins"][0]["joint_count"] == 2
    # Read only: nothing but the worker's own result was written.
    assert {(p["Bucket"], p["Key"].split("/")[0]) for p in fakes.s3.puts} == {
        (RESULTS_BUCKET, "jobs")
    }


def test_animation_inspection_of_broken_data_is_a_fail_verdict(
    worker, fakes, make_runtime, context
):
    document, binary = glb_builder.skinned_model(("Idle",))
    document["animations"][0]["samplers"][0]["interpolation"] = "BEZIER"
    data = glb_builder.glb(document, binary)
    _job_id, body, _key = submit(worker, fakes, "asset.analyze_animation", data)
    assert worker.handler.process(body, context, make_runtime("media")) == "succeeded"
    result = decode(fakes.sqs.sent[-1]["Body"]["result"])
    assert result.verdict.value == "fail"
    assert "unsupported_interpolation" in {finding.code for finding in result.findings}


def test_animation_inspection_is_refused_on_the_ai_queue(worker, fakes, make_runtime, context):
    _job_id, body, _key = submit(worker, fakes, "asset.analyze_animation")
    assert worker.handler.process(body, context, make_runtime("ai")) == "rejected"
    assert fakes.sqs.sent[-1]["Body"]["error"]["code"] == "wrong_queue"


# --- result size ----------------------------------------------------------------------------------


def large_model() -> bytes:
    """150 clips with long unique names: the metadata list cap and long names, near the
    profile's 64 KiB metadata budget."""
    clips = tuple(f"clip-{n:03d}-" + "x" * 180 for n in range(150))
    return glb_builder.skinned_glb(clips)


def test_a_large_metadata_result_stays_inline_under_the_200_kb_limit(
    worker, fakes, make_runtime, context
):
    _job_id, body, _key = submit(worker, fakes, data=large_model())
    assert worker.handler.process(body, context, make_runtime("media")) == "succeeded"
    message = fakes.sqs.sent[-1]["Body"]
    assert message["result"] is not None and message["result_s3_key"] is None
    encoded = len(worker.envelope.encode(message).encode())
    assert encoded <= worker.envelope.INLINE_RESULT_LIMIT
    result = decode(message["result"])
    assert len(result.metadata["animations"]) == 100  # MAX_LISTED
    assert encoded > 20_000  # the case really is large


def test_a_result_over_the_inline_limit_travels_as_an_s3_pointer(
    worker, fakes, make_runtime, context, monkeypatch
):
    monkeypatch.setattr(worker.envelope, "INLINE_RESULT_LIMIT", 4096)
    job_id, body, _key = submit(worker, fakes, data=large_model())
    assert worker.handler.process(body, context, make_runtime("media")) == "succeeded"
    message = fakes.sqs.sent[-1]["Body"]
    assert message["result"] is None
    assert message["result_s3_key"] == f"jobs/results/{job_id}.json"
    stored = json.loads(fakes.s3.objects[(RESULTS_BUCKET, message["result_s3_key"])])
    assert stored["result_s3_key"] is None
    assert decode(stored["result"]).verdict.value in {"pass", "fail"}


# --- batches --------------------------------------------------------------------------------------


def test_the_handler_reports_only_the_retryable_item_as_a_batch_failure(
    worker, fakes, make_runtime, context
):
    _good_id, good, _key = submit(worker, fakes)
    _missing_id, missing, _key = submit(worker, fakes, store=False)
    _flaky_id, flaky, flaky_key = submit(worker, fakes)
    original = fakes.s3.head_object

    def head(Bucket, Key):
        if Key == flaky_key:
            raise FakeClientError("SlowDown", 503)
        return original(Bucket=Bucket, Key=Key)

    fakes.s3.head_object = head
    event = {
        "Records": [
            {"messageId": "good", "body": good},
            {"messageId": "missing", "body": missing},
            {"messageId": "flaky", "body": flaky},
        ]
    }
    worker.handler.set_runtime(make_runtime("media"))
    try:
        out = worker.handler.handle(event, context)
    finally:
        worker.handler.set_runtime(None)
    assert out == {"batchItemFailures": [{"itemIdentifier": "flaky"}]}
    finals = [m["Body"] for m in fakes.sqs.sent if m["Body"]["status"] != "running"]
    assert [m["status"] for m in finals] == ["succeeded", "failed"]
