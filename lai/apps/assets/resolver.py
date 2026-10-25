"""Published-asset resolution (LAI-2200 AM-6; `docs/ASSET_MANAGER.md` sections 7 and 9).

A reference is `asset-id` (the definition's default version) or `asset-id@n` (pinned). Only
published data leaves this module: never drafts, validation reports, storage keys or who uploaded
what. Two queries per call whatever the number of references.
"""

import re
from functools import reduce
from operator import or_

from django.db.models import Q

from apps.catalog.models import AssetStatus, ContentAsset

from .delivery import deliver, ttl
from .models import AssetVersion, VersionStatus

REFERENCE = re.compile(r"^(?P<id>[a-z0-9]+(?:-[a-z0-9]+)*)(?:@(?P<number>[1-9][0-9]{0,5}))?$")
MAX_REFERENCES = 100


class BadReferences(ValueError):
    pass


def parse_references(raw: str) -> list[tuple[str, str, int | None]]:
    """`"a,b@2"` to `[("a", "a", None), ("b@2", "b", 2)]`, deduplicated, order kept."""
    parts = [part.strip() for part in (raw or "").split(",") if part.strip()]
    if not parts:
        raise BadReferences("Give at least one asset id in `ids`.")
    parts = list(dict.fromkeys(parts))
    if len(parts) > MAX_REFERENCES:
        raise BadReferences(f"At most {MAX_REFERENCES} asset ids per request.")
    references = []
    for part in parts:
        match = REFERENCE.fullmatch(part)
        if not match:
            raise BadReferences("Asset ids are lowercase words joined by hyphens, optionally @n.")
        number = match.group("number")
        references.append((part, match.group("id"), int(number) if number else None))
    return references


def resolve(references: list[tuple[str, str, int | None]]) -> list[dict]:
    ids = {asset_id for _ref, asset_id, _n in references}
    assets = {
        asset.asset_id: asset
        for asset in ContentAsset.objects.filter(asset_id__in=ids).select_related("default_version")
    }
    pins = {(asset_id, n) for _ref, asset_id, n in references if n is not None}
    pinned: dict[tuple[str, int], AssetVersion] = {}
    if pins:
        condition = reduce(or_, (Q(asset__asset_id=a, number=n) for a, n in pins))
        for version in AssetVersion.objects.filter(
            condition, status__in=[VersionStatus.PUBLISHED, VersionStatus.RETIRED]
        ).select_related("asset"):
            pinned[(version.asset.asset_id, version.number)] = version
    return [
        _entry(ref, asset_id, number, assets.get(asset_id), pinned)
        for ref, asset_id, number in references
    ]


def _entry(ref, asset_id, number, asset, pinned) -> dict:
    base = {"ref": ref, "id": asset_id}
    if asset is None:
        return {**base, "status": "unavailable"}
    if asset.status == AssetStatus.RETIRED:
        return {**base, "status": "retired"}
    version = pinned.get((asset_id, number)) if number is not None else asset.default_version
    if version is None or version.status not in (VersionStatus.PUBLISHED, VersionStatus.RETIRED):
        return {**base, "status": "unavailable"}
    if version.status == VersionStatus.RETIRED:
        return {**base, "status": "retired"}
    delivery = deliver(version)
    return {
        **base,
        "status": "resolved",
        "kind": asset.kind,
        "category": asset.category,
        "version": version.number,
        "versionId": str(version.version_id),
        "sha256": version.sha256,
        "format": version.format,
        "contentType": version.content_type,
        "sizeBytes": version.size_bytes,
        "url": delivery.url,
        "urlExpiresAt": delivery.expires_iso,
        "clips": list(version.clips),
        "dimensions": version.dimensions,
        "cache": {"key": f"{asset_id}@{version.version_id}", "immutable": True, "ttl": ttl()},
    }
