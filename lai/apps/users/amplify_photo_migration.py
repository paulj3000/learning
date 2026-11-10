"""Copy child photos from the legacy Amplify bucket into the Django photo bucket (AMP-04).

Runbook: docs/platform/AMPLIFY_STORAGE_CUTOVER.md. Entry point: `manage.py
migrate_amplify_child_photos`.

Amplify builds stored a parent-uploaded icon at `child-photos/<identity id>/<uuid>.jpg` in
`learningAdventureIslandMedia`, readable only by the uploading Cognito *identity*
(amplify/storage/resource.ts), and recorded that path on the Amplify `ChildProfile.avatarPhotoKey`.
Django keeps photos in its own private bucket under `children/<child uuid>/<photo uuid>`
(photo_storage.py, ADR-042), owned by the child's parent.

Mapping, without ever guessing:

- The *child* comes from the profile export (`import_amplify_profiles`' input,
  docs/platform/AMPLIFY_PROFILE_IMPORT.md): the child whose `avatarPhotoKey` names the object.
  `import_amplify_profiles` keeps the Amplify child id, so that id is the Django child id.
- The *owner* comes from that export too (the child's `ownerSub`, else its parent profile's
  `owner`), and must be the Cognito `sub` of the Django child's parent. Otherwise nothing is copied.
- The identity id in the key is only checked for consistency: one identity id must belong to one
  owner, and one owner's photos must sit under one identity id. Anything else is a conflict for a
  person to look at.

Copying re-runs the Django upload pipeline (`photos.replace_photo`): the same size, type and
structure checks and the same metadata stripping (`photo_validation.clean_jpeg`), a fresh
`children/<child>/<photo>` key, a checksummed conditional write, and a `ChildPhoto` row. The
stored object is then read back and its SHA-256 compared with the row. A child that already has
a Django photo keeps it: a matching checksum is `already_copied` (re-runs are idempotent), a
different one is `django_photo_newer` (the parent uploaded a newer photo in Django; never replaced).

Never deletes or changes a source object, and nothing here is public: the Django bucket stays
private and photos are served only to the parent, through presigned GETs or the authenticated
content route. The manifest lists every Django photo the run created, for `rollback`.
Console output is counts only; the manifest (written 0600) holds child and identity ids.
"""

import hashlib
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import UTC, datetime
from uuid import UUID

from django.conf import settings
from django.db import transaction
from django.utils.timezone import now

from apps.core.legacy_bucket import LegacyBucket, LegacyBucketError, etag_matches

from . import photos, services
from .amplify_import import ImportFileError, _read_export, owner_sub
from .models import ChildPhoto, ChildPhotoStatus
from .photo_storage import PhotoStorageError
from .photo_validation import PhotoRejected

LEGACY_PREFIX = "child-photos/"
LEGACY_KEY = re.compile(r"^child-photos/([A-Za-z0-9-]+:[0-9a-fA-F-]{36})/([A-Za-z0-9._-]+)$")
CONTENT_TYPE = "image/jpeg"

INVENTORY, DRY_RUN, COPY = "inventory", "dry-run", "copy"

# Outcomes that mean "the child's photo is in Django and verified".
DONE = frozenset({"copied", "already_copied"})


@dataclass
class PhotoRecord:
    legacy_key: str
    size: int
    etag: str
    last_modified: datetime
    identity_id: str | None = None
    source_sha256: str | None = None
    source_version_id: str | None = None
    etag_matches: bool | None = None  # None: a multipart ETag, which is not an MD5
    referenced: bool = False  # some exported child's avatarPhotoKey names this object
    child_id: str | None = None
    outcome: str = "inventoried"
    detail: str = ""
    django_photo_id: str | None = None
    django_sha256: str | None = None
    django_storage_key: str | None = None
    byte_identical: bool | None = None

    def as_dict(self) -> dict:
        body = {
            "legacyKey": self.legacy_key,
            "identityId": self.identity_id,
            "size": self.size,
            "etag": self.etag,
            "lastModified": self.last_modified.isoformat(),
            "sourceSha256": self.source_sha256,
            "sourceVersionId": self.source_version_id,
            "etagMatchesMd5": self.etag_matches,
            "referenced": self.referenced,
            "childId": self.child_id,
            "outcome": self.outcome,
        }
        optional = {
            "detail": self.detail,
            "djangoPhotoId": self.django_photo_id,
            "djangoSha256": self.django_sha256,
            "djangoStorageKey": self.django_storage_key,
            "byteIdentical": self.byte_identical,
        }
        body.update({name: value for name, value in optional.items() if value not in ("", None)})
        return body


@dataclass
class PhotoMigration:
    mode: str
    bucket: str
    records: list[PhotoRecord] = field(default_factory=list)
    missing_objects: list[dict] = field(default_factory=list)  # export references with no object
    versions: dict = field(default_factory=dict)

    def summary(self) -> dict:
        outcomes = Counter(record.outcome for record in self.records)
        referenced = [r for r in self.records if r.referenced]
        return {
            "sourceObjects": len(self.records),
            "sourceBytes": sum(record.size for record in self.records),
            "referencedObjects": len(referenced),
            "missingObjects": len(self.missing_objects),
            "inDjangoVerified": sum(outcomes[name] for name in DONE),
            "outcomes": dict(sorted(outcomes.items())),
        }

    def reconciled(self) -> bool:
        """Every photo a child references exists in Django with a verified checksum."""
        referenced = [r for r in self.records if r.referenced]
        return not self.missing_objects and all(r.outcome in DONE for r in referenced)

    def manifest(self) -> dict:
        created = [
            {
                "childId": r.child_id,
                "photoId": r.django_photo_id,
                "sha256": r.django_sha256,
                "storageKey": r.django_storage_key,
            }
            for r in self.records
            if r.outcome == "copied"
        ]
        return {
            "card": "AMP-04",
            "kind": "child-photos",
            "mode": self.mode,
            "sourceBucket": self.bucket,
            "sourcePrefix": LEGACY_PREFIX,
            "generatedAt": datetime.now(UTC).isoformat(),
            "summary": self.summary(),
            "reconciled": self.reconciled(),
            "sourceVersions": self.versions,
            "records": [record.as_dict() for record in self.records],
            "missingObjects": self.missing_objects,
            "rollback": {"createdPhotos": created},
        }


@dataclass(frozen=True)
class _ChildRef:
    child_id: UUID
    owner: str | None


def _references(export: dict) -> tuple[dict[str, list[_ChildRef]], list[dict]]:
    """`avatarPhotoKey` -> the export children naming it, plus the children whose id is unusable."""
    parents, children = _read_export(export)
    parent_owner = {str(item.get("id") or ""): owner_sub(item.get("owner")) for item in parents}
    refs: dict[str, list[_ChildRef]] = defaultdict(list)
    invalid: list[dict] = []
    for item in children:
        key = item.get("avatarPhotoKey")
        if not isinstance(key, str) or not key:
            continue
        try:
            child_id = UUID(str(item.get("id") or ""))
        except ValueError:
            invalid.append({"legacyKey": key, "reason": "invalid_child_id"})
            continue
        own = owner_sub(item.get("ownerSub"))
        via_parent = parent_owner.get(str(item.get("parentProfileId") or ""))
        if own and via_parent and own != via_parent:
            owner = None  # the export disagrees with itself: not resolvable
        else:
            owner = own or via_parent
        refs[key].append(_ChildRef(child_id, owner))
    return refs, invalid


def run(bucket: LegacyBucket, *, mode: str, export: dict | None) -> PhotoMigration:
    """Inventory, plan (dry run) or copy. Only `COPY` writes, and only to Django."""
    if mode not in (INVENTORY, DRY_RUN, COPY):
        raise ValueError("Unknown mode.")
    if mode != INVENTORY and export is None:
        raise ImportFileError("A dry run or a copy needs the profile export (--export).")
    migration = PhotoMigration(mode=mode, bucket=bucket.bucket)
    migration.versions = bucket.version_summary()
    refs, invalid = _references(export) if export is not None else ({}, [])
    migration.missing_objects.extend(invalid)

    max_bytes = settings.LAI_CHILD_PHOTO_MAX_BYTES
    seen: set[str] = set()
    sources: dict[str, bytes | None] = {}
    for item in bucket.list():
        seen.add(item.key)
        record = PhotoRecord(item.key, item.size, item.etag, item.last_modified)
        migration.records.append(record)
        match = LEGACY_KEY.fullmatch(item.key)
        record.identity_id = match[1] if match else None
        try:
            read = bucket.read(item.key, keep_up_to=max_bytes)
        except LegacyBucketError as error:
            record.outcome, record.detail = "read_failed", str(error)
            continue
        record.source_sha256, record.source_version_id = read.sha256, read.version_id
        record.etag_matches = etag_matches(item.etag, read.md5)
        sources[item.key] = read.data
        if read.size != item.size:
            record.outcome, record.detail = "read_failed", "size_changed_during_read"
        elif record.etag_matches is False:
            record.outcome = "integrity_failed"  # the bytes read are not the bytes S3 listed

    for key, children in refs.items():
        if key not in seen:
            for child in children:
                migration.missing_objects.append(
                    {"legacyKey": key, "childId": str(child.child_id), "reason": "missing_object"}
                )

    if export is None:
        return migration

    for record in migration.records:
        children = refs.get(record.legacy_key, [])
        record.referenced = bool(children)
        if len(children) == 1:
            record.child_id = str(children[0].child_id)

    _check_identities(migration.records, refs)
    for record in migration.records:
        if record.outcome != "inventoried":
            continue
        _plan_one(record, refs, sources.get(record.legacy_key), mode=mode)
    return migration


def _check_identities(records: list[PhotoRecord], refs: dict[str, list[_ChildRef]]) -> None:
    """One identity id per owner and one owner per identity id; otherwise mark a conflict."""
    owners_of: dict[str, set] = defaultdict(set)
    identities_of: dict[str, set] = defaultdict(set)
    for record in records:
        for child in refs.get(record.legacy_key, []):
            if record.identity_id and child.owner:
                owners_of[record.identity_id].add(child.owner)
                identities_of[child.owner].add(record.identity_id)
    for record in records:
        if record.outcome != "inventoried" or not record.identity_id:
            continue
        owners = owners_of.get(record.identity_id, set())
        if len(owners) > 1 or any(len(identities_of[owner]) > 1 for owner in owners):
            record.outcome = "identity_conflict"
            children = refs.get(record.legacy_key, [])
            record.child_id = str(children[0].child_id) if len(children) == 1 else None


def _plan_one(record: PhotoRecord, refs, data: bytes | None, *, mode: str) -> None:
    children = refs.get(record.legacy_key, [])
    if not LEGACY_KEY.fullmatch(record.legacy_key):
        record.outcome = "invalid_key"
        return
    if not children:
        record.outcome = "unreferenced_object"  # no child points at it: left in place, never copied
        return
    if len(children) > 1:
        record.outcome = "ambiguous_reference"
        return
    ref = children[0]
    record.child_id = str(ref.child_id)
    if not ref.owner:
        record.outcome = "unresolved_owner"
        return
    child = services.child_profile_for_import(ref.child_id)
    if child is None:
        record.outcome = "child_not_imported"  # run import_amplify_profiles --apply first
        return
    if child.parent.cognito_sub != ref.owner:
        record.outcome = "owner_mismatch"
        return
    if data is None:
        record.outcome, record.detail = "validation_failed", "photo_too_large"
        return
    try:
        clean = photos.validate_upload(data, CONTENT_TYPE)
    except PhotoRejected as rejected:
        record.outcome, record.detail = "validation_failed", rejected.code
        return
    digest = hashlib.sha256(clean.data).hexdigest()
    record.byte_identical = clean.data == data

    existing = photos.current_photo(child)
    if existing is not None:
        _describe(record, existing)
        if existing.sha256 != digest:
            record.outcome = "django_photo_newer"  # a newer Django photo wins; never replaced
            return
        record.outcome = "already_copied" if _verified(existing) else "destination_mismatch"
        return
    if mode != COPY:
        record.outcome, record.django_sha256 = "would_copy", digest
        return
    try:
        photo = photos.replace_photo(child.parent, child.pk, data, CONTENT_TYPE)
    except services.ChildProfileNotFound:
        record.outcome = "child_not_imported"
        return
    except (PhotoRejected, PhotoStorageError) as error:
        record.outcome, record.detail = "copy_failed", getattr(error, "code", str(error))
        return
    _describe(record, photo)
    if photo.sha256 == digest and _verified(photo):
        record.outcome = "copied"
        return
    record.outcome = "verify_failed"
    _remove_created(photo)


def _describe(record: PhotoRecord, photo: ChildPhoto) -> None:
    record.django_photo_id = str(photo.pk)
    record.django_sha256 = photo.sha256
    record.django_storage_key = photo.storage_key


def _verified(photo: ChildPhoto) -> bool:
    """The stored Django object is present and matches the row's checksum and size."""
    try:
        stored = photos.read_photo(photo)
    except PhotoStorageError:
        return False
    return len(stored) == photo.byte_size and hashlib.sha256(stored).hexdigest() == photo.sha256


def _remove_created(photo: ChildPhoto) -> bool:
    """Retire and purge one photo this migration created (verification failure or rollback)."""
    with transaction.atomic():
        changed = ChildPhoto.objects.filter(pk=photo.pk, status=ChildPhotoStatus.CURRENT).update(
            status=ChildPhotoStatus.DELETING, status_changed_at=now()
        )
    if changed:
        photos.purge_photos([photo.pk])
    return bool(changed)


# --- rollback -----------------------------------------------------------------------------------


@dataclass
class RollbackReport:
    confirmed: bool
    outcomes: list[dict] = field(default_factory=list)

    def summary(self) -> dict:
        return dict(sorted(Counter(item["outcome"] for item in self.outcomes).items()))

    def as_dict(self) -> dict:
        return {"confirmed": self.confirmed, "summary": self.summary(), "photos": self.outcomes}


def rollback(manifest: dict, *, confirm: bool) -> RollbackReport:
    """Remove the Django photos a copy run created, as listed in its manifest.

    Only a photo that is still `CURRENT` with the checksum the run recorded is removed. One the
    parent has since replaced or removed is left alone (`changed_since`). Source objects are never
    touched, so a rollback can always be followed by a fresh copy.
    """
    if manifest.get("kind") != "child-photos":
        raise ImportFileError("This is not a child photo migration manifest.")
    created = (manifest.get("rollback") or {}).get("createdPhotos") or []
    report = RollbackReport(confirmed=confirm)
    for entry in created:
        photo_id = entry.get("photoId") if isinstance(entry, dict) else None
        try:
            photo = ChildPhoto.objects.filter(pk=UUID(str(photo_id))).first()
        except ValueError:
            report.outcomes.append({"photoId": photo_id, "outcome": "invalid_entry"})
            continue
        if photo is None:
            outcome = "already_gone"
        elif photo.status != ChildPhotoStatus.CURRENT or photo.sha256 != entry.get("sha256"):
            outcome = "changed_since"
        elif not confirm:
            outcome = "would_remove"
        else:
            outcome = "removed" if _remove_created(photo) else "changed_since"
        report.outcomes.append({"photoId": str(photo_id), "outcome": outcome})
    return report
