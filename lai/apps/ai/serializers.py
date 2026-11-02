"""Request validation for the AI turn endpoints (LAI-0702, LAI-0703, LAI-0704).

What a client may send is only what the server can bound or check. Anything else in a body is
ignored, including fields a client might hope to set: `childProfileId`, `ageBand`, `maxLength`,
`aiEnabled`, `systemPrompt`, `validationStatus`, `safetyDisposition`, `modelId`. The child, its
age band and its AI switch come from Django; the prompt, limits and audit values from code.
"""

import re

from django.conf import settings
from rest_framework import serializers

from .contracts import INTENTS
from .limits import (
    MAX_AUTHORED_BASE_TEXT,
    MAX_CHOICE_ID,
    MAX_CHOICE_IDS,
    MAX_CORRELATION_ID,
    MAX_HINT_LEVEL,
    MAX_OBJECTIVE_CODE,
    MAX_STEP_SUMMARY,
    MAX_TEMPLATE_ID,
)
from .models import ContextSource

# Control characters (tab and newline excepted) and bidirectional overrides, which can hide
# instructions from a human reviewer while a model still reads them.
_HIDDEN = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f​-‏‪-‮⁦-⁩]")
_IDENTIFIER = r"^[a-z0-9][a-z0-9:._-]*$"


def _no_hidden_characters(value: str) -> str:
    if _HIDDEN.search(value):
        raise serializers.ValidationError("Contains characters that are not allowed.", "hidden")
    return value


def _text(max_length: int, **kwargs) -> serializers.CharField:
    return serializers.CharField(
        max_length=max_length, validators=[_no_hidden_characters], **kwargs
    )


def _identifier(max_length: int, **kwargs) -> serializers.RegexField:
    return serializers.RegexField(_IDENTIFIER, max_length=max_length, **kwargs)


class _TurnRequest(serializers.Serializer):
    contextSource = serializers.ChoiceField(
        choices=ContextSource.values, default=ContextSource.CLIENT_AUTHORED
    )
    # The adventure template (or `npc:<id>`, `story:<id>`) the turn belongs to (CLAUDE.md
    # section 7). Ignored for DJANGO_SESSION, where the session names it.
    templateId = _identifier(MAX_TEMPLATE_ID, required=False)
    sessionId = _identifier(MAX_CORRELATION_ID, required=False)
    stepId = _identifier(MAX_CORRELATION_ID, required=False)
    hintLevel = serializers.IntegerField(min_value=0, max_value=MAX_HINT_LEVEL, required=False)
    authoredBaseText = _text(MAX_AUTHORED_BASE_TEXT, required=False, allow_blank=True)

    catalog_required: tuple[str, ...] = ()

    def validate(self, attrs):
        errors = {}
        source = attrs["contextSource"]
        if source == ContextSource.DJANGO_CATALOG:
            if not self.catalog_required:
                errors["contextSource"] = "Not supported for this route."
            for name in self.catalog_required:
                if not attrs.get(name):
                    errors[name] = "Required for DJANGO_CATALOG."
        elif source == ContextSource.CLIENT_AUTHORED and not settings.LAI_AI_ALLOW_CLIENT_AUTHORED:
            errors["contextSource"] = "CLIENT_AUTHORED is disabled here."
        elif source == ContextSource.DJANGO_SESSION:
            for name in ("sessionId", "stepId"):
                if not attrs.get(name):
                    errors[name] = "Required for DJANGO_SESSION."
        if source == ContextSource.CLIENT_AUTHORED:
            for name in self.client_required:
                if attrs.get(name) in (None, ""):
                    errors[name] = "Required for CLIENT_AUTHORED."
        if errors:
            raise serializers.ValidationError(errors)
        if attrs.get("authoredBaseText") == "":
            attrs.pop("authoredBaseText")
        return attrs


class CompanionTurnRequest(_TurnRequest):
    client_required = ("templateId", "stepSummary")
    catalog_required = ("npcId", "nodeId")

    intent = serializers.ChoiceField(choices=INTENTS)
    stepSummary = _text(MAX_STEP_SUMMARY, required=False)
    learningObjectiveCode = _identifier(MAX_OBJECTIVE_CODE, required=False)
    allowedChoiceIds = serializers.ListField(
        child=_identifier(MAX_CHOICE_ID), max_length=MAX_CHOICE_IDS, required=False
    )
    # DJANGO_CATALOG (NPC dialogue, LAI-0709): the node whose authored narration hint to voice.
    npcId = _identifier(MAX_TEMPLATE_ID, required=False)
    nodeId = _identifier(MAX_CORRELATION_ID, required=False)

    def validate(self, attrs):
        attrs = super().validate(attrs)
        if attrs["contextSource"] == ContextSource.DJANGO_CATALOG and attrs["intent"] != "NARRATE":
            raise serializers.ValidationError({"intent": "NPC narration is NARRATE only."})
        return attrs


class TutorTurnRequest(_TurnRequest):
    client_required = ("templateId", "hintLevel")

    # `Skill.id`, the step's `learningObjectiveCode`.
    skillId = _identifier(MAX_OBJECTIVE_CODE)
