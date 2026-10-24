"""Quest definitions (LAI-0304). Per-child quest progress is LAI-0305.

Prerequisites, stages, and completion keep the exported shapes as JSON; the quest engine
evaluates them. Treasure Rush quests use the same vocabulary (a `WORLD_CHANGE` condition on the
chest's change key), so no new rule type is needed.
"""

from django.contrib.postgres.fields import ArrayField
from django.core.exceptions import ValidationError
from django.db import models

from apps.core.catalog import ContentStatus
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
