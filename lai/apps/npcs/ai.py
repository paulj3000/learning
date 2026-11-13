"""Hybrid AI hints for NPCs (workstream F, LAI-NPC-030, LAI-NPC-032, LAI-NPC-033).

Contract: docs/NPC_MANAGER_CONTRACTS.md section 5.3. The hint context is built here, on the
server, from the ACTIVE release snapshot only: the character's persona, the current node's
`allowedTopic` and authored text, and the child's age band. No client text is accepted. The turn
runs through the one shared AI pipeline (`apps.ai.services.pipeline.run_turn` via
`apps.ai.services.npc_hint`), which owns the parent switch, `LAI_AI_PROVIDER=disabled`, usage
limits and the kill switch, the provider and its timeouts, the Guardrail, output validation,
`boundary_violations`, the audit row (never text) and the fallbacks.

This module only reads `NpcConversationState` (it never moves the cursor) and writes nothing
else: no progress, quest, inventory, world change, relationship or session row. A hint is words.
"""

from __future__ import annotations

from dataclasses import dataclass

from apps.ai.services.npc_hint import NpcHintContext, fallback_line, request_npc_hint

from . import dialogue
from .models import NpcConversationState
from .published import PublishedRelease
from .state import ConversationEnded, ConversationNotFound
from .vocabulary import DialogueMode

#: Character modes that may ask a model for a hint. AUTHORED never calls a model.
HINT_MODES = frozenset({DialogueMode.HYBRID, DialogueMode.AI})


class HintUnavailable(LookupError):
    """The current node does not allow an AI hint (409 `dialogue_unavailable`)."""

    code = "dialogue_unavailable"


@dataclass(frozen=True)
class Hint:
    text: str
    source: str  # "AI" or "FALLBACK"


def current_node(child, release: PublishedRelease, character: dict, conversation_id) -> dict:
    """The node the child's open conversation with this NPC is at. Read only.

    `conversation_id` may be a `uuid.UUID` (path converter) or a str. Raises
    `ConversationNotFound` (not this child's current conversation) or `ConversationEnded`
    (ended, or started on a release that is no longer active).
    """
    npc_id = character["npcId"]
    state = (
        NpcConversationState.objects.filter(child=child, npc_id=npc_id)
        .only("conversation_id", "release_number", "dialogue_key", "node_key")
        .first()
    )
    wanted = str(conversation_id).lower()
    if state is None or state.conversation_id is None or str(state.conversation_id) != wanted:
        raise ConversationNotFound(wanted)
    if not state.node_key or state.release_number != release.number:
        raise ConversationEnded(wanted)
    current = release.dialogue(npc_id, state.dialogue_key)
    node = dialogue.node_by_key(current, state.node_key) if current else None
    if node is None:
        raise ConversationEnded(wanted)
    return {"dialogue": current, "node": node}


def _persona_serves(persona: dict, age_band: str) -> bool:
    bands = persona.get("ageBands") or []
    return not bands or age_band in bands


def hint_context(
    child, release: PublishedRelease, character: dict, conversation_id
) -> NpcHintContext:
    """The server-built context for a hint at the current node, or `HintUnavailable`."""
    found = current_node(child, release, character, conversation_id)
    node, current = found["node"], found["dialogue"]
    persona = character.get("persona")
    if (
        character.get("dialogueMode") not in HINT_MODES
        or not node.get("allowAiHint")
        or not (node.get("allowedTopic") or "").strip()
        or not isinstance(persona, dict)
    ):
        raise HintUnavailable
    return NpcHintContext(
        npc_id=character["npcId"],
        character_name=character.get("displayName") or character["npcId"],
        release=release.number,
        dialogue_key=current["dialogueKey"],
        node_key=node["nodeKey"],
        allowed_topic=node["allowedTopic"].strip(),
        authored_base_text=node.get("text") or "",
        persona_version=int(persona.get("version") or 0),
        personality_prompt=persona.get("personalityPrompt") or "",
        personality=dict(character.get("personality") or {}),
        max_response_chars=int(persona.get("maxResponseChars") or 0),
        fallback_lines=tuple(persona.get("fallbackLines") or ()),
        conversation_id=str(conversation_id).lower(),
    )


def request_hint(child, release: PublishedRelease, character: dict, conversation_id) -> Hint:
    """A hint for the child's current node: AI when allowed and safe, else an authored line."""
    ctx = hint_context(child, release, character, conversation_id)
    if not _persona_serves(character["persona"], child.age_band) or ctx.max_response_chars <= 0:
        # The persona was not approved for this band: authored words, no model call.
        return Hint(fallback_line(ctx), "FALLBACK")
    result = request_npc_hint(child, ctx)
    return Hint(result.turn["spokenText"], result.source)
