"""Import existing models into the asset manager (LAI-2200 AM-8; `docs/ASSET_MANAGER.md` s. 11).

Two sources, both idempotent (a file whose SHA-256 is already a version of the asset is skipped),
both producing `VALIDATED` versions only (publishing stays an administrator's decision):

- **Bundled**: every export-origin definition whose `bundled_path` exists under `react/public`.
- **Amplify**: a JSON export of Amplify `Asset` records with their `versions` (the read-only
  export of LAI-1101), plus a directory holding the downloaded files, found by `s3Key` or
  `fileName`. The Amplify `slug` is the asset id (ADR-030). Missing definitions are created
  (`origin=DJANGO`); existing ones keep their fields. Amplify version numbers are not reused:
  Django numbers versions itself and the report maps one to the other.

Nothing is deleted, in Django, S3 or Amplify, and no gameplay reference changes. Anything that
cannot be imported is listed as unresolved with a reason. `dry_run` reads, checksums and
validates but writes nothing.
"""

import json
import re
from dataclasses import dataclass, field
from pathlib import Path

from django.conf import settings

from apps.catalog.models import AssetCategory, AssetOrigin, AssetStatus, ContentAsset

from . import services
from .models import VersionStatus
from .storage import sha256_of
from .validation import validate_model

ASSET_ID = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")

# Amplify `AssetCategory` to (runtime kind, browsing category).
AMPLIFY_CATEGORIES = {
    "CHARACTER": ("character", AssetCategory.CHARACTER),
    "NPC": ("character", AssetCategory.NPC),
    "CREATURE": ("character", AssetCategory.CREATURE),
    "BUILDING": ("kit-piece", AssetCategory.BUILDING),
    "PROP": ("prop", AssetCategory.PROP),
    "VEGETATION": ("kit-piece", AssetCategory.SCENERY),
    "VEHICLE": ("prop", AssetCategory.VEHICLE),
    "QUEST_ITEM": ("collectible", AssetCategory.COLLECTIBLE),
    "ENVIRONMENT": ("kit-piece", AssetCategory.SCENERY),
    "DECORATION": ("prop", AssetCategory.PROP),
    "OTHER": ("prop", AssetCategory.OTHER),
}


@dataclass
class ImportReport:
    dry_run: bool
    imported: list[dict] = field(default_factory=list)
    skipped: list[dict] = field(default_factory=list)
    unresolved: list[dict] = field(default_factory=list)
    created_definitions: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "dry_run": self.dry_run,
            "imported": self.imported,
            "skipped": self.skipped,
            "unresolved": self.unresolved,
            "created_definitions": self.created_definitions,
        }


def default_public_root() -> Path:
    return Path(settings.BASE_DIR).parent / "react" / "public"


def _inside(root: Path, relative: str) -> Path | None:
    """`root/relative`, or None when it would leave `root` (no `..`, no absolute paths)."""
    root = root.resolve()
    candidate = (root / relative.lstrip("/")).resolve()
    return candidate if root in candidate.parents else None


def _import_file(report, asset, path: Path, source: dict, *, dry_run: bool) -> None:
    with path.open("rb") as stream:
        sha256, size = sha256_of(stream)
        existing = (
            asset.versions.filter(sha256=sha256)
            .exclude(status=VersionStatus.REJECTED)
            .values_list("number", flat=True)
            .first()
            if asset.pk
            else None
        )
        if existing is not None:
            report.skipped.append({**source, "asset": asset.asset_id, "version": existing})
            return
        if dry_run:
            result = validate_model(stream, size=size, definition=asset)
            if result.passed:
                report.imported.append({**source, "asset": asset.asset_id, "version": None})
            else:
                codes = sorted({f.code for f in result.errors})
                report.unresolved.append({**source, "reason": "invalid_model", "codes": codes})
            return
        try:
            version = services.upload_version(asset, stream, original_filename=path.name)
        except services.AssetActionRefused as refused:
            codes = sorted({f.code for f in refused.findings}) or [refused.code]
            report.unresolved.append({**source, "reason": refused.code, "codes": codes})
            return
    report.imported.append({**source, "asset": asset.asset_id, "version": version.number})


def import_bundled(*, root: Path | None = None, dry_run: bool = False) -> ImportReport:
    root = root or default_public_root()
    report = ImportReport(dry_run=dry_run)
    assets = ContentAsset.objects.filter(origin=AssetOrigin.EXPORT).exclude(bundled_path="")
    for asset in assets.order_by("asset_id"):
        source = {"source": "bundled", "path": asset.bundled_path}
        if asset.status != AssetStatus.ACTIVE:
            report.unresolved.append({**source, "asset": asset.asset_id, "reason": "asset_retired"})
            continue
        path = _inside(root, asset.bundled_path)
        if path is None:
            report.unresolved.append({**source, "asset": asset.asset_id, "reason": "unsafe_path"})
        elif not path.is_file():
            report.unresolved.append({**source, "asset": asset.asset_id, "reason": "file_missing"})
        else:
            _import_file(report, asset, path, source, dry_run=dry_run)
    return report


def import_amplify(export_file: Path, files_dir: Path, *, dry_run: bool = False) -> ImportReport:
    report = ImportReport(dry_run=dry_run)
    try:
        records = json.loads(Path(export_file).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        report.unresolved.append({"source": "amplify", "reason": "unreadable_export"})
        return report
    if isinstance(records, dict):
        records = records.get("assets", [])
    if not isinstance(records, list):
        report.unresolved.append({"source": "amplify", "reason": "unreadable_export"})
        return report
    for record in records:
        if not isinstance(record, dict):
            report.unresolved.append({"source": "amplify", "reason": "malformed_record"})
            continue
        slug = str(record.get("slug", ""))
        if not ASSET_ID.fullmatch(slug):
            report.unresolved.append({"source": "amplify", "slug": slug, "reason": "invalid_slug"})
            continue
        asset = _definition_for(report, slug, record, dry_run=dry_run)
        versions = record.get("versions") or [
            {
                "version": record.get("currentVersion"),
                "s3Key": record.get("s3Key"),
                "fileName": record.get("fileName"),
            }
        ]
        for entry in sorted(
            (v for v in versions if isinstance(v, dict)), key=lambda v: _int(v.get("version"))
        ):
            source = {"source": "amplify", "slug": slug, "amplify_version": entry.get("version")}
            path = _amplify_file(files_dir, entry)
            if path is None:
                report.unresolved.append({**source, "reason": "file_missing"})
                continue
            _import_file(report, asset, path, source, dry_run=dry_run)
    return report


def _definition_for(report, slug, record, *, dry_run):
    asset = ContentAsset.objects.filter(asset_id=slug).first()
    if asset is not None:
        return asset
    kind, category = AMPLIFY_CATEGORIES.get(
        str(record.get("category", "OTHER")), AMPLIFY_CATEGORIES["OTHER"]
    )
    asset = ContentAsset(
        asset_id=slug,
        kind=kind,
        category=category,
        origin=AssetOrigin.DJANGO,
        display_name=str(record.get("name", ""))[:120],
        description=str(record.get("description") or "")[:1000],
        tags=["imported-from-amplify"],
    )
    if not dry_run:
        asset.full_clean()
        asset.save()
    report.created_definitions.append(slug)
    return asset


def _amplify_file(files_dir: Path, entry: dict) -> Path | None:
    for name in (entry.get("s3Key"), entry.get("fileName")):
        if isinstance(name, str) and name:
            path = _inside(Path(files_dir), name)
            if path is not None and path.is_file():
                return path
    return None


def _int(value) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) else 0
