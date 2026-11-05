"""Response contracts and their validators (LAI-0701).

`CompanionTurn` and `TutorTurn` are the shapes the React client renders today
(`react/src/features/companion/schema.ts`, `react/src/features/tutor/types.ts`).
`validate_companion_turn` and `validate_tutor_turn` are line-for-line ports of
`validateCompanionTurn` and `validateTutorTurn`, reasons included, and the golden vectors in
`tests/golden/ai-safety.json` prove they agree with the TypeScript. Model output is untrusted:
it is `object` until one of these accepts it.

`*_OUTPUT_SCHEMA` are the JSON schemas sent to Bedrock structured outputs. They constrain the
shape, not the content; the validators are still the authority (a schema cannot express length
in UTF-16 units, allowed choice ids, or vocabulary).
"""

from dataclasses import dataclass

from .content_safety import claims_learning_judgment, contains_url, requests_personal_information
from .jscompat import js_length, js_regex, js_trim
from .tutor_content import REPRESENTATIONS, TUTOR_STRATEGIES, disallowed_curriculum_terms

EMOTIONS = ("CHEERFUL", "CURIOUS", "CALM", "ENCOURAGING")
INTENTS = ("NARRATE", "ASK", "HINT", "CELEBRATE", "REDIRECT")
DISPOSITIONS = ("ALLOW", "REDIRECT", "STOP")

# Bump when a response shape changes; written to every audit row (`outputSchemaVersion`).
COMPANION_OUTPUT_SCHEMA_VERSION = 1
TUTOR_OUTPUT_SCHEMA_VERSION = 1

_EMOTION_SYNONYMS = [
    ("CHEERFUL", js_regex(r"\b(playful|joyful|happy|cheerful|excited|fun|delighted)\b")),
    ("CURIOUS", js_regex(r"\b(curious|wonder(ing)?|intrigued|inquisitive)\b")),
    ("CALM", js_regex(r"\b(calm|peaceful|gentle|relaxed|soothing|focused)\b")),
    ("ENCOURAGING", js_regex(r"\b(encouraging|warm|supportive|proud|kind)\b")),
]


def normalize_enum_value(value: object, allowed: tuple[str, ...]) -> str | None:
    if not isinstance(value, str):
        return None
    upper = value.upper()
    return upper if upper in allowed else None


def normalize_emotion(value: object) -> str | None:
    exact = normalize_enum_value(value, EMOTIONS)
    if exact:
        return exact
    if not isinstance(value, str):
        return None
    for emotion, pattern in _EMOTION_SYNONYMS:
        if pattern.search(value):
            return emotion
    return None


@dataclass(frozen=True, slots=True)
class Valid:
    turn: dict

    valid = True

    def as_dict(self) -> dict:
        return {"valid": True, "turn": self.turn}


@dataclass(frozen=True, slots=True)
class Invalid:
    reason: str

    valid = False

    def as_dict(self) -> dict:
        return {"valid": False, "reason": self.reason}


def _is_record(value: object) -> bool:
    """`isRecord`: JavaScript `typeof value === 'object'`, so an array counts too."""
    return isinstance(value, (dict, list))


def _get(raw: object, key: str) -> object:
    return raw.get(key) if isinstance(raw, dict) else None


def _is_choice_list(value: object) -> bool:
    return isinstance(value, list) and all(
        isinstance(item, dict)
        and isinstance(item.get("id"), str)
        and isinstance(item.get("label"), str)
        for item in value
    )


def _is_blank(value: object) -> bool:
    return not isinstance(value, str) or len(js_trim(value)) == 0


def validate_companion_turn(
    raw: object,
    *,
    expected_intent: str,
    max_length: int,
    allowed_choice_ids: list[str] | None = None,
) -> Valid | Invalid:
    if not _is_record(raw):
        return Invalid("Response was not an object.")
    spoken_text = _get(raw, "spokenText")
    choices = _get(raw, "choices")
    if _is_blank(spoken_text):
        return Invalid("spokenText was missing or empty.")
    emotion = normalize_emotion(_get(raw, "emotion"))
    if not emotion:
        return Invalid("emotion was missing or not a known value.")
    intent = normalize_enum_value(_get(raw, "intent"), INTENTS)
    if not intent:
        return Invalid("intent was missing or not a known value.")
    disposition = normalize_enum_value(_get(raw, "safetyDisposition"), DISPOSITIONS)
    if not disposition:
        return Invalid("safetyDisposition was missing or not a known value.")
    if intent != expected_intent and intent != "REDIRECT":
        return Invalid(f'intent "{intent}" did not match the requested intent.')
    if js_length(spoken_text) > max_length:
        return Invalid("spokenText exceeded the age band length limit.")
    if contains_url(spoken_text):
        return Invalid("spokenText contained a URL.")
    if requests_personal_information(spoken_text):
        return Invalid("spokenText requested personal information.")

    validated_choices = None
    if choices is not None:
        if not _is_choice_list(choices):
            return Invalid("choices was not a list of {id, label}.")
        if not allowed_choice_ids:
            return Invalid("choices were offered but none were allowed.")
        if any(choice["id"] not in allowed_choice_ids for choice in choices):
            return Invalid("choices included an ID that was not allowed.")
        # The TypeScript keeps each choice object as given; only `{id, label}` is read, and the
        # renderer ignores anything else. Django returns exactly those two fields.
        validated_choices = [{"id": c["id"], "label": c["label"]} for c in choices]

    turn = {
        "spokenText": spoken_text,
        "emotion": emotion,
        "intent": intent,
        "safetyDisposition": disposition,
    }
    if validated_choices is not None:
        turn["choices"] = validated_choices
    return Valid(turn)


def validate_tutor_turn(raw: object, context: dict) -> Valid | Invalid:
    """`context` is the TypeScript `TutorContext` shape (`TutorContext.as_dict()`)."""
    if not _is_record(raw):
        return Invalid("Response was not an object.")
    spoken_text = _get(raw, "spokenText")
    if _is_blank(spoken_text):
        return Invalid("spokenText was missing or empty.")
    strategy = normalize_enum_value(_get(raw, "strategy"), TUTOR_STRATEGIES)
    if not strategy:
        return Invalid("strategy was missing or not an approved strategy.")
    if strategy != context["strategy"]:
        return Invalid(f'strategy "{strategy}" did not match the requested strategy.')
    emotion = normalize_emotion(_get(raw, "emotion"))
    if not emotion:
        return Invalid("emotion was missing or not a known value.")
    disposition = normalize_enum_value(_get(raw, "safetyDisposition"), DISPOSITIONS)
    if not disposition:
        return Invalid("safetyDisposition was missing or not a known value.")
    if js_length(spoken_text) > context["maxLength"]:
        return Invalid("spokenText exceeded the age band length limit.")
    if contains_url(spoken_text):
        return Invalid("spokenText contained a URL.")
    if requests_personal_information(spoken_text):
        return Invalid("spokenText requested personal information.")
    if claims_learning_judgment(spoken_text):
        return Invalid("spokenText judged the child or claimed mastery.")
    stray = disallowed_curriculum_terms(spoken_text, context["allowedVocabulary"])
    if stray:
        return Invalid(f"spokenText used curriculum terms outside this skill: {', '.join(stray)}.")

    representation = None
    raw_representation = _get(raw, "representation")
    if raw_representation is not None and raw_representation != "":
        if not isinstance(raw_representation, str):
            return Invalid("representation was not a string.")
        normalized = raw_representation.lower()
        if normalized not in REPRESENTATIONS:
            return Invalid("representation was not a known representation.")
        if strategy != "SWITCH_REPRESENTATION":
            return Invalid(
                "representation was set on a turn that was not switching representation."
            )
        if normalized not in context["allowedRepresentations"]:
            return Invalid("representation was not one the curriculum authored for this skill.")
        representation = normalized

    turn = {"spokenText": spoken_text, "strategy": strategy}
    if representation is not None:
        turn["representation"] = representation
    turn["emotion"] = emotion
    turn["safetyDisposition"] = disposition
    return Valid(turn)


# --- Bedrock structured-output schemas ---------------------------------------------------------

COMPANION_OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "spokenText": {"type": "string", "description": "What Chatty says, read aloud."},
        "emotion": {"type": "string", "enum": list(EMOTIONS)},
        "intent": {"type": "string", "enum": list(INTENTS)},
        "choices": {
            "type": ["array", "null"],
            "items": {
                "type": "object",
                "properties": {"id": {"type": "string"}, "label": {"type": "string"}},
                "required": ["id", "label"],
                "additionalProperties": False,
            },
        },
        "safetyDisposition": {"type": "string", "enum": list(DISPOSITIONS)},
    },
    "required": ["spokenText", "emotion", "intent", "choices", "safetyDisposition"],
    "additionalProperties": False,
}

TUTOR_OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "spokenText": {"type": "string", "description": "What Chatty says, read aloud."},
        "strategy": {"type": "string", "enum": list(TUTOR_STRATEGIES)},
        "representation": {"type": ["string", "null"]},
        "emotion": {"type": "string", "enum": list(EMOTIONS)},
        "safetyDisposition": {"type": "string", "enum": list(DISPOSITIONS)},
    },
    "required": ["spokenText", "strategy", "representation", "emotion", "safetyDisposition"],
    "additionalProperties": False,
}


# --- NPC hybrid hint (LAI-NPC-032), Django only ------------------------------------------------

NPC_HINT_OUTPUT_SCHEMA_VERSION = 1

NPC_HINT_OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "spokenText": {"type": "string", "description": "The character's hint, read aloud."},
        "safetyDisposition": {"type": "string", "enum": list(DISPOSITIONS)},
    },
    "required": ["spokenText", "safetyDisposition"],
    "additionalProperties": False,
}

_EM_DASH = "—"


def validate_npc_hint(raw: object, *, max_length: int) -> Valid | Invalid:
    """An NPC hint is `{spokenText, safetyDisposition}`; anything else in `raw` is dropped.

    Stricter than the companion port: no em dash (child copy rule), and no line that claims a
    reward, unlock or mastery (an NPC never changes gameplay state, so it may not say it did).
    `boundary_violations` still runs after this, in the pipeline.
    """
    from .services.safety import _MASTERY_OR_REWARD

    if not isinstance(raw, dict):
        return Invalid("Response was not an object.")
    spoken_text = raw.get("spokenText")
    if _is_blank(spoken_text):
        return Invalid("spokenText was missing or empty.")
    disposition = normalize_enum_value(raw.get("safetyDisposition"), DISPOSITIONS)
    if not disposition:
        return Invalid("safetyDisposition was missing or not a known value.")
    spoken_text = js_trim(spoken_text)
    if js_length(spoken_text) > max_length:
        return Invalid("spokenText exceeded the age band length limit.")
    if contains_url(spoken_text):
        return Invalid("spokenText contained a URL.")
    if requests_personal_information(spoken_text):
        return Invalid("spokenText requested personal information.")
    if _EM_DASH in spoken_text:
        return Invalid("spokenText contained an em dash.")
    if _MASTERY_OR_REWARD.search(spoken_text) or _NPC_GAMEPLAY_CLAIM.search(spoken_text):
        return Invalid("spokenText claimed a reward, an unlock or a result.")
    return Valid({"spokenText": spoken_text, "safetyDisposition": disposition})


# Lines a character could use to pretend the game state changed ("here is your treasure").
_NPC_GAMEPLAY_CLAIM = js_regex(
    r"\b(i('ve| have)? (just )?(gave|give|given|unlocked|unlock|opened|awarded))\b"
    r"|\b(here('s| is| are) (your|some|a) (treasure|coins?|gems?|stars?|points?|prize|reward"
    r"|key))\b|\byou (won|win|earned|unlocked|got it right|got it wrong|are right|are wrong)\b"
)
