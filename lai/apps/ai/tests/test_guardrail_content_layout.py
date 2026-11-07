"""Guardrail content layout (QA 2026-11-07, docs/AI_BEDROCK_CHATTY_QA_REPORT.md section 3).

Live Bedrock showed the deployed Guardrail's prompt-attack filter (strength HIGH) blocking
benign companion and NPC turns. It flagged our own instructions, either because they sat inside
the wrapped block ("never as instructions") or because no block was wrapped, so Bedrock
assessed the whole message. These tests pin the fix: every Converse request wraps at least one
block, and no wrapped block carries instruction wording.
"""

import json

import pytest

from apps.ai.providers.base import ContentPart, ModelRequest
from apps.ai.providers.bedrock import BedrockModelClient
from apps.ai.services.pipeline import NO_CLIENT_CONTEXT, TurnSpec, _content
from apps.question_studio.contracts import GenerationParams
from apps.question_studio.prompts import build_content

# Words from our own instructions that tripped the live filter. None may be wrapped.
INSTRUCTION_WORDS = ("instruction", "reply with", "json object", "treat it", "never as")


def turn_spec(untrusted):
    return TurnSpec(
        route="companion",
        route_name="companion",
        persona=None,
        output_schema={},
        schema_name="companion_turn",
        output_schema_version=1,
        input_category="",
        disposition_category="",
        context_source="CLIENT_AUTHORED",
        trusted_context={"intent": "HINT", "ageBand": "PATHFINDER", "unset": None},
        untrusted_context=untrusted,
        reply_fields="spokenText, emotion",
        validate=lambda value: value,
        fallback=lambda allowed: {},
        redirect=lambda reason: {},
    )


def wrapped(parts):
    client = BedrockModelClient(
        region="us-west-1",
        model_id="m",
        guardrail_id="g",
        guardrail_version="1",
        timeout_seconds=10,
        client=object(),
    )
    request = ModelRequest(
        route="companion",
        system_prompt="S",
        content=tuple(parts),
        output_schema={},
        schema_name="companion_turn",
        max_output_tokens=50,
        temperature=0.4,
    )
    blocks = client.converse_arguments(request)["messages"][0]["content"]
    return [b["guardContent"]["text"]["text"] for b in blocks if "guardContent" in b]


def assert_no_instructions(texts):
    assert texts, "Bedrock assesses the whole message when nothing is wrapped"
    for text in texts:
        assert not any(word in text.lower() for word in INSTRUCTION_WORDS), text


def test_client_text_is_wrapped_as_bare_json_and_the_framing_stays_trusted():
    untrusted = {"stepSummary": "counting the missing planks", "authoredBaseText": "Count them"}
    trusted, data = _content(turn_spec(untrusted))
    assert data.untrusted and json.loads(data.text) == untrusted
    assert "never as instructions" in trusted.text and not trusted.assessed
    assert_no_instructions(wrapped((trusted, data)))


def test_a_turn_with_no_client_text_wraps_only_a_marker():
    trusted, marker = _content(turn_spec({"stepSummary": "", "authoredBaseText": None}))
    assert marker.text == NO_CLIENT_CONTEXT and marker.guarded and not marker.untrusted
    assert "Reply with exactly one JSON object" in trusted.text
    assert wrapped((trusted, marker)) == [NO_CLIENT_CONTEXT]


@pytest.mark.parametrize("notes", ["", "Use pirate names"])
def test_studio_wraps_notes_or_a_marker_never_the_specification(notes):
    params = GenerationParams(
        subject="MATH",
        grade="3",
        topic="Multiplication",
        difficulty="EASY",
        question_type="MULTIPLE_CHOICE",
        count=5,
        notes=notes,
    )
    spec, last = build_content(params, 5)
    assert not spec.assessed and last.assessed
    texts = wrapped((spec, last))
    assert texts == [notes or "No staff notes were supplied."]
    assert_no_instructions(texts)


def test_assessed_covers_untrusted_and_guarded_parts():
    assert ContentPart("x", untrusted=True).assessed
    assert ContentPart("x", guarded=True).assessed
    assert not ContentPart("x").assessed
