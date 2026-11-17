"""The jobs worker (lambda/jobs_worker) against fake AWS clients: envelopes, idempotency,
retries, queues and each kind. The worker is imported from its packaged layout."""

import json
import uuid
from types import SimpleNamespace

import pytest
from jobs_worker_fakes import (
    ASSET_BUCKET,
    MODEL,
    RESULTS_BUCKET,
    SPEECH_BUCKET,
    FakeClientError,
    tiny_glb,
)


def studio_payload(**overrides):
    payload = {
        "batch_id": str(uuid.uuid4()),
        "chunk_index": 0,
        "want": 2,
        "offset": 0,
        "requested_before": 0,
        "max_attempts": 2,
        "model_id": MODEL,
        "request": {
            "route": "studio",
            "system_prompt": "You write practice questions.",
            "content": [
                {"text": "Write 2 questions.", "untrusted": False, "guarded": False},
                {"text": "No staff notes were supplied.", "untrusted": False, "guarded": True},
            ],
            "output_schema": {"type": "object"},
            "schema_name": "question_batch",
            "max_output_tokens": 2500,
            "temperature": 0.7,
        },
    }
    payload.update(overrides)
    return payload


def speech_payload(**overrides):
    digest = "ab" + "c" * 62
    payload = {
        "storage_key": f"speech/shared/ab/{digest}.mp3",
        "text": "Ahoy there, friend!",
        "text_type": "text",
        "voice_id": "Justin",
        "engine": "neural",
        "language": "en-US",
        "voice_profile_id": "pip",
        "characters": 19,
    }
    payload.update(overrides)
    return payload


ASSET_KEY = f"assets/models/pip-boat/{uuid.uuid4()}/model.glb"


def work(worker, kind, payload, job_id=None):
    return json.dumps(worker.envelope.build_work(job_id or str(uuid.uuid4()), kind, payload))


def response(questions, *, intervened=False):
    return SimpleNamespace(
        output=None if intervened else {"questions": questions},
        input_tokens=11,
        output_tokens=22,
        guardrail_intervened=intervened,
        model_id=MODEL,
    )


def statuses(fakes):
    return [m["Body"]["status"] for m in fakes.sqs.sent]


def record(body, message_id="msg-1"):
    return {"Records": [{"messageId": message_id, "body": body}]}


# --- studio.generate_chunk --------------------------------------------------------------------


def test_studio_chunk_success_sends_running_then_the_stored_result(
    worker, fakes, make_runtime, context
):
    fakes.model.responses = [response([{"stem": "a"}, {"stem": "b"}, {"stem": "extra"}])]
    rt = make_runtime("ai")
    body = work(worker, "studio.generate_chunk", studio_payload())
    assert worker.handler.process(body, context, rt) == "succeeded"
    assert statuses(fakes) == ["running", "succeeded"]
    final = fakes.sqs.sent[1]["Body"]
    assert final["result"]["items"] == [{"stem": "a"}, {"stem": "b"}]  # never more than `want`
    assert final["result"]["input_tokens"] == 11 and final["result"]["attempts"] == 1
    assert final["worker"] == {"function": "lai-dev-jobs-ai", "request_id": "req-1"}
    stored = json.loads(fakes.s3.objects[(RESULTS_BUCKET, f"jobs/results/{final['job_id']}.json")])
    assert stored == final
    request = fakes.model.requests[0]
    assert request.content[1].guarded and request.max_output_tokens == 2500


def test_redelivery_resends_the_stored_result_without_a_second_model_call(
    worker, fakes, make_runtime, context
):
    fakes.model.responses = [response([{"stem": "a"}, {"stem": "b"}])]
    rt = make_runtime("ai")
    body = work(worker, "studio.generate_chunk", studio_payload())
    worker.handler.process(body, context, rt)
    assert worker.handler.process(body, context, rt) == "resent"
    assert len(fakes.model.requests) == 1
    assert statuses(fakes) == ["running", "succeeded", "succeeded"]
    assert fakes.sqs.sent[1]["Body"] == fakes.sqs.sent[2]["Body"]


def test_model_not_in_the_approved_list_fails_without_a_call(worker, fakes, make_runtime, context):
    rt = make_runtime("ai")
    body = work(worker, "studio.generate_chunk", studio_payload(model_id="some.other-model"))
    assert worker.handler.process(body, context, rt) == "failed"
    final = fakes.sqs.sent[-1]["Body"]
    assert final["error"] == {"code": "model_not_approved", "retryable": False}
    assert fakes.model.requests == []


def test_approved_list_and_studio_model_come_from_ssm(worker, fakes, make_runtime, context):
    fakes.ssm.values["LAI_STUDIO_MODEL_ID"] = "studio-model"
    fakes.ssm.values["LAI_STUDIO_APPROVED_MODEL_IDS"] = "studio-model, other"
    fakes.model.responses = [response([{"stem": "a"}])]
    rt = make_runtime("ai")
    assert (
        worker.handler.process(
            work(worker, "studio.generate_chunk", studio_payload(model_id=MODEL)), context, rt
        )
        == "failed"
    )
    assert (
        worker.handler.process(
            work(worker, "studio.generate_chunk", studio_payload(model_id="studio-model", want=1)),
            context,
            rt,
        )
        == "succeeded"
    )
    assert fakes.ssm.calls == 1  # cached between invocations


@pytest.mark.parametrize("missing", ["LAI_AI_GUARDRAIL_ID", "LAI_AI_GUARDRAIL_VERSION"])
def test_no_guardrail_no_call(worker, fakes, make_runtime, context, missing):
    del fakes.ssm.values[missing]
    rt = make_runtime("ai")
    worker.handler.process(work(worker, "studio.generate_chunk", studio_payload()), context, rt)
    assert fakes.sqs.sent[-1]["Body"]["error"]["code"] == "guardrail_not_configured"
    assert fakes.model.requests == []


def test_draft_guardrail_is_refused(worker, fakes, make_runtime, context):
    fakes.ssm.values["LAI_AI_GUARDRAIL_VERSION"] = "DRAFT"
    worker.handler.process(
        work(worker, "studio.generate_chunk", studio_payload()), context, make_runtime("ai")
    )
    assert fakes.sqs.sent[-1]["Body"]["error"]["code"] == "guardrail_not_configured"


def test_default_bedrock_client_is_guarded_with_ssm_values(worker, fakes):
    from jobs_worker_fakes import environ

    rt = worker.aws.Runtime(worker.aws.Settings(environ("ai")), clients={"ssm": fakes.ssm})
    client = rt.bedrock_client(rt.ai_config())
    assert isinstance(client, worker.bedrock.BedrockModelClient)
    assert (client.guardrail_id, client.guardrail_version, client.region) == (
        "gr-123",
        "3",
        "us-west-2",
    )
    arguments = client.converse_arguments(
        worker.base.ModelRequest(
            route="studio",
            system_prompt="s",
            content=(worker.base.ContentPart("x", guarded=True),),
            output_schema={},
            schema_name="question_batch",
            max_output_tokens=10,
            temperature=0.1,
        )
    )
    assert arguments["guardrailConfig"]["guardrailIdentifier"] == "gr-123"
    assert arguments["modelId"] == MODEL


def test_transient_provider_errors_use_the_chunk_attempts(worker, fakes, make_runtime, context):
    fakes.model.responses = [
        worker.base.ProviderError("THROTTLED"),
        response([{"stem": "a"}, {"stem": "b"}]),
    ]
    worker.handler.process(
        work(worker, "studio.generate_chunk", studio_payload()), context, make_runtime("ai")
    )
    result = fakes.sqs.sent[-1]["Body"]["result"]
    assert result["attempts"] == 2 and result["failure"] == "" and len(result["items"]) == 2


def test_guardrail_intervention_is_a_chunk_failure_not_a_retry(
    worker, fakes, make_runtime, context
):
    fakes.model.responses = [response([], intervened=True)]
    worker.handler.process(
        work(worker, "studio.generate_chunk", studio_payload()), context, make_runtime("ai")
    )
    final = fakes.sqs.sent[-1]["Body"]
    assert final["status"] == "succeeded" and final["result"]["failure"] == "GUARDRAIL"
    assert final["result"]["items"] == []


def test_no_second_attempt_when_the_function_is_out_of_time(worker, fakes, make_runtime):
    fakes.model.responses = [worker.base.ProviderTimeout(), response([{"stem": "a"}])]
    short = SimpleNamespace(
        function_name="f", aws_request_id="r", get_remaining_time_in_millis=lambda: 30_000
    )
    worker.handler.process(
        work(worker, "studio.generate_chunk", studio_payload()), short, make_runtime("ai")
    )
    result = fakes.sqs.sent[-1]["Body"]["result"]
    assert result["attempts"] == 1 and result["failure"] == "TIMEOUT"


def test_retryable_errors_raise_for_sqs_and_store_nothing(worker, fakes, make_runtime, context):
    fakes.ssm.fail = True
    worker.handler.set_runtime(make_runtime("ai"))
    try:
        out = worker.handler.handle(
            record(work(worker, "studio.generate_chunk", studio_payload()), "m-7"), context
        )
    finally:
        worker.handler.set_runtime(None)
    assert out == {"batchItemFailures": [{"itemIdentifier": "m-7"}]}
    assert not [k for (_b, k) in fakes.s3.objects if k.startswith("jobs/results/")]


def test_a_failed_result_send_is_retried_and_then_resent(worker, fakes, make_runtime, context):
    fakes.model.responses = [response([{"stem": "a"}, {"stem": "b"}])]
    rt = make_runtime("ai")
    body = work(worker, "studio.generate_chunk", studio_payload())
    original = fakes.sqs.send_message
    calls = {"n": 0}

    def flaky(QueueUrl, MessageBody):
        calls["n"] += 1
        if calls["n"] == 2:  # the final result
            raise FakeClientError("ServiceUnavailable", 503)
        return original(QueueUrl=QueueUrl, MessageBody=MessageBody)

    fakes.sqs.send_message = flaky
    with pytest.raises(worker.tasks.TaskError):
        worker.handler.process(body, context, rt)
    assert worker.handler.process(body, context, rt) == "resent"
    assert len(fakes.model.requests) == 1 and statuses(fakes) == ["running", "succeeded"]


def test_oversized_results_travel_as_an_s3_pointer(worker, fakes, make_runtime, context):
    big = [{"stem": "x" * 3000, "n": i} for i in range(300)]
    fakes.model.responses = [response(big)]
    rt = make_runtime("ai")
    worker.handler.process(
        work(worker, "studio.generate_chunk", studio_payload(want=100)), context, rt
    )
    message = fakes.sqs.sent[-1]["Body"]
    assert message["result"] is None
    assert message["result_s3_key"] == f"jobs/results/{message['job_id']}.json"
    stored = json.loads(fakes.s3.objects[(RESULTS_BUCKET, message["result_s3_key"])])
    assert len(stored["result"]["items"]) == 100 and stored["result_s3_key"] is None


# --- envelopes and queues -----------------------------------------------------------------------


def test_wrong_queue_gets_a_failed_result(worker, fakes, make_runtime, context):
    rt = make_runtime("media")
    assert (
        worker.handler.process(work(worker, "studio.generate_chunk", studio_payload()), context, rt)
        == "rejected"
    )
    assert fakes.sqs.sent[-1]["Body"]["error"]["code"] == "wrong_queue"
    rt_ai = make_runtime("ai")
    worker.handler.process(work(worker, "speech.synthesize", speech_payload()), context, rt_ai)
    assert fakes.sqs.sent[-1]["Body"]["error"]["code"] == "wrong_queue"
    assert fakes.polly.calls == [] and fakes.model.requests == []


@pytest.mark.parametrize(
    "body",
    [
        "not json",
        json.dumps({"schema": 1}),
        json.dumps(
            {
                "schema": 1,
                "job_id": str(uuid.uuid4()),
                "kind": "shell.exec",
                "attempt": 1,
                "submitted_at": "2026-11-16T00:00:00Z",
                "payload": {},
            }
        ),
        json.dumps(
            {
                "schema": 2,
                "job_id": str(uuid.uuid4()),
                "kind": "asset.inspect",
                "attempt": 1,
                "submitted_at": "2026-11-16T00:00:00Z",
                "payload": {},
            }
        ),
    ],
)
def test_unreadable_or_unknown_envelopes_go_back_to_sqs(worker, fakes, make_runtime, context, body):
    worker.handler.set_runtime(make_runtime("media"))
    try:
        out = worker.handler.handle(record(body, "bad-1"), context)
    finally:
        worker.handler.set_runtime(None)
    assert out == {"batchItemFailures": [{"itemIdentifier": "bad-1"}]}
    assert fakes.sqs.sent == []


def test_invalid_payload_is_a_failed_result(worker, fakes, make_runtime, context):
    payload = studio_payload()
    payload["request"]["content"] = [{"text": "x", "untrusted": False, "guarded": False}]
    worker.handler.process(
        work(worker, "studio.generate_chunk", payload), context, make_runtime("ai")
    )
    assert fakes.sqs.sent[-1]["Body"]["error"]["code"] == "invalid_payload"
    assert fakes.model.requests == []


def test_settings_refuse_an_unknown_queue(worker):
    from jobs_worker_fakes import environ

    with pytest.raises(RuntimeError):
        worker.aws.Settings({**environ("ai"), "LAI_WORKER_QUEUE": "everything"})


# --- speech.synthesize ----------------------------------------------------------------------------


def test_speech_is_written_at_the_key_django_computed(worker, fakes, make_runtime, context):
    payload = speech_payload()
    worker.handler.process(
        work(worker, "speech.synthesize", payload), context, make_runtime("media")
    )
    final = fakes.sqs.sent[-1]["Body"]
    assert final["status"] == "succeeded" and final["result"]["reused"] is False
    assert fakes.s3.objects[(SPEECH_BUCKET, payload["storage_key"])].startswith(b"ID3")
    put = [p for p in fakes.s3.puts if p["Bucket"] == SPEECH_BUCKET][0]
    assert put["ContentType"] == "audio/mpeg" and put["ServerSideEncryption"] == "AES256"
    assert fakes.polly.calls[0]["VoiceId"] == "Justin"
    assert "voice_profile_id" not in fakes.polly.calls[0]


def test_speech_uses_the_polly_region_django_is_configured_with(
    worker, fakes, make_runtime, context
):
    runtime = make_runtime("media")
    runtime._clients["polly@us-west-2"] = fakes.polly
    payload = speech_payload(polly_region="us-west-2")
    worker.handler.process(work(worker, "speech.synthesize", payload), context, runtime)
    assert fakes.sqs.sent[-1]["Body"]["status"] == "succeeded"
    assert len(fakes.polly.calls) == 1


def test_speech_refuses_a_malformed_polly_region(worker, fakes, make_runtime, context):
    payload = speech_payload(polly_region="https://evil.example")
    worker.handler.process(
        work(worker, "speech.synthesize", payload), context, make_runtime("media")
    )
    assert fakes.polly.calls == []
    assert fakes.sqs.sent[-1]["Body"]["status"] == "failed"


def test_existing_speech_object_is_reused_without_polly(worker, fakes, make_runtime, context):
    payload = speech_payload()
    fakes.s3.objects[(SPEECH_BUCKET, payload["storage_key"])] = b"ID3 earlier"
    worker.handler.process(
        work(worker, "speech.synthesize", payload), context, make_runtime("media")
    )
    assert fakes.polly.calls == []
    assert fakes.sqs.sent[-1]["Body"]["result"] == {
        "storage_key": payload["storage_key"],
        "byte_size": 11,
        "reused": True,
    }


@pytest.mark.parametrize(
    "key",
    [
        "speech/child/ab/" + "ab" + "c" * 62 + ".mp3",  # never a child's clip
        "speech/shared/zz/" + "ab" + "c" * 62 + ".mp3",  # prefix must match the hash
        "speech/shared/ab/../" + "c" * 64 + ".mp3",
        "assets/models/x.glb",
    ],
)
def test_speech_key_pattern_is_enforced(worker, fakes, make_runtime, context, key):
    worker.handler.process(
        work(worker, "speech.synthesize", speech_payload(storage_key=key)),
        context,
        make_runtime("media"),
    )
    assert fakes.sqs.sent[-1]["Body"]["error"]["code"] == "invalid_speech_key"
    assert fakes.polly.calls == []
    assert not [p for p in fakes.s3.puts if p["Bucket"] == SPEECH_BUCKET]


def test_polly_throttling_is_retried_by_sqs(worker, fakes, make_runtime, context):
    fakes.polly.error = FakeClientError("ThrottlingException")
    with pytest.raises(worker.tasks.TaskError) as raised:
        worker.handler.process(
            work(worker, "speech.synthesize", speech_payload()), context, make_runtime("media")
        )
    assert raised.value.retryable and raised.value.code == "throttled"


def test_polly_access_denied_fails_without_retry(worker, fakes, make_runtime, context):
    fakes.polly.error = FakeClientError("AccessDeniedException")
    worker.handler.process(
        work(worker, "speech.synthesize", speech_payload()), context, make_runtime("media")
    )
    assert fakes.sqs.sent[-1]["Body"]["error"] == {"code": "access_denied", "retryable": False}


# --- asset.inspect --------------------------------------------------------------------------------


def test_asset_inspection_reads_glb_structure(worker, fakes, make_runtime, context):
    fakes.s3.objects[(ASSET_BUCKET, ASSET_KEY)] = tiny_glb()
    worker.handler.process(
        work(worker, "asset.inspect", {"storage_key": ASSET_KEY, "format": "glb"}),
        context,
        make_runtime("media"),
    )
    result = fakes.sqs.sent[-1]["Body"]["result"]
    meta = result["metadata"]
    assert meta["glbVersion"] == 2 and meta["generator"] == "test"
    assert meta["counts"]["nodes"] == 2 and meta["counts"]["meshes"] == 1
    assert meta["extensionsUsed"] == ["KHR_materials_unlit"] and meta["problems"] == []
    assert result["size_bytes"] == len(tiny_glb())


@pytest.mark.parametrize(
    ("key", "file_format"),
    [
        (ASSET_KEY, "png"),  # format must match the key
        ("speech/shared/ab/x.mp3", "mp3"),
        (ASSET_KEY.replace("pip-boat", "../etc"), "glb"),
        (ASSET_KEY.replace("models/", "images/"), "glb"),
    ],
)
def test_asset_key_layout_is_enforced(worker, fakes, make_runtime, context, key, file_format):
    worker.handler.process(
        work(worker, "asset.inspect", {"storage_key": key, "format": file_format}),
        context,
        make_runtime("media"),
    )
    assert fakes.sqs.sent[-1]["Body"]["error"]["code"] == "invalid_asset_key"


def test_missing_asset_object_fails(worker, fakes, make_runtime, context):
    worker.handler.process(
        work(worker, "asset.inspect", {"storage_key": ASSET_KEY, "format": "glb"}),
        context,
        make_runtime("media"),
    )
    assert fakes.sqs.sent[-1]["Body"]["error"]["code"] == "object_missing"
