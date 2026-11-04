"""Bedrock adapter and pipeline reliability with stubbed AWS only (LAI-0702, LAI-0705 readiness).

Nothing here reaches AWS. A stub stands in for the boto3 runtime client, and the pipeline tests
script `FakeModelClient`. They pin what the owner's live run will be compared against.
"""

import json
import logging

import pytest
from botocore.exceptions import ClientError, ConnectTimeoutError, ReadTimeoutError

from apps.ai.models import AIInteractionAudit, FailureCategory, SafetyEvent
from apps.ai.providers import get_model_client, reset_model_client_cache
from apps.ai.providers.base import (
    RETRYABLE_CATEGORIES,
    InvalidModelResponse,
    ProviderError,
    ProviderTimeout,
)
from apps.ai.providers.fake import GUARDRAIL_BLOCK
from apps.ai.tests.test_providers import TURN, Runtime, bedrock, converse_response, request

pytestmark = pytest.mark.django_db


class Sequenced:
    """A runtime stub that answers a list of results in order (a value, or an exception)."""

    def __init__(self, *results):
        self.results, self.calls = list(results), []

    def converse(self, **kwargs):
        self.calls.append(kwargs)
        result = self.results.pop(0)
        if isinstance(result, Exception):
            raise result
        return result


def ok():
    return converse_response(json.dumps(TURN))


# --- retry classification ----------------------------------------------------------------------


@pytest.mark.parametrize(
    ("category", "retryable"),
    [
        ("THROTTLED", True),
        ("UNAVAILABLE", True),
        ("TIMEOUT", True),
        ("ACCESS_DENIED", False),
        ("CONFIGURATION", False),
        ("REQUEST_REJECTED", False),
        ("TRUNCATED", False),
        ("INVALID_RESPONSE", False),
        ("UNKNOWN", False),
    ],
)
def test_only_transient_failures_are_retryable(category, retryable):
    assert ProviderError(category).retryable is retryable
    assert (category in RETRYABLE_CATEGORIES) is retryable


def test_the_sdk_retry_budget_is_bounded_and_not_widened_by_the_cold_client():
    client = bedrock(Runtime(), max_attempts=3, first_call_timeout_seconds=30)
    assert client.max_attempts == 3 and client.first_call_timeout_seconds == 30


def test_a_first_call_timeout_that_is_not_longer_is_ignored():
    assert bedrock(Runtime(), first_call_timeout_seconds=10).first_call_timeout_seconds is None
    assert bedrock(Runtime(), first_call_timeout_seconds=None).first_call_timeout_seconds is None


# --- first-request grammar compilation ---------------------------------------------------------


def test_only_the_first_request_per_schema_uses_the_longer_timeout():
    warm, cold = Sequenced(ok(), ok()), Sequenced(ok())
    client = bedrock(warm, first_call_timeout_seconds=30, cold_client=cold)
    client.invoke(request())
    assert (len(cold.calls), len(warm.calls)) == (1, 0) and client.is_warm("companion_turn")
    client.invoke(request())
    client.invoke(request())
    assert (len(cold.calls), len(warm.calls)) == (1, 2)


def test_each_schema_gets_its_own_first_call():
    warm, cold = Sequenced(ok()), Sequenced(ok(), ok())
    client = bedrock(warm, first_call_timeout_seconds=30, cold_client=cold)
    client.invoke(request(schema_name="companion_turn"))
    client.invoke(request(schema_name="tutor_turn"))
    assert len(cold.calls) == 2 and not warm.calls


def test_a_failed_first_call_does_not_mark_the_schema_warm():
    cold = Sequenced(ReadTimeoutError(endpoint_url="https://bedrock"), ok())
    client = bedrock(Sequenced(), first_call_timeout_seconds=30, cold_client=cold)
    with pytest.raises(ProviderTimeout):
        client.invoke(request())
    assert not client.is_warm("companion_turn")
    client.invoke(request())
    assert client.is_warm("companion_turn")


def test_without_the_setting_there_is_no_cold_path_at_all():
    runtime = Sequenced(ok(), ok())
    client = bedrock(runtime)
    client.invoke(request())
    client.invoke(request())
    assert len(runtime.calls) == 2


def test_a_guardrail_answer_also_counts_as_compiled():
    cold = Sequenced(converse_response("blocked", stop="guardrail_intervened"))
    client = bedrock(Sequenced(), first_call_timeout_seconds=30, cold_client=cold)
    assert client.invoke(request()).guardrail_intervened
    assert client.is_warm("companion_turn")


# --- malformed and unusual replies -------------------------------------------------------------


@pytest.mark.parametrize(
    "response",
    [
        converse_response("[1, 2]"),
        converse_response('"just a string"'),
        converse_response("42"),
        converse_response("null"),
        {"output": {"message": {"role": "assistant", "content": []}}, "stopReason": "end_turn"},
        {"output": {}, "stopReason": "end_turn"},
        {"stopReason": "end_turn"},
        converse_response(json.dumps(TURN), stop="tool_use"),
    ],
)
def test_malformed_replies_are_invalid_not_valid(response):
    with pytest.raises(InvalidModelResponse):
        bedrock(Runtime(response)).invoke(request())


def test_a_content_filtered_stop_is_treated_as_a_block_and_drops_the_text():
    response = bedrock(Runtime(converse_response("filtered words", stop="content_filtered")))
    result = response.invoke(request())
    assert result.guardrail_intervened and result.output is None


def test_a_truncated_reply_is_not_retryable_and_not_shown():
    with pytest.raises(ProviderError) as raised:
        bedrock(Runtime(converse_response('{"spokenText": "Cou', stop="max_tokens"))).invoke(
            request()
        )
    assert raised.value.category == "TRUNCATED" and not raised.value.retryable


@pytest.mark.parametrize(
    ("error", "retryable"),
    [
        (ConnectTimeoutError(endpoint_url="https://bedrock"), True),
        (ReadTimeoutError(endpoint_url="https://bedrock"), True),
        (ClientError({"Error": {"Code": "ThrottlingException"}}, "Converse"), True),
        (ClientError({"Error": {"Code": "ModelTimeoutException"}}, "Converse"), True),
        (ClientError({"Error": {"Code": "ServiceQuotaExceededException"}}, "Converse"), True),
        (ClientError({"Error": {"Code": "ExpiredTokenException"}}, "Converse"), False),
        (ClientError({"Error": {"Code": "ValidationException"}}, "Converse"), False),
    ],
)
def test_transient_aws_errors_are_classified_for_retry(error, retryable):
    with pytest.raises(ProviderError) as raised:
        bedrock(Runtime(error=error)).invoke(request())
    assert raised.value.retryable is retryable


# --- the shared client -------------------------------------------------------------------------


@pytest.fixture
def bedrock_settings(settings):
    settings.LAI_AI_PROVIDER = "bedrock"
    settings.LAI_AI_BEDROCK_REGION = "us-west-1"
    settings.LAI_AI_GUARDRAIL_ID = "gr-test"
    settings.LAI_AI_GUARDRAIL_VERSION = "1"
    reset_model_client_cache()
    yield settings
    reset_model_client_cache()


def test_one_client_is_shared_so_the_pool_and_warm_state_survive(bedrock_settings):
    first = get_model_client()
    assert get_model_client() is first
    bedrock_settings.LAI_AI_TIMEOUT_SECONDS = 12
    assert get_model_client() is not first  # a settings change builds a new one


def test_an_incomplete_configuration_is_never_cached(bedrock_settings):
    bedrock_settings.LAI_AI_GUARDRAIL_ID = ""
    from apps.ai.providers.base import ProviderConfigurationError

    for _ in range(2):
        with pytest.raises(ProviderConfigurationError):
            get_model_client()
    bedrock_settings.LAI_AI_GUARDRAIL_ID = "gr-test"
    assert get_model_client().guardrail_id == "gr-test"


# --- the pipeline over every failure ------------------------------------------------------------


COMPANION = {
    "intent": "HINT",
    "templateId": "bridge",
    "stepSummary": "counting planks",
    "authoredBaseText": "Count the gaps one at a time.",
}


def turn(api, parent, child, body=COMPANION):
    return api(parent).post(
        f"/api/v1/children/{child.pk}/ai/companion-turns/",
        json.dumps(body),
        content_type="application/json",
    )


@pytest.mark.postgres
@pytest.mark.parametrize(
    ("scripted", "category"),
    [
        (ProviderTimeout(), "TIMEOUT"),
        (ProviderError("THROTTLED"), "THROTTLED"),
        (ProviderError("UNAVAILABLE"), "UNAVAILABLE"),
        (ProviderError("ACCESS_DENIED"), "ACCESS_DENIED"),
        (ProviderError("TRUNCATED"), "TRUNCATED"),
        (RuntimeError("boom with AKIAIOSFODNN7EXAMPLE and a prompt"), "UNKNOWN"),
    ],
)
def test_every_transient_or_unexpected_failure_serves_authored_text_and_leaks_nothing(
    families, api, fake_model, caplog, scripted, category
):
    fake_model(scripted)
    with caplog.at_level(logging.DEBUG):
        response = turn(api, families.a, families.a1)
    assert response.status_code == 200 and response.json()["source"] == "FALLBACK"
    body = response.content.decode()
    assert "AKIA" not in body and "boom" not in body and "Traceback" not in body
    audit = AIInteractionAudit.objects.get()
    assert audit.fallback_used and audit.failure_category == category
    assert "AKIA" not in caplog.text and "prompt" not in caplog.text.replace("ai.provider", "")


@pytest.mark.postgres
def test_an_empty_or_malformed_reply_and_a_guardrail_block_each_leave_one_audit_row(
    families, api, fake_model
):
    fake_model(InvalidModelResponse(), GUARDRAIL_BLOCK, {"spokenText": ""}, "not an object")
    for _ in range(4):
        assert turn(api, families.a, families.a1).json()["source"] == "FALLBACK"
    statuses = list(
        AIInteractionAudit.objects.order_by("created_at").values_list(
            "validation_status", flat=True
        )
    )
    assert statuses[:2] == ["INVALID_SCHEMA", "BLOCKED_GUARDRAIL"]
    assert set(statuses[2:]) == {"INVALID_CONTENT"}
    assert SafetyEvent.objects.count() == 1  # only the guardrail block is a safety event


@pytest.mark.postgres
def test_failures_never_change_the_stored_failure_vocabulary():
    assert {"TIMEOUT", "THROTTLED", "UNAVAILABLE", "ACCESS_DENIED", "TRUNCATED", "UNKNOWN"} <= set(
        FailureCategory.values
    )
