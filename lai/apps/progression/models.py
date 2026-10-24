"""World changes (LAI-0305 subset, TR-4): the durable record that a child changed their island.

Same fields as the Amplify `WorldChange` (docs/DATA_MODEL.md). One row per child, location, and
change key, enforced by the database, so a change recorded twice (a retried request, two
devices, a replayed answer) is still one change. Rows are append-only: nothing in gameplay
edits or removes one. `ChildWorldState` (the derived current view) is not ported yet; the play
API reads these rows directly.
"""

import uuid

from django.db import models
from django.utils.timezone import now

from apps.core.child_owned import ChildOwnedModel


class AppendOnly(ValueError):
    pass


class WorldChange(ChildOwnedModel):
    CHILD_LINKS = ("source_session",)

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    child = models.ForeignKey(
        "users.ChildProfile", on_delete=models.CASCADE, related_name="world_changes"
    )
    location_slug = models.SlugField(max_length=80)
    change_type = models.CharField(max_length=40)
    change_key = models.CharField(max_length=80)
    payload = models.JSONField(default=dict, blank=True)
    source_session = models.ForeignKey(
        "game_sessions.AdventureSession",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="world_changes",
    )
    created_at = models.DateTimeField(default=now)

    class Meta:
        ordering = ["created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["child", "location_slug", "change_key"],
                name="progression_world_change_once",
            ),
            models.CheckConstraint(
                condition=~models.Q(change_key=""), name="progression_world_change_key_set"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.location_slug}:{self.change_key}"

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise AppendOnly("World changes are never edited.")
        super().save(*args, **kwargs)
