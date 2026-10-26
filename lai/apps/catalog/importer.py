"""Idempotent import of the versioned content export into the catalog (LAI-0304).

Three stages, so a bad export never reaches the database:

1. `read_export` verifies the files are exactly what the TypeScript exporter produced and
   validated against its JSON Schema: every file's sha256 must match the manifest, and the
   content digest is recomputed from them (`react/src/features/content-export/files.ts`).
2. `build_plan` checks every record and relationship the catalog imports, without touching
   the database, and collects every problem rather than stopping at the first.
3. `import_content` applies the plan in one transaction, under an advisory lock so two loads
   cannot interleave. Any error rolls the whole import back.

Until the content authoring cutover (ADR-019 sub-decision 8 amendment) the export is
authoritative for content fields. Catalog fields (`active`, `sort_order`) are set only when a
row is created. Nothing is deleted: a record a newer export lacks keeps its row, and its
`last_seen_release` shows it is not in the latest release.
"""

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from django.conf import settings
from django.db import connection, transaction

from apps.catalog.models import (
    Adventure,
    AdventureStep,
    CollectibleSet,
    ContentAsset,
    ContentRelease,
    ItemDefinition,
    LearningObjective,
    DiscoveryDefinition,
    Location,
    LocationAsset,
    NpcDefinition,
    Quest,
    RewardRule,
    World,
)
from apps.core import content_schema

# Schema 3 adds `locationAssets`; a schema 2 export imports with no asset associations.
SUPPORTED_SCHEMA_VERSIONS = (2, 3)
DEFAULT_EXPORT_DIR = Path(settings.CONTENT_DIR) / "exported"
SORT_ORDER_STEP = 10
# Arbitrary constant key for pg_advisory_xact_lock: one content import at a time.
IMPORT_LOCK_KEY = 304_0304


class ContentImportError(Exception):
    """The export was rejected. Nothing was written."""

    def __init__(self, problems: list[str]):
        super().__init__(f"content export rejected: {len(problems)} problem(s)")
        self.problems = problems


@dataclass
class ExportBundle:
    content_digest: str
    schema_version: int
    export_tool: str
    files: list[dict[str, Any]]
    collections: dict[str, list[dict[str, Any]]]
    schema_validated: bool = False


@dataclass
class ImportReport:
    status: str  # "imported", "unchanged" (already the latest release), or "dry-run"
    content_digest: str
    schema_version: int
    counts: dict[str, dict[str, int]] = field(default_factory=dict)
    skipped: list[str] = field(default_factory=list)
    release_id: int | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "content_digest": self.content_digest,
            "schema_version": self.schema_version,
            "counts": self.counts,
            "skipped": self.skipped,
        }


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_export(directory: Path = DEFAULT_EXPORT_DIR) -> ExportBundle:
    """Reads and verifies an export directory. Raises `ContentImportError` on any mismatch."""
    problems: list[str] = []
    try:
        manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise ContentImportError([f"manifest.json: unreadable ({type(error).__name__})"]) from None

    version = manifest.get("schemaVersion")
    if version not in SUPPORTED_SCHEMA_VERSIONS:
        raise ContentImportError(
            [f"manifest.json: schema version {version!r} is not one of {SUPPORTED_SCHEMA_VERSIONS}"]
        )

    files = manifest.get("files")
    if not isinstance(files, list) or not files:
        raise ContentImportError(["manifest.json: no file list"])

    collections: dict[str, list[dict[str, Any]]] = {}
    lines = []
    for entry in files:
        path = entry.get("path", "")
        if "/" in path or "\\" in path or not path.endswith(".json"):
            problems.append(f"manifest.json: unexpected file path {path!r}")
            continue
        try:
            data = (directory / path).read_bytes()
        except OSError:
            problems.append(f"{path}: missing")
            continue
        digest = _sha256(data)
        lines.append(f"{path}:{digest}")
        if digest != entry.get("sha256"):
            problems.append(f"{path}: sha256 does not match the manifest")
            continue
        body = json.loads(data)
        if body.get("schemaVersion") != version:
            problems.append(f"{path}: schema version differs from the manifest")
        for key, value in body.items():
            if key != "schemaVersion":
                collections[key] = value

    if not problems and _sha256("\n".join(lines).encode()) != manifest.get("contentDigest"):
        problems.append("manifest.json: content digest does not match the files")
    if problems:
        raise ContentImportError(problems)

    # The schema the exporter wrote beside the export, when present (always, for content/):
    # the same JSON Schema the TypeScript exporter validated against, checked again here with
    # the dependency-free validator in apps/core/content_schema.py.
    schema_file = directory.parent / "schema" / "content.schema.json"
    schema_validated = schema_file.is_file()
    if schema_validated:
        schema = json.loads(schema_file.read_text(encoding="utf-8"))
        for entry in files:
            try:
                content_schema.validate_file(
                    entry["path"], json.loads((directory / entry["path"]).read_bytes()), schema
                )
            except content_schema.ContentSchemaError as error:
                problems.extend(f"{entry['path']}: {message}" for message in error.errors[:20])
            except content_schema.UnsupportedKeyword as error:
                problems.append(f"schema: unsupported keyword ({error})")
        if problems:
            raise ContentImportError(problems)

    return ExportBundle(
        content_digest=manifest["contentDigest"],
        schema_version=version,
        export_tool=f"{manifest['exportTool']['name']}@{manifest['exportTool']['version']}",
        files=files,
        collections=collections,
        schema_validated=schema_validated,
    )


# --- Planning (no database) -------------------------------------------------------------------


@dataclass
class Plan:
    worlds: list[dict[str, Any]] = field(default_factory=list)
    locations: list[dict[str, Any]] = field(default_factory=list)
    adventures: list[dict[str, Any]] = field(default_factory=list)
    steps: list[dict[str, Any]] = field(default_factory=list)
    quests: list[dict[str, Any]] = field(default_factory=list)
    assets: list[dict[str, Any]] = field(default_factory=list)
    location_assets: list[dict[str, Any]] = field(default_factory=list)
    learning_objectives: list[dict[str, Any]] = field(default_factory=list)
    npcs: list[dict[str, Any]] = field(default_factory=list)
    collectible_sets: list[dict[str, Any]] = field(default_factory=list)
    items: list[dict[str, Any]] = field(default_factory=list)
    reward_rules: list[dict[str, Any]] = field(default_factory=list)
    discoveries: list[dict[str, Any]] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)


def _text(
    record: dict[str, Any], key: str, where: str, problems: list[str], *, optional=False
) -> str:
    value = record.get(key)
    if value is None and optional:
        return ""
    if not isinstance(value, str) or (not optional and not value):
        problems.append(f"{where}: `{key}` must be a non-empty string")
        return ""
    return value


def _texts(record: dict[str, Any], key: str, where: str, problems: list[str]) -> list[str]:
    value = record.get(key, [])
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        problems.append(f"{where}: `{key}` must be a list of strings")
        return []
    return value


def _unique(records: list[dict[str, Any]], key: str, kind: str, problems: list[str]) -> set[str]:
    seen: set[str] = set()
    for record in records:
        value = record.get(key)
        if value in seen:
            problems.append(f"{kind}: duplicate {key} {value!r}")
        seen.add(value)
    return seen


def _pack_owner(worlds: list[dict[str, Any]], list_key: str, kind: str, problems: list[str]):
    """slug -> world slug, from each world's content pack; a slug in two packs is an error."""
    owner: dict[str, str] = {}
    for world in worlds:
        for slug in world.get("pack", {}).get(list_key, []):
            if slug in owner:
                problems.append(
                    f"{kind} {slug!r}: listed in the packs of {owner[slug]!r} and {world['slug']!r}"
                )
            owner[slug] = world["slug"]
    return owner


def build_plan(bundle: ExportBundle) -> Plan:
    """Validates the records the catalog imports. Raises `ContentImportError` with every problem."""
    problems: list[str] = []
    plan = Plan()
    c = bundle.collections
    for name in ("islands", "locations", "adventures", "quests", "assets"):
        if not isinstance(c.get(name), list):
            problems.append(f"export: collection `{name}` is missing")
    if problems:
        raise ContentImportError(problems)

    worlds, locations, adventures, quests, assets = (
        c["islands"],
        c["locations"],
        c["adventures"],
        c["quests"],
        c["assets"],
    )
    world_slugs = _unique(worlds, "slug", "world", problems)
    location_slugs = _unique(locations, "slug", "location", problems)
    adventure_slugs = _unique(adventures, "slug", "adventure", problems)
    _unique(quests, "id", "quest", problems)
    asset_ids = _unique(assets, "id", "asset", problems)
    adventure_world = _pack_owner(worlds, "adventureSlugs", "adventure", problems)
    quest_world = _pack_owner(worlds, "questIds", "quest", problems)

    for index, world in enumerate(worlds):
        where = f"world {world.get('slug')!r}"
        plan.worlds.append(
            {
                "key": _text(world, "slug", where, problems),
                "order": index,
                "fields": {
                    "title": _text(world, "title", where, problems),
                    "tagline": _text(world, "tagline", where, problems, optional=True),
                    "description": _text(world, "description", where, problems, optional=True),
                    "is_home": bool(world.get("isHome", False)),
                    "supported_age_bands": _texts(world, "supportedAgeBands", where, problems),
                    "pack_version": int(world.get("pack", {}).get("version", 0)),
                    "source": world,
                },
            }
        )

    for index, location in enumerate(locations):
        where = f"location {location.get('slug')!r}"
        world_slug = _text(location, "worldSlug", where, problems)
        if world_slug and world_slug not in world_slugs:
            problems.append(f"{where}: unknown world {world_slug!r}")
        plan.locations.append(
            {
                "key": _text(location, "slug", where, problems),
                "order": index,
                "world": world_slug,
                "fields": {
                    "title": _text(location, "title", where, problems),
                    "tagline": _text(location, "tagline", where, problems, optional=True),
                    "description": _text(location, "description", where, problems, optional=True),
                    "skills": _texts(location, "skills", where, problems),
                    "source": location,
                },
            }
        )

    for index, adventure in enumerate(adventures):
        slug = adventure.get("slug")
        where = f"adventure {slug!r}"
        steps = adventure.get("steps")
        if not isinstance(steps, list) or not steps:
            problems.append(f"{where}: no steps")
            steps = []
        step_ids = _unique(steps, "id", f"{where} step", problems)
        entry = _text(adventure, "entryStepId", where, problems)
        if entry and entry not in step_ids:
            problems.append(f"{where}: entry step {entry!r} is not one of its steps")
        location_slug = _text(adventure, "locationSlug", where, problems)
        level = adventure.get("skillLevel")
        plan.adventures.append(
            {
                "key": _text(adventure, "slug", where, problems),
                "order": index,
                "world": adventure_world.get(slug),
                # A story-only pseudo-location has no Location record; the slug is kept as text.
                "location": location_slug if location_slug in location_slugs else None,
                "fields": {
                    "title": _text(adventure, "title", where, problems),
                    "version": int(adventure.get("version", 0)),
                    "location_slug": location_slug,
                    "age_bands": _texts(adventure, "ageBands", where, problems),
                    "entry_step_id": entry,
                    "skill_domain": adventure.get("skillDomain") or "",
                    "skill_level": level if isinstance(level, int) else None,
                    "source": {key: value for key, value in adventure.items() if key != "steps"},
                },
            }
        )
        for position, step in enumerate(steps):
            step_where = f"{where} step {step.get('id')!r}"
            plan.steps.append(
                {
                    "adventure": slug,
                    "key": _text(step, "id", step_where, problems),
                    "fields": {
                        "position": position,
                        "step_type": _text(step, "type", step_where, problems),
                        "objective_ids": _texts(step, "objectiveIds", step_where, problems),
                        "source": step,
                    },
                }
            )

    for index, quest in enumerate(quests):
        where = f"quest {quest.get('id')!r}"
        solved = [
            objective.get("adventureSlug")
            for stage in quest.get("stages", [])
            for objective in stage.get("objectives", [])
            if objective.get("kind") == "SOLVE"
        ]
        for slug in solved:
            if slug not in adventure_slugs:
                problems.append(f"{where}: SOLVE names unknown adventure {slug!r}")
        stage_ids = {stage.get("id") for stage in quest.get("stages", [])}
        if quest.get("entryStageId") not in stage_ids:
            problems.append(
                f"{where}: entry stage {quest.get('entryStageId')!r} is not one of its stages"
            )
        plan.quests.append(
            {
                "key": _text(quest, "id", where, problems),
                "order": index,
                "world": quest_world.get(quest.get("id")),
                "adventures": list(
                    dict.fromkeys(slug for slug in solved if slug in adventure_slugs)
                ),
                "fields": {
                    "title": _text(quest, "title", where, problems),
                    "summary": _text(quest, "summary", where, problems, optional=True),
                    "giver_npc_id": quest.get("giverNpcId") or "",
                    "age_bands": _texts(quest, "ageBands", where, problems),
                    "source": quest,
                },
            }
        )

    for asset in assets:
        where = f"asset {asset.get('id')!r}"
        lod = asset.get("lod") or {}
        low = lod.get("lowDetailId")
        if low is not None and low not in asset_ids:
            problems.append(f"{where}: unknown low-detail asset {low!r}")
        plan.assets.append(
            {
                "key": _text(asset, "id", where, problems),
                "low_detail": low,
                "fields": {
                    "kind": _text(asset, "kind", where, problems),
                    "bundled_path": _text(asset, "url", where, problems),
                    "clips": _texts(asset, "clips", where, problems),
                    "lod_distance_meters": lod.get("distanceMeters"),
                    "source": asset,
                },
            }
        )

    for region in c.get("locationAssets", []):
        slug = region.get("regionSlug")
        where = f"location assets {slug!r}"
        ids = _texts(region, "assetIds", where, problems)
        for asset_id in ids:
            if asset_id not in asset_ids:
                problems.append(f"{where}: unknown asset {asset_id!r}")
        if slug not in location_slugs:
            # The hub (welcome-harbor) has a scene but no Location record (a known ambiguity
            # in the export manifest); its assets are recorded in the export, not linked here.
            plan.skipped.append(f"{where}: region has no Location record ({len(ids)} assets)")
            continue
        for position, asset_id in enumerate(dict.fromkeys(ids)):
            plan.location_assets.append({"location": slug, "asset": asset_id, "position": position})

    _plan_supporting_catalogs(c, plan, location_slugs, problems)

    if problems:
        raise ContentImportError(problems)
    return plan


# The closed `DiscoveryRequirement` union (react/src/features/discovery/types.ts).
DISCOVERY_REQUIREMENT_TYPES = ("ALWAYS", "WORLD_CHANGE_PRESENT", "ITEM_OWNED", "DISCOVERY_PRESENT")


def _plan_supporting_catalogs(c, plan: Plan, location_slugs: set[str], problems: list[str]) -> None:
    """Learning objectives, NPCs, collectible sets, items and reward rules (all optional)."""
    objectives = c.get("learningObjectives", [])
    _unique(objectives, "code", "learning objective", problems)
    for objective in objectives:
        where = f"learning objective {objective.get('code')!r}"
        plan.learning_objectives.append(
            {
                "key": _text(objective, "code", where, problems),
                "fields": {
                    "domain": _text(objective, "domain", where, problems),
                    "title": _text(objective, "title", where, problems),
                    "source": objective,
                },
            }
        )

    discoveries = c.get("discoveries", [])
    _unique(discoveries, "id", "discovery", problems)
    for index, discovery in enumerate(discoveries):
        where = f"discovery {discovery.get('id')!r}"
        location = _text(discovery, "locationSlug", where, problems)
        requirements = discovery.get("requirements")
        if not isinstance(requirements, list) or not all(
            isinstance(r, dict) and r.get("type") in DISCOVERY_REQUIREMENT_TYPES
            for r in requirements
        ):
            problems.append(f"{where}: `requirements` must be a list of known requirement objects")
        plan.discoveries.append(
            {
                "key": _text(discovery, "id", where, problems),
                "order": index,
                "location": location if location in location_slugs else None,
                "fields": {
                    "kind": _text(discovery, "kind", where, problems),
                    "title": _text(discovery, "title", where, problems),
                    "location_slug": location,
                    "starts_quest_slug": discovery.get("startsQuestId") or "",
                    "source": discovery,
                },
            }
        )

    npcs = c.get("npcs", [])
    _unique(npcs, "id", "npc", problems)
    for index, npc in enumerate(npcs):
        where = f"npc {npc.get('id')!r}"
        home = _text(npc, "homeLocationSlug", where, problems)
        plan.npcs.append(
            {
                "key": _text(npc, "id", where, problems),
                "order": index,
                "home": home if home in location_slugs else None,
                "fields": {
                    "display_name": _text(npc, "displayName", where, problems),
                    "role": _text(npc, "role", where, problems, optional=True),
                    "home_location_slug": home,
                    "interaction_id": _text(npc, "interactionId", where, problems, optional=True),
                    "source": npc,
                },
            }
        )

    sets, items, rules = c.get("collectibleSets", []), c.get("items", []), c.get("rewardRules", [])
    set_ids = _unique(sets, "id", "collectible set", problems)
    item_ids = _unique(items, "id", "item", problems)
    _unique(rules, "id", "reward rule", problems)
    for collectible_set in sets:
        where = f"collectible set {collectible_set.get('id')!r}"
        completion = collectible_set.get("completionItemId")
        if completion is not None and completion not in item_ids:
            problems.append(f"{where}: unknown completion item {completion!r}")
        plan.collectible_sets.append(
            {
                "key": _text(collectible_set, "id", where, problems),
                "completion_item": completion,
                "fields": {
                    "display_name": _text(collectible_set, "displayName", where, problems),
                    "completion_message": _text(
                        collectible_set, "completionMessage", where, problems, optional=True
                    ),
                    "source": collectible_set,
                },
            }
        )
    for item in items:
        where = f"item {item.get('id')!r}"
        set_id = item.get("setId")
        if set_id is not None and set_id not in set_ids:
            problems.append(f"{where}: unknown collectible set {set_id!r}")
        plan.items.append(
            {
                "key": _text(item, "id", where, problems),
                "set": set_id,
                "fields": {
                    "display_name": _text(item, "displayName", where, problems),
                    "description": _text(item, "description", where, problems, optional=True),
                    "category": _text(item, "category", where, problems),
                    "rarity": _text(item, "rarity", where, problems),
                    "cosmetic_slot": item.get("cosmeticSlot") or "",
                    "hidden": bool(item.get("hidden", False)),
                    "source": item,
                },
            }
        )
    for rule in rules:
        where = f"reward rule {rule.get('id')!r}"
        granted = _texts(rule, "itemIds", where, problems)
        for item_id in granted:
            if item_id not in item_ids:
                problems.append(f"{where}: unknown item {item_id!r}")
        if not isinstance(rule.get("trigger"), dict):
            problems.append(f"{where}: `trigger` must be an object")
        plan.reward_rules.append(
            {
                "key": _text(rule, "id", where, problems),
                "items": granted,
                "fields": {
                    "trigger": rule.get("trigger"),
                    "message": _text(rule, "message", where, problems, optional=True),
                    "source": rule,
                },
            }
        )


# --- Applying ---------------------------------------------------------------------------------


def _counter() -> dict[str, int]:
    return {"created": 0, "updated": 0, "unchanged": 0, "missing": 0}


def _upsert(
    model, lookup: dict[str, Any], fields: dict[str, Any], release, counts, *, catalog=None
):
    """Creates or updates one imported row; catalog fields apply only on creation."""
    existing = model.objects.filter(**lookup).first()
    if existing is None:
        row = model.objects.create(**lookup, **fields, **(catalog or {}), last_seen_release=release)
        counts["created"] += 1
        return row
    changed = [name for name, value in fields.items() if getattr(existing, name) != value]
    for name in changed:
        setattr(existing, name, fields[name])
    existing.last_seen_release = release
    existing.save(update_fields=[*changed, "last_seen_release"])
    counts["updated" if changed else "unchanged"] += 1
    return existing


def _catalog(order: int) -> dict[str, Any]:
    return {"active": True, "sort_order": order * SORT_ORDER_STEP}


def _apply(plan: Plan, release: ContentRelease) -> dict[str, dict[str, int]]:
    counts = {
        name: _counter()
        for name in (
            "assets",
            "worlds",
            "locations",
            "adventures",
            "steps",
            "quests",
            "location_assets",
            "learning_objectives",
            "npcs",
            "collectible_sets",
            "items",
            "reward_rules",
            "discoveries",
        )
    }

    assets: dict[str, ContentAsset] = {}
    for record in plan.assets:
        assets[record["key"]] = _upsert(
            ContentAsset, {"asset_id": record["key"]}, record["fields"], release, counts["assets"]
        )
    for record in plan.assets:  # second pass: low-detail links need both rows to exist
        asset = assets[record["key"]]
        low = assets.get(record["low_detail"]) if record["low_detail"] else None
        if asset.low_detail_id != (low.pk if low else None):
            asset.low_detail = low
            asset.save(update_fields=["low_detail"])

    worlds = {
        r["key"]: _upsert(
            World,
            {"slug": r["key"]},
            r["fields"],
            release,
            counts["worlds"],
            catalog=_catalog(r["order"]),
        )
        for r in plan.worlds
    }
    locations = {
        r["key"]: _upsert(
            Location,
            {"slug": r["key"]},
            {**r["fields"], "world": worlds[r["world"]]},
            release,
            counts["locations"],
            catalog=_catalog(r["order"]),
        )
        for r in plan.locations
    }
    adventures = {}
    for r in plan.adventures:
        fields = {
            **r["fields"],
            "world": worlds.get(r["world"]),
            "location": locations.get(r["location"]),
        }
        adventures[r["key"]] = _upsert(
            Adventure,
            {"slug": r["key"]},
            fields,
            release,
            counts["adventures"],
            catalog=_catalog(r["order"]),
        )
    for r in plan.steps:
        _upsert(
            AdventureStep,
            {"adventure": adventures[r["adventure"]], "step_id": r["key"]},
            r["fields"],
            release,
            counts["steps"],
        )
    for r in plan.quests:
        quest = _upsert(
            Quest,
            {"slug": r["key"]},
            {**r["fields"], "world": worlds.get(r["world"])},
            release,
            counts["quests"],
            catalog=_catalog(r["order"]),
        )
        quest.adventures.set([adventures[slug] for slug in r["adventures"]])
    for r in plan.location_assets:
        _upsert(
            LocationAsset,
            {"location": locations[r["location"]], "asset": assets[r["asset"]]},
            {"position": r["position"]},
            release,
            counts["location_assets"],
        )

    for r in plan.learning_objectives:
        _upsert(
            LearningObjective,
            {"code": r["key"]},
            r["fields"],
            release,
            counts["learning_objectives"],
        )
    for r in plan.npcs:
        _upsert(
            NpcDefinition,
            {"npc_id": r["key"]},
            {**r["fields"], "home_location": locations.get(r["home"])},
            release,
            counts["npcs"],
            catalog=_catalog(r["order"]),
        )
    sets = {
        r["key"]: _upsert(
            CollectibleSet, {"set_id": r["key"]}, r["fields"], release, counts["collectible_sets"]
        )
        for r in plan.collectible_sets
    }
    items = {
        r["key"]: _upsert(
            ItemDefinition,
            {"item_id": r["key"]},
            {**r["fields"], "collectible_set": sets.get(r["set"])},
            release,
            counts["items"],
        )
        for r in plan.items
    }
    for r in plan.collectible_sets:  # second pass: the completion item needs the item rows
        collectible_set = sets[r["key"]]
        completion = items.get(r["completion_item"]) if r["completion_item"] else None
        if collectible_set.completion_item_id != (completion.pk if completion else None):
            collectible_set.completion_item = completion
            collectible_set.save(update_fields=["completion_item"])
    for r in plan.reward_rules:
        rule = _upsert(
            RewardRule, {"rule_id": r["key"]}, r["fields"], release, counts["reward_rules"]
        )
        rule.items.set([items[item_id] for item_id in r["items"]])
    for r in plan.discoveries:
        _upsert(
            DiscoveryDefinition,
            {"discovery_id": r["key"]},
            {**r["fields"], "location": locations.get(r["location"])},
            release,
            counts["discoveries"],
            catalog=_catalog(r["order"]),
        )

    for name, model in (
        ("assets", ContentAsset),
        ("worlds", World),
        ("locations", Location),
        ("adventures", Adventure),
        ("steps", AdventureStep),
        ("quests", Quest),
        ("location_assets", LocationAsset),
        ("learning_objectives", LearningObjective),
        ("npcs", NpcDefinition),
        ("collectible_sets", CollectibleSet),
        ("items", ItemDefinition),
        ("reward_rules", RewardRule),
        ("discoveries", DiscoveryDefinition),
    ):
        counts[name]["missing"] = model.objects.exclude(last_seen_release=release).count()
    return counts


def import_content(
    directory: Path = DEFAULT_EXPORT_DIR, *, dry_run: bool = False, force: bool = False
) -> ImportReport:
    """Imports an export. Idempotent: the same export twice is reported as unchanged."""
    bundle = read_export(directory)
    plan = build_plan(bundle)
    report = ImportReport(
        status="dry-run" if dry_run else "imported",
        content_digest=bundle.content_digest,
        schema_version=bundle.schema_version,
        skipped=list(plan.skipped),
    )
    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_advisory_xact_lock(%s)", [IMPORT_LOCK_KEY])
        latest = ContentRelease.objects.first()
        if latest and latest.content_digest == bundle.content_digest and not force:
            report.status = "unchanged"
            report.skipped.insert(0, f"release {bundle.content_digest[:12]} is already the latest")
            return report
        release = ContentRelease.objects.create(
            content_digest=bundle.content_digest,
            schema_version=bundle.schema_version,
            export_tool=bundle.export_tool,
            files=bundle.files,
            report={},
        )
        report.counts = _apply(plan, release)
        release.report = {**report.as_dict(), "schema_validated": bundle.schema_validated}
        release.save(update_fields=["report"])
        report.release_id = release.pk
        if dry_run:
            transaction.set_rollback(True)
            report.release_id = None
    return report
