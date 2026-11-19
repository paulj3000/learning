"""Seasonal events (NP-023, ADR-081): content staff configure, never engine code.

An event links Realms (catalog `World`) and Places (catalog `Location`) to an annual window.
Availability only decides whether a Place is *shown*; it never deletes or locks child progress.
`SeasonalCompletion` records, once per child, event and season year, that the event's completion
world change arrived (annual replay tracking). It is child-owned and not registered in Admin.
"""

import datetime

from django.contrib.postgres.fields import ArrayField
from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from apps.audio.vocabulary import CUE_ID
from apps.core.models import ChildOwnedModel

_LEAP = 2000  # a leap year, so Feb 29 is a valid window edge


def validate_cue_id(value: str) -> None:
    if not CUE_ID.match(value):
        raise ValidationError("Not a valid sound cue id (for example music.north_pole.village).")


class Theme(models.TextChoices):
    CHRISTMAS = "CHRISTMAS", "Christmas"
    HANUKKAH = "HANUKKAH", "Hanukkah"
    THANKSGIVING = "THANKSGIVING", "Thanksgiving"
    HALLOWEEN = "HALLOWEEN", "Halloween"
    EASTER = "EASTER", "Easter"
    LUNAR_NEW_YEAR = "LUNAR_NEW_YEAR", "Lunar New Year"
    WINTER = "WINTER", "Winter"
    OTHER = "OTHER", "Other"


class Availability(models.TextChoices):
    YEAR_ROUND = "YEAR_ROUND", "Year round (the window only features it)"
    WINDOW_ONLY = "WINDOW_ONLY", "Only inside its window"


def _month() -> list:
    return [MinValueValidator(1), MaxValueValidator(12)]


def _day() -> list:
    return [MinValueValidator(1), MaxValueValidator(31)]


class SeasonalEvent(models.Model):
    slug = models.SlugField(max_length=100, unique=True)
    title = models.CharField(max_length=200)
    theme = models.CharField(max_length=16, choices=Theme.choices, default=Theme.OTHER)
    description = models.TextField(blank=True)
    availability = models.CharField(
        max_length=12, choices=Availability.choices, default=Availability.YEAR_ROUND
    )
    window_start_month = models.PositiveSmallIntegerField(null=True, blank=True, validators=_month())
    window_start_day = models.PositiveSmallIntegerField(null=True, blank=True, validators=_day())
    window_end_month = models.PositiveSmallIntegerField(null=True, blank=True, validators=_month())
    window_end_day = models.PositiveSmallIntegerField(null=True, blank=True, validators=_day())
    featured_in_window = models.BooleanField(default=False)
    active = models.BooleanField(default=True)
    realms = models.ManyToManyField("catalog.World", blank=True, related_name="seasonal_events")
    places = models.ManyToManyField("catalog.Location", blank=True, related_name="seasonal_events")
    reward_items = models.ManyToManyField(
        "catalog.ItemDefinition", blank=True, related_name="seasonal_events"
    )
    audio_cue_ids = ArrayField(
        models.CharField(max_length=80, validators=[validate_cue_id]), default=list, blank=True
    )
    decoration_theme = models.SlugField(max_length=50, blank=True)
    completion_change_key = models.CharField(
        max_length=100,
        blank=True,
        help_text="The world change key that counts as finishing this event for a child.",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["slug"]
        constraints = [
            models.CheckConstraint(
                name="seasons_window_all_or_none",
                condition=models.Q(
                    window_start_month__isnull=True,
                    window_start_day__isnull=True,
                    window_end_month__isnull=True,
                    window_end_day__isnull=True,
                )
                | models.Q(
                    window_start_month__isnull=False,
                    window_start_day__isnull=False,
                    window_end_month__isnull=False,
                    window_end_day__isnull=False,
                ),
            ),
        ]

    def __str__(self) -> str:
        return self.slug

    @property
    def has_window(self) -> bool:
        return self.window_start_month is not None

    def clean(self):
        super().clean()
        parts = (
            self.window_start_month,
            self.window_start_day,
            self.window_end_month,
            self.window_end_day,
        )
        given = [p is not None for p in parts]
        if any(given) and not all(given):
            raise ValidationError("Give both ends of the window (month and day), or neither.")
        if all(given):
            for label, month, day in (
                ("start", parts[0], parts[1]),
                ("end", parts[2], parts[3]),
            ):
                try:
                    datetime.date(_LEAP, month, day)
                except ValueError:
                    raise ValidationError(f"The window {label} is not a real date.") from None
        elif self.availability == Availability.WINDOW_ONLY:
            raise ValidationError("An event that is only available in a window needs a window.")


class SeasonalCompletion(ChildOwnedModel):
    """A child finished an event in a season year. Never removed by availability changes."""

    event = models.ForeignKey(SeasonalEvent, on_delete=models.CASCADE, related_name="completions")
    season_year = models.PositiveSmallIntegerField()
    completed_at = models.DateTimeField()

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["child", "event", "season_year"], name="seasonal_completion_once"
            )
        ]
