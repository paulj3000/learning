"""Chatty's companion turn, the Django replacement for `generateCompanionTurn` (LAI-0702)."""

from functools import partial

from ..contracts import (
    COMPANION_OUTPUT_SCHEMA,
    COMPANION_OUTPUT_SCHEMA_VERSION,
    validate_companion_turn,
)
from ..fallbacks import companion_authored_fallback, companion_redirect
from ..limits import MAX_SPOKEN_LENGTH_BY_AGE_BAND
from ..models import ContextSource, RouteName
from ..prompts import COMPANION_PERSONA
from . import context as ctx
from .pipeline import TurnResult, TurnSpec, run_turn

REPLY_FIELDS = (
    "spokenText (string, at most maxLength characters), emotion (CHEERFUL, CURIOUS, CALM or "
    "ENCOURAGING), intent (the requested intent, or REDIRECT), choices (a list of {id, label} "
    "using only allowedChoiceIds, or null), safetyDisposition (ALLOW, REDIRECT or STOP)."
)


def request_companion_turn(child, data: dict) -> TurnResult:
    """`data` is the validated request (`serializers.CompanionTurnRequest`)."""
    intent = data["intent"]
    max_length = MAX_SPOKEN_LENGTH_BY_AGE_BAND[child.age_band]
    allowed_choice_ids = data.get("allowedChoiceIds") or None

    if data["contextSource"] == ContextSource.DJANGO_CATALOG:
        narration = ctx.load_npc_narration(data["npcId"], data["nodeId"], child=child)
        authored_base_text = narration.fallback_text
        allowed_choice_ids = None
        trusted = {
            "adventureTemplateId": narration.template_id,
            "stepSummary": narration.allowed_topic,
            "authoredBaseText": authored_base_text,
            **narration.extra,
        }
        untrusted = {}
        session_id, step_id = "", data["nodeId"]
    elif data["contextSource"] == ContextSource.DJANGO_SESSION:
        step = ctx.load_session_step(child, data["sessionId"], data["stepId"])
        hint_level = step.hint_level
        authored_base_text = step.hint_text(hint_level) if intent == "HINT" else step.prompt
        if allowed_choice_ids:
            allowed_choice_ids = [i for i in allowed_choice_ids if i in step.option_ids] or None
        trusted = {
            "adventureTemplateId": step.template_id,
            "stepSummary": step.prompt or step.step_id,
            "learningObjectiveCode": step.objective_ids[0] if step.objective_ids else None,
            "hintLevel": hint_level or None,
            "authoredBaseText": authored_base_text,
        }
        untrusted = {}
        session_id, step_id = step.session_id, step.step_id
    else:
        authored_base_text = data.get("authoredBaseText")
        trusted = {
            "adventureTemplateId": data["templateId"],
            "learningObjectiveCode": data.get("learningObjectiveCode"),
            "hintLevel": data.get("hintLevel"),
        }
        untrusted = {
            "stepSummary": data["stepSummary"],
            "authoredBaseText": authored_base_text,
        }
        session_id, step_id = data.get("sessionId", ""), data.get("stepId", "")

    trusted.update(
        {
            "ageBand": child.age_band,
            "intent": intent,
            "maxLength": max_length,
            "allowedChoiceIds": allowed_choice_ids,
        }
    )
    spec = TurnSpec(
        route="companion",
        route_name=RouteName.COMPANION,
        persona=COMPANION_PERSONA,
        output_schema=COMPANION_OUTPUT_SCHEMA,
        schema_name="companion_turn",
        output_schema_version=COMPANION_OUTPUT_SCHEMA_VERSION,
        input_category=intent,
        disposition_category=f"companion-turn-{intent.lower()}",
        context_source=data["contextSource"],
        trusted_context=trusted,
        untrusted_context=untrusted,
        reply_fields=REPLY_FIELDS,
        validate=partial(
            _validate,
            expected_intent=intent,
            max_length=max_length,
            allowed_choice_ids=allowed_choice_ids,
        ),
        fallback=lambda reuse: companion_authored_fallback(
            intent, authored_base_text, reuse_authored_text=reuse
        ),
        redirect=companion_redirect,
        fake_hints={"intent": intent},
        session_id=session_id,
        step_id=step_id,
    )
    return run_turn(child, spec)


def _validate(raw, **kwargs):
    return validate_companion_turn(raw, **kwargs)
