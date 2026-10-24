"""Adventure sessions, their step attempts, and household co-op sessions (LAI-0305).

Mirrors the Amplify `AdventureSession`, `AdventureAction` and `CoopSession` models so Phase 11
can migrate them, with two changes: the adventure is a foreign key to the catalog row (catalog
rows are never deleted by an import, so the reference survives a content release that drops the
adventure), and co-op participants are rows instead of an id array.

A session is the child's adventure progress: the current step, the status, and the timestamps.
Step progress is derived from the session's actions, one row per attempt; a step is completed
once an attempt has moved the session past it. No separate step-progress table exists because
the canonical model does not need one.

The values written here come from server-side rule code (`apps.game_sessions.services`, then
LAI-0601's Python validators). No endpoint writes them yet, and no client value is trusted.
"""

import uuid

from django.db import models
from django.db.models import F, Q

from apps.core.models import ChildOwnedModel

MAX_HINT_LEVEL = 5  # react/src/features/adventures/engine/hints.ts: MAX_HINT_LEVEL
# An authored transition may end an adventure without a step of this name (docs/DATA_MODEL.md).
COMPLETE_STEP_ID = "complete"


class SessionStatus(models.TextChoices):
    ACTIVE = "ACTIVE"
    PAUSED = "PAUSED"
    COMPLETED = "COMPLETED"
    ABANDONED = "ABANDONED"
    SAFETY_STOPPED = "SAFETY_STOPPED"


class Correctness(models.TextChoices):
    CORRECT = "CORRECT"
    INCORRECT = "INCORRECT"
    PARTIAL = "PARTIAL"
    NOT_APPLICABLE = "NOT_APPLICABLE"


class CoopSessionStatus(models.TextChoices):
    ACTIVE = "ACTIVE"
    COMPLETED = "COMPLETED"
    ABANDONED = "ABANDONED"


class AdventureSession(ChildOwnedModel):
    adventure = models.ForeignKey(
        "catalog.Adventure", on_delete=models.PROTECT, related_name="sessions"
    )
    template_version = models.PositiveIntegerField(
        help_text="The adventure's version when the session started; it never changes after."
    )
    content_release = models.ForeignKey(
        "catalog.ContentRelease", on_delete=models.PROTECT, related_name="+",
        help_text="The latest content release when the session started.",
    )
    status = models.CharField(max_length=16, choices=SessionStatus.choices)
    current_step_id = models.CharField(max_length=100)
    coop_session = models.ForeignKey(
        "game_sessions.CoopSession", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="adventure_sessions",
    )
    started_at = models.DateTimeField()
    last_activity_at = models.DateTimeField()
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(status__in=SessionStatus.values), name="session_status_valid"
            ),
            models.CheckConstraint(
                condition=(Q(status=SessionStatus.COMPLETED) & Q(completed_at__isnull=False))
                | (~Q(status=SessionStatus.COMPLETED) & Q(completed_at__isnull=True)),
                name="session_completed_at_iff_completed",
            ),
            models.CheckConstraint(
                condition=Q(last_activity_at__gte=F("started_at")), name="session_activity_after_start"
            ),
            # resumeOrStartSession reuses the active session; the database now guarantees one.
            models.UniqueConstraint(
                fields=["child", "adventure"], condition=Q(status=SessionStatus.ACTIVE),
                name="session_one_active_per_child_adventure",
            ),
        ]
        indexes = [
            models.Index(fields=["child", "status"], name="session_child_status"),
            models.Index(fields=["child", "-last_activity_at"], name="session_child_recent"),
        ]


class AdventureAction(models.Model):
    """One attempt at one step. Reached only through its session, never by id alone."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    session = models.ForeignKey(AdventureSession, on_delete=models.CASCADE, related_name="actions")
    step_id = models.CharField(max_length=100)
    action_type = models.CharField(max_length=32)
    normalized_answer = models.CharField(
        max_length=200, blank=True,
        help_text="The structured answer (an option id, a number, an order), never free text.",
    )
    correctness = models.CharField(max_length=16, choices=Correctness.choices)
    hint_level = models.PositiveSmallIntegerField(default=0)
    attempt_number = models.PositiveIntegerField()
    next_step_id = models.CharField(
        max_length=100, blank=True, help_text="Where this attempt moved the session; empty if it stayed."
    )
    duration_ms = models.PositiveIntegerField(null=True, blank=True)
    created_at = models.DateTimeField()

    class Meta:
        ordering = ["session", "created_at", "attempt_number"]
        constraints = [
            models.UniqueConstraint(
                fields=["session", "step_id", "attempt_number"], name="action_unique_attempt"
            ),
            models.CheckConstraint(condition=Q(attempt_number__gte=1), name="action_attempt_from_one"),
            models.CheckConstraint(
                condition=Q(hint_level__lte=MAX_HINT_LEVEL), name="action_hint_level_on_ladder"
            ),
            models.CheckConstraint(
                condition=Q(correctness__in=Correctness.values), name="action_correctness_valid"
            ),
        ]

    def __str__(self) -> str:
        return f"action {self.id}"


class CoopSession(models.Model):
    """A household co-presence session (ADR-006): one host parent, that parent's children."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    host_parent = models.ForeignKey(
        "users.ParentAccount", on_delete=models.PROTECT, related_name="+", editable=False
    )
    adventure = models.ForeignKey("catalog.Adventure", on_delete=models.PROTECT, related_name="+")
    template_version = models.PositiveIntegerField()
    status = models.CharField(max_length=16, choices=CoopSessionStatus.choices)
    shared_state = models.JSONField(
        null=True, blank=True, help_text="Slot claims and presence, as Amplify stores them."
    )
    started_at = models.DateTimeField()
    last_activity_at = models.DateTimeField()
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(status__in=CoopSessionStatus.values), name="coop_status_valid"
            ),
        ]

    def __str__(self) -> str:
        return f"coop session {self.id}"


class CoopParticipant(models.Model):
    """One child in a co-op session (Amplify's `participantChildProfileIds`, as rows)."""

    coop_session = models.ForeignKey(CoopSession, on_delete=models.CASCADE, related_name="participants")
    child = models.ForeignKey("users.ChildProfile", on_delete=models.CASCADE, related_name="+")

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["coop_session", "child"], name="coop_participant_once"),
        ]

    def __str__(self) -> str:
        return f"coop participant {self.pk}"
