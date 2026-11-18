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
