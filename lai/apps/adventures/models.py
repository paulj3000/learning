"""Adventure templates (LAI-0304).

`steps` keeps the exported step list as JSON: the adventure engine interprets it and the
loader validates it against the content schema. `location_slug` is a string, not a foreign
key, because story chapters use location slugs that are not `IslandLocation` rows.
"""

from django.contrib.postgres.fields import ArrayField
from django.core.exceptions import ValidationError
from django.db import models

from apps.core.catalog import ContentStatus
from apps.users.models import AgeBand


class AdventureTemplate(models.Model):
    slug = models.SlugField(max_length=80, unique=True)
    version = models.PositiveIntegerField(default=1)
    title = models.CharField(max_length=120)
    description = models.TextField(blank=True, help_text="Shown to parents and in admin.")
    location_slug = models.SlugField(max_length=80, db_index=True)
    age_bands = ArrayField(models.CharField(max_length=16, choices=AgeBand.choices))
    entry_step_id = models.CharField(max_length=80)
    steps = models.JSONField()
    skill_domain = models.CharField(max_length=20, blank=True)
    skill_level = models.PositiveSmallIntegerField(null=True, blank=True)
    learning_objectives = models.ManyToManyField(
        "education.LearningObjective", blank=True, related_name="adventures"
    )
    status = models.CharField(
        max_length=16, choices=ContentStatus.choices, default=ContentStatus.PUBLISHED
    )
    available_from = models.DateTimeField(null=True, blank=True)
    available_until = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["slug"]

    def __str__(self) -> str:
        return self.slug

    def clean(self):
        super().clean()
        errors = {}
        step_ids = [step.get("id") for step in self.steps if isinstance(step, dict)] if isinstance(
            self.steps, list
        ) else None
        if step_ids is None:
            errors["steps"] = "Must be a list of steps."
        elif self.entry_step_id not in step_ids:
            errors["entry_step_id"] = "No step has this id."
        if self.available_from and self.available_until:
            if self.available_until <= self.available_from:
                errors["available_until"] = "Must be after the start."
        if errors:
            raise ValidationError(errors)

    def is_available(self, at) -> bool:
        if self.status != ContentStatus.PUBLISHED:
            return False
        if self.available_from and at < self.available_from:
            return False
        return not (self.available_until and at >= self.available_until)
