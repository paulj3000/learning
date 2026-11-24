"""Promote a derived artifact into a new unpublished asset version (ADR-066, section 11).

`promote_artifact(artifact, user) -> AssetVersion` is the only way an artifact reaches the Asset
Library. It never publishes: the new version is `VALIDATED` (or `DRAFT` while asynchronous
validation runs) and still needs the existing explicit publication, with its existing
latest-validation gate. This module never calls the gate or `publish_version`.

Lock order is the asset services' (asset row, then version rows) with the artifact row after the
asset row, so promotion cannot deadlock with result recording (job, asset, version, artifact).
Concurrent promotions of one artifact serialize on its row: the second sees `promoted` and is
refused. Everything happens in one transaction; a refusal leaves no version, no object and no
state change. Raises `apps.assets.services.AssetActionRefused` (safe message) or `ArtifactRefused`.
"""

import io
import logging

from django.db import transaction
from django.utils.timezone import now

from apps.catalog.models import AssetStatus, ContentAsset

from . import artifact_storage as store
from . import formats, services
from .artifact_storage import ArtifactMismatch, ArtifactObjectMissing, ArtifactStorageUnavailable
from .artifacts import ArtifactRefused, require_permission
from .models import ArtifactState, AssetVersion, DerivedArtifact, VersionStatus
from .services import AssetActionRefused
from .storage import get_storage

logger = logging.getLogger("lai.assets")

#: Keys of the source version's metadata copied onto the promoted version (licence and source
#: provenance); nothing else is copied.
PROVENANCE_KEYS = ("licence", "license", "source", "credit", "attribution", "origin")
_PROMOTABLE_STATES = (ArtifactState.PENDING_REVIEW, ArtifactState.ACCEPTED)
_FORMAT_BY_CONTENT_TYPE = {info.content_type: name for name, info in formats.FORMATS.items()}


def derived_from(artifact: DerivedArtifact, source: AssetVersion) -> dict:
    """The `metadata["derivedFrom"]` provenance of a promoted version."""
    return {
        "sourceVersion": str(source.version_id),
        "sourceVersionNumber": source.number,
        "sourceSha256": artifact.source_sha256,
        "artifactId": str(artifact.pk),
        "role": artifact.role,
        "logicalId": artifact.logical_id,
        "processor": {"id": artifact.processor_id, "version": artifact.processor_version},
        "profile": {"id": artifact.profile_id, "version": artifact.profile_version},
        "jobId": str(artifact.job_id_text) if artifact.job_id_text else None,
    }


def promote_artifact(artifact: DerivedArtifact, user) -> AssetVersion:
    """Promote `artifact` into a new unpublished version of its asset. See the module docstring."""
    require_permission(user, "promote_derivedartifact")
    asset_pk = DerivedArtifact.objects.filter(pk=artifact.pk).values_list("asset_id", flat=True)
    asset_pk = asset_pk.first()
    if asset_pk is None:
        raise ArtifactRefused("gone", "This artifact no longer exists.")
    with transaction.atomic():
        asset = ContentAsset.objects.select_for_update().get(pk=asset_pk)
        artifact = (
            DerivedArtifact.objects.select_for_update()
            .select_related("source_version")
            .get(pk=artifact.pk)
        )
        _refuse_unless_promotable(artifact, asset)
        from .optimize import promotion_refusal  # ADR-070: compressed models need their control

        refusal = promotion_refusal(artifact)
        if refusal is not None:
            raise refusal
        data = _verified_bytes(artifact)
        source = artifact.source_version
        version = services.upload_version(
            asset,
            io.BytesIO(data),
            original_filename=f"{artifact.role}-{artifact.logical_id}.{_extension(artifact)}"[:255],
            user=user,
        )
        stored_key = version.storage_key
        try:
            version = AssetVersion.objects.select_for_update().get(pk=version.pk)
            copied = {
                k: source.metadata[k] for k in PROVENANCE_KEYS if k in (source.metadata or {})
            }
            version.metadata = {
                **(version.metadata or {}),
                **copied,
                "derivedFrom": derived_from(artifact, source),
            }
            version.save(update_fields=["metadata"])
            artifact.state = ArtifactState.PROMOTED
            artifact.promoted_version = version
            artifact.promoted_by, artifact.promoted_at = user, now()
            artifact.expires_at = None
            artifact.save(
                update_fields=[
                    "state",
                    "promoted_version",
                    "promoted_by",
                    "promoted_at",
                    "expires_at",
                ]
            )
        except BaseException:
            # `upload_version` already stored the object; the transaction will roll the version
            # row back, so the object would be an orphan. Remove it now (best effort: the storage
            # audit finds it otherwise).
            services._delete_quietly(get_storage(), stored_key)
            raise
    logger.info(
        "derived artifact promoted id=%s asset=%s version=%s",
        artifact.pk,
        asset.asset_id,
        version.number,
    )
    return version


def _extension(artifact: DerivedArtifact) -> str:
    return _FORMAT_BY_CONTENT_TYPE.get(artifact.content_type, "bin")


def _refuse_unless_promotable(artifact: DerivedArtifact, asset: ContentAsset) -> None:
    if artifact.state == ArtifactState.PROMOTED:
        raise AssetActionRefused("already_promoted", "This artifact was already promoted.")
    if artifact.state not in _PROMOTABLE_STATES:
        raise AssetActionRefused(
            "not_promotable_state", f"A {artifact.state} artifact cannot be promoted."
        )
    if not artifact.promotable:
        raise AssetActionRefused("not_promotable", "This kind of artifact cannot be promoted.")
    source = artifact.source_version
    if source.status == VersionStatus.REJECTED:
        raise AssetActionRefused("source_unavailable", "The source version was rejected.")
    if source.sha256 != artifact.source_sha256 or source.storage_key != artifact.source_storage_key:
        raise AssetActionRefused(
            "source_changed", "The source version is no longer the file this was made from."
        )
    if asset.status != AssetStatus.ACTIVE:
        raise AssetActionRefused("asset_retired", "This asset is retired.")
    if artifact.content_type not in _FORMAT_BY_CONTENT_TYPE:
        raise AssetActionRefused(
            "format_not_supported", "The Asset Library cannot hold this kind of file yet."
        )


def _verified_bytes(artifact: DerivedArtifact) -> bytes:
    """The artifact's bytes after re-verifying size and SHA-256 against the row."""
    import hashlib

    try:
        store.verify(
            artifact.storage_key,
            sha256=artifact.sha256,
            size_bytes=artifact.size_bytes,
            max_bytes=artifact.size_bytes,
        )
        with store.open_object(artifact.storage_key) as stream:
            data = stream.read(artifact.size_bytes + 1)
    except ArtifactObjectMissing:
        raise AssetActionRefused("object_missing", "The stored file is missing.") from None
    except ArtifactMismatch:
        raise AssetActionRefused(
            "artifact_changed", "The stored file no longer matches its checksum."
        ) from None
    except ArtifactStorageUnavailable:
        raise AssetActionRefused("storage_failed", "The stored file could not be read.") from None
    if len(data) != artifact.size_bytes or hashlib.sha256(data).hexdigest() != artifact.sha256:
        raise AssetActionRefused(
            "artifact_changed", "The stored file no longer matches its checksum."
        )
    return data
