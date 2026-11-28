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

from apps.catalog.models import Authorable

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
    AUTO = "AUTO", "Automatic (jumpable up to 1.2 m tall; taller is Solid)"
    SOLID = (
        "SOLID",
        ("Solid (blocks at every height; a part raised 1.7 m or more leaves a walk-under passage)"),
    )
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
    offset_y = models.FloatField(
        null=True,
        blank=True,
        help_text=(
            "Bottom on model Y, metres. A Solid part whose bottom is 1.7 m or more above the "
            "ground leaves a walk-under passage; lower, it blocks down to the ground. Raising a "
            "part never makes it jumpable."
        ),
    )
    offset_z = models.FloatField(null=True, blank=True, help_text="Centre on model Z, metres.")
    boxes = models.JSONField(
        default=list,
        blank=True,
        help_text=(
            'Compound only: a list of {"x", "z", "y", "width", "height", "depth"} boxes, where x '
            "and z are the centre and y the bottom, in model space (walls of a building). A Solid "
            "box with y of 1.7 m or more (a lintel) leaves a walk-under passage; a lower raised "
            "box blocks down to the ground. Use a Jumpable profile for a surface to stand on."
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


# --- Derived artifacts (ADR-066, docs/processing/DERIVED_ARTIFACTS.md) --------------------------

ARTIFACT_KEY_PREFIX = "processing/artifacts/"


class ArtifactState(models.TextChoices):
    """Review and retention state of one artifact. There is deliberately no published state: an
    artifact reaches the game only as a new AssetVersion (promotion), published separately."""

    PENDING_REVIEW = "pending_review", "Pending review"
    ACCEPTED = "accepted", "Accepted"
    REJECTED = "rejected", "Rejected"
    SUPERSEDED = "superseded", "Superseded"
    PROMOTED = "promoted", "Promoted to a new version"
    EXPIRED = "expired", "Expired (object being removed)"
    DELETED = "deleted", "Deleted (object removed)"


class ArtifactProducer(models.TextChoices):
    JOB = "job", "Background job"
    STAFF_CAPTURE = "staff_capture", "Staff capture"


#: Allowed state changes (anything else raises `ImmutableArtifact` on save).
ARTIFACT_TRANSITIONS = {
    ArtifactState.PENDING_REVIEW: {
        ArtifactState.ACCEPTED,
        ArtifactState.REJECTED,
        ArtifactState.SUPERSEDED,
        ArtifactState.PROMOTED,
        ArtifactState.EXPIRED,
    },
    ArtifactState.ACCEPTED: {
        ArtifactState.REJECTED,
        ArtifactState.SUPERSEDED,
        ArtifactState.PROMOTED,
    },
    ArtifactState.REJECTED: {ArtifactState.ACCEPTED, ArtifactState.EXPIRED},
    ArtifactState.SUPERSEDED: {ArtifactState.EXPIRED},
    ArtifactState.EXPIRED: {ArtifactState.DELETED},
    ArtifactState.PROMOTED: set(),
    ArtifactState.DELETED: set(),
}

#: Fixed from creation: the identity and provenance of the stored object. (`job` and `metadata`
#: are not here: a tombstone clears `job`, and the metadata is write-once by convention.)
ARTIFACT_IMMUTABLE_FIELDS = (
    "id",
    "source_version_id",
    "asset_id",
    "source_sha256",
    "source_storage_key",
    "job_id_text",
    "attempt_id",
    "logical_id",
    "role",
    "producer",
    "processor_id",
    "processor_version",
    "profile_id",
    "profile_version",
    "sha256",
    "size_bytes",
    "content_type",
    "storage_key",
    "created_at",
)


class ImmutableArtifact(ValueError):
    """An artifact's identity was about to change, an illegal state change was attempted, or a live
    artifact was being deleted."""


class DerivedArtifact(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    source_version = models.ForeignKey(
        AssetVersion, on_delete=models.PROTECT, related_name="derived_artifacts", editable=False
    )
    asset = models.ForeignKey(
        "catalog.ContentAsset",
        on_delete=models.PROTECT,
        related_name="derived_artifacts",
        editable=False,
    )
    source_sha256 = models.CharField(max_length=64, editable=False)
    source_storage_key = models.CharField(max_length=300, editable=False)
    #: The producing job. PROTECT while the artifact is live (the job is its evidence); cleared on
    #: a tombstone (`expired`/`deleted`) so job pruning is never blocked. Null for a staff capture.
    job = models.ForeignKey(
        "jobs.ProcessingJob",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="derived_artifacts",
        editable=False,
    )
    #: The lineage as plain UUIDs, kept when the job row is pruned or unlinked.
    job_id_text = models.UUIDField(null=True, blank=True, editable=False)
    attempt_id = models.UUIDField(null=True, blank=True, editable=False)
    logical_id = models.CharField(max_length=64, editable=False)
    role = models.CharField(max_length=48, editable=False)
    producer = models.CharField(
        max_length=14,
        choices=ArtifactProducer.choices,
        default=ArtifactProducer.JOB,
        editable=False,
    )
    captured_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
        editable=False,
    )
    processor_id = models.CharField(max_length=64, blank=True, editable=False)
    processor_version = models.CharField(max_length=32, blank=True, editable=False)
    profile_id = models.CharField(max_length=64, blank=True, editable=False)
    profile_version = models.PositiveIntegerField(default=0, editable=False)
    sha256 = models.CharField(max_length=64, editable=False)
    size_bytes = models.PositiveBigIntegerField(editable=False)
    content_type = models.CharField(max_length=100, editable=False)
    storage_key = models.CharField(max_length=300, unique=True, editable=False)
    state = models.CharField(
        max_length=14,
        choices=ArtifactState.choices,
        default=ArtifactState.PENDING_REVIEW,
        db_index=True,
        editable=False,
    )
    created_at = models.DateTimeField(default=now, editable=False)
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
        editable=False,
    )
    reviewed_at = models.DateTimeField(null=True, blank=True, editable=False)
    superseded_by = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="supersedes",
        editable=False,
    )
    superseded_at = models.DateTimeField(null=True, blank=True, editable=False)
    promoted_version = models.OneToOneField(
        AssetVersion,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="derived_from_artifact",
        editable=False,
    )
    promoted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
        editable=False,
    )
    promoted_at = models.DateTimeField(null=True, blank=True, editable=False)
    #: When retention may expire the artifact; null while it is protected (accepted, promoted).
    expires_at = models.DateTimeField(null=True, blank=True, editable=False)
    retention_hold = models.BooleanField(
        default=False, help_text="A held artifact is never expired or deleted by retention."
    )
    object_deleted_at = models.DateTimeField(null=True, blank=True, editable=False)
    #: Safe facts only: tool versions, dimensions, duration. Never names, paths or free text.
    metadata = models.JSONField(default=dict, blank=True, editable=False)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "derived artifact"
        permissions = [
            ("review_derivedartifact", "Can accept, reject and hold derived artifacts"),
            ("promote_derivedartifact", "Can promote a derived artifact into a new asset version"),
            ("capture_derivedartifact", "Can record a staff browser capture as a derived artifact"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["job_id_text", "attempt_id", "logical_id"],
                name="assets_artifact_job_attempt_logical_unique",
            ),
            models.CheckConstraint(
                condition=models.Q(state__in=ArtifactState.values),
                name="assets_artifact_state_valid",
            ),
            models.CheckConstraint(
                condition=models.Q(producer__in=ArtifactProducer.values),
                name="assets_artifact_producer_valid",
            ),
            models.CheckConstraint(
                condition=models.Q(sha256__regex=r"^[0-9a-f]{64}$")
                & models.Q(source_sha256__regex=r"^[0-9a-f]{64}$"),
                name="assets_artifact_sha256_hex",
            ),
            models.CheckConstraint(
                condition=models.Q(storage_key__startswith=ARTIFACT_KEY_PREFIX),
                name="assets_artifact_key_prefix",
            ),
            # promoted if and only if it links the version it created.
            models.CheckConstraint(
                condition=~models.Q(state=ArtifactState.PROMOTED)
                | models.Q(promoted_version__isnull=False),
                name="assets_artifact_promoted_has_version",
            ),
            models.CheckConstraint(
                condition=models.Q(state=ArtifactState.PROMOTED)
                | models.Q(promoted_version__isnull=True),
                name="assets_artifact_version_only_if_promoted",
            ),
            models.CheckConstraint(
                condition=~models.Q(state=ArtifactState.SUPERSEDED)
                | models.Q(superseded_at__isnull=False),
                name="assets_artifact_superseded_has_time",
            ),
            models.CheckConstraint(
                condition=~models.Q(state__in=[ArtifactState.ACCEPTED, ArtifactState.REJECTED])
                | models.Q(reviewed_at__isnull=False),
                name="assets_artifact_reviewed_has_time",
            ),
            models.CheckConstraint(
                condition=~models.Q(state=ArtifactState.DELETED)
                | models.Q(object_deleted_at__isnull=False),
                name="assets_artifact_deleted_has_time",
            ),
            # Protected states carry no deadline; the others always have one.
            models.CheckConstraint(
                condition=~models.Q(state__in=[ArtifactState.ACCEPTED, ArtifactState.PROMOTED])
                | models.Q(expires_at__isnull=True),
                name="assets_artifact_protected_no_deadline",
            ),
            models.CheckConstraint(
                condition=~models.Q(
                    state__in=[
                        ArtifactState.PENDING_REVIEW,
                        ArtifactState.REJECTED,
                        ArtifactState.SUPERSEDED,
                    ]
                )
                | models.Q(expires_at__isnull=False),
                name="assets_artifact_unprotected_has_deadline",
            ),
            # A job output names its job and attempt; a capture has neither.
            models.CheckConstraint(
                condition=~models.Q(producer=ArtifactProducer.JOB)
                | (models.Q(job_id_text__isnull=False) & models.Q(attempt_id__isnull=False)),
                name="assets_artifact_job_has_lineage",
            ),
            models.CheckConstraint(
                condition=~models.Q(producer=ArtifactProducer.STAFF_CAPTURE)
                | (
                    models.Q(job__isnull=True)
                    & models.Q(job_id_text__isnull=True)
                    & models.Q(attempt_id__isnull=True)
                ),
                name="assets_artifact_capture_has_no_job",
            ),
            # A live job output keeps its job link; only a tombstone may drop it.
            models.CheckConstraint(
                condition=~models.Q(producer=ArtifactProducer.JOB)
                | models.Q(job__isnull=False)
                | models.Q(state__in=[ArtifactState.EXPIRED, ArtifactState.DELETED]),
                name="assets_artifact_live_job_linked",
            ),
        ]
        indexes = [
            models.Index(
                fields=["source_version", "role", "state"], name="assets_artifact_source_role"
            ),
            models.Index(fields=["expires_at"], name="assets_artifact_expires"),
            models.Index(fields=["asset", "state"], name="assets_artifact_asset_state"),
        ]

    @classmethod
    def from_db(cls, db, field_names, values, **kwargs):
        instance = super().from_db(db, field_names, values, **kwargs)
        # A partial load (Django's delete collector defers fields) takes no snapshot: reading a
        # deferred field here would itself reload the row.
        if not instance.get_deferred_fields():
            instance._loaded = instance._snapshot()
        return instance

    def _snapshot(self) -> dict:
        return {name: getattr(self, name) for name in (*ARTIFACT_IMMUTABLE_FIELDS, "state")}

    def save(self, *args, **kwargs):
        loaded = getattr(self, "_loaded", None)
        if loaded is not None:
            changed = [n for n in ARTIFACT_IMMUTABLE_FIELDS if getattr(self, n) != loaded[n]]
            if changed:
                raise ImmutableArtifact(f"An artifact cannot change: {', '.join(changed)}.")
            if (
                self.state != loaded["state"]
                and self.state not in ARTIFACT_TRANSITIONS[loaded["state"]]
            ):
                raise ImmutableArtifact(f"A {loaded['state']} artifact cannot become {self.state}.")
        super().save(*args, **kwargs)
        self._loaded = self._snapshot()

    def delete(self, *args, **kwargs):
        if self.state not in (ArtifactState.EXPIRED, ArtifactState.DELETED):
            raise ImmutableArtifact("A live artifact is never deleted; let retention expire it.")
        return super().delete(*args, **kwargs)

    @property
    def promotable(self) -> bool:
        from lai_processing.contracts.job_types import role_spec

        spec = role_spec(self.role)
        return bool(spec and spec.promotable)

    def __str__(self) -> str:
        return f"{self.role}:{self.logical_id} ({self.state})"


# --- Image profiles and materials (LAI-ENV-02; docs/ENVIRONMENT_ASSETS.md) ---------------------


class ImageRole(models.TextChoices):
    SURFACE = "SURFACE", "Surface texture (tiling colour)"
    MATERIAL_MAP = "MATERIAL_MAP", "Material map (data: normal, roughness, ORM...)"
    SPRITE = "SPRITE", "Sprite (shell, starfish, plant, flower)"
    DECAL = "DECAL", "Decal (footprint, treasure X, rune, marking)"
    PARTICLE = "PARTICLE", "Particle image (fire, smoke, snow, magic)"
    BACKDROP = "BACKDROP", "Backdrop (distant island, mountains, clouds)"
    SKY = "SKY", "Sky (panorama or cube map)"
    PICTURE = "PICTURE", "Picture (flat art)"


class ColourSpace(models.TextChoices):
    SRGB = "SRGB", "sRGB (colour)"
    LINEAR = "LINEAR", "Linear (data, never colour-managed)"


class DataChannel(models.TextChoices):
    NORMAL = "NORMAL", "Normal map"
    ROUGHNESS = "ROUGHNESS", "Roughness"
    METALNESS = "METALNESS", "Metalness"
    OCCLUSION = "OCCLUSION", "Ambient occlusion"
    ORM = "ORM", "Packed ORM (R occlusion, G roughness, B metalness)"
    OPACITY = "OPACITY", "Opacity"
    HEIGHT = "HEIGHT", "Height"


class NormalConvention(models.TextChoices):
    OPENGL = "OPENGL", "OpenGL (+Y up; required)"
    DIRECTX = "DIRECTX", "DirectX (-Y; refused, flip the green channel)"


class AlphaMode(models.TextChoices):
    OPAQUE = "OPAQUE", "Opaque"
    MASK = "MASK", "Cut-out (alpha below the cutoff is invisible)"
    BLEND = "BLEND", "Blended transparency"


class TextureWrap(models.TextChoices):
    REPEAT = "REPEAT", "Repeat"
    MIRROR = "MIRROR", "Mirrored repeat"
    CLAMP = "CLAMP", "Clamp to edge"


class SpritePlacement(models.TextChoices):
    GROUND = "GROUND", "Flat on the ground"
    UPRIGHT = "UPRIGHT", "Upright card, fixed direction"
    BILLBOARD = "BILLBOARD", "Always faces the camera"
    BILLBOARD_Y = "BILLBOARD_Y", "Turns about the vertical to face the camera"


class ParticleBlending(models.TextChoices):
    NORMAL = "NORMAL", "Normal"
    ADDITIVE = "ADDITIVE", "Additive (glows: fire, magic)"


class SkyLayout(models.TextChoices):
    EQUIRECTANGULAR = "EQUIRECTANGULAR", "Equirectangular panorama (2:1)"
    CUBE_STRIP = "CUBE_STRIP", "Cube map strip (6:1; +X, -X, +Y, -Y, +Z, -Z)"
    CUBE_GRID = "CUBE_GRID", "Cube map grid (3:2; +X, -X, +Y on top, -Y, +Z, -Z below)"


def _optional_float(help_text: str):
    return models.FloatField(null=True, blank=True, help_text=help_text)


class ImageProfile(models.Model):
    """How an image asset is drawn wherever a scene uses it (staff-authored, Django Admin).

    One row per asset is its default (`version` empty); a row naming a version overrides it for
    that version only, like `CollisionProfile`. Rules: `apps.assets.image_profiles`. The runtime
    block the resolver sends is contract `env-assets/1`. Never a source of collision.
    """

    asset = models.ForeignKey(
        "catalog.ContentAsset", on_delete=models.CASCADE, related_name="image_profiles"
    )
    version = models.ForeignKey(
        AssetVersion,
        on_delete=models.CASCADE,
        related_name="image_profiles",
        null=True,
        blank=True,
        help_text="Empty: the asset's default for every version. Set: this version only.",
    )
    role = models.CharField(max_length=16, choices=ImageRole.choices)
    colour_space = models.CharField(
        max_length=8,
        choices=ColourSpace.choices,
        default=ColourSpace.SRGB,
        help_text="Material maps are linear; every other role is sRGB.",
    )
    data_channel = models.CharField(
        max_length=12, choices=DataChannel.choices, blank=True, help_text="Material maps only."
    )
    normal_convention = models.CharField(
        max_length=8,
        choices=NormalConvention.choices,
        blank=True,
        help_text="Normal maps only: confirm the map is OpenGL (+Y up, green points up), which "
        "Three.js expects. A DirectX map (green points down) is refused: flip its green channel "
        "and upload it again.",
    )
    alpha_mode = models.CharField(max_length=8, choices=AlphaMode.choices, default=AlphaMode.OPAQUE)
    alpha_cutoff = _optional_float("Cut-out only: 0 to 1 (default 0.5).")
    seamless = models.BooleanField(
        default=False, help_text="Surfaces and maps: the image tiles without visible seams."
    )
    wrap = models.CharField(
        max_length=8, choices=TextureWrap.choices, default=TextureWrap.REPEAT, blank=True
    )
    metres_per_repeat = _optional_float(
        "Surfaces and maps: the size of one tile in the world, metres. Empty: use the repeats."
    )
    repeat_u = _optional_float("Default repeats across (empty: 1).")
    repeat_v = _optional_float("Default repeats down (empty: 1).")
    rotation_degrees = models.PositiveSmallIntegerField(
        null=True, blank=True, help_text="Texture orientation, 0 to 359 degrees."
    )
    world_width_m = _optional_float("Default width in the world, metres.")
    world_height_m = _optional_float(
        "Default height in the world, metres. Empty: from the width and the image proportions."
    )
    anchor_x = _optional_float("Pivot across the image, 0 (left) to 1 (right). Default 0.5.")
    anchor_y = _optional_float(
        "Pivot down the image, 0 (top) to 1 (bottom); image space has its origin at the top left "
        "(env-assets/1 E-1). Default 1, so the default anchor [0.5, 1.0] is bottom centre."
    )
    placement = models.CharField(max_length=12, choices=SpritePlacement.choices, blank=True)
    decal_depth_m = _optional_float("Decals: how deep the projection reaches, metres (0.25).")
    opacity = _optional_float("Decals, particles, backdrops: 0 to 1 (default 1).")
    blending = models.CharField(max_length=8, choices=ParticleBlending.choices, blank=True)
    sheet_columns = models.PositiveSmallIntegerField(
        null=True, blank=True, help_text="Sprite sheet: frames across (empty or 1: no sheet)."
    )
    sheet_rows = models.PositiveSmallIntegerField(
        null=True, blank=True, help_text="Sprite sheet: frames down."
    )
    frame_count = models.PositiveSmallIntegerField(
        null=True, blank=True, help_text="Frames used, left to right then top to bottom."
    )
    frames_per_second = _optional_float("Animation speed (sheets), above 0 and at most 60.")
    loop = models.BooleanField(default=True, help_text="Sheets: play the frames in a loop.")
    sky_layout = models.CharField(max_length=16, choices=SkyLayout.choices, blank=True)
    recommended_usage = models.CharField(
        max_length=300, blank=True, help_text="Staff guidance, never shown to children."
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
                name="assets_imageprofile_one_default_per_asset",
            ),
            models.UniqueConstraint(
                fields=["version"],
                condition=models.Q(version__isnull=False),
                name="assets_imageprofile_one_per_version",
            ),
            models.CheckConstraint(
                condition=models.Q(role__in=ImageRole.values), name="assets_imageprofile_role"
            ),
            models.CheckConstraint(
                condition=~models.Q(role=ImageRole.MATERIAL_MAP)
                | models.Q(colour_space=ColourSpace.LINEAR),
                name="assets_imageprofile_maps_are_linear",
            ),
            *[
                models.CheckConstraint(
                    condition=models.Q(**{f"{name}__isnull": True})
                    | models.Q(**{f"{name}__gt": 0}),
                    name=f"assets_imageprofile_{name}_positive",
                )
                for name in (
                    "metres_per_repeat",
                    "world_width_m",
                    "world_height_m",
                    "decal_depth_m",
                )
            ],
        ]

    def clean(self):
        from . import image_profiles

        super().clean()
        image_profiles.clean_profile(self)

    def __str__(self) -> str:
        scope = f"v{self.version.number}" if self.version_id else "default"
        return f"{self.asset.asset_id} image profile ({scope})"


class MaterialDefinition(Authorable):
    """A reusable material: maps over published textures plus factors (ADR-047 authorable).

    Identity, name, status and retirement are the `ContentAsset` (kind `material`). The content
    is versioned as `ContentRevision`s of kind `material`; publishing copies the body into
    `definition` and the named textures into `texture_asset_ids` (`apps.assets.materials`).
    Never deleted; retire the asset instead.
    """

    asset = models.OneToOneField(
        "catalog.ContentAsset",
        on_delete=models.PROTECT,
        related_name="material_definition",
        limit_choices_to={"kind": "material"},
    )
    definition = models.JSONField(default=dict, blank=True, editable=False)
    texture_asset_ids = ArrayField(
        models.SlugField(max_length=100), default=list, blank=True, editable=False
    )
    created_at = models.DateTimeField(default=now, editable=False)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["asset__asset_id"]
        verbose_name = "material definition"

    @property
    def material_id(self) -> str:
        return self.asset.asset_id

    def clean(self):
        super().clean()
        if self.asset_id and self.asset.kind != "material":
            from django.core.exceptions import ValidationError

            raise ValidationError({"asset": "Choose a content asset of kind material."})

    def delete(self, *args, **kwargs):
        raise ImmutableVersion("Material definitions are kept; retire the material asset.")

    def __str__(self) -> str:
        return f"{self.asset.asset_id} material"
