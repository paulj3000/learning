"""Quest progress (LAI-0305). Mirrors Amplify `ChildQuestState`.

A quest belongs to a world, not to one adventure (LAI-0304): its progress links to the catalog
`Quest`, and the adventures it spans are found through the quest, never stored here. Stage and
objective ids are the quest's own authored ids, kept as arrays because they are only ever read
and written together with the row (the documented ArrayField choice).
"""

from django.contrib.postgres.fields import ArrayField
from django.db import models
from django.db.models import Q

from apps.core.models import ChildOwnedModel


class QuestStatus(models.TextChoices):
    ACTIVE = "ACTIVE"
    COMPLETED = "COMPLETED"


class QuestProgress(ChildOwnedModel):
    quest = models.ForeignKey("catalog.Quest", on_delete=models.PROTECT, related_name="progress")
    status = models.CharField(max_length=16, choices=QuestStatus.choices)
    current_stage_id = models.CharField(max_length=100)
    completed_stage_ids = ArrayField(models.CharField(max_length=100), default=list, blank=True)
    completed_objective_ids = ArrayField(models.CharField(max_length=100), default=list, blank=True)
    started_at = models.DateTimeField()
    last_updated_at = models.DateTimeField()
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["child", "quest"], name="quest_progress_once_per_child"
            ),
            models.CheckConstraint(
                condition=Q(status__in=QuestStatus.values), name="quest_status_valid"
            ),
            models.CheckConstraint(
                condition=(Q(status=QuestStatus.COMPLETED) & Q(completed_at__isnull=False))
                | (Q(status=QuestStatus.ACTIVE) & Q(completed_at__isnull=True)),
                name="quest_completed_at_iff_completed",
            ),
        ]
        indexes = [models.Index(fields=["child", "status"], name="quest_progress_child_status")]
