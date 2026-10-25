"""Immutable asset versions (LAI-2200, ADR-035; `docs/ASSET_MANAGER.md`).

The definition is `catalog.ContentAsset`; this module adds the binaries. A version is a stored
file plus what validation found in it. Once published its bytes and metadata never change: a
replacement model is a new version with a new object key, so every URL and cache entry for a
version stays valid for as long as the version is served.

Lifecycle: DRAFT -> VALIDATED | REJECTED, VALIDATED -> PUBLISHED | REJECTED,
PUBLISHED -> RETIRED.
Only `apps.assets.services` moves a version between states.
"""

import uuid

from django.conf import settings
from django.contrib.postgres.fields import ArrayField
from django.db import models
from django.utils.timezone import now


class VersionStatus(models.TextChoices):
    DRAFT = "DRAFT", "Draft (uploaded, not validated)"
    VALIDATED = "VALIDATED", "Validated (ready to publish)"
    REJECTED = "REJECTED", "Rejected (failed validation)"
    PUBLISHED = "PUBLISHED", "Published"
    RETIRED = "RETIRED", "Retired"


class ModelFormat(models.TextChoices):
    GLB = "glb", "glTF binary (.glb)"
    GLTF = "gltf", "glTF JSON, self-contained (.gltf)"


CONTENT_TYPES = {ModelFormat.GLB: "model/gltf-binary", ModelFormat.GLTF: "model/gltf+json"}

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
    VersionStatus.RETIRED: set(),
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
    format = models.CharField(max_length=4, choices=ModelFormat.choices, editable=False)
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
                condition=models.Q(format__in=ModelFormat.values),
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
            if self.status != loaded["status"] and self.status not in ALLOWED_TRANSITIONS[
                loaded["status"]
            ]:
                raise ImmutableVersion(
                    f"A {loaded['status']} version cannot become {self.status}."
                )
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
    def label(self) -> str:
        return f"{self.asset.asset_id}@{self.number}"

    def __str__(self) -> str:
        return f"{self.asset_id}:v{self.number}"
