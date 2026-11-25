"""Which 3D Area placements and chests use an asset (LAI-07 W2-3; ASSET_LIBRARY.md s. 25.3).

Registered with `apps.assets.dependencies` from `RegionsConfig.ready()`. Rules: owner decision
2026-11-22 (#246), with engine advice from Agent 4 (Game Engine Core):

- Retiring an **asset** is refused while a PUBLISHED `WorldRegion` names it: in a
  `WorldObjectPlacement` or `TreasureChest` row, or anywhere in its `scene` JSON under `assetId`
  or any `...AssetId` key (backdrop, ground, layout props, vegetation, procedural, scenery,
  jump-platform specs, building wall/roof/door), or in an `assetIds`/`...AssetIds` list.
  A low-detail twin is not followed: no Django region can draw one (owner decision 2026-11-25,
  semantics agreed with LAI 04; `docs/ASSET_LIBRARY.md` section 25.3, `tests/test_lod_twins.py`).
  Children would see the bundled model or a placeholder, and the placement could lose its
  collision (a model the app ships keeps it: `docs/ASSET_LIBRARY.md` section 7, #75).
- Placements in DRAFT or RETIRED 3D Areas are reported only (RETIRED ones as historical).
- A region whose scene names no `groundAssetId` tiles `ground-tile` (the client's default), so it
  uses that asset like any scene id (LAI 01 finding, 2026-11-25; agreed with LAI 04). The ground
  is bundled, so retiring it falls back to the same file; it blocks anyway for consistency, since
  an explicit `groundAssetId: "ground-tile"` already blocks and the implicit one must match.
- Retiring a **version** is unchanged. Placements store an asset id, never a version, so they
  are served the default, and the default cannot be retired without naming a replacement
  (`default_in_use`). Asked about the default version, placements are reported, never blocking.
- An empty `asset_id` (a placeholder on purpose) matches nothing. An NPC placement drawn through
  its NPC definition is the `npcs` provider's job; the `npc` foreign key is not followed here.

Read-only: nothing here changes a region, a seed or the publish flow.
"""

from __future__ import annotations

from django.urls import NoReverseMatch, reverse

from apps.core.content_status import ContentStatus

from .models import TreasureChest, WorldObjectPlacement, WorldRegion

SOURCE = "regions"
REFUSAL_CODE = "region_placement_dependency"
#: The ground a region tiles when its scene names none: `DEFAULT_GROUND_ASSET_ID` in
#: `react/src/features/region-play/regionManifest.ts` (`ground()`). Keep the two equal.
DEFAULT_GROUND_ASSET_ID = "ground-tile"
DEFAULT_GROUND_PATH = "groundAssetId (default ground-tile)"


def _admin_url(region) -> str:
    try:
        return reverse("admin:regions_worldregion_change", args=[region.pk])
    except NoReverseMatch:  # admin not mounted (some test settings)
        return ""


def _is_asset_key(key) -> bool:
    """`assetId` or any `...AssetId` (ground, wall, roof, door, plank: the client manifest's
    names). Over-matching only over-blocks, the safe side of a fail-closed guard."""
    return isinstance(key, str) and (key == "assetId" or key.endswith("AssetId"))


def _is_asset_list_key(key) -> bool:
    """`assetIds` or any `...AssetIds`: a list of asset ids (extension declarations)."""
    return isinstance(key, str) and (key == "assetIds" or key.endswith("AssetIds"))


def scene_asset_ids(scene) -> dict[str, list[str]]:
    """Every asset id a `scene` names, with the JSON paths naming it (`layout.props[2].assetId`).

    Pure: walks dicts and lists only, ignores non-string and empty values."""
    found: dict[str, list[str]] = {}

    def walk(node, path: str) -> None:
        if isinstance(node, dict):
            for key, value in node.items():
                here = f"{path}.{key}" if path else str(key)
                if _is_asset_key(key) and isinstance(value, str) and value:
                    found.setdefault(value, []).append(here)
                elif _is_asset_list_key(key) and isinstance(value, list):
                    for index, item in enumerate(value):
                        if isinstance(item, str) and item:
                            found.setdefault(item, []).append(f"{here}[{index}]")
                else:
                    walk(value, here)
        elif isinstance(node, list):
            for index, value in enumerate(node):
                walk(value, f"{path}[{index}]")

    walk(scene, "")
    return found


def _draws_default_ground(scene) -> bool:
    """The client tiles `DEFAULT_GROUND_ASSET_ID` unless `scene.groundAssetId` is a non-empty
    string (`regionManifest.ts`), so such a region uses that asset although its JSON never
    names it."""
    ground = scene.get("groundAssetId") if isinstance(scene, dict) else None
    return not (isinstance(ground, str) and ground)


def _rows(asset):
    placements = WorldObjectPlacement.objects.filter(asset_id=asset.asset_id).select_related(
        "region"
    )
    chests = TreasureChest.objects.filter(asset_id=asset.asset_id).select_related("region")
    rows = [("placement", row.region, row.entity_id) for row in placements]
    rows += [("chest", row.region, row.entity_id) for row in chests]
    for region in WorldRegion.objects.all():
        paths = list(scene_asset_ids(region.scene).get(asset.asset_id, []))
        if asset.asset_id == DEFAULT_GROUND_ASSET_ID and _draws_default_ground(region.scene):
            paths.append(DEFAULT_GROUND_PATH)
        if paths:
            more = f" and {len(paths) - 1} more" if len(paths) > 1 else ""
            rows.append(("scene", region, f"{paths[0]}{more}"))
    return sorted(rows, key=lambda item: (item[1].region_id, item[0], item[2]))


def usages(asset, version=None):
    from apps.assets.dependencies import Usage

    if not asset.asset_id:
        return []
    if version is not None and asset.default_version_id != version.pk:
        return []  # placements are only ever served the default version
    found = []
    for what, region, entity in _rows(asset):
        published = region.status == ContentStatus.PUBLISHED
        found.append(
            Usage(
                SOURCE,
                REFUSAL_CODE,
                f"3D Area {region.region_id} ({region.get_status_display().lower()}), "
                f"{what} {entity}",
                blocks_retirement=published and version is None,
                historical=region.status == ContentStatus.RETIRED,
                admin_url=_admin_url(region),
                details={"region": region.region_id, what: entity},
            )
        )
    return found


def refusal(asset, version, blocking):
    from apps.assets.services import AssetActionRefused

    regions = sorted({usage.details["region"] for usage in blocking})
    named = ", ".join(usage.label for usage in blocking)
    return AssetActionRefused(
        REFUSAL_CODE,
        f'"{asset.asset_id}" is used by published 3D Area(s): {named}. Children would see the '
        "bundled model or a placeholder, and could lose its collision. Remove or change those "
        "uses, or make the 3D Area a draft, before retiring it.",
        details={"regions": regions, "placements": [dict(usage.details) for usage in blocking]},
    )


def register() -> None:
    from apps.assets.dependencies import register_usage_provider

    register_usage_provider(SOURCE, usages, refusal=refusal)
