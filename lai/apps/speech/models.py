"""Spoken dialogue: voice profiles, authored lines, approved utterances, the clip cache (SM-P8).

Nothing here stores audio bytes (the speech store does) and nothing here lets a client choose what
is said. Text reaches speech only as a `SpeechLine` (written by staff), an `ApprovedUtterance`
(made by the server from a validated AI turn, owned by one child, short-lived) or an authored NPC
narration node already in the catalog.
"""

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator, RegexValidator
from django.db import models
from django.utils.timezone import now

from apps.core.models import ChildOwnedModel

from . import voices

PROFILE_ID = RegexValidator(
    r"^[a-z0-9]+(-[a-z0-9]+)*$", "Use lower-case words joined by dashes, for example keeper-quill."
)


class VoiceProfile(models.Model):
    """A character's voice. Staff manage these in Django Admin only."""

    profile_id = models.CharField(
        max_length=40,
        unique=True,
        validators=[PROFILE_ID],
        help_text="Stable id games use, for example keeper-quill, chatty, narrator, tutor.",
    )
    display_name = models.CharField(max_length=80)
    polly_voice_id = models.CharField("Polly voice", max_length=32)
    language_code = models.CharField(max_length=10, default="en-US")
    engine = models.CharField(max_length=12, default="neural")
    speaking_rate_percent = models.PositiveSmallIntegerField(
        "speaking rate (%)",
        default=100,
        validators=[MinValueValidator(voices.MIN_RATE), MaxValueValidator(voices.MAX_RATE)],
        help_text="Standard and neural voices only. 100 is normal; lower is slower.",
    )
    character_id = models.SlugField(
        max_length=64,
        blank=True,
        help_text="The NPC id this voice belongs to (so authored dialogue can find it).",
    )
    enabled = models.BooleanField(default=True)
    notes = models.CharField(max_length=200, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
        editable=False,
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
        editable=False,
    )
    created_at = models.DateTimeField(default=now, editable=False)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["profile_id"]
        verbose_name = "voice profile"
        constraints = [
            models.CheckConstraint(
                condition=models.Q(speaking_rate_percent__gte=voices.MIN_RATE)
                & models.Q(speaking_rate_percent__lte=voices.MAX_RATE),
                name="speech_voice_rate_range",
            ),
        ]

    def __str__(self) -> str:
        return self.profile_id

    def clean(self):
        super().clean()
        problem = voices.voice_problem(self.polly_voice_id, self.language_code, self.engine)
        if problem:
            raise ValidationError({"polly_voice_id": problem})


class SpeechLine(models.Model):
    """A line staff wrote to be spoken (a greeting, a narrated instruction)."""

    line_id = models.CharField(
        max_length=80,
        unique=True,
        validators=[PROFILE_ID],
        help_text="Stable id a game asks for, for example castle-quill-greeting.",
    )
    voice_profile = models.ForeignKey(VoiceProfile, on_delete=models.PROTECT, related_name="lines")
    text = models.TextField(help_text="Exactly what is spoken and shown as the caption.")
    context = models.CharField(
        max_length=40, blank=True, help_text="The game or adventure it is for."
    )
    enabled = models.BooleanField(default=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
        editable=False,
    )
    created_at = models.DateTimeField(default=now, editable=False)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["line_id"]
        verbose_name = "speech line"

    def __str__(self) -> str:
        return self.line_id

    def clean(self):
        super().clean()
        from .services import text_problem

        problem = text_problem(self.text)
        if problem:
            raise ValidationError({"text": problem})


class UtteranceSource(models.TextChoices):
    COMPANION = "COMPANION", "Chatty (companion turn)"
    TUTOR = "TUTOR", "Tutor turn"


class ApprovedUtterance(ChildOwnedModel):
    """Text the server approved to be spoken to one child, kept only briefly.

    Made by the AI integration after the turn passed validation and the guardrails. The child's
    app can only ever ask for this by id, and only while it has not expired.
    """

    text = models.TextField()
    voice_profile = models.ForeignKey(VoiceProfile, on_delete=models.PROTECT, related_name="+")
    source = models.CharField(max_length=12, choices=UtteranceSource.choices)
    created_at = models.DateTimeField(default=now, editable=False)
    expires_at = models.DateTimeField(db_index=True)

    class Meta:
        verbose_name = "approved utterance"

    def __str__(self) -> str:
        return f"Utterance {self.pk}"


class ClipScope(models.TextChoices):
    AUTHORED = "authored", "Authored (shared by every child)"
    CHILD = "child", "One child's"


class SpeechClip(models.Model):
    """One generated MP3 in the speech store, found again by `cache_key`."""

    cache_key = models.CharField(max_length=64, unique=True, editable=False)
    storage_key = models.CharField(max_length=120, unique=True, editable=False)
    scope = models.CharField(max_length=8, choices=ClipScope.choices, editable=False)
    # A child-scoped clip belongs to one child. A plain id, not a foreign key: the clip expires on
    # its own and `purge_child` removes it sooner when a child is deleted.
    owner_child_id = models.UUIDField(null=True, blank=True, editable=False, db_index=True)
    voice_profile_id = models.CharField(max_length=40, editable=False)
    voice = models.CharField(max_length=32, editable=False)
    engine = models.CharField(max_length=12, editable=False)
    language = models.CharField(max_length=10, editable=False)
    characters = models.PositiveIntegerField(editable=False)
    byte_size = models.PositiveIntegerField(editable=False)
    created_at = models.DateTimeField(default=now, editable=False)
    last_used_at = models.DateTimeField(default=now, editable=False)
    hits = models.PositiveIntegerField(default=0, editable=False)
    expires_at = models.DateTimeField(null=True, blank=True, db_index=True, editable=False)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "speech clip"

    def __str__(self) -> str:
        return f"{self.scope} clip {self.pk}"


class SpeechUsage(ChildOwnedModel):
    """What one child asked for today (the limits). Counts and sizes only, never text."""

    day = models.DateField(db_index=True)
    requests = models.PositiveIntegerField(default=0)
    characters = models.PositiveIntegerField(default=0)
    cache_hits = models.PositiveIntegerField(default=0)
    failures = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["child", "day"], name="speech_usage_one_per_child_day")
        ]

    def __str__(self) -> str:
        return f"Speech usage {self.day}"


class SpeechDailyTotal(models.Model):
    """Everything synthesized in a day: the operational numbers and a labelled estimate."""

    day = models.DateField(unique=True)
    requests = models.PositiveIntegerField(default=0)
    cache_hits = models.PositiveIntegerField(default=0)
    cache_misses = models.PositiveIntegerField(default=0)
    characters_synthesized = models.PositiveBigIntegerField(default=0)
    failures = models.PositiveIntegerField(default=0)
    # An estimate from the configured price per million characters. Never a bill.
    estimated_cost_microusd = models.PositiveBigIntegerField(null=True, blank=True)

    class Meta:
        ordering = ["-day"]
        verbose_name = "daily speech total"

    def __str__(self) -> str:
        return str(self.day)
