"""Quest definitions (LAI-0304) and a child's quest progress (LAI-0305 subset, TR-4).

Prerequisites, stages, and completion keep the exported shapes as JSON; the quest engine
evaluates them. Treasure Rush quests use the same vocabulary (a `WORLD_CHANGE` condition on the
chest's change key), so no new rule type is needed.
"""

from django.contrib.postgres.fields import ArrayField
from django.core.exceptions import ValidationError
from django.db import models
from django.utils.timezone import now

from apps.core.catalog import ContentStatus
from apps.core.child_owned import ChildOwnedModel
from apps.users.models import AgeBand


class QuestDefinition(models.Model):
    quest_id = models.SlugField(max_length=80, unique=True)
    title = models.CharField(max_length=120)
    summary = models.CharField(max_length=300)
    age_bands = ArrayField(models.CharField(max_length=16, choices=AgeBand.choices))
    giver_npc = models.ForeignKey(
        "islands.NpcDefinition",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="quests_given",
    )
    prerequisites = models.JSONField(default=list)
    entry_stage_id = models.CharField(max_length=80)
    stages = models.JSONField()
    completion = models.JSONField(default=dict)
    status = models.CharField(
        max_length=16, choices=ContentStatus.choices, default=ContentStatus.PUBLISHED
    )

    class Meta:
        ordering = ["quest_id"]

    def __str__(self) -> str:
        return self.quest_id

    def clean(self):
        super().clean()
        if not isinstance(self.stages, list):
            raise ValidationError({"stages": "Must be a list of stages."})
        stage_ids = {stage.get("id") for stage in self.stages if isinstance(stage, dict)}
        if self.entry_stage_id not in stage_ids:
            raise ValidationError({"entry_stage_id": "No stage has this id."})


class QuestStatus(models.TextChoices):
    ACTIVE = "ACTIVE"
    COMPLETED = "COMPLETED"


class QuestProgress(ChildOwnedModel):
    """The Amplify `ChildQuestState`. Deliberately small: objective completion is derived on
    the server from world changes, inventory, and sessions (`quests/engine.py`), so this row
    holds only what cannot be derived. AVAILABLE is not stored: no row and passing
    prerequisites mean available. Nothing here is child-authored."""

    child = models.ForeignKey(
        "users.ChildProfile", on_delete=models.CASCADE, related_name="quest_progress"
    )
    # PROTECT: a quest a child has started is retired, never deleted.
    quest = models.ForeignKey(QuestDefinition, on_delete=models.PROTECT, related_name="progress")
    status = models.CharField(max_length=16, choices=QuestStatus.choices, default=QuestStatus.ACTIVE)
    current_stage_id = models.CharField(max_length=80)
    completed_stage_ids = ArrayField(models.CharField(max_length=80), default=list, blank=True)
    completed_objective_ids = ArrayField(models.CharField(max_length=80), default=list, blank=True)
    started_at = models.DateTimeField(default=now)
    updated_at = models.DateTimeField(auto_now=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["child", "quest"], name="quests_progress_once"),
            models.CheckConstraint(
                condition=models.Q(status__in=QuestStatus.values),
                name="quests_progress_status_valid",
            ),
            models.CheckConstraint(
                condition=models.Q(status=QuestStatus.COMPLETED, completed_at__isnull=False)
                | models.Q(status=QuestStatus.ACTIVE, completed_at__isnull=True),
                name="quests_progress_completed_at_iff_completed",
            ),
        ]

    def __str__(self) -> str:
        return str(self.quest_id)
