"""Interaction API (workstream C, LAI-NPC-012/013/017).

Contract: docs/NPC_MANAGER_CONTRACTS.md section 5.2. The server selects dialogue from the ACTIVE
release, filters nodes and choices by the child's age band and conditions, and keeps the
conversation cursor in `NpcConversationState`. No route here writes progress.
"""

from __future__ import annotations

from rest_framework import serializers
from rest_framework.response import Response

from apps.game_sessions.serializers import ClosedSerializer

from . import dialogue, state, triggers
from .api import NpcScopedView, npc_error
from .vocabulary import CONTRACT_VERSION


class StartRequest(ClosedSerializer):
    trigger = serializers.CharField(max_length=40)
    placementKey = serializers.SlugField(max_length=100, required=False)  # noqa: N815


class ChooseRequest(ClosedSerializer):
    choiceKey = serializers.SlugField(max_length=60)  # noqa: N815


class EmptyRequest(ClosedSerializer):
    pass


def _body(request) -> dict:
    data = request.data
    return data if isinstance(data, dict) else {"_": data}  # a non-object body is refused


def runtime_node(node: dict | None, character: dict, release: int, dialogue_key: str | None):
    if node is None:
        return None
    speech = None
    if character.get("voiceProfile"):
        speech = {
            "kind": "npcDialogueNode",
            "npcId": character["npcId"],
            "release": release,
            "dialogueKey": dialogue_key,
            "nodeKey": node["nodeKey"],
        }
    return {
        "nodeKey": node["nodeKey"],
        "text": node["text"],
        "emotion": node["emotion"],
        "animationState": node.get("animationState") or None,
        "audio": node.get("audio"),
        "speech": speech,
        "allowAiHint": bool(node.get("allowAiHint")),
    }


def interaction_body(conversation: state.Conversation, character: dict) -> dict:
    return {
        "contractVersion": CONTRACT_VERSION,
        "release": conversation.release,
        "npcId": conversation.npc_id,
        "conversationId": conversation.conversation_id,
        "dialogueKey": conversation.dialogue_key,
        "node": runtime_node(
            conversation.node, character, conversation.release, conversation.dialogue_key
        ),
        "choices": [
            {"choiceKey": c["choiceKey"], "label": c["label"], "action": c["action"]}
            for c in conversation.choices
        ],
        "ended": conversation.ended,
        "questOffer": ({"questId": conversation.quest_offer} if conversation.quest_offer else None),
    }


def _already_over(release, npc_id: str, conversation_id: str) -> dict:
    """The `end` answer for a conversation that is no longer open."""
    return {
        "contractVersion": CONTRACT_VERSION,
        "release": release.number,
        "npcId": npc_id,
        "conversationId": conversation_id,
        "dialogueKey": None,
        "node": None,
        "choices": [],
        "ended": True,
        "questOffer": None,
    }


class _InteractionView(NpcScopedView):
    def _character_and_release(self, npc_id: str):
        """The character and the release it came from (one release, even across a publish)."""
        self.published_character(npc_id)  # scope, age band and placement checks (404)
        release = self.release()
        character = release.characters.get(npc_id)
        if character is None:
            raise npc_error("npc_not_found", 404)
        return character, release


class InteractionStartView(_InteractionView):
    """POST .../npcs/<npc>/interactions/ {"trigger", "placementKey"?}: start a conversation."""

    def post(self, request, child_id, npc_id, **scope):
        body = StartRequest(data=_body(request))
        body.is_valid(raise_exception=True)
        try:
            trigger = triggers.validate_trigger(body.validated_data["trigger"])
        except triggers.InvalidTrigger:
            raise npc_error("invalid_trigger", 400) from None
        character, release = self._character_and_release(npc_id)
        placement_key = body.validated_data.get("placementKey")
        if placement_key is not None:
            here = release.placements(place=self.scope.place, area=self.scope.area)
            if not any(p["npcId"] == npc_id and p["placementKey"] == placement_key for p in here):
                raise npc_error("npc_not_found", 404)
        conversation = state.start(self.child, release, character, trigger)
        return Response(interaction_body(conversation, character))


class InteractionActionView(_InteractionView):
    """POST .../interactions/<conversation>/(choose|advance|end)/."""

    def post(self, request, child_id, npc_id, conversation_id, action, **scope):
        if action == "choose":
            body = ChooseRequest(data=_body(request))
        else:
            body = EmptyRequest(data=_body(request) if request.data else {})
        body.is_valid(raise_exception=True)
        character, release = self._character_and_release(npc_id)
        try:
            conversation = state.act(
                self.child,
                release,
                character,
                str(conversation_id),  # the route's uuid converter yields a UUID
                action,
                body.validated_data.get("choiceKey"),
            )
        except (state.ConversationNotFound, state.ConversationEnded) as error:
            if action == "end":
                # Ending is idempotent: a conversation that is already over (ended, replaced by
                # a newer one, or from an older release) is simply over. A client's best-effort
                # end can race its next start; that is not an error the browser should log.
                return Response(_already_over(release, npc_id, str(conversation_id)))
            if isinstance(error, state.ConversationNotFound):
                raise npc_error("conversation_not_found", 404) from None
            raise npc_error("conversation_ended", 409) from None
        except dialogue.InvalidChoice:
            raise npc_error("invalid_choice", 409) from None
        return Response(interaction_body(conversation, character))
