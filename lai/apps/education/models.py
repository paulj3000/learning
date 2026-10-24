"""Skill evidence, skill progress and story artifacts (LAI-0305).

Mirrors Amplify `SkillEvidence`, `SkillProgress` and `StoryArtifact`. Learning objectives are
referenced by their stable `code` until a `LearningObjective` catalog model exists (proposed
LAI-0309). The counter arithmetic is not ported here: LAI-0603 ports `nextSkillProgressCounts`
against the golden vectors. The constraints below only reject impossible counters.

Evidence comes from an adventure session or from story play (Amplify writes the latter as
`story:<storyProgressId>`), so it has one foreign key for each and exactly one must be set.
"""

from django.db import models
from django.db.models import F, Q

from apps.core.models import ChildOwnedModel
from apps.game_sessions.models import Correctness


class SkillStatus(models.TextChoices):
    LOCKED = "LOCKED"
    INTRODUCED = "INTRODUCED"
    DEVELOPING = "DEVELOPING"
    PROFICIENT = "PROFICIENT"
    MASTERED = "MASTERED"


class ErrorPattern(models.TextChoices):
    NONE = "NONE"
    NEEDS_SUPPORT = "NEEDS_SUPPORT"
    INCONSISTENT = "INCONSISTENT"
    STALLED = "STALLED"


class SkillEvidence(ChildOwnedModel):
    adventure_session = models.ForeignKey(
        "game_sessions.AdventureSession", on_delete=models.CASCADE, null=True, blank=True,
        related_name="+",
    )
    story_progress = models.ForeignKey(
        "progression.StoryProgress", on_delete=models.CASCADE, null=True, blank=True, related_name="+"
    )
    learning_objective_code = models.CharField(max_length=100)
    evidence_type = models.CharField(max_length=32)
    result = models.CharField(max_length=16, choices=Correctness.choices)
    support_level = models.PositiveSmallIntegerField()
    duration_ms = models.PositiveIntegerField(null=True, blank=True)
    observed_at = models.DateTimeField()

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(adventure_session__isnull=False, story_progress__isnull=True)
                | Q(adventure_session__isnull=True, story_progress__isnull=False),
                name="evidence_exactly_one_source",
            ),
        ]
        indexes = [
            models.Index(
                fields=["child", "learning_objective_code", "observed_at"], name="evidence_child_skill"
            ),
        ]


class SkillProgress(ChildOwnedModel):
    learning_objective_code = models.CharField(max_length=100)
    exposure_count = models.PositiveIntegerField(default=0)
    independent_success_count = models.PositiveIntegerField(default=0)
    supported_success_count = models.PositiveIntegerField(default=0)
    consecutive_independent_correct = models.PositiveIntegerField(default=0)
    recent_level = models.CharField(max_length=16, choices=SkillStatus.choices, blank=True)
    error_pattern = models.CharField(max_length=16, choices=ErrorPattern.choices, blank=True)
    last_practiced_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["child", "learning_objective_code"], name="skill_progress_once"
            ),
            # Every success is an exposure, and a streak is made of independent successes.
            models.CheckConstraint(
                condition=Q(exposure_count__gte=F("independent_success_count") + F("supported_success_count")),
                name="skill_progress_successes_within_exposures",
            ),
            models.CheckConstraint(
                condition=Q(independent_success_count__gte=F("consecutive_independent_correct")),
                name="skill_progress_streak_within_successes",
            ),
        ]


class StoryArtifact(ChildOwnedModel):
    """A story the child made. Parent-viewable and parent-deletable (LAI-0607)."""

    adventure_session = models.ForeignKey(
        "game_sessions.AdventureSession", on_delete=models.CASCADE, related_name="+",
        help_text="The session it was made in; the adventure is the session's.",
    )
    title = models.CharField(max_length=200)
    scenes = models.JSONField()
    created_at = models.DateTimeField()
