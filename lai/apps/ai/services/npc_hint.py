"""A hybrid hint voiced by a published NPC persona (LAI-NPC-030, LAI-NPC-032). Django only.

The NPC Manager (`apps.npcs.ai`) builds `NpcHintContext` from the ACTIVE release snapshot alone
and calls `request_npc_hint`; this module turns it into a `TurnSpec` for the one shared pipeline
(`run_turn`). Nothing here reads a request body: there is no client text, so `untrusted_context`
is empty, and every field below was authored by staff and published in a release.

Fallbacks are the persona's own authored lines (`fallbackLines`); a Guardrail block or a
REDIRECT/STOP disposition uses the companion's authored redirect line. Nothing in this module
writes gameplay state; `run_turn` writes only the audit row, a safety event and usage counters.
"""

from __future__ import annotations

import zlib
from dataclasses import dataclass
from functools import partial

from ..contracts import NPC_HINT_OUTPUT_SCHEMA, NPC_HINT_OUTPUT_SCHEMA_VERSION, validate_npc_hint
from ..fallbacks import FALLBACK_TURNS
from ..limits import MAX_SPOKEN_LENGTH_BY_AGE_BAND
from ..models import ContextSource, RouteName
from ..prompts import NPC_HINT_PERSONA
from .pipeline import TurnResult, TurnSpec, run_turn

REPLY_FIELDS = (
    "spokenText (string, at most maxLength characters: one short hint about allowedTopic, in "
    "the character's voice), safetyDisposition (ALLOW, REDIRECT or STOP)."
)

#: The closed audit `input_category` for this route.
INPUT_CATEGORY = "NPC_HINT"


@dataclass(frozen=True)
class NpcHintContext:
    """Everything the model may see, all from the published release (never from a client)."""

    npc_id: str
    character_name: str
    release: int
    dialogue_key: str
    node_key: str
    allowed_topic: str
    authored_base_text: str
    persona_version: int
    personality_prompt: str
    personality: dict
    max_response_chars: int
    fallback_lines: tuple[str, ...]
    conversation_id: str = ""


def max_length_for(age_band: str, persona_max: int) -> int:
    """The tighter of the persona's limit and the age band's AI limit."""
    return min(persona_max, MAX_SPOKEN_LENGTH_BY_AGE_BAND[age_band])


def fallback_line(ctx: NpcHintContext) -> str:
    """One of the persona's authored lines, chosen deterministically per node."""
    lines = [line for line in ctx.fallback_lines if isinstance(line, str) and line.strip()]
    if not lines:  # release validation forbids this; never leave a child without a line
        return FALLBACK_TURNS["HINT"]["spokenText"]
    index = zlib.crc32(f"{ctx.dialogue_key}:{ctx.node_key}".encode()) % len(lines)
    return lines[index].strip()


def _fallback(ctx: NpcHintContext, _reuse: bool) -> dict:
    return {"spokenText": fallback_line(ctx), "safetyDisposition": "ALLOW"}


def _redirect(disposition: str) -> dict:
    return {
        "spokenText": FALLBACK_TURNS["REDIRECT"]["spokenText"],
        "safetyDisposition": disposition,
    }


def build_spec(child, ctx: NpcHintContext) -> TurnSpec:
    max_length = max_length_for(child.age_band, ctx.max_response_chars)
    personality = {
        k: v for k, v in (ctx.personality or {}).items() if k in ("traits", "tone", "catchphrases")
    }
    trusted = {
        "characterName": ctx.character_name,
        "persona": ctx.personality_prompt,
        "personality": personality or None,
        "allowedTopic": ctx.allowed_topic,
        "authoredBaseText": ctx.authored_base_text,
        "ageBand": child.age_band,
        "intent": "HINT",
        "maxLength": max_length,
    }
    return TurnSpec(
        route="npc",
        route_name=RouteName.NPC_HINT,
        persona=NPC_HINT_PERSONA,
        output_schema=NPC_HINT_OUTPUT_SCHEMA,
        schema_name="npc_hint",
        output_schema_version=NPC_HINT_OUTPUT_SCHEMA_VERSION,
        input_category=INPUT_CATEGORY,
        disposition_category="npc-hint",
        context_source=ContextSource.DJANGO_CATALOG,
        trusted_context=trusted,
        untrusted_context={},
        reply_fields=REPLY_FIELDS,
        validate=partial(validate_npc_hint, max_length=max_length),
        fallback=partial(_fallback, ctx),
        redirect=_redirect,
        fake_hints={"npcHint": True},
        # The conversation id bounds turns per conversation (`usage.admit` session limit) and
        # correlates the audit row; it is an opaque id, never a child identifier.
        session_id=ctx.conversation_id,
        step_id=f"{ctx.npc_id}:{ctx.dialogue_key}:{ctx.node_key}"[:100],
    )


def request_npc_hint(child, ctx: NpcHintContext) -> TurnResult:
    return run_turn(child, build_spec(child, ctx))
