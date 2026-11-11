"""Per-child world, story and NPC state outside region play (AMP-03).

Child-scoped and bearer-only (`ChildScopedAPIView`, LAI-0403): the child comes from the URL and
is resolved through the authenticated parent, so another family's child is a 404. Request
bodies are closed. Thin views over `services.py`, `stories.py`, `npcs.py` and `discoveries.py`.

World changes
    GET    world-changes/                       every recorded change, newest first
    POST   world-changes/                       record one, once (201 new, 200 already there)
World state
    GET    world-state/                         discoveries, characters met, last checkpoint
    PATCH  world-state/                         {metCharacterId?, lastCheckpointId?}
    DELETE world-state/                         a parent clears the exploration record
Stories
    GET    stories/                             the child's story progress rows
    POST   stories/{slug}/start/                start (201) or resume (200)
    POST   stories/{slug}/flags/                {flagKey, flagValue}: an authored choice
    POST   stories/{slug}/chapters/{id}/complete/  finish the current chapter
    POST   stories/{slug}/reflections/          {sceneId}: reflection evidence
NPCs
    GET    npc-memory/                          every NPC relationship
    POST   npc-memory/{npc}/dialogue/           {nodeId}: a dialogue node was shown
    DELETE npc-memory/                          a parent clears every NPC memory

Discovery itself stays `discoveries/` (SC-R04-00): the server decides whether a secret opens.
"""

import re
import uuid

from rest_framework import serializers
from rest_framework.exceptions import APIException, NotFound
from rest_framework.response import Response

from apps.core.models import CrossChildReference
from apps.game_sessions.models import AdventureSession
from apps.game_sessions.serializers import ClosedSerializer
from apps.users.scoping import ChildScopedAPIView

from . import discoveries, npcs, stories
from .models import NpcRelationship, StoryProgress, WorldChange, WorldState
from .services import record_world_change

MAX_WORLD_CHANGES = 1000
CHANGE_TYPE = re.compile(r"^[A-Z][A-Z0-9_]{0,63}$")
CHANGE_KEY = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$")
CHECKPOINT_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,48}:[a-z0-9][a-z0-9-]{0,48}$")
# Non-session provenance, as the client writes it (`quest:<id>`, `discovery:<id>`, ...).
SOURCE_LABEL = re.compile(r"^(quest|discovery|story|world|tide-trial):[a-z0-9][a-z0-9-]{0,56}$")


def _coded(status: int, code: str, detail: str) -> APIException:
    error = type(f"Coded_{code}", (APIException,), {"status_code": status, "default_code": code})
    return error(detail)


# --- World changes ----------------------------------------------------------------------------


def world_change_body(change: WorldChange) -> dict:
    return {
        "id": str(change.pk),
        "locationSlug": change.location_slug,
        "changeType": change.change_type,
        "changeKey": change.change_key,
        "sourceSessionId": change.source_session_id,
        "createdAt": change.created_at.isoformat(),
    }


class WorldChangeWrite(ClosedSerializer):
    locationSlug = serializers.SlugField(max_length=100)
    changeType = serializers.RegexField(CHANGE_TYPE)
    changeKey = serializers.RegexField(CHANGE_KEY)
    sourceSessionId = serializers.CharField(max_length=64, required=False, allow_blank=True)


class WorldChangeListView(ChildScopedAPIView):
    def get(self, request, child_id):
        changes = self.scoped(WorldChange.objects).order_by("-created_at")[:MAX_WORLD_CHANGES]
        return Response({"worldChanges": [world_change_body(c) for c in changes]})

    def post(self, request, child_id):
        body = WorldChangeWrite(data=request.data)
        body.is_valid(raise_exception=True)
        data = body.validated_data
        source = (data.get("sourceSessionId") or "").strip()
        session = None
        if source:
            try:
                session_id = uuid.UUID(source)
            except ValueError:
                session_id = None
            if session_id is not None:
                # A session id must be this child's own session; anyone else's is not found.
                session = self.get_scoped_object(AdventureSession.objects, session_id)
                source = ""
            elif not SOURCE_LABEL.match(source):
                raise _coded(400, "invalid_source", "That source is not accepted.")
        existing = self.scoped(WorldChange.objects).filter(
            location_slug=data["locationSlug"], change_key=data["changeKey"]
        )
        if not existing.exists() and self.scoped(WorldChange.objects).count() >= MAX_WORLD_CHANGES:
            raise _coded(409, "world_change_limit", "No more changes can be recorded.")
        try:
            change, created = record_world_change(
                self.child,
                location_slug=data["locationSlug"],
                change_type=data["changeType"],
                change_key=data["changeKey"],
                source_session=session,
                source_session_id=source,
            )
        except CrossChildReference:  # unreachable: the session was resolved through the child
            raise NotFound from None
        return Response(world_change_body(change), status=201 if created else 200)


# --- World state ------------------------------------------------------------------------------


class WorldStateWrite(ClosedSerializer):
    metCharacterId = serializers.SlugField(max_length=100, required=False)
    # Authored checkpoint ids are `<region>:<spot>` (react/src/features/discovery/checkpoints.ts).
    lastCheckpointId = serializers.RegexField(CHECKPOINT_ID, required=False)


def world_state_body(child) -> dict:
    state = WorldState.objects.for_child(child).first()
    return {
        "discoveredIds": discoveries.discovered_ids(child),
        "metCharacterIds": list(state.discovered_characters) if state else [],
        "lastCheckpointId": (state.last_checkpoint_id or None) if state else None,
    }


class WorldStateView(ChildScopedAPIView):
    def get(self, request, child_id):
        return Response(world_state_body(self.child))

    def patch(self, request, child_id):
        from django.db import transaction
        from django.utils import timezone

        body = WorldStateWrite(data=request.data)
        body.is_valid(raise_exception=True)
        data = body.validated_data
        met = data.get("metCharacterId")
        if met is not None and not npcs.is_known_npc(met):
            raise _coded(400, "unknown_character", "That character is not on the island.")
        now = timezone.now()
        with transaction.atomic():
            WorldState.objects.get_or_create(child=self.child, defaults={"updated_at": now})
            state = WorldState.objects.select_for_update().get(child=self.child)
            changed = []
            if met is not None and met not in state.discovered_characters:
                state.discovered_characters = [*state.discovered_characters, met]
                changed.append("discovered_characters")
            checkpoint = data.get("lastCheckpointId")
            if checkpoint is not None and checkpoint != state.last_checkpoint_id:
                state.last_checkpoint_id = checkpoint
                changed.append("last_checkpoint_id")
            if changed:
                state.updated_at = now
                state.save(update_fields=[*changed, "updated_at"])
        return Response(world_state_body(self.child))

    def delete(self, request, child_id):
        self.scoped(WorldState.objects).delete()
        return Response(status=204)


# --- Stories ----------------------------------------------------------------------------------


def story_body(progress: StoryProgress) -> dict:
    return {
        "id": str(progress.pk),
        "storyId": progress.story_slug,
        "currentChapterId": progress.current_chapter_id,
        "completedChapterIds": list(progress.completed_chapter_ids),
        "storyFlags": {k: v for k, v in (progress.story_flags or {}).items() if isinstance(v, str)},
        "startedAt": progress.started_at.isoformat(),
        "lastPlayedAt": progress.last_played_at.isoformat(),
        "completedAt": progress.completed_at.isoformat() if progress.completed_at else None,
    }


class FlagWrite(ClosedSerializer):
    flagKey = serializers.CharField(max_length=64)
    flagValue = serializers.CharField(max_length=64)


class ReflectionWrite(ClosedSerializer):
    sceneId = serializers.CharField(max_length=100)


def _story_error(error: Exception) -> APIException:
    if isinstance(error, stories.UnknownStory | stories.StoryNotStarted):
        return NotFound()
    if isinstance(error, stories.StoryUnavailable):
        return _coded(409, "content_unavailable", "This is not available right now.")
    if isinstance(error, stories.StoryRejected):
        status = 400 if error.code.startswith("unknown_") else 409
        return _coded(status, error.code, "That is not possible in this story right now.")
    raise error


class StoryListView(ChildScopedAPIView):
    def get(self, request, child_id):
        rows = self.scoped(StoryProgress.objects).order_by("-last_played_at")
        return Response({"stories": [story_body(row) for row in rows]})


class StoryStartView(ChildScopedAPIView):
    def post(self, request, child_id, story_slug):
        ClosedSerializer(data=request.data or {}).is_valid(raise_exception=True)
        try:
            progress, created = stories.start_story(self.child, story_slug)
        except (stories.UnknownStory, stories.StoryUnavailable) as error:
            raise _story_error(error) from None
        return Response(story_body(progress), status=201 if created else 200)


class StoryFlagView(ChildScopedAPIView):
    def post(self, request, child_id, story_slug):
        body = FlagWrite(data=request.data)
        body.is_valid(raise_exception=True)
        try:
            progress = stories.set_flag(
                self.child,
                story_slug,
                body.validated_data["flagKey"],
                body.validated_data["flagValue"],
            )
        except (stories.UnknownStory, stories.StoryNotStarted, stories.StoryRejected) as error:
            raise _story_error(error) from None
        return Response(story_body(progress))


class StoryChapterCompleteView(ChildScopedAPIView):
    def post(self, request, child_id, story_slug, chapter_id):
        ClosedSerializer(data=request.data or {}).is_valid(raise_exception=True)
        try:
            progress = stories.complete_chapter(self.child, story_slug, chapter_id)
        except (stories.UnknownStory, stories.StoryNotStarted, stories.StoryRejected) as error:
            raise _story_error(error) from None
        return Response(story_body(progress))


class StoryReflectionView(ChildScopedAPIView):
    def post(self, request, child_id, story_slug):
        body = ReflectionWrite(data=request.data)
        body.is_valid(raise_exception=True)
        try:
            written = stories.record_reflection(
                self.child, story_slug, body.validated_data["sceneId"]
            )
        except (stories.UnknownStory, stories.StoryNotStarted, stories.StoryRejected) as error:
            raise _story_error(error) from None
        return Response({"recorded": written}, status=201 if written else 200)


# --- NPCs -------------------------------------------------------------------------------------


def npc_body(relationship: NpcRelationship) -> dict:
    flags = relationship.memory_flags if isinstance(relationship.memory_flags, dict) else {}
    return {
        "npcId": relationship.npc_id,
        "relationshipPoints": relationship.relationship_points,
        "relationshipLevel": relationship.relationship_level,
        "memoryFlags": {k: v for k, v in flags.items() if isinstance(v, bool)},
        "seenNodeIds": list(relationship.seen_node_ids),
        "firstMetAt": relationship.first_met_at.isoformat(),
        "lastInteractedAt": relationship.last_interacted_at.isoformat(),
    }


class DialogueWrite(ClosedSerializer):
    nodeId = serializers.CharField(max_length=100)


class NpcListView(ChildScopedAPIView):
    def get(self, request, child_id):
        rows = self.scoped(NpcRelationship.objects).order_by("npc_id")
        return Response({"npcs": [npc_body(row) for row in rows]})

    def delete(self, request, child_id):
        self.scoped(NpcRelationship.objects).delete()
        return Response(status=204)


class NpcDialogueView(ChildScopedAPIView):
    def post(self, request, child_id, npc_id):
        body = DialogueWrite(data=request.data)
        body.is_valid(raise_exception=True)
        try:
            relationship, previous = npcs.record_dialogue(
                self.child, npc_id, body.validated_data["nodeId"]
            )
        except npcs.UnknownNpc:
            raise NotFound from None
        except npcs.UnknownDialogueNode:
            raise _coded(400, "unknown_dialogue_node", "That is not something they say.") from None
        return Response(
            {
                "npc": npc_body(relationship),
                "levelIncreased": relationship.relationship_level != previous,
            }
        )
