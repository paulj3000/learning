"""Child NPC conversation state (LAI-NPC-017).

One `NpcConversationState` per child and NPC holds the conversation cursor (conversation id,
release, dialogue, node), NPC-local flags, the dialogue keys this child has seen and a visit
count. Every change happens in a transaction under `select_for_update`, so two taps at once
cannot both move the cursor.

This module reads authoritative progress (through `conditions.context_for`) and never writes it:
no `NpcRelationship`, `WorldChange`, `QuestProgress` or inventory row is created or changed here.
"""

from __future__ import annotations

import dataclasses
import uuid
from dataclasses import dataclass

from django.db import transaction
from django.utils.timezone import now

from . import conditions, dialogue
from .models import NpcConversationState
from .published import PublishedRelease

#: Most dialogue keys remembered per child and NPC (the array field's size).
MAX_SEEN_DIALOGUES = 200


class ConversationNotFound(LookupError):
    code = "conversation_not_found"


class ConversationEnded(LookupError):
    code = "conversation_ended"


@dataclass(frozen=True)
class Conversation:
    """What the interaction API answers with (before serialisation)."""

    release: int
    npc_id: str
    conversation_id: str | None
    dialogue_key: str | None
    node: dict | None
    choices: list[dict]
    quest_offer: str | None = None

    @property
    def ended(self) -> bool:
        return self.node is None


def _locked_state(child, npc_id: str) -> NpcConversationState:
    state, _ = NpcConversationState.objects.select_for_update().get_or_create(
        child=child, npc_id=npc_id
    )
    return state


def _context(child, npc_id: str, state: NpcConversationState, *, in_conversation=False):
    # Visits counted by this state win; before the first counted conversation, an existing
    # NpcRelationship (the child met this NPC through play) makes it a return visit. Inside an
    # open conversation the current visit is not a prior one, so FIRST_VISIT and RETURN_VISIT
    # read the same on every node of one conversation.
    prior = (state.visit_count - (1 if in_conversation else 0)) or None
    return conditions.context_for(child, npc_id, local_flags=state.local_flags, prior_visits=prior)


def _offer(quest_slug: str | None, age_band: str) -> str | None:
    """The quest slug when it is an active catalog quest for this band; otherwise no offer."""
    if not quest_slug:
        return None
    from apps.catalog.models import Quest

    quest = Quest.objects.filter(slug=quest_slug, active=True).values("age_bands").first()
    if quest is None:
        return None
    bands = quest["age_bands"] or []
    return quest_slug if not bands or age_band in bands else None


def start(child, release: PublishedRelease, character: dict, trigger: str) -> Conversation:
    """Start the best dialogue for `trigger`, replacing any open cursor. No match: ended."""
    npc_id = character["npcId"]
    at = now()
    with transaction.atomic():
        state = _locked_state(child, npc_id)
        ctx = _context(child, npc_id, state)
        picked = dialogue.select(
            character.get("dialogues", []), trigger, ctx, set(state.seen_dialogue_keys)
        )
        state.last_trigger = trigger
        state.last_interaction_at = at
        if picked is None:
            state.save(update_fields=["last_trigger", "last_interaction_at"])
            return Conversation(release.number, npc_id, None, None, None, [])
        chosen, node = picked
        key = chosen["dialogueKey"]
        state.conversation_id = uuid.uuid4()
        state.release_number = release.number
        state.dialogue_key = key
        state.node_key = node["nodeKey"]
        state.conversation_started_at = at
        state.visit_count += 1
        seen = [k for k in state.seen_dialogue_keys if k != key] + [key]
        state.seen_dialogue_keys = seen[-MAX_SEEN_DIALOGUES:]
        state.save()
        return Conversation(
            release.number,
            npc_id,
            str(state.conversation_id),
            key,
            node,
            dialogue.visible_choices(node, ctx),
        )


def act(
    child,
    release: PublishedRelease,
    character: dict,
    conversation_id: str,
    action: str,
    choice_key: str | None = None,
) -> Conversation:
    """`choose`, `advance` or `end` the child's current conversation with this NPC.

    Raises `ConversationNotFound` (not this child's current conversation), `ConversationEnded`
    (already ended, or started on a release that is no longer active: it is ended first) and
    `dialogue.InvalidChoice`.
    """
    npc_id = character["npcId"]
    ended_by_release = False
    with transaction.atomic():
        state = (
            NpcConversationState.objects.select_for_update()
            .filter(child=child, npc_id=npc_id)
            .first()
        )
        if state is None or str(state.conversation_id) != conversation_id:
            raise ConversationNotFound(conversation_id)
        if not state.node_key:
            raise ConversationEnded(conversation_id)
        current = release.dialogue(npc_id, state.dialogue_key)
        node = dialogue.node_by_key(current, state.node_key) if current else None
        if state.release_number != release.number or node is None:
            _close(state)
            ended_by_release = True
        else:
            result = _apply(child, release, state, current, node, action, choice_key)
    if ended_by_release:  # raised after the commit, so the cursor stays closed
        raise ConversationEnded(conversation_id)
    return result


def _close(state: NpcConversationState) -> None:
    state.node_key = ""
    state.last_interaction_at = now()
    state.save(update_fields=["node_key", "last_interaction_at"])


def _apply(child, release, state, current, node, action, choice_key) -> Conversation:
    ctx = _context(child, state.npc_id, state, in_conversation=True)
    if action == "end":
        step = dialogue.Step(node=None, local_flags=dict(ctx.local_flags))
    elif action == "advance":
        step = dialogue.advance(current, node, ctx)
    elif action == "choose":
        step = dialogue.choose(current, node, choice_key or "", ctx)
    else:
        raise dialogue.InvalidChoice(action)
    state.local_flags = step.local_flags
    state.node_key = "" if step.ended else step.node["nodeKey"]
    state.last_interaction_at = now()
    state.save(update_fields=["local_flags", "node_key", "last_interaction_at"])
    after = dataclasses.replace(ctx, local_flags=step.local_flags)
    return Conversation(
        release.number,
        state.npc_id,
        str(state.conversation_id),
        state.dialogue_key,
        step.node,
        [] if step.ended else dialogue.visible_choices(step.node, after),
        _offer(step.quest_offer, child.age_band),
    )
