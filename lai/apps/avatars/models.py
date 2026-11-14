"""Player avatar identities (LAI-JMP-01c, ADR-057; `docs/PLAYER_AVATAR_ASSETS.md`).

One row per avatar a parent can choose (`ChildProfile.avatar_key`). It points at a character
model in the existing asset library (`catalog.ContentAsset`, versions in `assets.AssetVersion`)
and says how to show it: scale, facing, which clip plays which state, which materials take the
child's colours, and where future cosmetics attach. It stores no file and no child data.

What children are served is decided by `apps.avatars.services.child_avatar`: only an AVAILABLE
row whose model resolves to a PUBLISHED version. Anything else is the placeholder.
"""

import math

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from .vocabulary import AVATAR_KEYS, AvatarStatus

MIN_SCALE = 0.2
MAX_SCALE = 5.0


class PlayerAvatar(models.Model):
    avatar_key = models.CharField(
        max_length=16,
        unique=True,
        choices=[(key, key.title()) for key in AVATAR_KEYS],
        help_text="The identity a parent chooses for a child. Fixed; one row each.",
    )
    display_name = models.CharField(max_length=60)
    status = models.CharField(
        max_length=10,
        choices=AvatarStatus.choices,
        default=AvatarStatus.DRAFT,
        help_text="Only Available rows are served; everything else draws the placeholder.",
    )
    model_asset = models.ForeignKey(
        "catalog.ContentAsset",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="player_avatar_models",
        help_text="A character asset (GLB or glTF) from the asset library.",
    )
    pinned_version = models.ForeignKey(
        "assets.AssetVersion",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="+",
        help_text="Optional. Empty: the asset's current published default version.",
    )
    thumbnail_asset = models.ForeignKey(
        "catalog.ContentAsset",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="player_avatar_thumbnails",
        help_text="Optional. An image asset showing the character.",
    )
    scale = models.FloatField(
        default=1.0,
        validators=[MinValueValidator(MIN_SCALE), MaxValueValidator(MAX_SCALE)],
        help_text="Uniform scale. Aim for a 1.2 to 1.5 m tall character.",
    )
    rotation_offset_y = models.FloatField(
        default=0.0,
        validators=[MinValueValidator(-2 * math.pi), MaxValueValidator(2 * math.pi)],
        help_text="Radians added to facing, for a model not authored facing +Z.",
    )
    animation_map = models.JSONField(
        default=dict,
        blank=True,
        help_text='Player state to clip name, e.g. {"idle": "Idle", "walk": "Walk", '
        '"jump": "Jump"}. States left out use the standard clip names.',
    )
    customization = models.JSONField(
        default=dict,
        blank=True,
        help_text='{"colorMaterials": {"Body": "body", "Trim": "accent"}, '
        '"attachPoints": {"head": "Head", "back": "Spine2"}}',
    )
    notes = models.CharField(max_length=500, blank=True, help_text="Staff-only notes.")
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
        editable=False,
    )

    class Meta:
        ordering = ["avatar_key"]
        permissions = [("publish_playeravatar", "Can make a player avatar available or disable it")]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(avatar_key__in=AVATAR_KEYS), name="avatars_key_valid"
            ),
            models.CheckConstraint(
                condition=models.Q(status__in=AvatarStatus.values), name="avatars_status_valid"
            ),
            models.CheckConstraint(
                condition=models.Q(scale__gte=MIN_SCALE) & models.Q(scale__lte=MAX_SCALE),
                name="avatars_scale_range",
            ),
            models.CheckConstraint(
                condition=~models.Q(status=AvatarStatus.AVAILABLE)
                | models.Q(model_asset__isnull=False),
                name="avatars_available_has_model",
            ),
        ]

    def clean(self):
        from .validation import problems

        found = problems(self, for_availability=self.status == AvatarStatus.AVAILABLE)
        if found:
            raise ValidationError(found)

    def __str__(self) -> str:
        return f"{self.display_name} ({self.avatar_key})"
