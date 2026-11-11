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


class PuzzleSubmissionRequest(ClosedSerializer):
    """`{submission: {...}}`. The shape inside is checked by the puzzle kind's grader."""

    submission = serializers.DictField()


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


def object_entry(entry) -> dict:
    """A placement, and for a pickup (TR-14) whether this child has picked it up."""
    placement = entry["placement"]
    data = ObjectSerializer(placement).data
    data.update({"pickup": placement.is_pickup, "collected": entry["collected"]})
    return data


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
                # TR-14: encounter order, presentation, and why it is locked for this child.
                "presentation": chest.presentation,
                "sortOrder": chest.sort_order,
                "locked": entry.get("lock_reason") is not None,
                "lockReason": entry.get("lock_reason"),
                "requiredItemId": chest.required_item.item_id if chest.required_item_id else None,
                "answerEntityIds": list(chest.answer_entity_ids or []),
                "clue": chest.clue,
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

    setId = serializers.SerializerMethodField()
    journal = serializers.SerializerMethodField()

    def get_assetId(self, item) -> str:
        return ""  # catalog items have no model id yet; the client draws a placeholder

    def get_setId(self, item) -> str | None:
        return item.collectible_set.set_id if item.collectible_set_id else None

    def get_journal(self, item) -> dict | None:
        """A Discovery Journal entry's metadata (FP-10), from the item's published content."""
        entry = (item.source or {}).get("journal")
        if not isinstance(entry, dict):
            return None
        return {
            "subject": entry.get("subject"),
            "questId": entry.get("questId"),
            "illustrationAssetId": entry.get("illustrationAssetId"),
        }


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


def puzzle_state(entry) -> dict:
    """A 3D Area puzzle for the child's age band (ADR-047 F, LAI-0812)."""
    puzzle, body = entry["puzzle"], entry["body"]
    return {
        "puzzleId": puzzle.puzzle_id,
        "kind": puzzle.kind,
        "title": body["title"],
        "entityIds": list(puzzle.entity_ids),
        "solved": entry["solved"],
        "locked": entry["locked"],
        "failedAttempts": entry["failed_attempts"],
        "parameters": entry["parameters"],
    }


def _region(state) -> dict:
    data = RegionSerializer(state["region"]).data
    content = state.get("region_content")
    if content:  # ADR-047: the authored copy, as this visit started with it
        data["title"] = content["title"]
        data["scene"] = {
            **data["scene"],
            "copy": content.get("copy", {}),
            "environment": content.get("environment", {}),
        }
    return data


class BootstrapSerializer(serializers.Serializer):
    def to_representation(self, state):
        dialogue = state.get("npc_dialogue", {})
        npcs = NpcPlacementSerializer(state["npcs"], many=True).data
        for npc in npcs:
            npc["dialogue"] = dialogue.get(npc["entityId"], [])
        return {
            "region": _region(state),
            "spawn": SpawnSerializer(state["spawn"]).data if state["spawn"] else None,
            "npcs": npcs,
            "puzzles": [puzzle_state(entry) for entry in state.get("puzzles", [])],
            "catalog": state.get("catalog", {"worldSlug": "", "assets": []}),
            "objects": [object_entry(entry) for entry in state["objects"]],
            "chests": [ChestStateSerializer().to_representation(c) for c in state["chests"]],
            "quests": [QuestEntrySerializer().to_representation(q) for q in state["quests"]],
            "session": SessionSerializer(state["session"]).data if state["session"] else None,
            "worldChanges": WorldChangeSerializer(state["world_changes"], many=True).data,
            "launchPoints": [launch_point(p) for p in state.get("launch_points", [])],
        }


def launch_point(point) -> dict:
    """An object that starts an Adventure (ADR-041). Its position is the placement's own."""
    adventure = point.adventure
    return {
        "launchId": point.launch_id,
        "entityId": point.entity_id,
        "objectKind": point.object_kind,
        "label": point.label,
        "prompt": point.prompt,
        "adventure": {
            "adventureId": adventure.slug,
            "title": adventure.title,
            "placeSlug": adventure.location.slug if adventure.location_id else "",
        },
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
            "newItems": [
                item for item in self.context.get("items", []) if item["itemId"] in new_items
            ],
            "rewardMessage": self.context.get("reward_message") if new_items else None,
            "questUpdates": quest_updates_data(outcome.quest_updates),
            "completionRewards": completion_rewards_data(outcome.completion_rewards),
        }


def quest_updates_data(updates) -> list[dict]:
    return [
        {
            "questId": update.progress.quest.slug,
            "status": update.progress.status,
            "currentStageId": update.progress.current_stage_id,
            "justCompleted": update.result.just_completed,
            "newlyCompletedObjectiveIds": list(update.result.newly_completed_objective_ids),
        }
        for update in updates
        if update.result.changed
    ]


def completion_rewards_data(rewards) -> list[dict]:
    """Rewards for finishing a quest (TR-14), only those granted by this request."""
    out = []
    for reward in rewards:
        if not reward.grant.granted:
            continue
        new = set(reward.grant.new_item_ids)
        out.append(
            {
                "ruleId": reward.rule.rule_id,
                "items": ItemSerializer(
                    [i for i in reward.rule.items.order_by("item_id") if i.item_id in new],
                    many=True,
                ).data,
                "message": reward.rule.message,
            }
        )
    return out


class PickupSerializer(serializers.Serializer):
    def to_representation(self, outcome):
        reward = outcome.reward
        rule = outcome.placement.pickup_reward_rule
        new = set(reward.new_item_ids) if reward else set()
        items = [i for i in rule.items.order_by("item_id") if i.item_id in new] if rule else []
        return {
            "entityId": outcome.placement.entity_id,
            "pickedUp": outcome.picked_up,
            "collected": True,
            "newItems": ItemSerializer(items, many=True).data,
            "rewardMessage": rule.message if rule and new else None,
            "questUpdates": quest_updates_data(outcome.quest_updates),
            "completionRewards": completion_rewards_data(outcome.completion_rewards),
        }


class TalkSerializer(serializers.Serializer):
    def to_representation(self, outcome):
        return {
            "flagsSet": list(outcome.flags_set),
            "questUpdates": quest_updates_data(outcome.quest_updates),
            "completionRewards": completion_rewards_data(outcome.completion_rewards),
        }


# --- Native discovery, home and inventory (LAI-ANDROID-API-001) -----------------------------
# Contract: docs/android/ANDROID_API_CONTRACT.md. Thumbnails are asset ids or null (ADR-030).
# Regions and adventures carry no illustration yet, so theirs is null; Islands and Places carry
# an authored, published `artAssetId` (AP-03, see `island_entry`).


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


MAX_ISLAND_SUBJECTS = 6


def island_subjects(entry) -> list[str]:
    """What an Island teaches: its Places' authored skills, first seen first, without repeats."""
    subjects: list[str] = []
    for place in entry.places:
        for skill in place.place.skills or []:
            if skill not in subjects:
                subjects.append(skill)
    return subjects[:MAX_ISLAND_SUBJECTS]


def island_entry(entry) -> dict:
    island = entry.island
    return {
        "islandId": island.slug,
        "title": island.title,
        "tagline": island.tagline,
        "isHome": island.is_home,
        "description": island.description,
        # AP-03 discovery: who it is for, what it teaches, whether it is open, how far along.
        "ageBands": list(island.supported_age_bands),
        "subjects": island_subjects(entry),
        # The Realm Explorer's filters: MATH, READING, SCIENCE, CREATIVITY (discovery.py).
        "subjectAreas": list(entry.subject_areas),
        # An authored `artAssetId` whose image is published, else null (draw the fallback). The
        # client resolves it through the child-scoped asset resolver (ADR-030, LAI-2200).
        "thumbnailAssetId": entry.art_asset_id,
        "unlocked": entry.unlocked,
        "lockedHint": entry.locked_hint,
        "progress": {
            "placesExplored": sum(place.explored for place in entry.places),
            "placesTotal": len(entry.places),
        },
        "places": [
            {
                "placeId": place.place.slug,
                "title": place.place.title,
                "tagline": place.place.tagline,
                "description": place.place.description,
                "skills": list(place.place.skills or []),
                "subjectAreas": list(place.subject_areas),
                "thumbnailAssetId": place.art_asset_id,
                "adventureCount": place.adventure_count,
                "explored": place.explored,
                # null: no published 3D Area yet; the Place's adventures are still available.
                "area": region_entry(place.area) if place.area else None,
            }
            for place in entry.places
        ],
    }


class PuzzleOutcomeSerializer(serializers.Serializer):
    """The answer to a puzzle submission (LAI-0812). A code for feedback, never copy."""

    def to_representation(self, outcome):
        reward = outcome.reward
        new_items = reward.new_item_ids if reward else ()
        return {
            "attemptId": str(outcome.attempt.pk) if outcome.attempt else None,
            "correct": outcome.correct,
            "feedback": "CORRECT" if outcome.correct else "TRY_AGAIN",
            "solvedNow": outcome.solved_now,
            "alreadySolved": outcome.already_solved,
            "failedAttempts": outcome.failed_attempts,
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
