"""Release validation: assets (LAI-NPC-003, LAI-NPC-035). Owner: workstream A.

Called by `apps.npcs.validation.release_problems` with the built snapshot; returns problems in
words staff can act on and never raises. Reads only staff-authored rows and the asset library;
never child data.

The snapshot builder (`publishing.snapshot.asset_ref`) already reports, for every reference: a
retired asset, the wrong kind for a model (`character`), a portrait (`image`/`sprite`) or a
recorded line (`audio`), an unpublished pinned or default version, and an asset with neither a
published version nor a bundled path. This module does not repeat those. It adds:

1. **Animation clips.** Every clip an `animationMap` names must exist in the model the release
   resolved: `AssetVersion.clips` of the frozen version, or `ContentAsset.clips` for a
   bundled-only reference (`version: null`).
2. **Extra kinds by role** (the builder accepts any kind for extras):

   - TEXTURE: texture or image;
   - ACCESSORY: prop or character (a model attached at `attachPoint`; a documented choice);
   - PORTRAIT: image or sprite;
   - AUDIO: audio.

3. **Draft rows still pass their own validation.** Every READY character on an active NPC, its
   variants and its active placements must pass `full_clean()` now (a row can go stale after it
   was saved, e.g. a Place moved to another Island or a pinned version re-pointed). This needs
   the database, so it lives here rather than in the pure structure checks.
"""

from __future__ import annotations

from django.core.exceptions import ValidationError

from apps.assets.models import AssetVersion
from apps.catalog.models import ContentAsset

#: Which asset kinds suit each `VariantAssetRole` (see the module docstring).
EXTRA_KINDS: dict[str, tuple[str, ...]] = {
    "TEXTURE": ("texture", "image"),
    "ACCESSORY": ("prop", "character"),
    "PORTRAIT": ("image", "sprite"),
    "AUDIO": ("audio",),
}


def _model_refs(snapshot: dict):
    for npc_id, character in snapshot.get("characters", {}).items():
        for variant in character.get("variants", []):
            yield npc_id, variant


def _load(snapshot: dict) -> tuple[dict[str, ContentAsset], dict[tuple[str, int], AssetVersion]]:
    """Every asset and frozen version the snapshot names, in two queries."""
    ids: set[str] = set()
    versioned: set[tuple[str, int]] = set()
    for _npc_id, variant in _model_refs(snapshot):
        refs = [variant.get("model"), *(e.get("asset") for e in variant.get("extras", []))]
        for ref in refs:
            if ref:
                ids.add(ref["assetId"])
                if ref.get("version") is not None:
                    versioned.add((ref["assetId"], ref["version"]))
    assets = {a.asset_id: a for a in ContentAsset.objects.filter(asset_id__in=ids)}
    versions = {
        (v.asset.asset_id, v.number): v
        for v in AssetVersion.objects.filter(
            asset__asset_id__in={a for a, _ in versioned}
        ).select_related("asset")
        if (v.asset.asset_id, v.number) in versioned
    }
    return assets, versions


def clip_problems(snapshot: dict, assets=None, versions=None) -> list[str]:
    if assets is None or versions is None:
        assets, versions = _load(snapshot)
    found: list[str] = []
    for npc_id, variant in _model_refs(snapshot):
        ref = variant.get("model")
        mapping = variant.get("animationMap") or {}
        if not ref or not mapping or ref["assetId"] not in assets:
            continue
        where = f"{npc_id} variant {variant['variantKey']} animation map"
        if ref.get("version") is not None:
            version = versions.get((ref["assetId"], ref["version"]))
            if version is None:
                continue  # the builder already reported the missing version
            clips, source = list(version.clips), f"{ref['assetId']} v{ref['version']}"
        else:
            clips, source = list(assets[ref["assetId"]].clips), f"{ref['assetId']} (bundled)"
        available = ", ".join(clips) if clips else "none"
        for state, clip in sorted(mapping.items()):
            if clip not in clips:
                found.append(
                    f"{where}: {state} uses clip {clip!r}, which {source} does not have "
                    f"(available clips: {available})"
                )
    return found


def extra_kind_problems(snapshot: dict, assets=None) -> list[str]:
    if assets is None:
        assets, _versions = _load(snapshot)
    found: list[str] = []
    for npc_id, variant in _model_refs(snapshot):
        for extra in variant.get("extras", []):
            ref, role = extra.get("asset"), extra.get("role")
            asset = assets.get(ref["assetId"]) if ref else None
            allowed = EXTRA_KINDS.get(role, ())
            if asset is not None and asset.kind not in allowed:
                found.append(
                    f"{npc_id} variant {variant['variantKey']} {str(role).lower()}: asset "
                    f"{asset.asset_id} is a {asset.kind}, expected {' or '.join(allowed)}"
                )
    return found


def _messages(error: ValidationError) -> list[str]:
    if hasattr(error, "error_dict"):
        return [
            f"{name}: {message}"
            for name, messages in error.message_dict.items()
            for message in messages
        ]
    return list(error.messages)


def draft_row_problems() -> list[str]:
    """Every READY character, its variants and active placements must still pass full_clean."""
    from ..models import NpcCharacter, NpcPlacement
    from ..vocabulary import CharacterStatus

    found: list[str] = []
    characters = (
        NpcCharacter.objects.filter(status=CharacterStatus.READY, definition__active=True)
        .select_related("definition")
        .prefetch_related("variants__model_asset", "variants__pinned_version")
        .order_by("definition__npc_id")
    )
    ready_pks = []
    for character in characters:
        ready_pks.append(character.pk)
        rows = [(character.slug, character)]
        rows += [(f"{character.slug} variant {v.variant_key}", v) for v in character.variants.all()]
        for where, row in rows:
            try:
                row.full_clean()
            except ValidationError as error:
                found.extend(f"{where}: {message}" for message in _messages(error))
    placements = (
        NpcPlacement.objects.filter(active=True, character__in=ready_pks)
        .select_related("location", "world", "region", "variant", "character")
        .order_by("location__slug", "placement_key")
    )
    for placement in placements:
        try:
            placement.full_clean()
        except ValidationError as error:
            where = f"placement {placement.location.slug}/{placement.placement_key}"
            found.extend(f"{where}: {message}" for message in _messages(error))
    return found


def problems(snapshot: dict) -> list[str]:
    assets, versions = _load(snapshot)
    return [
        *clip_problems(snapshot, assets, versions),
        *extra_kind_problems(snapshot, assets),
        *draft_row_problems(),
    ]
