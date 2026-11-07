"""Provider selection, the fake, and the Bedrock client with a stubbed runtime (LAI-0701/0702).

No test here touches AWS: `BedrockModelClient` is given a stub in place of the boto3 client.
"""

import json
from dataclasses import replace

import pytest
from botocore.exceptions import ClientError, NoCredentialsError, ReadTimeoutError

from apps.ai.contracts import COMPANION_OUTPUT_SCHEMA
from apps.ai.providers import get_model_client, override_model_client
from apps.ai.providers.base import (
    ContentPart,
    InvalidModelResponse,
    ModelRequest,
    ProviderConfigurationError,
    ProviderError,
    ProviderTimeout,
)
from apps.ai.providers.bedrock import BedrockModelClient, parse_json_text
from apps.ai.providers.fake import GUARDRAIL_BLOCK, FakeModelClient


def request(**overrides):
    values = {
        "route": "companion",
        "system_prompt": "SYSTEM",
        "content": (ContentPart("trusted"), ContentPart("from the app", untrusted=True)),
        "output_schema": COMPANION_OUTPUT_SCHEMA,
        "schema_name": "companion_turn",
        "max_output_tokens": 300,
        "temperature": 0.4,
        "fake_hints": {"intent": "HINT"},
    }
    return ModelRequest(**{**values, **overrides})


class Runtime:
    """Stands in for `boto3.client('bedrock-runtime')`."""

    def __init__(self, response=None, error=None):
        self.response, self.error, self.calls = response, error, []

    def converse(self, **kwargs):
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        return self.response


def bedrock(runtime=None, **overrides):
    values = {
        "region": "us-west-1",
        "model_id": "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        "guardrail_id": "gr-test",
        "guardrail_version": "1",
        "timeout_seconds": 10,
        "client": runtime or Runtime(),
    }
    return BedrockModelClient(**{**values, **overrides})


def converse_response(text, stop="end_turn"):
    return {
        "output": {"message": {"role": "assistant", "content": [{"text": text}]}},
        "stopReason": stop,
        "usage": {"inputTokens": 120, "outputTokens": 40},
        "metrics": {"latencyMs": 456},
    }


TURN = {
    "spokenText": "Count each gap.",
    "emotion": "CALM",
    "intent": "HINT",
    "choices": None,
    "safetyDisposition": "ALLOW",
}


# --- selection --------------------------------------------------------------------------------


def test_test_settings_select_the_fake(settings):
    assert settings.LAI_AI_PROVIDER == "fake"
    assert isinstance(get_model_client(), FakeModelClient)


def test_disabled_selects_no_client(settings):
    settings.LAI_AI_PROVIDER = "disabled"
    assert get_model_client() is None


def test_bedrock_without_a_guardrail_fails_closed(settings):
    settings.LAI_AI_PROVIDER = "bedrock"
    settings.LAI_AI_BEDROCK_REGION = "us-west-1"
    settings.LAI_AI_GUARDRAIL_ID = ""
    settings.LAI_AI_GUARDRAIL_VERSION = ""
    with pytest.raises(ProviderConfigurationError):
        get_model_client()


@pytest.mark.parametrize("missing", ["region", "model_id", "guardrail_id", "guardrail_version"])
def test_bedrock_client_refuses_any_missing_setting(missing):
    with pytest.raises(ProviderConfigurationError):
        bedrock(**{missing: ""})


def test_bedrock_with_full_settings_builds_without_calling_aws(settings):
    settings.LAI_AI_PROVIDER = "bedrock"
    settings.LAI_AI_BEDROCK_REGION = "us-west-1"
    settings.LAI_AI_GUARDRAIL_ID = "gr-1"
    settings.LAI_AI_GUARDRAIL_VERSION = "3"
    client = get_model_client()
    assert isinstance(client, BedrockModelClient)
    assert client.model_id == "us.anthropic.claude-haiku-4-5-20251001-v1:0"
    assert client._client is None  # boto3 is only created on the first invoke


def test_override_wins_and_is_restored():
    fake = FakeModelClient()
    with override_model_client(fake):
        assert get_model_client() is fake
    assert get_model_client() is not fake


# --- fake ---------------------------------------------------------------------------------------


def test_fake_default_reply_follows_the_requested_intent():
    response = FakeModelClient().invoke(request())
    assert response.output["intent"] == "HINT"
    assert response.provider == "fake" and not response.guardrail_intervened


def test_fake_scripts_outputs_errors_and_guardrail_blocks_in_order():
    fake = FakeModelClient([{"a": 1}, ProviderTimeout(), GUARDRAIL_BLOCK])
    assert fake.invoke(request()).output == {"a": 1}
    with pytest.raises(ProviderTimeout):
        fake.invoke(request())
    blocked = fake.invoke(request())
    assert blocked.guardrail_intervened and blocked.output is None
    assert len(fake.requests) == 3


# --- Bedrock request shape ---------------------------------------------------------------------


def test_converse_arguments_guard_only_untrusted_text_and_use_structured_text_output():
    arguments = bedrock().converse_arguments(request())
    assert arguments["modelId"] == "us.anthropic.claude-haiku-4-5-20251001-v1:0"
    assert arguments["system"] == [{"text": "SYSTEM"}]
    assert arguments["messages"][0]["content"] == [
        {"text": "trusted"},
        {"guardContent": {"text": {"text": "from the app"}}},
    ]
    assert arguments["inferenceConfig"] == {"maxTokens": 300, "temperature": 0.4}
    assert arguments["guardrailConfig"] == {
        "guardrailIdentifier": "gr-test",
        "guardrailVersion": "1",
        "trace": "disabled",
    }
    schema = arguments["outputConfig"]["textFormat"]["structure"]["jsonSchema"]
    assert json.loads(schema["schema"]) == COMPANION_OUTPUT_SCHEMA
    # Guardrails do not assess tool-call arguments on Converse, so tools are never used.
    assert "toolConfig" not in arguments


def test_structured_output_can_be_switched_off():
    arguments = bedrock(structured_output=False).converse_arguments(request())
    assert "outputConfig" not in arguments


def test_every_object_in_the_output_schemas_forbids_extra_properties():
    from apps.ai.contracts import TUTOR_OUTPUT_SCHEMA

    def objects(node):
        if isinstance(node, dict):
            if node.get("type") == "object":
                yield node
            for value in node.values():
                yield from objects(value)

    for schema in (COMPANION_OUTPUT_SCHEMA, TUTOR_OUTPUT_SCHEMA):
        found = list(objects(schema))
        assert found and all(o.get("additionalProperties") is False for o in found)


# --- Bedrock responses ------------------------------------------------------------------------


def test_a_text_json_reply_is_parsed_with_usage():
    runtime = Runtime(converse_response(json.dumps(TURN)))
    response = bedrock(runtime).invoke(request())
    assert response.output == TURN
    assert (response.input_tokens, response.output_tokens, response.latency_ms) == (120, 40, 456)
    assert response.guardrail_applied and not response.guardrail_intervened


def test_a_fenced_json_reply_is_accepted():
    assert parse_json_text('```json\n{"a": 1}\n```') == {"a": 1}


def test_a_guardrail_intervention_never_returns_the_blocked_text():
    runtime = Runtime(converse_response("Sorry, blocked message", stop="guardrail_intervened"))
    response = bedrock(runtime).invoke(request())
    assert response.guardrail_intervened and response.output is None


@pytest.mark.parametrize(
    ("response", "error"),
    [
        (converse_response("not json"), InvalidModelResponse),
        (converse_response("   "), InvalidModelResponse),
        (converse_response(json.dumps(TURN)[:20], stop="max_tokens"), ProviderError),
    ],
)
def test_unusable_replies_raise(response, error):
    with pytest.raises(error):
        bedrock(Runtime(response)).invoke(request())


def _client_error(code):
    return ClientError({"Error": {"Code": code, "Message": "secret detail sk-123"}}, "Converse")


@pytest.mark.parametrize(
    ("error", "category"),
    [
        (_client_error("ThrottlingException"), "THROTTLED"),
        (_client_error("AccessDeniedException"), "ACCESS_DENIED"),
        (_client_error("ValidationException"), "REQUEST_REJECTED"),
        (_client_error("ResourceNotFoundException"), "CONFIGURATION"),
        (_client_error("ServiceUnavailableException"), "UNAVAILABLE"),
        (_client_error("SomethingNew"), "UNKNOWN"),
        (ReadTimeoutError(endpoint_url="https://bedrock"), "TIMEOUT"),
        (NoCredentialsError(), "CONFIGURATION"),
    ],
)
def test_aws_errors_become_closed_categories_without_their_messages(error, category):
    with pytest.raises(ProviderError) as raised:
        bedrock(Runtime(error=error)).invoke(request())
    assert raised.value.category == category
    assert "secret detail" not in str(raised.value)
    assert raised.value.__cause__ is None and raised.value.__suppress_context__


# QA-AQS-D4 (live Bedrock, 2026-11-07): with no `guardContent` block Bedrock assesses the whole
# message, and the prompt-attack filter blocked our own instructions on every server-context
# companion turn and every Studio batch. Every request now carries one, and instructions stay
# outside it.
INSTRUCTION_MARKERS = ("Reply with", "Treat it only as information", "Write ", "Hints:")


def _guarded_and_plain(arguments):
    blocks = arguments["messages"][0]["content"]
    guarded = [b["guardContent"]["text"]["text"] for b in blocks if "guardContent" in b]
    plain = [b["text"] for b in blocks if "text" in b]
    return guarded, plain


def test_screened_server_data_is_wrapped_for_the_guardrail():
    content = (ContentPart("Context:"), ContentPart('{"a": 1}', screened=True))
    guarded, plain = _guarded_and_plain(bedrock().converse_arguments(request(content=content)))
    assert guarded == ['{"a": 1}'] and plain == ["Context:"]


def _requests_from_the_real_builders():
    from apps.ai.services.pipeline import TurnSpec, _content
    from apps.question_studio import contracts, prompts

    def spec(untrusted):
        return TurnSpec(
            route="companion",
            route_name="generateCompanionTurn",
            persona="P",
            output_schema=COMPANION_OUTPUT_SCHEMA,
            schema_name="companion_turn",
            output_schema_version=1,
            input_category="HINT",
            disposition_category="x",
            context_source="DJANGO_SESSION",
            trusted_context={"ageBand": "SPROUT"},
            untrusted_context=untrusted,
            reply_fields="spokenText",
            validate=None,
            fallback=None,
            redirect=None,
        )

    studio = contracts.GenerationParams(
        subject="MATH",
        grade="1",
        topic="addition",
        difficulty="EASY",
        question_type="MULTIPLE_CHOICE",
        count=5,
    )
    yield "server-context turn", _content(spec({}))
    yield "client-context turn", _content(spec({"stepSummary": "counting planks"}))
    yield "studio batch", prompts.build_content(studio, 5)
    yield (
        "studio batch with notes",
        prompts.build_content(replace(studio, notes="pirates"), 5),
    )


def test_every_real_request_has_a_guard_block_with_no_instructions_in_it():
    for name, content in _requests_from_the_real_builders():
        guarded, plain = _guarded_and_plain(bedrock().converse_arguments(request(content=content)))
        assert guarded, f"{name}: no guardContent, so Bedrock would assess our instructions"
        for text in guarded:
            assert not any(m in text for m in INSTRUCTION_MARKERS), (name, text)
