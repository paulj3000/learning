"""NPCs (LAI-0605). Child-scoped, bearer only (LAI-0403). Contract: docs/PLAY_API.md, "NPCs".

GET  /api/v1/children/{child_id}/npcs/                  every NPC, with this child's relationship
GET  /api/v1/children/{child_id}/npcs/{npc_id}/         one NPC
POST /api/v1/children/{child_id}/npcs/{npc_id}/talk/     no body: the entry node the rules select
POST /api/v1/children/{child_id}/npcs/{npc_id}/choices/  {"fromNodeId", "choiceId"}: the next node

Talk and choice responses: {"npcId", "node": {"id", "text", "choices": [{"id", "label"}]} | null,
"relationship", "questUpdates", "rewards"}. Conditions, flags and points are never sent.
"""

from rest_framework import serializers
from rest_framework.exceptions import APIException, NotFound
from rest_framework.response import Response

from apps.catalog.models import ContentRelease, NpcDefinition
from apps.game_sessions.serializers import quest_updates_body
from apps.inventory.serializers import rewards_body
from apps.users.scoping import ChildScopedAPIView

from . import dialogue, discoveries, npc
from .models import NpcRelationship


class DialogueChoiceUnavailable(APIException):
    status_code = 409
    default_code = "dialogue_choice_unavailable"


def relationship_body(relationship: NpcRelationship | None, *, level_increased=None) -> dict:
    points = relationship.relationship_points if relationship else 0
    body = {
        "level": npc.relationship_level_for_points(points),
        "met": relationship is not None,
        "lastInteractedAt": relationship.last_interacted_at.isoformat() if relationship else None,
    }
    if level_increased is not None:
        body["levelIncreased"] = level_increased
    return body


def npc_body(definition: NpcDefinition, relationship) -> dict:
    return {
        "npcId": definition.npc_id,
        "displayName": definition.display_name,
        "role": definition.role,
        "homeLocationSlug": definition.home_location_slug,
        "interactionId": definition.interaction_id,
        "relationship": relationship_body(relationship),
    }


def node_body(node: dict | None, context: dict) -> dict | None:
    if node is None:
        return None
    return {
        "id": node["id"],
        "text": node.get("text", ""),
        "choices": [
            {"id": choice["id"], "label": choice.get("label", "")}
            for choice in npc.available_choices(node, context)
        ],
    }


class NpcListView(ChildScopedAPIView):
    def get(self, request, child_id):
        release = ContentRelease.objects.order_by("-imported_at", "-id").first()
        definitions = NpcDefinition.objects.filter(active=True, last_seen_release=release)
        relationships = {r.npc_id: r for r in self.scoped(NpcRelationship.objects.all())}
        return Response(
            {"npcs": [npc_body(d, relationships.get(d.npc_id)) for d in definitions]}
        )


class NpcDetailView(ChildScopedAPIView):
    def get(self, request, child_id, npc_id):
        try:
            definition = dialogue.visible_npc(npc_id)
        except dialogue.NpcNotVisible:
            raise NotFound from None
        relationship = self.scoped(NpcRelationship.objects.filter(npc_id=npc_id)).first()
        return Response(npc_body(definition, relationship))


class ChoiceRequest(serializers.Serializer):
    fromNodeId = serializers.CharField(max_length=100)
    choiceId = serializers.CharField(max_length=100)

    def validate(self, attrs):
        unknown = set(self.initial_data) - set(self.fields)
        if unknown:
            raise serializers.ValidationError(
                {name: ["This field is not accepted."] for name in sorted(unknown)},
                code="unknown_field",
            )
        return attrs


def _talk_response(result: dialogue.TalkResult) -> Response:
    return Response(
        {
            "npcId": result.npc.npc_id,
            "node": node_body(result.node, result.context),
            "relationship": relationship_body(
                result.relationship, level_increased=result.level_increased
            ),
            "questUpdates": quest_updates_body(result.quest_updates),
            "rewards": rewards_body(result.rewards),
        }
    )


class NpcTalkView(ChildScopedAPIView):
    def post(self, request, child_id, npc_id):
        if request.data:
            raise serializers.ValidationError(
                {"non_field_errors": ["This request takes no body."]}, code="unexpected_body"
            )
        try:
            result = dialogue.converse(self.child, npc_id)
        except dialogue.NpcNotVisible:
            raise NotFound from None
        return _talk_response(result)


class NpcChoiceView(ChildScopedAPIView):
    def post(self, request, child_id, npc_id):
        body = ChoiceRequest(data=request.data)
        body.is_valid(raise_exception=True)
        try:
            result = dialogue.converse(
                self.child,
                npc_id,
                from_node_id=body.validated_data["fromNodeId"],
                choice_id=body.validated_data["choiceId"],
            )
        except dialogue.NpcNotVisible:
            raise NotFound from None
        except dialogue.ChoiceNotAvailable:
            raise DialogueChoiceUnavailable from None
        return _talk_response(result)


# --- Discoveries (LAI-0605) -------------------------------------------------------------------


class DiscoveryListView(ChildScopedAPIView):
    """GET: the secrets this child has found. Unfound ones are not listed."""

    def get(self, request, child_id):
        found = discoveries.discovered_ids(self.child)
        definitions = {
            d.discovery_id: d
            for d in discoveries.DiscoveryDefinition.objects.filter(discovery_id__in=found)
        }
        return Response(
            {
                "discoveries": [
                    {
                        "discoveryId": d.discovery_id,
                        "title": d.title,
                        "kind": d.kind,
                        "locationSlug": d.location_slug,
                    }
                    for d in (definitions.get(i) for i in found)
                    if d is not None
                ]
            }
        )


class DiscoveryView(ChildScopedAPIView):
    """POST (no body): the child reached this secret. FOUND_NOW, ALREADY_FOUND or LOCKED."""

    def post(self, request, child_id, discovery_id):
        if request.data:
            raise serializers.ValidationError(
                {"non_field_errors": ["This request takes no body."]}, code="unexpected_body"
            )
        try:
            result = discoveries.discover(self.child, discovery_id)
        except discoveries.DiscoveryNotVisible:
            raise NotFound from None
        return Response(
            {
                **result.outcome,
                "worldChangeKey": result.world_change_key,
                "startedQuestId": result.started_quest_id,
                "questUpdates": quest_updates_body(result.quest_updates),
                "rewards": rewards_body(result.rewards),
            }
        )
