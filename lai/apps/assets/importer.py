"""Import bundled models into the asset library (LAI-2200 AM-8; `docs/ASSET_LIBRARY.md` s. 11).

Every export-origin definition whose `bundled_path` exists under `react/public`. Idempotent (a
file whose SHA-256 is already a version of the asset is skipped), and it produces `VALIDATED`
versions only (publishing stays an administrator's decision).

Nothing is deleted, in Django or S3, and no gameplay reference changes. Anything that cannot be
imported is listed as unresolved with a reason. `dry_run` reads, checksums and validates but
writes nothing.
"""

from dataclasses import dataclass, field
from pathlib import Path

from django.conf import settings

from apps.catalog.models import AssetOrigin, AssetStatus, ContentAsset

from . import services
from .models import VersionStatus
from .storage import sha256_of
from .validation import validate_upload


@dataclass
class ImportReport:
    dry_run: bool
    imported: list[dict] = field(default_factory=list)
    skipped: list[dict] = field(default_factory=list)
    unresolved: list[dict] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "dry_run": self.dry_run,
            "imported": self.imported,
            "skipped": self.skipped,
            "unresolved": self.unresolved,
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
        )
        if existing is not None:
            report.skipped.append({**source, "asset": asset.asset_id, "version": existing})
            return
        if dry_run:
            result = validate_upload(stream, size=size, definition=asset)
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


def import_bundled(
    *, root: Path | None = None, dry_run: bool = False, ids: list[str] | None = None
) -> ImportReport:
    """Every export-origin definition with a bundled file, or only `ids` when given.

    An id in `ids` that is not such a definition is listed as unresolved (`unknown_asset`), so a
    typo in a deployment command is reported instead of silently importing nothing.
    """
    root = root or default_public_root()
    report = ImportReport(dry_run=dry_run)
    assets = ContentAsset.objects.filter(origin=AssetOrigin.EXPORT).exclude(bundled_path="")
    if ids is not None:
        assets = assets.filter(asset_id__in=ids)
        known = set(assets.values_list("asset_id", flat=True))
        for asset_id in sorted(set(ids) - known):
            report.unresolved.append(
                {"source": "bundled", "asset": asset_id, "reason": "unknown_asset"}
            )
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
