"""World changes, world state, story progress and NPC relationships (LAI-0305).

Mirrors Amplify `WorldChange`, `ChildWorldState`, `ChildStoryProgress` and `ChildNpcState`.

Location, story, NPC and checkpoint ids are the export's stable string ids. `location_slug` is
not a foreign key because a story's world change may name a story-only place with no Location
record (a known ambiguity of the export); stories and NPCs have no catalog models yet.
"""

from django.contrib.postgres.fields import ArrayField
from django.db import models

from apps.core.models import ChildOwnedModel


class RelationshipLevel(models.TextChoices):
    STRANGER = "STRANGER"
    ACQUAINTANCE = "ACQUAINTANCE"
    FRIEND = "FRIEND"
    TRUSTED_FRIEND = "TRUSTED_FRIEND"


class AppendOnly(ValueError):
    """A recorded world change was about to be edited (Treasure Rush TR-4)."""


class WorldChange(ChildOwnedModel):
    """A persistent consequence on the island (ADR-005). Recording the same change twice is a
    no-op, and a recorded change is never edited (append-only)."""

    location_slug = models.CharField(max_length=100)
    change_type = models.CharField(max_length=64)
    change_key = models.CharField(max_length=100)
    payload = models.JSONField(null=True, blank=True)
    source_session_id = models.CharField(
        max_length=64,
        blank=True,
        help_text="The adventure, story or co-op session that caused it, as Amplify records it.",
    )
    created_at = models.DateTimeField()

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["child", "location_slug", "change_key"], name="world_change_once"
            ),
            models.CheckConstraint(condition=~models.Q(change_key=""), name="world_change_key_set"),
        ]
        indexes = [
            models.Index(fields=["child", "location_slug"], name="world_change_child_location")
        ]

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise AppendOnly("A world change is never edited.")
        super().save(*args, **kwargs)


class WorldState(ChildOwnedModel):
    """One per child: what they have discovered and where they last stood."""

    discovered_objects = ArrayField(models.CharField(max_length=100), default=list, blank=True)
    discovered_characters = ArrayField(models.CharField(max_length=100), default=list, blank=True)
    last_checkpoint_id = models.CharField(max_length=100, blank=True)
    updated_at = models.DateTimeField()

    class Meta:
        constraints = [models.UniqueConstraint(fields=["child"], name="world_state_one_per_child")]


class StoryProgress(ChildOwnedModel):
    story_slug = models.CharField(max_length=100)
    current_chapter_id = models.CharField(max_length=100)
    completed_chapter_ids = ArrayField(models.CharField(max_length=100), default=list, blank=True)
    story_flags = models.JSONField(null=True, blank=True)
    started_at = models.DateTimeField()
    last_played_at = models.DateTimeField()
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["child", "story_slug"], name="story_progress_once"),
        ]


class NpcRelationship(ChildOwnedModel):
    npc_id = models.CharField(max_length=100)
    relationship_points = models.IntegerField(default=0)
    relationship_level = models.CharField(max_length=16, choices=RelationshipLevel.choices)
    memory_flags = models.JSONField(null=True, blank=True)
    seen_node_ids = ArrayField(models.CharField(max_length=100), default=list, blank=True)
    first_met_at = models.DateTimeField()
    last_interacted_at = models.DateTimeField()

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["child", "npc_id"], name="npc_relationship_once"),
            models.CheckConstraint(
                condition=models.Q(relationship_level__in=RelationshipLevel.values),
                name="npc_relationship_level_valid",
            ),
        ]
