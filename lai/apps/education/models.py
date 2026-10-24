"""Learning objectives and math challenge slots (LAI-0304, TR-2); skill evidence (TR-4)."""

import uuid

from django.core.exceptions import ValidationError
from django.db import models
from django.utils.timezone import now

from apps.core.catalog import ContentStatus
from apps.core.child_owned import ChildOwnedModel
from apps.users.models import AgeBand

from .challenges import SKILL_RULES, ChallengeParameters, ResponseMode, validate_parameters


class LearningDomain(models.TextChoices):
    LITERACY = "literacy"
    NUMERACY = "numeracy"
    SCIENCE = "science"
    CREATIVITY = "creativity"
    SOCIAL_EMOTIONAL = "social-emotional"
    EXECUTIVE_FUNCTION = "executive-function"


class LearningObjective(models.Model):
    """A learning objective adventure steps cite by `code` (`objectiveIds`)."""

    code = models.SlugField(max_length=80, unique=True)
    domain = models.CharField(max_length=40, choices=LearningDomain.choices)
    title = models.CharField(max_length=200)

    class Meta:
        ordering = ["code"]

    def __str__(self) -> str:
        return self.code


class ChallengeSpec(models.Model):
    """One challenge slot: TR-1 `ChallengeParameters` for one age band.

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


class EvidenceResult(models.TextChoices):
    """The Amplify `Correctness` enum."""

    CORRECT = "CORRECT"
    INCORRECT = "INCORRECT"
    PARTIAL = "PARTIAL"
    NOT_APPLICABLE = "NOT_APPLICABLE"


class SkillEvidence(ChildOwnedModel):
    """One observation of a child practising a learning objective (the Amplify `SkillEvidence`).

    Append-only raw evidence; `SkillProgress` (the Mastery Engine's derived counters) is computed
    from it and is not ported yet. `attempt` is unique, so a challenge attempt yields at most one
    piece of evidence however often the write is retried, which closes, for this path, the
    "no natural collision key" gap ADR-015 recorded for evidence writes.
    """

    CHILD_LINKS = ("session", "attempt")

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    child = models.ForeignKey(
        "users.ChildProfile", on_delete=models.CASCADE, related_name="skill_evidence"
    )
    session = models.ForeignKey(
        "game_sessions.AdventureSession",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="skill_evidence",
    )
    attempt = models.OneToOneField(
        "game_sessions.ChallengeAttempt",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="evidence",
    )
    learning_objective = models.ForeignKey(
        LearningObjective, on_delete=models.PROTECT, related_name="evidence"
    )
    evidence_type = models.CharField(max_length=40)
    result = models.CharField(max_length=16, choices=EvidenceResult.choices)
    # As in Amplify: the hint level the child used; 0 means unsupported.
    support_level = models.PositiveSmallIntegerField(default=0)
    difficulty = models.PositiveSmallIntegerField(null=True, blank=True)
    duration_ms = models.PositiveIntegerField(null=True, blank=True)
    observed_at = models.DateTimeField(default=now)

    class Meta:
        ordering = ["observed_at"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(result__in=EvidenceResult.values),
                name="education_evidence_result_valid",
            )
        ]
        indexes = [
            models.Index(
                fields=["child", "learning_objective", "observed_at"],
                name="education_evidence_child_lo",
            )
        ]

    def __str__(self) -> str:
        return str(self.id)
