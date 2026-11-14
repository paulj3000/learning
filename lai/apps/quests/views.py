"""Quest state outside region play (AMP-03). Child-scoped, bearer-only (LAI-0403).

GET    children/{id}/quests/          every quest this child has started or finished
PUT    children/{id}/quests/{slug}/   save the state the client's quest engine projected
DELETE children/{id}/quests/          a parent clears the child's quest progress

Starting a quest stays `quests/{slug}/accept/` (TR-5), which checks the age band and the
prerequisites. PUT is a validated write (`services.save_quest_state`): only the quest's own
stage and objective ids, completed lists that only grow, and never a change to a finished quest.
What a stage or the quest's completion owes is decided here from the catalog quest, never from
the request: the authored world changes of each newly completed stage and of the completion, the
completion's NPC memory flags, and the `QUEST_COMPLETED` reward rules (each fires once per child).
Sending the same state again changes nothing and grants nothing.
"""

from django.db import transaction
from rest_framework import serializers
from rest_framework.exceptions import APIException, NotFound
from rest_framework.response import Response

from apps.game_sessions.serializers import ClosedSerializer
from apps.game_sessions.services import InvalidTransition, ProgressNotFound
from apps.progression.npcs import set_memory_flags
from apps.progression.services import record_world_change
from apps.users.scoping import ChildScopedAPIView

from . import engine
from .models import QuestProgress, QuestStatus
from .services import QuestUpdate, grant_quest_completion_rewards, save_quest_state


class QuestStateRejected(APIException):
    status_code = 409
    default_code = "invalid_transition"
    default_detail = "That quest cannot change that way."


def quest_body(progress: QuestProgress) -> dict:
    return {
        "id": str(progress.pk),
        "questId": progress.quest.slug,
        "status": progress.status,
        "currentStageId": progress.current_stage_id,
        "completedStageIds": list(progress.completed_stage_ids),
        "completedObjectiveIds": list(progress.completed_objective_ids),
        "startedAt": progress.started_at.isoformat(),
        "lastUpdatedAt": progress.last_updated_at.isoformat(),
        "completedAt": progress.completed_at.isoformat() if progress.completed_at else None,
    }


class QuestStateWrite(ClosedSerializer):
    status = serializers.ChoiceField(choices=QuestStatus.values)
    currentStageId = serializers.CharField(max_length=100)
    completedStageIds = serializers.ListField(
        child=serializers.CharField(max_length=100), max_length=100
    )
    completedObjectiveIds = serializers.ListField(
        child=serializers.CharField(max_length=100), max_length=200
    )


class QuestListView(ChildScopedAPIView):
    def get(self, request, child_id):
        rows = self.scoped(QuestProgress.objects.select_related("quest")).order_by("started_at")
        return Response({"quests": [quest_body(row) for row in rows]})

    def delete(self, request, child_id):
        self.scoped(QuestProgress.objects).delete()
        return Response(status=204)


def _same_state(progress: QuestProgress, data: dict) -> bool:
    return (
        progress.status == data["status"]
        and progress.current_stage_id == data["currentStageId"]
        and list(progress.completed_stage_ids) == list(data["completedStageIds"])
        and list(progress.completed_objective_ids) == list(data["completedObjectiveIds"])
    )


class QuestStateView(ChildScopedAPIView):
    def put(self, request, child_id, quest_slug):
        body = QuestStateWrite(data=request.data)
        body.is_valid(raise_exception=True)
        data = body.validated_data
        progress = (
            self.scoped(QuestProgress.objects.select_related("quest"))
            .filter(quest__slug=quest_slug)
            .first()
        )
        if progress is None:
            raise NotFound
        if _same_state(progress, data):
            return Response({"quest": quest_body(progress), "rewardMessages": [], "newItemIds": []})
        if data["status"] == QuestStatus.COMPLETED:
            # A quest completes only by leaving a stage that has nowhere to go next
            # (`advanceQuest`), so that stage must be finished and be an authored last stage.
            final = next(
                (
                    stage
                    for stage in progress.quest.source.get("stages", [])
                    if stage.get("id") == data["currentStageId"]
                ),
                None,
            )
            if (
                final is None
                or final.get("nextStageId")
                or data["currentStageId"] not in data["completedStageIds"]
            ):
                raise QuestStateRejected
        before_stages = set(progress.completed_stage_ids)
        was_active = progress.status == QuestStatus.ACTIVE
        with transaction.atomic():
            try:
                saved = save_quest_state(
                    self.child,
                    progress.pk,
                    status=data["status"],
                    current_stage_id=data["currentStageId"],
                    completed_stage_ids=list(dict.fromkeys(data["completedStageIds"])),
                    completed_objective_ids=list(dict.fromkeys(data["completedObjectiveIds"])),
                )
            except ProgressNotFound:
                raise NotFound from None
            except InvalidTransition:
                raise QuestStateRejected from None
            just_completed = was_active and saved.status == QuestStatus.COMPLETED
            source = saved.quest.source
            stages = {stage.get("id"): stage for stage in source.get("stages", [])}
            changes = [
                change
                for stage_id in saved.completed_stage_ids
                if stage_id not in before_stages
                for change in stages.get(stage_id, {}).get("worldChanges", [])
            ]
            completion = source.get("completion", {}) or {}
            if just_completed:
                changes.extend(completion.get("worldChanges", []))
            for change in changes:
                record_world_change(
                    self.child,
                    location_slug=change["locationSlug"],
                    change_type=change["changeType"],
                    change_key=change["changeKey"],
                    source_session_id=f"quest:{saved.quest.slug}",
                )
            messages, new_items = [], []
            if just_completed:
                for entry in completion.get("setsNpcMemoryFlags", []) or []:
                    if isinstance(entry, dict) and entry.get("npcId"):
                        set_memory_flags(self.child, entry["npcId"], entry.get("flags", []))
                update = QuestUpdate(
                    progress=saved,
                    result=engine.AdvanceResult(
                        state=engine.QuestState(
                            status=saved.status, current_stage_id=saved.current_stage_id
                        ),
                        changed=True,
                        just_completed=True,
                    ),
                )
                for reward in grant_quest_completion_rewards(self.child, [update]):
                    if reward.grant.granted:
                        if reward.rule.message:
                            messages.append(reward.rule.message)
                        new_items.extend(reward.grant.new_item_ids)
        return Response(
            {"quest": quest_body(saved), "rewardMessages": messages, "newItemIds": new_items}
        )
