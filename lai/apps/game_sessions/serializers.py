"""Request and response shapes for the play API (TR-5). The contract is in docs/PLAY_API.md.

Responses use camelCase keys, as the TypeScript client does. Request bodies are closed: an
unknown field (a client-supplied `correct`, `reward`, or `worldChange`) is a validation error,
not something silently ignored.
"""

from rest_framework import serializers

from apps.education.challenges import public_challenge
from apps.users.serializers import ChildProfileSerializer


class ClosedSerializer(serializers.Serializer):
    """A request body that refuses fields it does not declare."""

    def validate(self, attrs):
        unknown = set(self.initial_data) - set(self.fields)
        if unknown:
            raise serializers.ValidationError(
                {name: ["This field is not accepted."] for name in sorted(unknown)},
                code="unknown_field",
            )
        return attrs


class StrictIntegerField(serializers.Field):
    """A JSON integer. Unlike `IntegerField`, refuses "3", 3.0, and true: an answer of the
    wrong type is malformed (TR-1), not coerced into a guess."""

    default_error_messages = {"invalid": "A whole number is required."}

    def to_internal_value(self, data):
        if not isinstance(data, int) or isinstance(data, bool):
            self.fail("invalid")
        return data

    def to_representation(self, value):
        return value


class AnswerRequest(ClosedSerializer):
    answer = StrictIntegerField()
    hintLevel = serializers.IntegerField(min_value=0, max_value=10, default=0, source="hint_level")
    durationMs = serializers.IntegerField(
        min_value=0, max_value=3_600_000, required=False, allow_null=True, source="duration_ms"
    )


class EmptyRequest(ClosedSerializer):
    pass


# --- Responses ------------------------------------------------------------------------------


class PlaceholderSerializer(serializers.Serializer):
    width = serializers.FloatField(source="placeholder_width")
    height = serializers.FloatField(source="placeholder_height")
    depth = serializers.FloatField(source="placeholder_depth")


class PlacedSerializer(serializers.Serializer):
    entityId = serializers.CharField(source="entity_id")
    label = serializers.CharField()
    x = serializers.FloatField()
    z = serializers.FloatField()
    elevation = serializers.FloatField()
    rotationY = serializers.FloatField(source="rotation_y")
    scale = serializers.FloatField()
    assetId = serializers.CharField(source="asset_id")
    placeholder = PlaceholderSerializer(source="*")


class ObjectSerializer(PlacedSerializer):
    kind = serializers.CharField()
    interactionId = serializers.CharField(source="interaction_id")


class NpcPlacementSerializer(PlacedSerializer):
    npcId = serializers.CharField(source="npc.npc_id")
    displayName = serializers.CharField(source="npc.display_name")
    interactionId = serializers.CharField(source="interaction_id")

    def to_representation(self, instance):
        data = super().to_representation(instance)
        # The placement's own model wins; otherwise the NPC's default character model.
        data["assetId"] = instance.asset_id  # catalog NPCs carry no model of their own
        return data


class ChestStateSerializer(serializers.Serializer):
    def to_representation(self, entry):
        chest = entry["chest"]
        data = PlacedSerializer(chest).data
        data.update(
            {
                "openClip": chest.open_clip,
                "isOpen": entry["is_open"],
                "challengeAvailable": entry["challenge_available"],
            }
        )
        return data


class SpawnSerializer(serializers.Serializer):
    checkpointId = serializers.CharField(source="checkpoint_id")
    label = serializers.CharField()
    x = serializers.FloatField()
    z = serializers.FloatField()
    yaw = serializers.FloatField()


class RegionSerializer(serializers.Serializer):
    regionId = serializers.CharField(source="region_id")
    title = serializers.CharField()
    locationSlug = serializers.CharField(source="location.slug")
    version = serializers.IntegerField()
    scene = serializers.JSONField()


class SessionSerializer(serializers.Serializer):
    sessionId = serializers.UUIDField(source="id")
    kind = serializers.CharField()
    regionId = serializers.CharField(source="region_id")
    templateSlug = serializers.SerializerMethodField()
    locationSlug = serializers.CharField(source="location_slug")
    status = serializers.CharField()
    startedAt = serializers.DateTimeField(source="started_at")
    lastActivityAt = serializers.DateTimeField(source="last_activity_at")
    completedAt = serializers.DateTimeField(source="completed_at")

    def get_templateSlug(self, session) -> str:
        return session.adventure.slug if session.adventure_id else ""


class WorldChangeSerializer(serializers.Serializer):
    locationSlug = serializers.CharField(source="location_slug")
    changeType = serializers.CharField(source="change_type")
    changeKey = serializers.CharField(source="change_key")
    payload = serializers.SerializerMethodField()
    createdAt = serializers.DateTimeField(source="created_at")

    def get_payload(self, change) -> dict:
        return change.payload or {}


class ItemSerializer(serializers.Serializer):
    itemId = serializers.CharField(source="item_id")
    displayName = serializers.CharField(source="display_name")
    description = serializers.CharField()
    category = serializers.CharField()
    assetId = serializers.SerializerMethodField()

    def get_assetId(self, item) -> str:
        return ""  # catalog items have no model id yet; the client draws a placeholder


class InventoryEntrySerializer(serializers.Serializer):
    item = ItemSerializer()
    grantedAt = serializers.DateTimeField(source="acquired_at")


class QuestEntrySerializer(serializers.Serializer):
    def to_representation(self, entry):
        quest, progress = entry.quest, entry.progress
        done = set(progress.completed_objective_ids) if progress else set()
        return {
            "questId": quest.slug,
            "title": quest.title,
            "summary": quest.summary,
            "giverNpcId": quest.source.get("giverNpcId"),
            "status": entry.status,
            "currentStageId": progress.current_stage_id if progress else None,
            "completedAt": (
                serializers.DateTimeField().to_representation(progress.completed_at)
                if progress and progress.completed_at
                else None
            ),
            "stages": [
                {
                    "id": stage.get("id"),
                    "title": stage.get("title", ""),
                    "complete": progress is not None
                    and stage.get("id") in progress.completed_stage_ids,
                    "objectives": [
                        {
                            "id": objective.get("id"),
                            "label": objective.get("label", ""),
                            "optional": bool(objective.get("optional", False)),
                            "complete": objective.get("id") in done,
                        }
                        for objective in stage.get("objectives", [])
                    ],
                }
                for stage in quest.source.get("stages", [])
            ],
        }


class ChallengeResponseSerializer(serializers.Serializer):
    """An issued challenge. Built from `public_challenge`, which has no answer field."""

    def to_representation(self, attempt):
        return {
            "attemptId": str(attempt.pk),
            "attemptNumber": attempt.attempt_number,
            "sessionId": str(attempt.session_id),
            "targetEntityId": attempt.target_entity_id,
            "ageBand": attempt.age_band,
            "challenge": public_challenge(attempt.challenge()),
            "issuedAt": serializers.DateTimeField().to_representation(attempt.issued_at),
        }


class BootstrapSerializer(serializers.Serializer):
    def to_representation(self, state):
        return {
            "region": RegionSerializer(state["region"]).data,
            "spawn": SpawnSerializer(state["spawn"]).data if state["spawn"] else None,
            "npcs": NpcPlacementSerializer(state["npcs"], many=True).data,
            "objects": ObjectSerializer(state["objects"], many=True).data,
            "chests": [ChestStateSerializer().to_representation(c) for c in state["chests"]],
            "quests": [QuestEntrySerializer().to_representation(q) for q in state["quests"]],
            "session": SessionSerializer(state["session"]).data if state["session"] else None,
            "worldChanges": WorldChangeSerializer(state["world_changes"], many=True).data,
        }


class ProgressSerializer(serializers.Serializer):
    def to_representation(self, state):
        return {
            "sessions": SessionSerializer(state["sessions"], many=True).data,
            "worldChanges": WorldChangeSerializer(state["world_changes"], many=True).data,
            "openedChests": [
                {"regionId": chest.region.region_id, "entityId": chest.entity_id}
                for chest in state["opened_chests"]
            ],
            "inventory": InventoryEntrySerializer(state["inventory"], many=True).data,
            "quests": [QuestEntrySerializer().to_representation(q) for q in state["quests"]],
            "practice": [
                {
                    "objectiveCode": row["objective_code"],
                    "attempts": row["attempts"],
                    "correct": row["correct"],
                }
                for row in state["practice"]
            ],
            # LAI-0603, additive: the Mastery Engine's status per objective with evidence.
            "mastery": state["mastery"],
        }


class OutcomeSerializer(serializers.Serializer):
    def to_representation(self, outcome):
        reward = outcome.reward
        new_items = reward.new_item_ids if reward else ()
        return {
            "attemptId": str(outcome.attempt.pk),
            "correct": outcome.correct,
            # A code, not copy: the client says it aloud in the child's language.
            "feedback": "CORRECT" if outcome.correct else "TRY_AGAIN",
            "canRetry": not outcome.correct,
            "chestOpened": outcome.chest_opened,
            "newItems": [
                item for item in self.context.get("items", []) if item["itemId"] in new_items
            ],
            "rewardMessage": self.context.get("reward_message") if new_items else None,
            "questUpdates": [
                {
                    "questId": update.progress.quest.slug,
                    "status": update.progress.status,
                    "currentStageId": update.progress.current_stage_id,
                    "justCompleted": update.result.just_completed,
                    "newlyCompletedObjectiveIds": list(update.result.newly_completed_objective_ids),
                }
                for update in outcome.quest_updates
                if update.result.changed
            ],
        }


# --- Native discovery, home and inventory (LAI-ANDROID-API-001) -----------------------------
# Contract: docs/android/ANDROID_API_CONTRACT.md. Thumbnails are asset ids or null (ADR-030):
# no catalog row carries an illustration yet, so every `thumbnailAssetId` is null today.


def _iso(value):
    return serializers.DateTimeField().to_representation(value) if value else None


def resume_info(session) -> dict | None:
    if session is None:
        return None
    return {
        "sessionId": str(session.pk),
        "status": session.status,
        "lastActivityAt": _iso(session.last_activity_at),
    }


def region_entry(entry) -> dict:
    region = entry.region
    location, world = region.location, region.location.world
    return {
        "regionId": region.region_id,
        "title": region.title,
        "description": location.tagline,
        "world": {"slug": world.slug, "title": world.title},
        "location": {"slug": location.slug, "title": location.title},
        "ageBands": list(world.supported_age_bands),
        "available": entry.playable,
        "lockedReason": None if entry.playable else "NO_CHALLENGE_FOR_AGE_BAND",
        "status": entry.status,
        "chestsTotal": entry.chests_total,
        "chestsOpened": entry.chests_opened,
        "thumbnailAssetId": None,
        "prerequisites": [],
        "resume": resume_info(entry.open_session),
        "lastPlayedAt": _iso(entry.last_session.last_activity_at) if entry.last_session else None,
    }


def adventure_entry(entry) -> dict:
    adventure = entry.adventure
    return {
        "adventureId": adventure.slug,
        "kind": "STEP_ADVENTURE",
        "title": adventure.title,
        "description": "",
        "ageBands": list(adventure.age_bands),
        "skillDomain": adventure.skill_domain,
        "available": True,
        "lockedReason": None,
        "status": entry.status,
        "thumbnailAssetId": None,
        "prerequisites": [],
        "resume": resume_info(entry.active_session),
    }


def quest_status_entry(entry) -> dict:
    data = QuestEntrySerializer().to_representation(entry)
    data["available"] = entry.status != "LOCKED"
    data["lockedReason"] = "PREREQUISITES_NOT_MET" if entry.status == "LOCKED" else None
    data["prerequisites"] = [
        condition
        for condition in entry.quest.source.get("prerequisites", [])
        if isinstance(condition, dict) and condition.get("type") != "ALWAYS"
    ]
    return data


class HomeSerializer(serializers.Serializer):
    def to_representation(self, state):
        child = state["child"]
        return {
            "child": ChildProfileSerializer(child).data,
            "lastRegion": region_entry(state["last_region"]) if state["last_region"] else None,
            "resume": [region_entry(e) for e in state["resume"]],
            "nextRegions": [region_entry(e) for e in state["next_regions"]],
            "progress": {
                "completedSessions": state["summary"]["completed_sessions"],
                "worldChanges": state["summary"]["world_changes"],
                "items": state["summary"]["items"],
                "questsCompleted": state["summary"]["quests_completed"],
                "questsActive": state["summary"]["quests_active"],
            },
            "recentItems": InventoryEntrySerializer(state["recent_items"], many=True).data,
            "recentActivities": [
                {
                    "type": "SESSION_COMPLETED",
                    "kind": session.kind,
                    "regionId": session.region_id,
                    "adventureId": session.adventure.slug if session.adventure_id else "",
                    "at": _iso(session.completed_at),
                }
                for session in state["recent_completed"]
            ],
            "recentWorldChanges": WorldChangeSerializer(
                state["recent_world_changes"], many=True
            ).data,
            "restrictions": {
                "active": child.active,
                "sessionMinutes": child.session_minutes,
                "aiEnabled": child.ai_enabled,
                "readingMode": child.reading_mode,
            },
        }


class LaunchRequest(ClosedSerializer):
    regionId = serializers.SlugField(max_length=80)


class RedeemRequest(ClosedSerializer):
    ticket = serializers.CharField(min_length=20, max_length=128, trim_whitespace=False)
