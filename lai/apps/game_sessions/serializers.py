"""Request and response shapes for the play API (TR-5). The contract is in docs/PLAY_API.md.

Responses use camelCase keys, as the TypeScript client does. Request bodies are closed: an
unknown field (a client-supplied `correct`, `reward`, or `worldChange`) is a validation error,
not something silently ignored.
"""

from rest_framework import serializers

from apps.education.challenges import public_challenge


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
        data["assetId"] = instance.asset_id or instance.npc.asset_id
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
    templateSlug = serializers.CharField(source="template_slug")
    locationSlug = serializers.CharField(source="location_slug")
    status = serializers.CharField()
    startedAt = serializers.DateTimeField(source="started_at")
    lastActivityAt = serializers.DateTimeField(source="last_activity_at")
    completedAt = serializers.DateTimeField(source="completed_at")


class WorldChangeSerializer(serializers.Serializer):
    locationSlug = serializers.CharField(source="location_slug")
    changeType = serializers.CharField(source="change_type")
    changeKey = serializers.CharField(source="change_key")
    payload = serializers.JSONField()
    createdAt = serializers.DateTimeField(source="created_at")


class ItemSerializer(serializers.Serializer):
    itemId = serializers.CharField(source="item_id")
    displayName = serializers.CharField(source="display_name")
    description = serializers.CharField()
    category = serializers.CharField()
    assetId = serializers.CharField(source="asset_id")


class InventoryEntrySerializer(serializers.Serializer):
    item = ItemSerializer()
    grantedAt = serializers.DateTimeField(source="granted_at")


class QuestEntrySerializer(serializers.Serializer):
    def to_representation(self, entry):
        quest, progress = entry.quest, entry.progress
        done = set(progress.completed_objective_ids) if progress else set()
        return {
            "questId": quest.quest_id,
            "title": quest.title,
            "summary": quest.summary,
            "giverNpcId": quest.giver_npc.npc_id if quest.giver_npc_id else None,
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
                for stage in quest.stages
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
            "newItems": [item for item in self.context.get("items", []) if item["itemId"] in new_items],
            "rewardMessage": self.context.get("reward_message") if new_items else None,
            "questUpdates": [
                {
                    "questId": update.progress.quest.quest_id,
                    "status": update.progress.status,
                    "currentStageId": update.progress.current_stage_id,
                    "justCompleted": update.result.just_completed,
                    "newlyCompletedObjectiveIds": list(update.result.newly_completed_objective_ids),
                }
                for update in outcome.quest_updates
                if update.result.changed
            ],
        }
