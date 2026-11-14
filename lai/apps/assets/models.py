"""Immutable asset versions (LAI-2200, ADR-035; `docs/ASSET_LIBRARY.md`).

The definition is `catalog.ContentAsset`; this module adds the binaries. A version is a stored
file plus what validation found in it. Once published its bytes and metadata never change: a
replacement model is a new version with a new object key, so every URL and cache entry for a
version stays valid for as long as the version is served.

Lifecycle: DRAFT -> VALIDATED | REJECTED, VALIDATED -> PUBLISHED | REJECTED,
PUBLISHED -> RETIRED, RETIRED -> PUBLISHED (a rollback re-verifies the stored bytes first).
Only `apps.assets.services` moves a version between states.
"""

import uuid

from django.conf import settings
from django.contrib.postgres.fields import ArrayField
from django.db import models
from django.utils.timezone import now

from . import formats


class VersionStatus(models.TextChoices):
    DRAFT = "DRAFT", "Draft (uploaded, not validated)"
    VALIDATED = "VALIDATED", "Validated (ready to publish)"
    REJECTED = "REJECTED", "Rejected (failed validation)"
    PUBLISHED = "PUBLISHED", "Published"
    RETIRED = "RETIRED", "Retired"


class FileFormat(models.TextChoices):
    """Every accepted format (AM-13): models, images and audio. See `formats.py`."""

    GLB = "glb", formats.FORMATS["glb"].label
    GLTF = "gltf", formats.FORMATS["gltf"].label
    PNG = "png", formats.FORMATS["png"].label
    JPEG = "jpeg", formats.FORMATS["jpeg"].label
    WEBP = "webp", formats.FORMATS["webp"].label
    MP3 = "mp3", formats.FORMATS["mp3"].label
    WAV = "wav", formats.FORMATS["wav"].label
    OGG = "ogg", formats.FORMATS["ogg"].label


# Kept so existing imports of the model-only name keep working.
ModelFormat = FileFormat

CONTENT_TYPES = {name: info.content_type for name, info in formats.FORMATS.items()}

# Fields fixed from the moment a version is first published.
IMMUTABLE_FIELDS = (
    "asset_id",
    "number",
    "version_id",
    "storage_key",
    "original_filename",
    "content_type",
    "size_bytes",
    "sha256",
    "format",
    "clips",
    "dimensions",
    "metadata",
    "validation_report",
    "validated_at",
    "published_at",
    "uploaded_by_id",
    "published_by_id",
    "created_at",
)

ALLOWED_TRANSITIONS = {
    VersionStatus.DRAFT: {VersionStatus.VALIDATED, VersionStatus.REJECTED},
    # REJECTED: re-validation at publish time failed (checksum or definition changed).
    VersionStatus.VALIDATED: {VersionStatus.PUBLISHED, VersionStatus.REJECTED},
    VersionStatus.REJECTED: set(),
    VersionStatus.PUBLISHED: {VersionStatus.RETIRED},
    # A rollback to a retired version republishes it after the bytes are re-verified.
    VersionStatus.RETIRED: {VersionStatus.PUBLISHED},
}


class ImmutableVersion(ValueError):
    """A published version's bytes or metadata were about to change, or it was being deleted."""


class AssetVersion(models.Model):
    version_id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    asset = models.ForeignKey(
        "catalog.ContentAsset", on_delete=models.PROTECT, related_name="versions"
    )
    number = models.PositiveIntegerField(editable=False)
    status = models.CharField(
        max_length=10, choices=VersionStatus.choices, default=VersionStatus.DRAFT, editable=False
    )
    storage_key = models.CharField(max_length=300, unique=True, editable=False)
    original_filename = models.CharField(max_length=255, editable=False)
    content_type = models.CharField(max_length=64, editable=False)
    size_bytes = models.PositiveBigIntegerField(editable=False)
    sha256 = models.CharField(max_length=64, editable=False)
    format = models.CharField(max_length=4, choices=FileFormat.choices, editable=False)
    clips = ArrayField(models.CharField(max_length=64), default=list, blank=True, editable=False)
    dimensions = models.JSONField(
        null=True, blank=True, editable=False, help_text="Bounding box size in metres: x, y, z."
    )
    metadata = models.JSONField(default=dict, blank=True, editable=False)
    validation_report = models.JSONField(default=list, blank=True, editable=False)
    notes = models.CharField(max_length=500, blank=True, help_text="Admin-only notes.")
    created_at = models.DateTimeField(default=now, editable=False)
    validated_at = models.DateTimeField(null=True, blank=True, editable=False)
    published_at = models.DateTimeField(null=True, blank=True, editable=False)
    retired_at = models.DateTimeField(null=True, blank=True, editable=False)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="+",
        null=True,
        blank=True,
        editable=False,
    )
    published_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="+",
        null=True,
        blank=True,
        editable=False,
    )

    class Meta:
        ordering = ["asset__asset_id", "-number"]
        permissions = [
            ("publish_assetversion", "Can publish asset versions and choose the default"),
            ("retire_assetversion", "Can retire asset versions and assets"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["asset", "number"], name="assets_version_number_unique"
            ),
            models.CheckConstraint(
                condition=models.Q(number__gte=1), name="assets_version_number_positive"
            ),
            models.CheckConstraint(
                condition=models.Q(sha256__regex=r"^[0-9a-f]{64}$"),
                name="assets_version_sha256_hex",
            ),
            models.CheckConstraint(
                condition=models.Q(status__in=VersionStatus.values),
                name="assets_version_status_valid",
            ),
            models.CheckConstraint(
                condition=models.Q(format__in=FileFormat.values),
                name="assets_version_format_valid",
            ),
            models.CheckConstraint(
                condition=models.Q(size_bytes__gte=1), name="assets_version_size_positive"
            ),
            # Published or retired: it passed validation and has a publication time.
            models.CheckConstraint(
                condition=~models.Q(status__in=[VersionStatus.PUBLISHED, VersionStatus.RETIRED])
                | (models.Q(published_at__isnull=False) & models.Q(validated_at__isnull=False)),
                name="assets_version_published_was_validated",
            ),
            models.CheckConstraint(
                condition=~models.Q(status=VersionStatus.VALIDATED)
                | (models.Q(validated_at__isnull=False) & models.Q(published_at__isnull=True)),
                name="assets_version_validated_unpublished",
            ),
            models.CheckConstraint(
                condition=~models.Q(status=VersionStatus.RETIRED)
                | models.Q(retired_at__isnull=False),
                name="assets_version_retired_has_time",
            ),
            models.CheckConstraint(
                condition=models.Q(status__in=[VersionStatus.PUBLISHED, VersionStatus.RETIRED])
                | models.Q(published_at__isnull=True),
                name="assets_version_unpublished_has_no_publication_time",
            ),
        ]
        indexes = [models.Index(fields=["asset", "status"], name="assets_version_asset_status")]

    @classmethod
    def from_db(cls, db, field_names, values, **kwargs):
        instance = super().from_db(db, field_names, values, **kwargs)
        instance._loaded = instance._snapshot()
        return instance

    @property
    def was_published(self) -> bool:
        loaded = getattr(self, "_loaded", None)
        status = loaded["status"] if loaded else self.status
        return status in (VersionStatus.PUBLISHED, VersionStatus.RETIRED)

    @property
    def is_published(self) -> bool:
        return self.status == VersionStatus.PUBLISHED

    def save(self, *args, **kwargs):
        loaded = getattr(self, "_loaded", None)
        if loaded is not None:
            if (
                self.status != loaded["status"]
                and self.status not in ALLOWED_TRANSITIONS[loaded["status"]]
            ):
                raise ImmutableVersion(f"A {loaded['status']} version cannot become {self.status}.")
            if loaded["status"] in (VersionStatus.PUBLISHED, VersionStatus.RETIRED):
                changed = [n for n in IMMUTABLE_FIELDS if getattr(self, n) != loaded[n]]
                if changed:
                    raise ImmutableVersion(
                        f"A published version cannot change: {', '.join(changed)}."
                    )
        super().save(*args, **kwargs)
        self._loaded = self._snapshot()

    def _snapshot(self) -> dict:
        return {name: getattr(self, name) for name in (*IMMUTABLE_FIELDS, "status")}

    def delete(self, *args, **kwargs):
        if self.was_published:
            raise ImmutableVersion("A published version is never deleted; retire it instead.")
        return super().delete(*args, **kwargs)

    @property
    def family(self) -> str:
        return formats.family_of(self.format)

    @property
    def file_name(self) -> str:
        return formats.file_name(self.format)

    @property
    def label(self) -> str:
        return f"{self.asset.asset_id}@{self.number}"

    def __str__(self) -> str:
        return f"{self.asset_id}:v{self.number}"


# --- collision profiles (Asset Manager, 2026-11-14; `docs/ASSET_COLLISION_PROFILES.md`) ---------


class CollisionShape(models.TextChoices):
    NONE = "NONE", "None (never blocks)"
    BOX = "BOX", "Box"
    CYLINDER = "CYLINDER", "Cylinder"
    CAPSULE = "CAPSULE", "Capsule"
    COMPOUND = "COMPOUND", "Compound boxes"


class CollisionBehavior(models.TextChoices):
    AUTO = "AUTO", "Automatic (jumpable up to 1.2 m tall, solid above)"
    SOLID = "SOLID", "Solid (blocks at every height)"
    JUMPABLE = "JUMPABLE", "Jumpable (hop onto or over it)"
    WALKABLE = "WALKABLE", "Walkable (walk over it; kept clear of other colliders)"
    DECORATIVE = "DECORATIVE", "Decorative (visual only, never blocks)"


class CollisionAxis(models.TextChoices):
    Y = "Y", "Upright (model Y)"
    X = "X", "Lying along model X"
    Z = "Z", "Lying along model Z"


class CollisionProfile(models.Model):
    """How a 3D asset blocks movement wherever it is placed (staff-authored, Django Admin).

    One row per asset is its default (`version` empty); a row naming a version overrides it for
    that version only. Every size is in model space, metres, before a placement's position,
    rotation and scale. Empty sizes and offsets come from the version's measured bounds
    (`AssetVersion.metadata["bounds"]`, else `dimensions`), so `BOX` with nothing filled in is
    the automatic bounding box. The runtime only has axis-aligned boxes; `collision.py` turns
    every shape into model-space boxes and the client turns those into world boxes.
    """

    asset = models.ForeignKey(
        "catalog.ContentAsset", on_delete=models.CASCADE, related_name="collision_profiles"
    )
    version = models.ForeignKey(
        AssetVersion,
        on_delete=models.CASCADE,
        related_name="collision_profiles",
        null=True,
        blank=True,
        help_text="Empty: the asset's default for every version. Set: this version only.",
    )
    shape = models.CharField(
        max_length=8, choices=CollisionShape.choices, default=CollisionShape.BOX
    )
    behavior = models.CharField(
        max_length=10, choices=CollisionBehavior.choices, default=CollisionBehavior.AUTO
    )
    axis = models.CharField(
        max_length=1,
        choices=CollisionAxis.choices,
        default=CollisionAxis.Y,
        help_text="Cylinder and capsule only: upright, or lying along a model axis (a log).",
    )
    width = models.FloatField(null=True, blank=True, help_text="Size along model X, metres.")
    height = models.FloatField(null=True, blank=True, help_text="Size along model Y, metres.")
    depth = models.FloatField(null=True, blank=True, help_text="Size along model Z, metres.")
    radius = models.FloatField(
        null=True, blank=True, help_text="Cylinder and capsule radius, metres (a tree's trunk)."
    )
    offset_x = models.FloatField(null=True, blank=True, help_text="Centre on model X, metres.")
    offset_y = models.FloatField(null=True, blank=True, help_text="Bottom on model Y, metres.")
    offset_z = models.FloatField(null=True, blank=True, help_text="Centre on model Z, metres.")
    boxes = models.JSONField(
        default=list,
        blank=True,
        help_text=(
            'Compound only: a list of {"x", "z", "y", "width", "height", "depth"} boxes, where x and'
            " z are the centre and y the bottom, in model space (walls of a building)."
        ),
    )
    notes = models.CharField(max_length=500, blank=True)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="+",
        null=True,
        blank=True,
        editable=False,
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["asset__asset_id", "version__number"]
        constraints = [
            models.UniqueConstraint(
                fields=["asset"],
                condition=models.Q(version__isnull=True),
                name="assets_collisionprofile_one_default_per_asset",
            ),
            models.UniqueConstraint(
                fields=["version"],
                condition=models.Q(version__isnull=False),
                name="assets_collisionprofile_one_per_version",
            ),
            *[
                models.CheckConstraint(
                    condition=models.Q(**{f"{name}__isnull": True})
                    | models.Q(**{f"{name}__gt": 0}),
                    name=f"assets_collisionprofile_{name}_positive",
                )
                for name in ("width", "height", "depth", "radius")
            ],
        ]

    def __str__(self) -> str:
        scope = f"v{self.version.number}" if self.version_id else "default"
        return f"{self.asset.asset_id} collision ({scope})"
