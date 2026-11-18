"""Keeper Quill's flavour lines in the castle (SC-R09-02): the `npc_hint` route, no new route.

A castle ambient event that Quill is part of (`castle_events`) has an authored line. When the
ACTIVE release publishes Quill with a staff-approved persona that allows hints, the line may be
re-voiced by that persona through the one shared pipeline (`request_npc_hint`); in every other
case, and on every failure, the authored line is what comes back. The model sees only the
persona, an allowed topic, the authored line, the age band and the length limit: no child text
(`untrusted_context` is empty), no choices, and nothing here sets a flag or writes any state. A
URL, a request for personal information, an over-length line, a reward claim or an em dash in the
model's reply is rejected by the same validator every NPC hint uses, and the authored line is
shown instead.

Only a character published in the release can speak: this module cannot name a persona, so a
memory flag or any other dialogue state outside the release is impossible by construction.
"""

from __future__ import annotations

from apps.ai.services.npc_hint import NpcHintContext, request_npc_hint

from . import published
from .ai import HINT_MODES, Hint, _persona_serves

#: The one character whose castle lines may be re-voiced.
QUILL = "keeper-quill"
#: What the persona may talk about here. Authored, never from a client.
ALLOWED_TOPIC = "a quiet, cosy moment in Storykeeper Castle"
DIALOGUE_KEY = "castle-ambient"


def authored_line(event: dict, band: str) -> str:
    return event["lines"][band][0].strip()


def quill_flavour(child, event: dict) -> Hint:
    """The line to show for a Quill castle event: persona-voiced when allowed, else authored."""
    line = authored_line(event, child.age_band)
    if event.get("npcId") != QUILL:
        return Hint(line, "FALLBACK")
    try:
        release = published.current()
        character = release.character(QUILL)
    except (published.NoActiveRelease, published.NpcNotPublished):
        return Hint(line, "FALLBACK")
    persona = character.get("persona")
    if (
        character.get("dialogueMode") not in HINT_MODES
        or not isinstance(persona, dict)
        or not _persona_serves(persona, child.age_band)
        or int(persona.get("maxResponseChars") or 0) <= 0
    ):
        return Hint(line, "FALLBACK")
    context = NpcHintContext(
        npc_id=QUILL,
        character_name=character.get("displayName") or QUILL,
        release=release.number,
        dialogue_key=DIALOGUE_KEY,
        node_key=event["id"],
        allowed_topic=ALLOWED_TOPIC,
        authored_base_text=line,
        persona_version=int(persona.get("version") or 0),
        personality_prompt=persona.get("personalityPrompt") or "",
        personality=dict(character.get("personality") or {}),
        max_response_chars=int(persona.get("maxResponseChars") or 0),
        # The authored event line is the fallback, so a failure shows exactly the approved copy.
        fallback_lines=(line,),
    )
    result = request_npc_hint(child, context)
    return Hint(result.turn["spokenText"], result.source)
