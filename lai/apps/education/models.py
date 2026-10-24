"""Learning objectives and administrator-configured math challenge slots (LAI-0304, TR-2)."""

from django.core.exceptions import ValidationError
from django.db import models

from apps.core.catalog import ContentStatus
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
