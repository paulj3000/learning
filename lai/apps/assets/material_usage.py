"""Which materials use a texture, and where those materials are used (LAI-ENV-02; s.25).

Registered with the dependency registry from `AssetsConfig.ready()` as the `materials` source,
classified AUTHORITATIVE: a failed check could hide a published material that draws the texture.

Rules (`docs/ENVIRONMENT_ASSETS.md` section 4, and ASSET_LIBRARY.md s.25 for the registry):

- Retiring a texture **asset** is refused while an ACTIVE material's published content names it
  in any map slot. Children would lose that map wherever the material is drawn.
- The use is followed one step further: the material's own usages (3D Areas, shipped scenes,
  any registered source) are listed in the label and `details["usedBy"]`, so staff see the 3D
  Areas a texture reaches through a material. Whether the material itself may be retired is
  decided when the material is retired, by those same sources.
- Drafts and submitted versions that name the texture are reported, never blocking. A retired
  material is historical.
- Retiring a texture **version** is unchanged: materials name an asset id, so they are served
  the default version, which cannot be retired without a replacement. Asked about the default
  version, materials are reported, never blocking.

Read-only, ids and slugs only in labels (no child data).
"""

from __future__ import annotations

from django.urls import NoReverseMatch, reverse

from apps.catalog.models import AssetStatus, ContentAsset, ContentRevision, RevisionStatus

from . import materials
from .dependencies import (
    CheckClass,
    DependencyCheckFailed,
    Usage,
    check_class,
    register_usage_provider,
    usages_by_source,
)

SOURCE = "materials"
REFUSAL_CODE = "material_dependency"


def _admin_url(definition) -> str:
    try:
        return reverse("admin:assets_materialdefinition_change", args=[definition.pk])
    except NoReverseMatch:  # admin not mounted (some test settings)
        return ""


def _material_uses(material_asset: ContentAsset) -> list[Usage]:
    """Every non-material usage of a material (3D Areas, shipped scenes...). An authoritative
    source that cannot answer makes this check fail too (fail closed)."""
    found: list[Usage] = []
    for entry in usages_by_source(material_asset):
        if entry.source == SOURCE:
            continue
        if entry.failed:
            if check_class(entry.source) == CheckClass.INFORMATIONAL:
                continue
            raise DependencyCheckFailed(entry.source)
        found.extend(entry.usages)
    return found


def usages(asset, version=None):
    from .models import MaterialDefinition

    if asset.kind != "texture" or not asset.asset_id:
        return []
    if version is not None and asset.default_version_id != version.pk:
        return []  # materials are only ever served the texture's default version
    found: list[Usage] = []
    rows = (
        MaterialDefinition.objects.filter(texture_asset_ids__contains=[asset.asset_id])
        .select_related("asset", "published_revision")
        .order_by("asset__asset_id")
    )
    for row in rows:
        slots = [
            slot
            for slot, entry in (row.definition.get("maps") or {}).items()
            if isinstance(entry, dict) and entry.get("assetId") == asset.asset_id
        ]
        active = row.asset.status == AssetStatus.ACTIVE
        published = row.published_revision_id is not None
        reached = _material_uses(row.asset) if active else []
        where = sorted({u.label for u in reached})
        label = f"Material {row.asset.asset_id} ({', '.join(slots)} map)"
        if where:
            label += f", used by {'; '.join(where)}"
        found.append(
            Usage(
                SOURCE,
                REFUSAL_CODE,
                label,
                blocks_retirement=active and published and version is None,
                historical=not active,
                admin_url=_admin_url(row),
                details={
                    "material": row.asset.asset_id,
                    "slots": slots,
                    "usedBy": [dict(u.details) | {"source": u.source} for u in reached],
                },
            )
        )
    # Drafts and submitted versions: reported so staff know, never blocking.
    pending = ContentRevision.objects.filter(
        kind=materials.KIND, status__in=[RevisionStatus.DRAFT, RevisionStatus.SUBMITTED]
    ).order_by("record_key", "number")
    for revision in pending:
        if asset.asset_id in materials.map_asset_ids(revision.body):
            found.append(
                Usage(
                    SOURCE,
                    REFUSAL_CODE,
                    f"Material {revision.record_key}, {revision.get_status_display().lower()} "
                    f"version {revision.number}",
                    details={"material": revision.record_key, "revision": revision.number},
                )
            )
    return found


def refusal(asset, version, blocking):
    from .services import AssetActionRefused

    named = "; ".join(usage.label for usage in blocking)
    return AssetActionRefused(
        REFUSAL_CODE,
        f'"{asset.asset_id}" is a map of published material(s): {named}. Children would lose '
        "that map wherever the material is drawn. Publish a version of each material without "
        "it, or retire those materials first.",
        details={"materials": sorted({usage.details["material"] for usage in blocking})},
    )


def register() -> None:
    register_usage_provider(SOURCE, usages, refusal=refusal, check_class=CheckClass.AUTHORITATIVE)
