"""The asset version lifecycle (LAI-2200 AM-4; `docs/ASSET_LIBRARY.md` sections 3 and 9).

Every state change goes through here, inside a transaction, with the asset row locked so two
administrators cannot allocate the same version number or race a publication. Permission checks
belong to the caller (the admin); these functions enforce the lifecycle and storage rules.

Logs carry asset ids, version numbers and outcome codes only (ADR-025).
"""

import logging
import uuid
from collections.abc import Callable
from datetime import timedelta
from typing import IO

from django.db import transaction
from django.db.models import Max, ProtectedError
from django.utils import timezone

from apps.catalog.models import AssetStatus, ContentAsset

from .models import CONTENT_TYPES, AssetVersion, DerivedArtifact, VersionStatus
from .processing import (
    async_validation_applies,
    identity_mismatch,
    model_validation_summary,
    submit_model_validation,
    validation_jobs,
)
from .storage import KEY_PREFIX, StorageError, get_storage, object_key, sha256_of
from .validation import Finding, ValidationResult, validate_upload

logger = logging.getLogger("lai.assets")


class AssetActionRefused(Exception):
    """The action is not allowed in the current state. `message` is safe to show an admin."""

    def __init__(
        self,
        code: str,
        message: str,
        findings: list[Finding] | None = None,
        *,
        details: dict | None = None,
    ):
        super().__init__(message)
        self.code = code
        self.message = message
        self.findings = findings or []
        # Structured facts a client can act on (the existing version of a duplicate upload).
        self.details = details or {}


#: Callables `guard(asset, version)` consulted, inside the retirement transaction and with the
#: asset row locked, before an asset (`version=None`) or one of its versions is retired. A guard
#: refuses by raising `AssetActionRefused`; returning means "no objection". Other apps register
#: here from their `AppConfig.ready()` (the NPC Manager refuses to retire what a live NPC release
#: uses, LAI-NPC-036), so this module never imports them.
RetirementGuard = Callable[[ContentAsset, AssetVersion | None], None]
RETIREMENT_GUARDS: list[RetirementGuard] = []


def register_retirement_guard(guard: RetirementGuard) -> None:
    """Add `guard` once (re-registering, e.g. on a second `ready()`, is a no-op)."""
    if guard not in RETIREMENT_GUARDS:
        RETIREMENT_GUARDS.append(guard)


def _check_retirement_guards(asset: ContentAsset, version: AssetVersion | None) -> None:
    for guard in RETIREMENT_GUARDS:
        guard(asset, version)


def _locked(asset: ContentAsset) -> ContentAsset:
    return ContentAsset.objects.select_for_update().get(pk=asset.pk)


def upload_version(
    asset: ContentAsset,
    upload: IO[bytes],
    *,
    original_filename: str,
    user=None,
    extra_metadata: dict | None = None,
    notes: str = "",
):
    """Checksum, validate and store a new version of any supported family (AM-13).

    Returns it `VALIDATED`, or raises. With `LAI_ASSET_ASYNC_VALIDATION=on` and a GLB model
    (`async_validation_applies`), the version is created `DRAFT` and its `asset.validate_model`
    job is submitted in the same transaction (ADR-064); the job's handler later moves the draft
    to `VALIDATED` or `REJECTED` (with the inline backend, before this returns). The version
    returned is re-read from the database.

    `extra_metadata` (TR-PALM-03: provenance, licence, how a pack model was prepared) is merged
    into the version's metadata beside what validation detected; validation's own keys win. Like
    the rest of the metadata it becomes immutable once the version is published.

    A file that fails validation is never stored and makes no row: the admin sees the findings
    and nothing needs cleaning up. A storage or database failure, or a refused job submission,
    leaves no row, no job and no object.
    """
    # Validate before hashing: an oversized file (above the model or GLB limit) is refused from
    # its size and header alone, before the whole upload is read.
    upload.seek(0, 2)
    result = validate_upload(upload, size=upload.tell(), definition=asset)
    upload.seek(0)
    if not result.passed:
        logger.info("asset upload rejected: %s %s", asset.asset_id, _codes(result))
        raise AssetActionRefused(
            "invalid_file", "The file did not pass validation.", result.findings
        )
    sha256, size = sha256_of(upload)

    deferred = async_validation_applies(result.format)
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
                details={"version": duplicate},
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
        if deferred:
            version = _create_draft_and_submit(
                storage,
                key,
                asset=asset,
                version_id=version_id,
                number=number,
                original_filename=original_filename,
                content_type=content_type,
                size=size,
                sha256=sha256,
                result=result,
                user=user,
                extra_metadata=extra_metadata,
                notes=notes,
            )
        else:
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
                    metadata={**(extra_metadata or {}), **result.metadata},
                    validation_report=result.report(),
                    notes=(notes or "")[:500],
                    validated_at=timezone.now(),
                    uploaded_by=user,
                )
            except Exception:
                _delete_quietly(storage, key)  # the row failed: do not leave an orphan behind
                raise
    if deferred:
        logger.info("asset version uploaded as draft: %s v%s", asset.asset_id, number)
    else:
        logger.info("asset version uploaded: %s v%s", asset.asset_id, number)
    return version


def _create_draft_and_submit(
    storage,
    key: str,
    *,
    asset: ContentAsset,
    version_id: uuid.UUID,
    number: int,
    original_filename: str,
    content_type: str,
    size: int,
    sha256: str,
    result: ValidationResult,
    user,
    extra_metadata: dict | None = None,
    notes: str = "",
) -> AssetVersion:
    """The asynchronous half of `upload_version`, run in its transaction (asset row locked) after
    the object is stored: the `DRAFT` row and its model validation job commit together or not at
    all. Any failure deletes the just-stored object and re-raises; a refused submission
    (`JobsError`, `JobsDisabled` included) becomes `AssetActionRefused("processing_unavailable")`.
    Returns the version re-read from the database: the inline backend has already applied the
    job, so it may be `VALIDATED` or `REJECTED`."""
    from apps.jobs.services import JobsError

    try:
        version = AssetVersion.objects.create(
            version_id=version_id,
            asset=asset,
            number=number,
            status=VersionStatus.DRAFT,
            storage_key=key,
            original_filename=(original_filename or "")[:255],
            content_type=content_type,
            size_bytes=size,
            sha256=sha256,
            format=result.format,
            clips=result.clips,
            dimensions=result.dimensions,
            metadata={**(extra_metadata or {}), **result.metadata},
            validation_report=result.report(),
            notes=(notes or "")[:500],
            validated_at=None,
            uploaded_by=user,
        )
        submit_model_validation(version, user=user)
        return AssetVersion.objects.select_related("asset").get(pk=version.pk)
    except JobsError as error:
        _delete_quietly(storage, key)
        logger.warning(
            "asset upload processing refused: %s v%s %s", asset.asset_id, number, error.code
        )
        raise AssetActionRefused(
            "processing_unavailable",
            "Background validation is not available right now, so the file was not stored. "
            "Try again later.",
        ) from None
    except Exception:
        _delete_quietly(storage, key)  # the row or the job failed: do not leave an orphan
        raise


def publish_version(version: AssetVersion, *, user=None) -> AssetVersion:
    """`VALIDATED` to `PUBLISHED`, after re-reading the stored bytes.

    The stored object must still match the recorded checksum and size, and must still pass
    validation against the definition as it is now (its declared clips may have grown). A
    failure marks the version `REJECTED`. The first published version becomes the default.

    When asynchronous validation applies (`LAI_ASSET_ASYNC_VALIDATION=on` and a GLB model), the
    version also needs a completed, passing `asset.validate_model` job for exactly its stored
    file, by the processor version this build runs; without one it is refused with
    `processing_required` and left unchanged. Jobs are read, never locked. Publishing is always
    this explicit call: no job result publishes a version.
    """
    with transaction.atomic():
        asset = _locked(version.asset)
        version = AssetVersion.objects.select_for_update().get(pk=version.pk)
        refusal = publish_refusal(version, asset=asset)
        if refusal is not None:
            if refusal.code == "processing_required":
                logger.info(
                    "asset publish refused: %s v%s processing_required",
                    asset.asset_id,
                    version.number,
                )
            raise refusal
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
                result = validate_upload(stored, size=size, definition=asset)
        if policy_only(result):
            # The bytes are intact; only the extension policy (or a compression control) has
            # changed since the version was validated. Refuse and leave the version unchanged:
            # a later policy or control change can make it publishable again.
            logger.info(
                "asset publish refused: %s v%s policy %s",
                asset.asset_id,
                version.number,
                _codes(result),
            )
            policy_refusal = AssetActionRefused(
                "policy_refused",
                "The file is unchanged, but the game's current model policy does not accept it "
                "(an extension or compression setting). It was not rejected; publish it again "
                "once the policy allows it.",
                result.findings,
            )
        elif not result.passed:
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
    if policy_only(result):
        raise policy_refusal
    if not result.passed:
        raise AssetActionRefused(
            "invalid_file", "The stored file failed validation; it was rejected.", result.findings
        )
    return version


def publish_refusal(
    version: AssetVersion, *, asset: ContentAsset | None = None
) -> AssetActionRefused | None:
    """Why `publish_version` would refuse `version` before reading its stored file, or None.

    The same checks, in the same order, as the publication itself: the asset is active, the
    version is `VALIDATED`, and, when asynchronous validation applies, `_has_passing_validation`.
    Read only (Django Admin shows it); `publish_version` calls it under its locks and still
    re-reads and re-validates the stored bytes afterwards."""
    asset = asset if asset is not None else version.asset
    if asset.status != AssetStatus.ACTIVE:
        return AssetActionRefused("asset_retired", "This asset is retired.")
    if version.status != VersionStatus.VALIDATED:
        return AssetActionRefused(
            "not_validated",
            f"Only a validated version can be published (this one is {version.status}).",
        )
    compression = compression_refusal(version)
    if compression is not None:
        return compression
    if async_validation_applies(version) and not _has_passing_validation(version):
        return AssetActionRefused(
            "processing_required",
            "This model has no passing background validation for its current file. Run "
            "Validate in background, wait for a passing result, then publish again.",
        )
    return None


def compressed_extensions(version: AssetVersion) -> frozenset[str]:
    """The gated compression extensions (ADR-070) a model version uses, from its recorded
    validation metadata (`extensionsUsed`; a validator refuses compression that is not declared
    there)."""
    from lai_processing.processors.gltf.extension_policy import CONTROLS

    used = (version.metadata or {}).get("extensionsUsed") or []
    return frozenset(name for name in used if isinstance(name, str) and name in CONTROLS)


def compression_refusal(version: AssetVersion) -> AssetActionRefused | None:
    """ADR-070 publication gate: a compressed GLB is publishable only while the control of every
    compression extension it uses is on NOW (`LAI_GLB_MESHOPT`, `LAI_GLB_KTX2`). Checked before
    the stored bytes are re-validated, so switching a control off refuses the publication and
    leaves the version unchanged (it is not rejected). Already-published versions are never
    touched; the latest-validation gate (`_has_passing_validation`) still applies on top."""
    from lai_processing.processors.gltf.extension_policy import CONTROLS

    from .validation import compression_controls

    enabled = compression_controls()
    off = sorted(name for name in compressed_extensions(version) if CONTROLS[name] not in enabled)
    if not off:
        return None
    return AssetActionRefused(
        "compression_disabled",
        "This model uses compression that is switched off for publishing "
        f"({', '.join(off)}). Turn the setting on, or publish an uncompressed version.",
    )


#: `ProcessingJob.subject_outcome` codes after which a job's result does not count for the gate.
_UNUSABLE_OUTCOMES = frozenset(
    {"result_invalid", "version_missing", "processing_failed", "result_superseded"}
)


def _has_passing_validation(version: AssetVersion) -> bool:
    """The publication gate (read only; `publish_version` calls it with the asset and version rows
    locked, and `submit_model_validation` takes the same locks, so a validation cannot be submitted
    between this check and the publication).

    The LATEST `asset.validate_model` job for this exact source decides: the same version, stored
    key and SHA-256 and the validation profile. Anything newer than a pass blocks publication:
    a pending, running, failed (cancelled, timed out, refused), rejected, invalid, mismatched or
    superseded job. The deciding job must be completed, accepted when it was applied (no mismatch,
    not invalid, not superseded), a `pass` verdict, and by the processor version this build runs
    (an older processor's pass is not evidence under a newer policy). A job that names other bytes
    or another profile is not applicable and is skipped; any other identity problem on a newer
    job blocks. A pruned job is no evidence (`jobs_sweep` retention): validate again.

    Published versions are never touched: this gates new publications and republication only."""
    from apps.jobs.models import JobStatus

    for job in validation_jobs(version):
        problem = identity_mismatch(job, version)
        if problem in _OTHER_SOURCE_MISMATCHES:
            continue  # validates other bytes or another profile: not applicable
        if problem is not None or job.status != JobStatus.COMPLETED:
            return False  # the latest applicable job is unfinished, failed or not for this file
        outcome = job.subject_outcome or ""
        if outcome.endswith("_mismatch") or outcome in _UNUSABLE_OUTCOMES:
            return False
        summary = model_validation_summary(job)
        return (
            summary is not None
            and summary.get("verdict") == "pass"
            and identity_mismatch(job, version, require_current_processor=True) is None
        )
    return False


#: `identity_mismatch` codes meaning the job is about different bytes or a different profile.
_OTHER_SOURCE_MISMATCHES = frozenset({"checksum_mismatch", "size_mismatch", "profile_mismatch"})


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
        _check_retirement_guards(asset, version)
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


def republish_version(version: AssetVersion, *, user=None) -> AssetVersion:
    """`RETIRED` back to `PUBLISHED` after re-reading the stored bytes (a rollback target).

    The same checks as a first publication: the object must exist, match its recorded checksum
    and size, and pass validation. A version whose bytes no longer verify stays `RETIRED`
    (never rejected: it was valid when it shipped) and the administrator is told why.

    The original publication record (`published_at`, `published_by`) is history and is kept as it
    was: both are immutable once a version is published (`models.IMMUTABLE_FIELDS`). Who restored
    the version is recorded by the caller (the Django Admin history entry), never by rewriting
    who first published it (LAI-07 A2); the log line carries ids only (ADR-025). `user` is kept
    in the signature for callers.
    """
    with transaction.atomic():
        asset = _locked(version.asset)
        version = AssetVersion.objects.select_for_update().get(pk=version.pk)
        if asset.status != AssetStatus.ACTIVE:
            raise AssetActionRefused("asset_retired", "This asset is retired.")
        if version.status != VersionStatus.RETIRED:
            raise AssetActionRefused(
                "not_retired", f"Only a retired version can be republished ({version.status})."
            )
        compression = compression_refusal(version)
        if compression is not None:
            raise compression
        problem = _verify_bytes(version, asset, previously_published=True)
        if problem is not None:
            raise AssetActionRefused("verification_failed", problem)
        version.status = VersionStatus.PUBLISHED
        version.retired_at = None
        version.save(update_fields=["status", "retired_at"])
    logger.info("asset version republished: %s v%s", asset.asset_id, version.number)
    return version


def rollback_to_version(version: AssetVersion, *, user=None) -> ContentAsset:
    """Make a previous valid version the live one, republishing it first when it was retired.

    The version being replaced stays published unless an administrator retires it. Draft,
    validated-but-never-published and rejected versions are not rollback targets: publish them
    through the normal path.
    """
    version = AssetVersion.objects.get(pk=version.pk)  # the caller's copy may be stale
    if version.status == VersionStatus.RETIRED:
        version = republish_version(version, user=user)
    elif version.status != VersionStatus.PUBLISHED:
        raise AssetActionRefused(
            "not_rollback_target",
            "Only a version that was published before can be rolled back to.",
        )
    return set_default_version(version)


def reactivate_asset(asset: ContentAsset) -> ContentAsset:
    """`RETIRED` back to `ACTIVE`. Its versions keep their own states; nothing is republished."""
    with transaction.atomic():
        asset = _locked(asset)
        if asset.status != AssetStatus.RETIRED:
            raise AssetActionRefused("not_retired", "This asset is already active.")
        asset.status = AssetStatus.ACTIVE
        asset.save(update_fields=["status", "updated_at"])
    logger.info("asset reactivated: %s", asset.asset_id)
    return asset


def verify_version(version: AssetVersion) -> str | None:
    """Re-read the stored object. None when it is present and unchanged, else why not."""
    return _verify_bytes(version, version.asset)


def policy_only(result: ValidationResult) -> bool:
    """True when `result` failed only on the extension policy (`POLICY_ERROR_CODES`), never on
    the file's bytes or structure."""
    from lai_processing.processors.gltf.extension_policy import POLICY_ERROR_CODES

    codes = {f.code for f in result.errors}
    return bool(codes) and codes <= POLICY_ERROR_CODES


def _verify_bytes(
    version: AssetVersion, asset: ContentAsset, *, previously_published: bool = False
) -> str | None:
    """None when the stored object is present, unchanged and valid, else why not.

    `previously_published` (republish and rollback of a retired version): the bytes must be
    intact and every structural check must still pass, but errors that come only from the
    extension policy (`policy_only`) are tolerated, because the same bytes were valid and live
    under the policy recorded when they were published. Gated compression is still refused by
    `compression_refusal` before this runs. This is the conservative choice: integrity and
    structure are re-proven; only a later tightening of the extension table is not applied
    retroactively to a rollback target."""
    try:
        stored = get_storage().open(version.storage_key)
    except StorageError:
        return "The stored file is missing or could not be read."
    with stored:
        sha256, size = sha256_of(stored)
        if sha256 != version.sha256 or size != version.size_bytes:
            return "The stored file no longer matches its recorded checksum."
        result = validate_upload(stored, size=size, definition=asset)
    if not result.passed and not (previously_published and policy_only(result)):
        return "The stored file no longer passes validation: " + _codes(result)
    return None


def retire_asset(asset: ContentAsset) -> ContentAsset:
    """Nothing of a retired asset resolves; its versions and files are kept.

    Raises `AssetActionRefused` when a registered retirement guard objects.
    """
    with transaction.atomic():
        asset = _locked(asset)
        _check_retirement_guards(asset, None)
        asset.status = AssetStatus.RETIRED
        asset.save(update_fields=["status", "updated_at"])
    logger.info("asset retired: %s", asset.asset_id)
    return asset


def delete_unpublished_version(version: AssetVersion) -> None:
    """Delete a never-published version and, once that commits, its stored file.

    Lock order, as everywhere: the asset row first, then the version row. A version that was
    created by promoting a derived artifact is refused with its own code and message: the artifact
    row protects it (`promoted_version` is PROTECT), and removing a promoted version, which would
    have to return the artifact to a reviewable state and keep an audit record, is an OPEN
    DECISION (docs/processing/DERIVED_ARTIFACTS.md, section 13). Until the owner decides, a
    promoted version that should not ship simply stays unpublished."""
    asset_pk = AssetVersion.objects.filter(pk=version.pk).values_list("asset_id", flat=True).first()
    if asset_pk is None:
        return  # already gone
    with transaction.atomic():
        ContentAsset.objects.select_for_update().filter(pk=asset_pk).first()
        version = AssetVersion.objects.select_for_update().get(pk=version.pk)
        if version.was_published:
            raise AssetActionRefused("published", "Published versions are never deleted.")
        if DerivedArtifact.objects.filter(promoted_version=version).exists():
            raise AssetActionRefused(
                "promoted_version",
                "This version was created from a derived artifact, so it cannot be deleted "
                "here. Leave it unpublished or reject it. Deleting promoted versions needs an "
                "owner decision.",
            )
        key = version.storage_key
        # Tombstones of expired or deleted artifacts (no live object to protect) go with it.
        version.derived_artifacts.filter(state__in=["expired", "deleted"]).delete()
        try:
            version.delete()
        except ProtectedError:
            # Live derived artifacts (ADR-066) made FROM this version keep it alive: they must
            # expire (retention) or be rejected before the version can be deleted.
            raise AssetActionRefused(
                "has_derived_artifacts",
                "This version has derived artifacts. Let them expire or reject them first.",
            ) from None
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
