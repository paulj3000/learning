"""The NPC hint route in `apps.ai` (LAI-NPC-030, 032): schema, validator, prompt and spec."""

from types import SimpleNamespace

import pytest

from apps.ai.contracts import NPC_HINT_OUTPUT_SCHEMA, validate_npc_hint
from apps.ai.models import RouteName
from apps.ai.prompts import NPC_HINT_PERSONA, PERSONAS
from apps.ai.providers.base import ModelRequest
from apps.ai.providers.fake import default_output
from apps.ai.services.npc_hint import (
    NpcHintContext,
    build_spec,
    fallback_line,
    max_length_for,
)


def ctx(**changes) -> NpcHintContext:
    values = {
        "npc_id": "pip",
        "character_name": "Pirate Pip",
        "release": 3,
        "dialogue_key": "hello",
        "node_key": "greet",
        "allowed_topic": "counting planks",
        "authored_base_text": "Ahoy! Can you count the planks?",
        "persona_version": 2,
        "personality_prompt": "You are Pirate Pip.",
        "personality": {"tone": "warm", "secret": "dropped"},
        "max_response_chars": 150,
        "fallback_lines": ("Count them one at a time!", "Look again, matey!"),
        "conversation_id": "c0ffee00-0000-4000-8000-000000000000",
    }
    values.update(changes)
    return NpcHintContext(**values)


def test_the_route_name_and_prompt_are_registered():
    assert RouteName.NPC_HINT == "generateNpcHint" and len(RouteName.NPC_HINT) <= 32
    assert PERSONAS["npc-hint"] is NPC_HINT_PERSONA
    assert "—" not in NPC_HINT_PERSONA.system_prompt
    assert "Never say that you give, award, or unlock anything" in NPC_HINT_PERSONA.system_prompt


def test_the_schema_is_hint_text_and_a_disposition():
    assert NPC_HINT_OUTPUT_SCHEMA["required"] == ["spokenText", "safetyDisposition"]
    assert NPC_HINT_OUTPUT_SCHEMA["additionalProperties"] is False


def test_valid_output_is_trimmed_and_stripped_of_extra_fields():
    result = validate_npc_hint(
        {"spokenText": " Count slowly. ", "safetyDisposition": "allow", "unlock": "gate"},
        max_length=40,
    )
    assert result.valid and result.turn == {
        "spokenText": "Count slowly.",
        "safetyDisposition": "ALLOW",
    }


@pytest.mark.parametrize(
    "raw",
    [
        None,
        "text",
        ["spokenText"],
        {"safetyDisposition": "ALLOW"},
        {"spokenText": "   ", "safetyDisposition": "ALLOW"},
        {"spokenText": "Hi", "safetyDisposition": "OK"},
        {"spokenText": "z" * 41, "safetyDisposition": "ALLOW"},
        {"spokenText": "Go to http://x.io", "safetyDisposition": "ALLOW"},
        {"spokenText": "Tell me your phone number.", "safetyDisposition": "ALLOW"},
        {"spokenText": "Count — then look.", "safetyDisposition": "ALLOW"},
        {"spokenText": "I give you 5 coins!", "safetyDisposition": "ALLOW"},
        {"spokenText": "You won the treasure!", "safetyDisposition": "ALLOW"},
        {"spokenText": "Mark it as complete.", "safetyDisposition": "ALLOW"},
    ],
)
def test_invalid_output_is_refused(raw):
    assert not validate_npc_hint(raw, max_length=40).valid


def test_the_length_is_the_tighter_of_persona_and_band():
    assert max_length_for("SPROUT", 300) == 120
    assert max_length_for("PATHFINDER", 150) == 150
    assert max_length_for("EXPLORER", 400) == 320


def test_the_fallback_line_is_authored_and_deterministic():
    assert fallback_line(ctx()) == fallback_line(ctx())
    assert fallback_line(ctx()) in ctx().fallback_lines
    assert fallback_line(ctx(fallback_lines=())) == "Take a closer look. You can do this!"


def test_the_spec_is_server_built_with_no_untrusted_text():
    child = SimpleNamespace(age_band="SPROUT", pk="child-id", nickname="Zinnia")
    spec = build_spec(child, ctx())
    assert spec.route == "npc" and spec.route_name == RouteName.NPC_HINT
    assert spec.untrusted_context == {}
    assert spec.context_source == "DJANGO_CATALOG" and spec.input_category == "NPC_HINT"
    assert spec.trusted_context["maxLength"] == 120  # Sprout clamp under the persona's 150
    assert spec.trusted_context["personality"] == {"tone": "warm"}
    assert spec.trusted_context["allowedTopic"] == "counting planks"
    assert "Zinnia" not in str(spec.trusted_context) and "child-id" not in str(spec)
    assert spec.step_id == "pip:hello:greet" and spec.session_id == ctx().conversation_id
    assert spec.fallback(True)["spokenText"] in ctx().fallback_lines
    assert spec.redirect("STOP")["safetyDisposition"] == "STOP"


def test_the_fake_model_answers_a_valid_npc_hint_by_default():
    request = ModelRequest("npc", "", (), NPC_HINT_OUTPUT_SCHEMA, "npc_hint", 100, 0.2)
    assert validate_npc_hint(default_output(request), max_length=120).valid
