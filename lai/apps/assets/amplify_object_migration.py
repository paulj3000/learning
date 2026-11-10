"""Move the legacy Amplify asset-library objects into the Django asset library (AMP-04).

Runbook: docs/platform/AMPLIFY_STORAGE_CUTOVER.md. Entry point: `manage.py
migrate_amplify_asset_objects`.

The Amplify Model Asset Library (ADR-030) kept versioned GLB files at
`assets/models/<folder>/<asset id>/v<n>/model.glb` in `learningAdventureIslandMedia`, with the
`Asset` / `AssetVersion` records in DynamoDB. The Django library (ADR-043, `docs/ASSET_LIBRARY.md`)
has its own private bucket, key layout and lifecycle. This module does not invent a second
import path: it streams the legacy objects (read only) into a private temporary directory laid
out by key and hands them to the existing importer (`importer.import_amplify`, AM-8), which
validates every file, stores it with a checksummed conditional write, and creates `VALIDATED`
versions. Nothing is published: publishing stays an administrator's decision in Django Admin.

- `inventory`: every legacy object with size, ETag, version id and SHA-256, and whether a Django
  version with that SHA-256 already exists (`in_django`) or not (`not_in_django`). Read only.
- dry run (the default with an export): the importer's dry run over the downloaded files.
- `copy`: the import itself, then every new version is re-read from Django storage and checked
  (`services.verify_version`), and every source object is reconciled by checksum again.

Never deletes or changes a source object. The manifest lists every Django version and definition
the run created, for `rollback` (which only ever deletes never-published versions).
"""

import tempfile
from collections import Counter
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID

from apps.catalog.models import ContentAsset
from apps.core.legacy_bucket import LegacyBucket, LegacyBucketError, etag_matches

from . import services
from .importer import import_amplify
from .models import AssetVersion

LEGACY_PREFIX = "assets/"
INVENTORY, DRY_RUN, COPY = "inventory", "dry-run", "copy"


class ManifestError(ValueError):
    pass


@dataclass
class ObjectRecord:
    legacy_key: str
    size: int
    etag: str
    last_modified: datetime
    source_sha256: str | None = None
    source_version_id: str | None = None
    etag_matches: bool | None = None  # None: a multipart ETag, which is not an MD5
    outcome: str = "not_in_django"
    detail: str = ""
    django_versions: list[dict] = field(default_factory=list)

    def as_dict(self) -> dict:
        body = {
            "legacyKey": self.legacy_key,
            "size": self.size,
            "etag": self.etag,
            "lastModified": self.last_modified.isoformat(),
            "sourceSha256": self.source_sha256,
            "sourceVersionId": self.source_version_id,
            "etagMatchesMd5": self.etag_matches,
            "outcome": self.outcome,
            "djangoVersions": self.django_versions,
        }
        if self.detail:
            body["detail"] = self.detail
        return body


@dataclass
class AssetMigration:
    mode: str
    bucket: str
    records: list[ObjectRecord] = field(default_factory=list)
    versions: dict = field(default_factory=dict)
    import_report: dict | None = None
    created_versions: list[dict] = field(default_factory=list)
    created_definitions: list[str] = field(default_factory=list)

    def summary(self) -> dict:
        outcomes = Counter(record.outcome for record in self.records)
        body = {
            "sourceObjects": len(self.records),
            "sourceBytes": sum(record.size for record in self.records),
            "inDjango": outcomes["in_django"],
            "outcomes": dict(sorted(outcomes.items())),
        }
        if self.import_report is not None:
            body["imported"] = len(self.import_report["imported"])
            body["skipped"] = len(self.import_report["skipped"])
            body["unresolved"] = len(self.import_report["unresolved"])
            body["createdVersionsVerified"] = sum(
                1 for item in self.created_versions if item.get("verified")
            )
        return body

    def reconciled(self) -> bool:
        """Every legacy object is a Django version by checksum, and every new version verified."""
        return all(record.outcome == "in_django" for record in self.records) and all(
            item.get("verified") for item in self.created_versions
        )

    def manifest(self) -> dict:
        return {
            "card": "AMP-04",
            "kind": "asset-objects",
            "mode": self.mode,
            "sourceBucket": self.bucket,
            "sourcePrefix": LEGACY_PREFIX,
            "generatedAt": datetime.now(UTC).isoformat(),
            "summary": self.summary(),
            "reconciled": self.reconciled(),
            "sourceVersions": self.versions,
            "records": [record.as_dict() for record in self.records],
            "importReport": self.import_report,
            "rollback": {
                "createdVersions": [
                    {key: value for key, value in item.items() if key != "verified"}
                    for item in self.created_versions
                ],
                "createdDefinitions": self.created_definitions,
            },
        }


def _reconcile(records: list[ObjectRecord]) -> None:
    for record in records:
        if record.outcome in ("read_failed", "integrity_failed") or record.source_sha256 is None:
            continue
        matches = AssetVersion.objects.filter(sha256=record.source_sha256).select_related("asset")
        record.django_versions = [
            {"assetId": v.asset.asset_id, "number": v.number, "status": v.status} for v in matches
        ]
        record.outcome = "in_django" if record.django_versions else "not_in_django"


def run(bucket: LegacyBucket, *, mode: str, export_file: Path | None) -> AssetMigration:
    if mode not in (INVENTORY, DRY_RUN, COPY):
        raise ValueError("Unknown mode.")
    if mode != INVENTORY and export_file is None:
        raise ManifestError("A dry run or a copy needs the Amplify asset export (--export).")
    migration = AssetMigration(mode=mode, bucket=bucket.bucket)
    migration.versions = bucket.version_summary()

    with tempfile.TemporaryDirectory(prefix="amp04-assets-") as scratch:
        root = Path(scratch)
        for item in bucket.list():
            record = ObjectRecord(item.key, item.size, item.etag, item.last_modified)
            migration.records.append(record)
            target = None if mode == INVENTORY else root / item.key
            try:
                read = bucket.read(item.key, into=target)
            except LegacyBucketError as error:
                record.outcome, record.detail = "read_failed", str(error)
                continue
            record.source_sha256, record.source_version_id = read.sha256, read.version_id
            record.etag_matches = etag_matches(item.etag, read.md5)
            if read.size != item.size or record.etag_matches is False:
                record.outcome = "read_failed" if read.size != item.size else "integrity_failed"
                if target is not None:
                    target.unlink(missing_ok=True)  # never import a partial or damaged file
        if mode != INVENTORY:
            report = import_amplify(export_file, root, dry_run=mode != COPY)
            migration.import_report = report.as_dict()
            if mode == COPY:
                migration.created_definitions = list(report.created_definitions)
                migration.created_versions = _created_versions(report.imported)
    _reconcile(migration.records)
    return migration


def _created_versions(imported: list[dict]) -> list[dict]:
    created = []
    for item in imported:
        version = (
            AssetVersion.objects.filter(
                asset__asset_id=item.get("asset"), number=item.get("version")
            )
            .select_related("asset")
            .first()
        )
        if version is None:
            continue
        created.append(
            {
                "assetId": version.asset.asset_id,
                "number": version.number,
                "versionId": str(version.version_id),
                "sha256": version.sha256,
                "storageKey": version.storage_key,
                "amplifyVersion": item.get("amplify_version"),
                "verified": services.verify_version(version) is None,
            }
        )
    return created


# --- rollback -----------------------------------------------------------------------------------


@dataclass
class RollbackReport:
    confirmed: bool
    outcomes: list[dict] = field(default_factory=list)
    definitions_to_review: list[str] = field(default_factory=list)

    def summary(self) -> dict:
        return dict(sorted(Counter(item["outcome"] for item in self.outcomes).items()))


def rollback(manifest: dict, *, confirm: bool) -> RollbackReport:
    """Delete the never-published versions a copy run created (`delete_unpublished_version`).

    A version that has been published since is kept (`published`): published versions are never
    deleted (ADR-043). Definitions the run created are listed for review in Django Admin rather
    than deleted, since content may already reference them.
    """
    if manifest.get("kind") != "asset-objects":
        raise ManifestError("This is not an asset object migration manifest.")
    section = manifest.get("rollback") or {}
    report = RollbackReport(
        confirmed=confirm, definitions_to_review=list(section.get("createdDefinitions") or [])
    )
    for entry in section.get("createdVersions") or []:
        version_id = entry.get("versionId") if isinstance(entry, dict) else None
        try:
            version = AssetVersion.objects.filter(version_id=UUID(str(version_id))).first()
        except ValueError:
            report.outcomes.append({"versionId": version_id, "outcome": "invalid_entry"})
            continue
        if version is None:
            outcome = "already_gone"
        elif version.was_published:
            outcome = "published"
        elif version.sha256 != entry.get("sha256"):
            outcome = "changed_since"
        elif not confirm:
            outcome = "would_delete"
        else:
            try:
                services.delete_unpublished_version(version)
                outcome = "deleted"
            except services.AssetActionRefused:
                outcome = "published"
        report.outcomes.append({"versionId": str(version_id), "outcome": outcome})
    report.definitions_to_review = [
        asset_id
        for asset_id in report.definitions_to_review
        if ContentAsset.objects.filter(asset_id=asset_id).exists()
    ]
    return report
