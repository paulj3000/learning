"""Skill evidence, skill progress and story artifacts (LAI-0305).

Mirrors Amplify `SkillEvidence`, `SkillProgress` and `StoryArtifact`. Learning objectives are
referenced by their stable `code` until a `LearningObjective` catalog model exists (proposed
LAI-0309). The counter arithmetic is not ported here: LAI-0603 ports `nextSkillProgressCounts`
against the golden vectors. The constraints below only reject impossible counters.

Evidence comes from an adventure session, from story play (Amplify writes the latter as
`story:<storyProgressId>`), or from a Treasure Rush challenge attempt, so it has one foreign key
for each and exactly one must be set. `ChallengeSpec` (a seed-authored challenge slot) also
lives here, from Treasure Rush.
"""

from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import F, Q

from apps.core.content_status import ContentStatus
from apps.core.models import ChildOwnedModel
from apps.game_sessions.models import Correctness
from apps.users.models import AgeBand

from .challenges import SKILL_RULES, ChallengeParameters, ResponseMode, validate_parameters


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


class ChallengeSpec(models.Model):
    """One challenge slot: TR-1 `ChallengeParameters` for one age band (seed-authored, like
    the region rows that use it; LAI-0805 decides how such config is authored later).

    Every save is checked with `validate_parameters`, so a row can never hold parameters the
    generator would refuse. The seed is not stored here: the server picks one per attempt.
    """

    slug = models.SlugField(max_length=80, unique=True)
    title = models.CharField(max_length=120, help_text="Admin-only label, never shown to a child.")
    age_band = models.CharField(max_length=16, choices=AgeBand.choices)
    skill_id = models.CharField(
        max_length=80, choices=[(skill, skill) for skill in sorted(SKILL_RULES)]
    )
    min_value = models.PositiveSmallIntegerField(default=0)
    max_value = models.PositiveSmallIntegerField()
    response_mode = models.CharField(
        max_length=16, choices=[(mode.value, mode.value) for mode in ResponseMode]
    )
    choice_count = models.PositiveSmallIntegerField(
        default=0, help_text="Number of answer buttons for CHOICE; 0 for NUMBER_INPUT."
    )
    status = models.CharField(
        max_length=16, choices=ContentStatus.choices, default=ContentStatus.DRAFT
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["slug"]

    def __str__(self) -> str:
        return self.slug

    def parameters(self) -> ChallengeParameters:
        return ChallengeParameters(
            skill_id=self.skill_id,
            min_value=self.min_value,
            max_value=self.max_value,
            response_mode=ResponseMode(self.response_mode),
            choice_count=self.choice_count,
        )

    def clean(self):
        super().clean()
        if self.response_mode not in ResponseMode.__members__.values():
            return  # the field's own choices check reports it
        codes = validate_parameters(self.parameters(), self.age_band)
        if codes:
            raise ValidationError(
                [ValidationError(code, code=code) for code in codes], code="invalid_challenge"
            )

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)


class SkillEvidence(ChildOwnedModel):
    CHILD_LINKS = ("adventure_session", "story_progress", "challenge_attempt")

    adventure_session = models.ForeignKey(
        "game_sessions.AdventureSession", on_delete=models.CASCADE, null=True, blank=True,
        related_name="+",
    )
    story_progress = models.ForeignKey(
        "progression.StoryProgress", on_delete=models.CASCADE, null=True, blank=True, related_name="+"
    )
    challenge_attempt = models.OneToOneField(
        "game_sessions.ChallengeAttempt", on_delete=models.CASCADE, null=True, blank=True,
        related_name="evidence",
    )
    learning_objective_code = models.CharField(max_length=100)
    evidence_type = models.CharField(max_length=32)
    difficulty = models.PositiveSmallIntegerField(null=True, blank=True)
    result = models.CharField(max_length=16, choices=Correctness.choices)
    support_level = models.PositiveSmallIntegerField()
    duration_ms = models.PositiveIntegerField(null=True, blank=True)
    observed_at = models.DateTimeField()

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(adventure_session__isnull=False, story_progress__isnull=True,
                            challenge_attempt__isnull=True)
                | Q(adventure_session__isnull=True, story_progress__isnull=False,
                    challenge_attempt__isnull=True)
                | Q(adventure_session__isnull=True, story_progress__isnull=True,
                    challenge_attempt__isnull=False),
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
