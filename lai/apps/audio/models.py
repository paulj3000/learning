"""Sound cues, their assignments, and published sound releases (SM-P2; ADR in docs/DECISIONS.md).

Three layers, deliberately separate:

- `SoundCue` is a logical sound ("sfx.chest.open") that points at a managed audio asset
  (`catalog.ContentAsset`, kind `audio`) and carries playback settings. No bytes and no storage
  key live here: the Asset Library owns files, versions, publishing and delivery.
- `SoundAssignment` attaches a cue to an event on something in the content hierarchy
  (Island, Place, 3D Area, Adventure, Quest, NPC, object, chest, reward).
- `SoundRelease` is an immutable snapshot of every enabled cue and assignment, with each cue's
  audio version pinned. Games only ever read the one LIVE release. Cues and assignments are the
  working copy: editing them changes nothing a child hears until someone publishes a release.
"""

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator, RegexValidator
from django.db import models
from django.utils.timezone import now

from apps.core.models import ChildOwnedModel

from . import vocabulary as vocab

_UNIT = [MinValueValidator(0.0), MaxValueValidator(1.0)]


class SoundCue(models.Model):
    cue_id = models.CharField(
        "cue id",
        max_length=80,
        unique=True,
        validators=[
            RegexValidator(
                vocab.CUE_ID_PATTERN,
                "Use the channel, then lower-case words joined by dots, "
                "for example sfx.chest.open or music.treasure_rush.explore.",
            )
        ],
        help_text="Stable id games use. Starts with the channel. Never reuse an id for a "
        "different sound.",
    )
    name = models.CharField(max_length=120)
    description = models.CharField(max_length=500, blank=True)
    channel = models.CharField(max_length=8, choices=vocab.Channel.choices)
    asset = models.ForeignKey(
        "catalog.ContentAsset",
        on_delete=models.PROTECT,
        related_name="sound_cues",
        help_text="An audio asset from the Asset Library. Upload and publish files there.",
    )
    pinned_version = models.ForeignKey(
        "assets.AssetVersion",
        on_delete=models.PROTECT,
        related_name="+",
        null=True,
        blank=True,
        help_text="Leave empty to use the asset's default version when a release is published. "
        "A published release always pins the exact version either way.",
    )
    volume = models.FloatField(
        default=1.0, validators=[MinValueValidator(0.0), MaxValueValidator(1.0)]
    )
    loop = models.BooleanField(default=False)
    stream = models.BooleanField(
        default=False, help_text="Play from a streamed file. Use for music and long ambience."
    )
    priority = models.PositiveSmallIntegerField(
        null=True,
        blank=True,
        validators=[MaxValueValidator(100)],
        help_text="0 to 100. Empty uses the channel's default.",
    )
    max_concurrent = models.PositiveSmallIntegerField(
        "concurrency limit",
        null=True,
        blank=True,
        validators=[MinValueValidator(1), MaxValueValidator(32)],
        help_text="How many copies may play at once. Empty means no limit.",
    )
    cooldown_ms = models.PositiveIntegerField(
        "cooldown (ms)", default=0, validators=[MaxValueValidator(60_000)]
    )
    fade_in_ms = models.PositiveIntegerField(
        "fade in (ms)", default=0, validators=[MaxValueValidator(10_000)]
    )
    fade_out_ms = models.PositiveIntegerField(
        "fade out (ms)", default=0, validators=[MaxValueValidator(10_000)]
    )
    shared = models.BooleanField(
        default=False,
        help_text="Include in every manifest, for sounds games trigger directly "
        "(buttons, menus, common effects).",
    )
    enabled = models.BooleanField(
        default=True, help_text="Disabled cues are left out of the next release."
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="+",
        null=True,
        blank=True,
        editable=False,
    )
    created_at = models.DateTimeField(default=now, editable=False)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["cue_id"]
        verbose_name = "sound cue"
        verbose_name_plural = "sound cues"
        constraints = [
            models.CheckConstraint(
                condition=models.Q(channel__in=vocab.Channel.values),
                name="audio_cue_channel_valid",
            ),
            # The id's first word is the cue's channel, so an id never lies about its mixer.
            models.CheckConstraint(
                condition=models.Q(cue_id__startswith=models.F("channel")),
                name="audio_cue_id_starts_with_channel",
            ),
            models.CheckConstraint(
                condition=models.Q(volume__gte=0.0, volume__lte=1.0),
                name="audio_cue_volume_range",
            ),
            models.CheckConstraint(
                condition=models.Q(priority__isnull=True) | models.Q(priority__lte=100),
                name="audio_cue_priority_range",
            ),
            models.CheckConstraint(
                condition=models.Q(max_concurrent__isnull=True) | models.Q(max_concurrent__gte=1),
                name="audio_cue_concurrency_positive",
            ),
        ]

    def __str__(self) -> str:
        return self.cue_id

    def save(self, *args, **kwargs):
        if self.pk:
            stored = SoundCue.objects.filter(pk=self.pk).values_list("channel", flat=True).first()
            if stored is not None and stored != self.channel:
                # Assignments and games rely on the id's channel; a different channel is a new cue.
                raise ValidationError({"channel": "A cue's channel cannot change. Make a new cue."})
        super().save(*args, **kwargs)

    def clean(self):
        super().clean()
        errors: dict[str, str] = {}
        if self.channel and self.cue_id:
            if not self.cue_id.startswith(f"{self.channel}."):
                errors["cue_id"] = f"This id must start with '{self.channel}.' for this channel."
        if self.asset_id:
            asset = self.asset
            if asset.kind != vocab.AUDIO_KIND:
                errors["asset"] = "Choose an audio asset (this one is not an audio asset)."
            elif self.channel and asset.category not in vocab.CHANNEL_CATEGORIES.get(
                self.channel, frozenset()
            ):
                errors["asset"] = (
                    f"A '{asset.category}' asset does not suit the {self.channel} channel. "
                    "Change the asset's category in the Asset Library or choose another asset."
                )
        if self.pinned_version_id and self.asset_id:
            version = self.pinned_version
            if version.asset_id != self.asset_id:
                errors["pinned_version"] = "This version belongs to a different asset."
            elif version.status != "PUBLISHED":
                errors["pinned_version"] = (
                    f"This version is {version.get_status_display().lower()}. "
                    "Pin a published version."
                )
        if errors:
            raise ValidationError(errors)


class SoundAssignment(models.Model):
    """Attach a cue to an event on a target, inside a scope of the content hierarchy.

    The scope uses real relationships (Island = `catalog.World`, Place = `catalog.Location`,
    3D Area = `regions.WorldRegion`); none set means everywhere. The target is named by its
    existing stable content id and checked against the real rows (`targets.py`).
    """

    world = models.ForeignKey(
        "catalog.World",
        on_delete=models.PROTECT,
        related_name="sound_assignments",
        null=True,
        blank=True,
        verbose_name="island",
    )
    location = models.ForeignKey(
        "catalog.Location",
        on_delete=models.PROTECT,
        related_name="sound_assignments",
        null=True,
        blank=True,
        verbose_name="place",
    )
    region = models.ForeignKey(
        "regions.WorldRegion",
        on_delete=models.PROTECT,
        related_name="sound_assignments",
        null=True,
        blank=True,
        verbose_name="3D Area",
    )
    target_type = models.CharField(max_length=12, choices=vocab.TargetType.choices)
    target_id = models.SlugField(
        max_length=80,
        blank=True,
        help_text="The content id of the target. Empty for the scope itself.",
    )
    event = models.CharField(max_length=20, choices=vocab.SoundEvent.choices)
    cue = models.ForeignKey(SoundCue, on_delete=models.PROTECT, related_name="assignments")
    channel = models.CharField(
        max_length=8,
        choices=vocab.Channel.choices,
        editable=False,
        help_text="Copied from the cue. A slot holds one cue per channel, so a Place can start "
        "an ambient bed and an Area can start music for the same event.",
    )
    enabled = models.BooleanField(default=True)
    note = models.CharField(max_length=200, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="+",
        null=True,
        blank=True,
        editable=False,
    )
    created_at = models.DateTimeField(default=now, editable=False)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["target_type", "target_id", "event"]
        verbose_name = "sound assignment"
        verbose_name_plural = "sound assignments"
        constraints = [
            # One cue per slot and channel: the same scope, target, event and channel cannot be
            # assigned twice.
            models.UniqueConstraint(
                fields=[
                    "world",
                    "location",
                    "region",
                    "target_type",
                    "target_id",
                    "event",
                    "channel",
                ],
                nulls_distinct=False,
                name="audio_assignment_one_cue_per_slot",
            ),
            models.CheckConstraint(
                condition=models.Q(world__isnull=True, location__isnull=True)
                | models.Q(world__isnull=True, region__isnull=True)
                | models.Q(location__isnull=True, region__isnull=True),
                name="audio_assignment_one_scope",
            ),
            models.CheckConstraint(
                condition=models.Q(target_type__in=vocab.TargetType.values),
                name="audio_assignment_target_type_valid",
            ),
            models.CheckConstraint(
                condition=models.Q(event__in=vocab.SoundEvent.values),
                name="audio_assignment_event_valid",
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(target_type=vocab.TargetType.SCOPE, target_id="")
                    | (~models.Q(target_type=vocab.TargetType.SCOPE) & ~models.Q(target_id=""))
                ),
                name="audio_assignment_target_id_matches_type",
            ),
        ]

    def __str__(self) -> str:
        target = self.target_id or "scope"
        return f"{self.target_type}:{target} {self.event} -> {self.cue_id}"

    @property
    def scope_type(self) -> str:
        if self.region_id:
            return vocab.Scope.AREA
        if self.location_id:
            return vocab.Scope.PLACE
        if self.world_id:
            return vocab.Scope.ISLAND
        return vocab.Scope.GLOBAL

    @property
    def scope_id(self) -> str | None:
        if self.region_id:
            return self.region.region_id
        if self.location_id:
            return self.location.slug
        if self.world_id:
            return self.world.slug
        return None

    def save(self, *args, **kwargs):
        if self.cue_id:
            self.channel = self.cue.channel
        super().save(*args, **kwargs)

    def clean(self):
        super().clean()
        from . import targets

        if self.cue_id:
            self.channel = self.cue.channel
        problems = targets.assignment_problems(self)
        if problems:
            raise ValidationError(problems)


class ReleaseStatus(models.TextChoices):
    LIVE = "LIVE", "Live"
    SUPERSEDED = "SUPERSEDED", "Superseded"


class ImmutableRelease(ValueError):
    """A release's content was about to change, or it was being deleted."""


class SoundRelease(models.Model):
    """An immutable, published snapshot. At most one is LIVE; games read only that one."""

    number = models.PositiveIntegerField(unique=True, editable=False)
    status = models.CharField(
        max_length=12, choices=ReleaseStatus.choices, default=ReleaseStatus.LIVE, editable=False
    )
    revision = models.CharField(max_length=64, editable=False)
    snapshot = models.JSONField(editable=False)
    note = models.CharField(max_length=300, blank=True, editable=False)
    rolled_back_from = models.ForeignKey(
        "self",
        on_delete=models.PROTECT,
        related_name="+",
        null=True,
        blank=True,
        editable=False,
        help_text="Set when this release re-publishes an earlier one.",
    )
    published_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="+",
        null=True,
        blank=True,
        editable=False,
    )
    published_at = models.DateTimeField(default=now, editable=False)

    FIXED_FIELDS = ("number", "revision", "snapshot", "note", "rolled_back_from_id", "published_at")

    class Meta:
        ordering = ["-number"]
        verbose_name = "sound release"
        verbose_name_plural = "sound releases"
        permissions = [
            ("publish_soundrelease", "Can publish the sound library"),
            ("rollback_soundrelease", "Can roll the sound library back to an earlier release"),
        ]
        constraints = [
            # At most one LIVE row: the unique key is the status, restricted to LIVE rows.
            models.UniqueConstraint(
                fields=["status"],
                condition=models.Q(status="LIVE"),
                name="audio_release_one_live",
            ),
            models.CheckConstraint(
                condition=models.Q(status__in=ReleaseStatus.values),
                name="audio_release_status_valid",
            ),
            models.CheckConstraint(
                condition=models.Q(revision__regex=r"^[0-9a-f]{64}$"),
                name="audio_release_revision_hex",
            ),
        ]

    @classmethod
    def from_db(cls, db, field_names, values, **kwargs):
        instance = super().from_db(db, field_names, values, **kwargs)
        instance._loaded = {name: getattr(instance, name) for name in cls.FIXED_FIELDS}
        return instance

    def save(self, *args, **kwargs):
        loaded = getattr(self, "_loaded", None)
        if loaded is not None:
            changed = [n for n in self.FIXED_FIELDS if getattr(self, n) != loaded[n]]
            if changed:
                raise ImmutableRelease(f"A release cannot change: {', '.join(changed)}.")
        super().save(*args, **kwargs)
        self._loaded = {name: getattr(self, name) for name in self.FIXED_FIELDS}

    def delete(self, *args, **kwargs):
        raise ImmutableRelease("A sound release is never deleted; publish a newer one instead.")

    def __str__(self) -> str:
        return f"Release {self.number} ({self.get_status_display().lower()})"


class ChildAudioSettings(ChildOwnedModel):
    """One child's saved audio mix (SM-P5): the Sound Manager's master and five channel settings.

    The mix is a preference, so a mute never overwrites a remembered volume (they are separate
    columns). Defaults equal the React Sound Manager's calm defaults
    (`react/src/audio/AudioChannels.ts`). At most one row per child; no row means defaults.
    Rows belong to the child and go with the child (`ChildOwnedModel`). Nothing here is free
    text, and no sound is stored: staff configure sound in the sound library, not here.
    """

    master_volume = models.FloatField(default=1.0, validators=_UNIT)
    master_muted = models.BooleanField(default=False)
    music_volume = models.FloatField(default=0.5, validators=_UNIT)
    music_muted = models.BooleanField(default=False)
    ambient_volume = models.FloatField(default=0.5, validators=_UNIT)
    ambient_muted = models.BooleanField(default=False)
    sfx_volume = models.FloatField(default=0.8, validators=_UNIT)
    sfx_muted = models.BooleanField(default=False)
    voice_volume = models.FloatField(default=1.0, validators=_UNIT)
    voice_muted = models.BooleanField(default=False)
    ui_volume = models.FloatField(default=0.7, validators=_UNIT)
    ui_muted = models.BooleanField(default=False)
    reduced_intensity = models.BooleanField(
        default=False, help_text="Music and ambience play at half level."
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "child audio settings"
        verbose_name_plural = "child audio settings"
        constraints = [
            models.UniqueConstraint(
                fields=["child"], name="audio_childaudiosettings_one_per_child"
            ),
            *[
                models.CheckConstraint(
                    condition=models.Q(**{f"{name}__gte": 0.0, f"{name}__lte": 1.0}),
                    name=f"audio_childaudiosettings_{name}_range",
                )
                for name in (
                    "master_volume",
                    "music_volume",
                    "ambient_volume",
                    "sfx_volume",
                    "voice_volume",
                    "ui_volume",
                )
            ],
        ]

    def __str__(self) -> str:
        return f"Audio settings {self.pk}"


class SoundLibraryReport(SoundCue):
    """A proxy with no table of its own, so the readiness report has a place in Django Admin.

    It stores nothing. The admin page (`admin.SoundLibraryReportAdmin`) renders `reporting.py`.
    """

    class Meta:
        proxy = True
        verbose_name = "library report"
        verbose_name_plural = "library report"
