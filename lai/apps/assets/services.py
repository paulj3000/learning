"""The asset version lifecycle (LAI-2200 AM-4; `docs/ASSET_MANAGER.md` sections 3 and 9).

Every state change goes through here, inside a transaction, with the asset row locked so two
administrators cannot allocate the same version number or race a publication. Permission checks
belong to the caller (the admin); these functions enforce the lifecycle and storage rules.

Logs carry asset ids, version numbers and outcome codes only (ADR-025).
"""

import logging
import uuid
from datetime import timedelta
from typing import IO

from django.db import transaction
from django.db.models import Max
from django.utils import timezone

from apps.catalog.models import AssetStatus, ContentAsset

from .models import CONTENT_TYPES, AssetVersion, VersionStatus
from .storage import KEY_PREFIX, StorageError, get_storage, object_key, sha256_of
from .validation import Finding, ValidationResult, validate_model

logger = logging.getLogger("lai.assets")


class AssetActionRefused(Exception):
    """The action is not allowed in the current state. `message` is safe to show an admin."""

    def __init__(self, code: str, message: str, findings: list[Finding] | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.findings = findings or []


def _locked(asset: ContentAsset) -> ContentAsset:
    return ContentAsset.objects.select_for_update().get(pk=asset.pk)


def upload_version(asset: ContentAsset, upload: IO[bytes], *, original_filename: str, user=None):
    """Checksum, validate and store a new version. Returns it `VALIDATED`, or raises.

    A file that fails validation is never stored and makes no row: the admin sees the findings
    and nothing needs cleaning up. A storage or database failure leaves no row and no object.
    """
    sha256, size = sha256_of(upload)
    result = validate_model(upload, size=size, definition=asset)
    if not result.passed:
        logger.info("asset upload rejected: %s %s", asset.asset_id, _codes(result))
        raise AssetActionRefused(
            "invalid_model", "The model did not pass validation.", result.findings
        )

    storage = get_storage()
    with transaction.atomic():
        asset = _locked(asset)
        if asset.status != AssetStatus.ACTIVE:
            raise AssetActionRefused("asset_retired", "This asset is retired.")
        duplicate = (
            asset.versions.filter(sha256=sha256)
            .exclude(status=VersionStatus.REJECTED)
            .values_list("number", flat=True)
            .first()
        )
        if duplicate is not None:
            raise AssetActionRefused(
                "duplicate_version",
                f"This exact file is already version {duplicate} of this asset.",
            )
        number = (asset.versions.aggregate(top=Max("number"))["top"] or 0) + 1
        version_id = uuid.uuid4()
        key = object_key(asset.asset_id, version_id, result.format)
        content_type = CONTENT_TYPES[result.format]
        try:
            storage.put(key, upload, content_type=content_type, sha256=sha256)
        except StorageError:
            logger.warning("asset upload storage failure: %s v%s", asset.asset_id, number)
            raise AssetActionRefused(
                "storage_failed", "The file could not be stored. Try again."
            ) from None
        try:
            version = AssetVersion.objects.create(
                version_id=version_id,
                asset=asset,
                number=number,
                status=VersionStatus.VALIDATED,
                storage_key=key,
                original_filename=(original_filename or "")[:255],
                content_type=content_type,
                size_bytes=size,
                sha256=sha256,
                format=result.format,
                clips=result.clips,
                dimensions=result.dimensions,
                metadata=result.metadata,
                validation_report=result.report(),
                validated_at=timezone.now(),
                uploaded_by=user,
            )
        except Exception:
            _delete_quietly(storage, key)  # the row failed: do not leave an orphan behind
            raise
    logger.info("asset version uploaded: %s v%s", asset.asset_id, number)
    return version


def publish_version(version: AssetVersion, *, user=None) -> AssetVersion:
    """`VALIDATED` to `PUBLISHED`, after re-reading the stored bytes.

    The stored object must still match the recorded checksum and size, and must still pass
    validation against the definition as it is now (its declared clips may have grown). A
    failure marks the version `REJECTED`. The first published version becomes the default.
    """
    with transaction.atomic():
        asset = _locked(version.asset)
        version = AssetVersion.objects.select_for_update().get(pk=version.pk)
        if asset.status != AssetStatus.ACTIVE:
            raise AssetActionRefused("asset_retired", "This asset is retired.")
        if version.status != VersionStatus.VALIDATED:
            raise AssetActionRefused(
                "not_validated",
                f"Only a validated version can be published (this one is {version.status}).",
            )
        try:
            stored = get_storage().open(version.storage_key)
        except StorageError:
            raise AssetActionRefused(
                "storage_failed", "The stored file could not be read."
            ) from None
        with stored:
            sha256, size = sha256_of(stored)
            if sha256 != version.sha256 or size != version.size_bytes:
                result = ValidationResult(format=version.format)
                result.error("checksum_mismatch", "The stored file no longer matches its checksum.")
            else:
                result = validate_model(stored, size=size, definition=asset)
        if not result.passed:
            version.status = VersionStatus.REJECTED
            version.validation_report = result.report()
            version.save(update_fields=["status", "validation_report"])
            logger.info(
                "asset publish rejected: %s v%s %s", asset.asset_id, version.number, _codes(result)
            )
        else:
            version.status = VersionStatus.PUBLISHED
            version.published_at = timezone.now()
            version.published_by = user
            version.save(update_fields=["status", "published_at", "published_by"])
            if asset.default_version_id is None:
                asset.default_version = version
                asset.save(update_fields=["default_version", "updated_at"])
            logger.info("asset version published: %s v%s", asset.asset_id, version.number)
    if not result.passed:
        raise AssetActionRefused(
            "invalid_model", "The stored model failed validation; it was rejected.", result.findings
        )
    return version


def set_default_version(version: AssetVersion) -> ContentAsset:
    """Point the definition's default at another published version of the same asset."""
    with transaction.atomic():
        asset = _locked(version.asset)
        version = AssetVersion.objects.select_for_update().get(pk=version.pk)
        if version.asset_id != asset.pk or version.status != VersionStatus.PUBLISHED:
            raise AssetActionRefused("not_published", "Only a published version can be default.")
        if asset.status != AssetStatus.ACTIVE:
            raise AssetActionRefused("asset_retired", "This asset is retired.")
        asset.default_version = version
        asset.save(update_fields=["default_version", "updated_at"])
    logger.info("asset default changed: %s v%s", asset.asset_id, version.number)
    return asset


def retire_version(version: AssetVersion, *, replacement: AssetVersion | None = None):
    """`PUBLISHED` to `RETIRED`. The default must move first, or `replacement` names where to."""
    with transaction.atomic():
        asset = _locked(version.asset)
        version = AssetVersion.objects.select_for_update().get(pk=version.pk)
        if version.status != VersionStatus.PUBLISHED:
            raise AssetActionRefused("not_published", "Only a published version can be retired.")
        if asset.default_version_id == version.pk:
            if replacement is None:
                raise AssetActionRefused(
                    "default_in_use",
                    "This is the asset's default version. Make another published version the "
                    "default first, or retire the whole asset.",
                )
            replacement = AssetVersion.objects.select_for_update().get(pk=replacement.pk)
            if replacement.asset_id != asset.pk or replacement.status != VersionStatus.PUBLISHED:
                raise AssetActionRefused(
                    "not_published", "The replacement must be a published version."
                )
            asset.default_version = replacement
            asset.save(update_fields=["default_version", "updated_at"])
        version.status = VersionStatus.RETIRED
        version.retired_at = timezone.now()
        version.save(update_fields=["status", "retired_at"])
    logger.info("asset version retired: %s v%s", asset.asset_id, version.number)
    return version


def retire_asset(asset: ContentAsset) -> ContentAsset:
    """Nothing of a retired asset resolves; its versions and files are kept."""
    with transaction.atomic():
        asset = _locked(asset)
        asset.status = AssetStatus.RETIRED
        asset.save(update_fields=["status", "updated_at"])
    logger.info("asset retired: %s", asset.asset_id)
    return asset


def delete_unpublished_version(version: AssetVersion) -> None:
    """Delete a never-published version and, once that commits, its stored file."""
    with transaction.atomic():
        version = AssetVersion.objects.select_for_update().get(pk=version.pk)
        if version.was_published:
            raise AssetActionRefused("published", "Published versions are never deleted.")
        key = version.storage_key
        version.delete()
        storage = get_storage()
        transaction.on_commit(lambda: _delete_quietly(storage, key))


def audit_storage(*, delete: bool = False, min_age: timedelta = timedelta(days=1)) -> dict:
    """Objects under the asset prefix that no version row references.

    With `delete`, removes orphans older than `min_age` (younger ones may belong to an upload
    that is still committing). Never touches an object a row references.
    """
    storage = get_storage()
    referenced = set(AssetVersion.objects.values_list("storage_key", flat=True))
    cutoff = timezone.now() - min_age
    orphans, deleted, kept = [], [], []
    for item in storage.list(KEY_PREFIX):
        if item.key in referenced:
            continue
        orphans.append(item.key)
        if delete and item.last_modified <= cutoff:
            _delete_quietly(storage, item.key)
            deleted.append(item.key)
        elif delete:
            kept.append(item.key)
    missing = sorted(key for key in referenced if not storage.exists(key))
    return {"orphans": orphans, "deleted": deleted, "kept_too_recent": kept, "missing": missing}


def _delete_quietly(storage, key: str) -> None:
    try:
        storage.delete(key)
    except StorageError:
        logger.warning("asset object delete failed; the storage audit will find it")


def _codes(result: ValidationResult) -> str:
    return ",".join(sorted({f.code for f in result.errors}))
