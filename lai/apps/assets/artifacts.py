"""Staff review, hold, preview and capture of derived artifacts (ADR-066, DERIVED_ARTIFACTS.md).

Service functions for Django Admin and for Workstream E's capture view. Every function checks the
Django permission it needs (a second line of defence beside the admin), takes the row locks in the
asset-services order (asset row, then artifact row) and refuses with `ArtifactRefused(code,
message)`, where `message` is safe to show staff. Logs carry ids and codes only.

Permissions on `assets.DerivedArtifact`: `view_derivedartifact`, `review_derivedartifact`,
`promote_derivedartifact` (apps.assets.artifact_promotion) and `capture_derivedartifact`.
"""

import logging
import struct
import uuid
from datetime import timedelta
from typing import IO

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils.timezone import now

from . import artifact_storage as store
from .artifact_storage import ArtifactMismatch, ArtifactObjectMissing, ArtifactStorageUnavailable
from .models import ArtifactProducer, ArtifactState, AssetVersion, DerivedArtifact, VersionStatus

logger = logging.getLogger("lai.assets")

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
#: Content types a browser may show inline; everything else is offered as a download.
INLINE_TYPES = frozenset(
    {"image/png", "image/webp", "image/jpeg", "audio/ogg", "audio/mpeg", "audio/wav"}
)
CAPTURE_EXTENSIONS = {"image/png": "png", "image/webp": "webp"}
CAPTURE_PROCESSOR = ("lai.staff_capture", "1.0.0")
CAPTURE_PROFILE = ("browser-capture", 1)

_LIVE_FOR_REVIEW = (ArtifactState.PENDING_REVIEW, ArtifactState.ACCEPTED, ArtifactState.REJECTED)


class ArtifactRefused(Exception):
    """The action is not allowed. `message` is safe to show staff (no em dashes)."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def require_permission(user, codename: str) -> None:
    if (
        user is None
        or not getattr(user, "is_active", False)
        or not user.has_perm(f"assets.{codename}")
    ):
        raise ArtifactRefused("permission_denied", "You do not have permission to do this.")


def _deadline(days: int):
    return now() + timedelta(days=days)


def _locked(artifact: DerivedArtifact) -> DerivedArtifact:
    """The artifact row locked after its asset row (the lock order of the asset services)."""
    from apps.catalog.models import ContentAsset

    ContentAsset.objects.select_for_update().filter(pk=artifact.asset_id).first()
    return DerivedArtifact.objects.select_for_update().get(pk=artifact.pk)


# --- review ------------------------------------------------------------------------------------


def accept_artifact(artifact: DerivedArtifact, user) -> DerivedArtifact:
    """`pending_review` or `rejected` to `accepted`. An accepted artifact is protected from
    retention until it is superseded or promoted."""
    require_permission(user, "review_derivedartifact")
    with transaction.atomic():
        artifact = _locked(artifact)
        if artifact.state not in (ArtifactState.PENDING_REVIEW, ArtifactState.REJECTED):
            raise ArtifactRefused("wrong_state", f"A {artifact.state} artifact cannot be accepted.")
        artifact.state = ArtifactState.ACCEPTED
        artifact.reviewed_by, artifact.reviewed_at = user, now()
        artifact.expires_at = None
        artifact.save(update_fields=["state", "reviewed_by", "reviewed_at", "expires_at"])
    logger.info("derived artifact accepted id=%s", artifact.pk)
    return artifact


def reject_artifact(artifact: DerivedArtifact, user) -> DerivedArtifact:
    """`pending_review` or `accepted` to `rejected`; retention may remove it after the
    superseded period (30 days by default)."""
    require_permission(user, "review_derivedartifact")
    with transaction.atomic():
        artifact = _locked(artifact)
        if artifact.state not in (ArtifactState.PENDING_REVIEW, ArtifactState.ACCEPTED):
            raise ArtifactRefused("wrong_state", f"A {artifact.state} artifact cannot be rejected.")
        artifact.state = ArtifactState.REJECTED
        artifact.reviewed_by, artifact.reviewed_at = user, now()
        artifact.expires_at = _deadline(settings.LAI_ARTIFACT_RETENTION_SUPERSEDED_DAYS)
        artifact.save(update_fields=["state", "reviewed_by", "reviewed_at", "expires_at"])
    logger.info("derived artifact rejected id=%s", artifact.pk)
    return artifact


def set_hold(artifact: DerivedArtifact, user, *, hold: bool) -> DerivedArtifact:
    """Protect (or release) an artifact from retention."""
    require_permission(user, "review_derivedartifact")
    with transaction.atomic():
        artifact = _locked(artifact)
        if artifact.state in (ArtifactState.EXPIRED, ArtifactState.DELETED):
            raise ArtifactRefused("wrong_state", "This artifact is already being removed.")
        artifact.retention_hold = hold
        artifact.save(update_fields=["retention_hold"])
    logger.info("derived artifact hold=%s id=%s", hold, artifact.pk)
    return artifact


# --- viewing -----------------------------------------------------------------------------------


def open_for_view(artifact: DerivedArtifact, user) -> IO[bytes]:
    """A verified stream of the artifact's bytes for a staff preview or download.

    Needs `view_derivedartifact`. The stored object is re-verified (size and SHA-256) before any
    byte is returned, so a changed object is never shown. Raises `ArtifactRefused`."""
    require_permission(user, "view_derivedartifact")
    if artifact.state in (ArtifactState.EXPIRED, ArtifactState.DELETED):
        raise ArtifactRefused("gone", "This artifact has been removed.")
    try:
        store.verify(
            artifact.storage_key,
            sha256=artifact.sha256,
            size_bytes=artifact.size_bytes,
            max_bytes=artifact.size_bytes,
        )
        return store.open_object(artifact.storage_key)
    except ArtifactObjectMissing:
        raise ArtifactRefused("object_missing", "The stored file is missing.") from None
    except ArtifactMismatch:
        logger.warning("derived artifact checksum mismatch id=%s", artifact.pk)
        raise ArtifactRefused(
            "artifact_changed", "The stored file no longer matches its checksum."
        ) from None
    except ArtifactStorageUnavailable:
        raise ArtifactRefused("storage_failed", "The stored file could not be read.") from None


def is_inline(artifact: DerivedArtifact) -> bool:
    return artifact.content_type in INLINE_TYPES


# --- staff capture -----------------------------------------------------------------------------


def _sniff(data: bytes, content_type: str) -> dict | None:
    """Facts about `data` when its bytes really are `content_type` (PNG or WebP), else None. The
    browser's claim about the type is never trusted."""
    if content_type == "image/png":
        if data[:8] != PNG_SIGNATURE or data[12:16] != b"IHDR" or len(data) < 24:
            return None
        width, height = struct.unpack(">II", data[16:24])
        return {"width": width, "height": height}
    if content_type == "image/webp":
        if len(data) < 16 or data[:4] != b"RIFF" or data[8:12] != b"WEBP":
            return None
        return {}
    return None


def record_staff_capture(
    source_version: AssetVersion,
    user,
    data: bytes,
    content_type: str,
    *,
    role: str = "model.thumbnail",
) -> DerivedArtifact:
    """Store a staff browser capture (a GLB thumbnail) as a `pending_review` artifact.

    Server-side identity and validation (Workstream E builds the page on this):
    `LAI_THUMBNAIL_CAPTURE` is on; the user has `assets.capture_derivedartifact`; `role` is a
    declared staff-capture role and `content_type` one of its types; the size is within its bound;
    the bytes really are that format (signature sniffed); the source is a GLB model version that
    is not rejected, of an active asset. The object is written create-only under
    `processing/artifacts/<env>/capture/<artifact id>.<ext>` and an older pending or accepted
    capture of the same source and role is superseded. A database failure removes the object.
    """
    from apps.catalog.models import AssetStatus
    from apps.jobs.workloads import thumbnail_capture_enabled
    from lai_processing.contracts.job_types import role_spec

    if not thumbnail_capture_enabled():
        raise ArtifactRefused("capture_disabled", "Thumbnail capture is switched off.")
    require_permission(user, "capture_derivedartifact")
    spec = role_spec(role)
    if spec is None or spec.producer != "staff_capture" or content_type not in spec.content_types:
        raise ArtifactRefused("role_not_allowed", "This kind of capture is not accepted.")
    if not isinstance(data, bytes | bytearray) or not 1 <= len(data) <= spec.max_size_bytes:
        raise ArtifactRefused("size", "The capture is empty or too large.")
    data = bytes(data)
    facts = _sniff(data, content_type)
    if facts is None:
        raise ArtifactRefused("bad_image", "The capture is not a valid image of that type.")
    import hashlib

    digest = hashlib.sha256(data).hexdigest()
    artifact_id = uuid.uuid4()
    key = store.capture_key(artifact_id, CAPTURE_EXTENSIONS[content_type])
    stamp = now()
    with transaction.atomic():
        from apps.catalog.models import ContentAsset

        ContentAsset.objects.select_for_update().filter(pk=source_version.asset_id).first()
        version = (
            AssetVersion.objects.select_for_update()
            .select_related("asset")
            .filter(pk=source_version.pk)
            .first()
        )
        if version is None or version.status == VersionStatus.REJECTED:
            raise ArtifactRefused("source_unavailable", "The model version is not available.")
        if version.format != "glb" or version.asset.status != AssetStatus.ACTIVE:
            raise ArtifactRefused("source_unavailable", "Only an active GLB model can be captured.")
        try:
            store.put_create_only(key, data, content_type=content_type, sha256=digest)
        except (ArtifactMismatch, ArtifactStorageUnavailable):
            raise ArtifactRefused("storage_failed", "The capture could not be stored.") from None
        try:
            artifact = DerivedArtifact.objects.create(
                id=artifact_id,
                source_version=version,
                asset=version.asset,
                source_sha256=version.sha256,
                source_storage_key=version.storage_key,
                logical_id="capture",
                role=role,
                producer=ArtifactProducer.STAFF_CAPTURE,
                captured_by=user,
                processor_id=CAPTURE_PROCESSOR[0],
                processor_version=CAPTURE_PROCESSOR[1],
                profile_id=CAPTURE_PROFILE[0],
                profile_version=CAPTURE_PROFILE[1],
                sha256=digest,
                size_bytes=len(data),
                content_type=content_type,
                storage_key=key,
                state=ArtifactState.PENDING_REVIEW,
                created_at=stamp,
                expires_at=stamp + timedelta(days=settings.LAI_ARTIFACT_RETENTION_UNREVIEWED_DAYS),
                metadata=facts,
            )
        except IntegrityError:
            _delete_quietly(key)
            raise ArtifactRefused("storage_failed", "The capture could not be recorded.") from None
        except Exception:
            _delete_quietly(key)
            raise
        older = (
            DerivedArtifact.objects.select_for_update()
            .filter(
                source_version=version,
                role=role,
                producer=ArtifactProducer.STAFF_CAPTURE,
                state__in=[ArtifactState.PENDING_REVIEW, ArtifactState.ACCEPTED],
            )
            .exclude(pk=artifact.pk)
        )
        deadline = stamp + timedelta(days=settings.LAI_ARTIFACT_RETENTION_SUPERSEDED_DAYS)
        for previous in older:
            previous.state = ArtifactState.SUPERSEDED
            previous.superseded_by, previous.superseded_at = artifact, stamp
            previous.expires_at = deadline
            previous.save(update_fields=["state", "superseded_by", "superseded_at", "expires_at"])
    logger.info("derived artifact captured id=%s role=%s", artifact.pk, role)
    return artifact


def _delete_quietly(key: str) -> None:
    try:
        store.delete_object(key)
    except ArtifactStorageUnavailable:
        logger.warning("derived artifact object delete failed; the retention sweep will find it")
