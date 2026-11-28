"""Reusable materials over published textures (LAI-ENV-02; `docs/ENVIRONMENT_ASSETS.md` s.4).

A material is a `ContentAsset` of kind `material` (identity, name, status, retirement) plus a
`MaterialDefinition` row whose content is versioned through ADR-047 `ContentRevision`s of kind
`material`. This module is the material's `authoring.Kind`: how a body is read, checked and
applied. It also builds the resolver's material entry and registers the `materials` dependency
provider (a texture used by a material, and through it by 3D Areas).

Every map is optional. A map names a texture asset by id only (never a version, URL or key), so
it is served that texture's default version, like every placement.
"""

from __future__ import annotations

import copy

from apps.catalog.models import AssetStatus, ContentAsset

from . import image_profiles

KIND = "material"
SCHEMA = image_profiles.SCHEMA

#: Map slots. Colour slots need a SURFACE (sRGB) texture; data slots a MATERIAL_MAP with the
#: matching channel (linear).
COLOUR_SLOTS = ("baseColor", "emissive")
DATA_SLOTS = {
    "normal": "NORMAL",
    "roughness": "ROUGHNESS",
    "metalness": "METALNESS",
    "occlusion": "OCCLUSION",
    "orm": "ORM",
    "opacity": "OPACITY",
    "height": "HEIGHT",
}
SLOTS = (*COLOUR_SLOTS, *DATA_SLOTS)
#: A packed ORM map replaces these three.
ORM_PARTS = ("occlusion", "roughness", "metalness")

DEFAULT_FACTORS = {
    "baseColor": 0xFFFFFF,
    "roughness": 1.0,
    "metalness": 0.0,
    "emissive": 0x000000,
    "emissiveIntensity": 1.0,
    "opacity": 1.0,
    "occlusionStrength": 1.0,
}
COLOUR_FACTORS = ("baseColor", "emissive")
UNIT_FACTORS = ("roughness", "metalness", "opacity", "occlusionStrength")
DEFAULT_UV = {"metresPerRepeat": None, "repeat": [1.0, 1.0], "rotationDegrees": 0, "offset": [0, 0]}
TOP_KEYS = {"materialId", "maps", "factors", "alphaMode", "alphaCutoff", "doubleSided", "uv"}
MAP_KEYS = {"assetId", "scale"}


def blank_maps() -> dict:
    """Every slot, empty (`assetId: ""` means no map), so the structured editor shows them all."""
    return {
        slot: ({"assetId": "", "scale": 1.0} if slot == "normal" else {"assetId": ""})
        for slot in SLOTS
    }


def empty_body(material_id: str) -> dict:
    return {
        "materialId": material_id,
        "maps": blank_maps(),
        "factors": dict(DEFAULT_FACTORS),
        "alphaMode": "OPAQUE",
        "alphaCutoff": 0.5,
        "doubleSided": False,
        "uv": copy.deepcopy(DEFAULT_UV),
    }


def map_asset_slots(body) -> dict[str, str]:
    """Slot -> texture id for every slot that names a texture."""
    maps = body.get("maps") if isinstance(body, dict) else None
    if not isinstance(maps, dict):
        return {}
    return {
        slot: entry["assetId"]
        for slot in SLOTS
        if isinstance(entry := maps.get(slot), dict)
        and isinstance(entry.get("assetId"), str)
        and entry["assetId"]
    }


def map_asset_ids(body) -> list[str]:
    """Texture ids a body names, in slot order, without repeats."""
    maps = body.get("maps") if isinstance(body, dict) else None
    if not isinstance(maps, dict):
        return []
    found = []
    for slot in SLOTS:
        entry = maps.get(slot)
        if isinstance(entry, dict) and isinstance(entry.get("assetId"), str) and entry["assetId"]:
            found.append(entry["assetId"])
    return list(dict.fromkeys(found))


def _is_number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def body_problems(body, *, check_assets: bool = True) -> list[str]:
    """Every problem with a material body, as `$.path: message` lines (ADR-047 style)."""
    problems: list[str] = []
    if not isinstance(body, dict):
        return ["$: must be a JSON object"]
    unknown = set(body) - TOP_KEYS
    if unknown:
        problems.append(f"$: unknown keys {', '.join(sorted(unknown))}")

    maps = body.get("maps", {})
    if not isinstance(maps, dict):
        problems.append("$.maps: must be an object of slot -> {assetId}")
        maps = {}
    for slot, entry in maps.items():
        where = f"$.maps.{slot}"
        if slot not in SLOTS:
            problems.append(f"{where}: unknown slot; use {', '.join(SLOTS)}")
            continue
        if entry is None or (isinstance(entry, dict) and entry.get("assetId") == ""):
            continue  # an empty slot
        if not isinstance(entry, dict) or not isinstance(entry.get("assetId"), str):
            problems.append(f'{where}: must be {{"assetId": "..."}} or null')
            continue
        if set(entry) - MAP_KEYS:
            problems.append(f"{where}: unknown keys {', '.join(sorted(set(entry) - MAP_KEYS))}")
        if "scale" in entry and not (_is_number(entry["scale"]) and 0 <= entry["scale"] <= 10):
            problems.append(f"{where}.scale: must be a number from 0 to 10")
        if check_assets:
            problems.extend(_map_asset_problems(where, slot, entry["assetId"]))
    named = set(map_asset_slots(body))
    if "orm" in named and named & set(ORM_PARTS):
        problems.append(
            "$.maps.orm: a packed ORM map replaces occlusion, roughness and "
            "metalness; remove those or the ORM map"
        )

    factors = body.get("factors", {})
    if not isinstance(factors, dict):
        problems.append("$.factors: must be an object")
        factors = {}
    for name, value in factors.items():
        where = f"$.factors.{name}"
        if name not in DEFAULT_FACTORS:
            problems.append(f"{where}: unknown factor")
        elif name in COLOUR_FACTORS:
            if not (
                isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= 0xFFFFFF
            ):
                problems.append(f"{where}: must be a colour from 0 to 16777215")
        elif name in UNIT_FACTORS:
            if not (_is_number(value) and 0 <= value <= 1):
                problems.append(f"{where}: must be a number from 0 to 1")
        elif not (_is_number(value) and 0 <= value <= 100):  # emissiveIntensity
            problems.append(f"{where}: must be a number from 0 to 100")

    if body.get("alphaMode", "OPAQUE") not in image_profiles.ALPHA_MODES:
        problems.append(f"$.alphaMode: must be one of {', '.join(image_profiles.ALPHA_MODES)}")
    cutoff = body.get("alphaCutoff", 0.5)
    if not (_is_number(cutoff) and 0 <= cutoff <= 1):
        problems.append("$.alphaCutoff: must be a number from 0 to 1")
    if not isinstance(body.get("doubleSided", False), bool):
        problems.append("$.doubleSided: must be true or false")
    problems.extend(_uv_problems(body.get("uv", DEFAULT_UV)))
    return problems


def _pair(value, low, high) -> bool:
    return (
        isinstance(value, list)
        and len(value) == 2
        and all(_is_number(v) and low <= v <= high for v in value)
    )


def _uv_problems(uv) -> list[str]:
    if not isinstance(uv, dict):
        return ["$.uv: must be an object"]
    problems = []
    unknown = set(uv) - set(DEFAULT_UV)
    if unknown:
        problems.append(f"$.uv: unknown keys {', '.join(sorted(unknown))}")
    metres = uv.get("metresPerRepeat")
    if metres is not None and not (_is_number(metres) and 0 < metres <= 1000):
        problems.append("$.uv.metresPerRepeat: must be a positive number of metres, or null")
    if "repeat" in uv and not _pair(
        uv["repeat"], image_profiles.MIN_REPEAT, image_profiles.MAX_REPEAT
    ):
        problems.append("$.uv.repeat: must be [u, v], each from 0.01 to 1000")
    if "offset" in uv and not _pair(uv["offset"], -1, 1):
        problems.append("$.uv.offset: must be [u, v], each from -1 to 1")
    rotation = uv.get("rotationDegrees", 0)
    if not (_is_number(rotation) and 0 <= rotation < 360):
        problems.append("$.uv.rotationDegrees: must be from 0 to 359")
    return problems


def _map_asset_problems(where: str, slot: str, asset_id: str) -> list[str]:
    asset = ContentAsset.objects.filter(asset_id=asset_id).first()
    if asset is None:
        return [f"{where}.assetId: unknown asset {asset_id!r}"]
    if asset.kind != "texture":
        return [f"{where}.assetId: {asset_id!r} is a {asset.kind}, not a texture"]
    if asset.status != AssetStatus.ACTIVE:
        return [f"{where}.assetId: {asset_id!r} is retired"]
    from .licences import licence_problem

    if asset.default_version_id is not None:
        problem = licence_problem(asset.default_version)
        if problem is not None:  # D-3: published realm content needs a licensed texture
            return [f"{where}.assetId: {asset_id!r} cannot be used yet: {problem}"]
    profile = asset.image_profiles.filter(version__isnull=True).first()
    if slot in COLOUR_SLOTS:
        if profile is not None and profile.role != image_profiles.SURFACE:
            return [
                f"{where}.assetId: {asset_id!r} is a {profile.role.lower()} image; a "
                f"{slot} map needs a surface (colour, sRGB) texture"
            ]
        return []
    channel = DATA_SLOTS[slot]
    if profile is None:
        return [
            f"{where}.assetId: {asset_id!r} has no image profile. Give it the Material map "
            f"role with the {channel.lower()} channel, so it is read as data, not colour"
        ]
    if profile.role != image_profiles.MATERIAL_MAP or profile.data_channel != channel:
        return [f"{where}.assetId: {asset_id!r} is not a {channel.lower()} material map"]
    return []


def normalized(body: dict) -> dict:
    """The body with defaults filled in and empty slots removed (what the row and runtime see)."""
    out = empty_body(body.get("materialId", ""))
    out["maps"] = {
        slot: {k: v for k, v in entry.items() if k in MAP_KEYS}
        for slot, entry in (body.get("maps") or {}).items()
        if slot in SLOTS and isinstance(entry, dict) and entry.get("assetId")
    }
    out["factors"].update(
        {k: v for k, v in (body.get("factors") or {}).items() if k in DEFAULT_FACTORS}
    )
    for key in ("alphaMode", "alphaCutoff", "doubleSided"):
        if key in body:
            out[key] = body[key]
    out["uv"].update({k: v for k, v in (body.get("uv") or {}).items() if k in DEFAULT_UV})
    return out


# --- authoring.Kind (registered from AssetsConfig.ready) ----------------------------------------


def read_body(row) -> dict:
    """The published body with every empty slot shown, for the structured editor."""
    if not row.definition:
        return empty_body(row.asset.asset_id)
    body = {"materialId": row.asset.asset_id, **copy.deepcopy(row.definition)}
    body["maps"] = {**blank_maps(), **body.get("maps", {})}
    return body


def apply(row, body: dict, problems: list[str]):
    problems.extend(body_problems(body))
    if row.asset.kind != KIND:
        problems.append(f"$: {row.asset.asset_id!r} is a {row.asset.kind}, not a material")
    if problems:
        return lambda: None
    clean = normalized(body)
    clean.pop("materialId", None)

    def finish() -> None:
        row.definition = clean
        row.texture_asset_ids = map_asset_ids(clean)
        row.save(update_fields=["definition", "texture_asset_ids", "updated_at"])

    return finish


def register_kind() -> None:
    from apps.catalog.authoring import Kind, register

    from .models import MaterialDefinition

    register(
        Kind(
            name=KIND,
            model=MaterialDefinition,
            key_field="material_id",
            body_key="materialId",
            schema_definition=None,
            read_body=read_body,
            apply=apply,
            child_facing_paths=(),  # no child-readable text in a material
        )
    )


# --- Resolver ------------------------------------------------------------------------------------


def resolved_entry(ref: str, asset: ContentAsset, definition, image_entries: dict) -> dict:
    """A material's resolver entry. `definition` is its `MaterialDefinition` (or None);
    `image_entries` holds each map texture's own resolver entry."""
    base = {"ref": ref, "id": asset.asset_id}
    if asset.status == AssetStatus.RETIRED:
        return {**base, "status": "retired"}
    revision = getattr(definition, "published_revision", None) if definition else None
    if definition is None or revision is None or not definition.definition:
        return {**base, "status": "unavailable"}
    body = definition.definition
    maps = {}
    for slot, entry in body.get("maps", {}).items():
        texture = image_entries.get(entry["assetId"]) or {
            "id": entry["assetId"],
            "status": "unavailable",
        }
        texture = {k: v for k, v in texture.items() if k != "ref"}
        if "scale" in entry:
            texture = {**texture, "scale": entry["scale"]}
        maps[slot] = texture
    from .delivery import ttl

    return {
        **base,
        "status": "resolved",
        "kind": KIND,
        "category": asset.category,
        "family": KIND,
        "version": revision.number,
        "revisionId": str(revision.pk),
        "cache": {"key": f"{asset.asset_id}@{revision.pk}", "immutable": True, "ttl": ttl()},
        "material": {
            "schema": SCHEMA,
            "factors": body.get("factors", dict(DEFAULT_FACTORS)),
            "alphaMode": body.get("alphaMode", "OPAQUE"),
            "alphaCutoff": body.get("alphaCutoff", 0.5),
            "doubleSided": body.get("doubleSided", False),
            "uv": body.get("uv", copy.deepcopy(DEFAULT_UV)),
            "maps": maps,
        },
    }
