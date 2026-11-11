"""Idempotent import of the versioned content export into the catalog (LAI-0304).

Three stages, so a bad export never reaches the database:

1. `read_export` verifies the files are exactly what the TypeScript exporter produced and
   validated against its JSON Schema: every file's sha256 must match the manifest, and the
   content digest is recomputed from them (`react/src/features/content-export/files.ts`).
2. `build_plan` checks every record and relationship the catalog imports, without touching
   the database, and collects every problem rather than stopping at the first.
3. `import_content` applies the plan in one transaction, under an advisory lock so two loads
   cannot interleave. Any error rolls the whole import back.

Content authority (ADR-047, Accepted 2026-11-01): the export is the initial import and migration
path. A record that is still export-owned is updated from the export, and each change is recorded
as a new published `IMPORT` revision. A record an administrator has published in Django Admin is
Django-owned: the import never changes it. When the export differs, the release report lists it
under `conflicts` and the exported body is kept as a draft for an administrator to review.
Catalog fields (`active`, `sort_order`) are set only when a row is created. Nothing is deleted: a
record a newer export lacks keeps its row, and its `last_seen_release` shows it is not in the
latest release.
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
    AssetOrigin,
    CollectibleSet,
    ContentAsset,
    ContentAuthority,
    ContentRelease,
    ItemDefinition,
    LearningObjective,
    Location,
    LocationAsset,
    NpcDefinition,
    Quest,
    RevisionOrigin,
    RewardRule,
    Story,
    World,
)
from apps.core import content_schema

from . import authoring, records

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
    conflicts: list[str] = field(default_factory=list)
    """Django-owned records whose export differs; kept as drafts, never applied (ADR-047)."""
    release_id: int | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "content_digest": self.content_digest,
            "schema_version": self.schema_version,
            "counts": self.counts,
            "skipped": self.skipped,
            "conflicts": self.conflicts,
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
    stories: list[dict[str, Any]] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)


_text = records.text
_texts = records.texts


def _unique(records_: list[dict[str, Any]], key: str, kind: str, problems: list[str]) -> set[str]:
    seen: set[str] = set()
    for record in records_:
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
                "fields": records.world_fields(world, where, problems),
            }
        )

    for index, location in enumerate(locations):
        where = f"location {location.get('slug')!r}"
        fields, world_slug = records.location_fields(location, where, problems)
        if world_slug and world_slug not in world_slugs:
            problems.append(f"{where}: unknown world {world_slug!r}")
        plan.locations.append(
            {
                "key": _text(location, "slug", where, problems),
                "order": index,
                "world": world_slug,
                "fields": fields,
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
        fields = records.adventure_fields(adventure, step_ids, where, problems)
        location_slug = fields["location_slug"]
        plan.adventures.append(
            {
                "key": _text(adventure, "slug", where, problems),
                "order": index,
                "world": adventure_world.get(slug),
                # A story-only pseudo-location has no Location record; the slug is kept as text.
                "location": location_slug if location_slug in location_slugs else None,
                "fields": fields,
            }
        )
        for position, step in enumerate(steps):
            step_where = f"{where} step {step.get('id')!r}"
            plan.steps.append(
                {
                    "adventure": slug,
                    "key": _text(step, "id", step_where, problems),
                    "fields": records.step_fields(step, position, step_where, problems),
                }
            )

    for index, quest in enumerate(quests):
        where = f"quest {quest.get('id')!r}"
        fields, solved = records.quest_fields(quest, adventure_slugs, where, problems)
        plan.quests.append(
            {
                "key": _text(quest, "id", where, problems),
                "order": index,
                "world": quest_world.get(quest.get("id")),
                "adventures": solved,
                "fields": fields,
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

    stories = c.get("stories", [])  # optional: older exports have none (LAI-0309)
    _unique(stories, "slug", "story", problems)
    for index, story in enumerate(stories):
        where = f"story {story.get('slug')!r}"
        fields, solved = records.story_fields(story, adventure_slugs, where, problems)
        plan.stories.append(
            {
                "key": _text(story, "slug", where, problems),
                "order": index,
                "adventures": solved,
                "fields": fields,
            }
        )

    if problems:
        raise ContentImportError(problems)
    return plan


def _plan_supporting_catalogs(c, plan: Plan, location_slugs: set[str], problems: list[str]) -> None:
    """Learning objectives, NPCs, collectible sets, items and reward rules (all optional)."""
    objectives = c.get("learningObjectives", [])
    _unique(objectives, "code", "learning objective", problems)
    for objective in objectives:
        where = f"learning objective {objective.get('code')!r}"
        plan.learning_objectives.append(
            {
                "key": _text(objective, "code", where, problems),
                "fields": records.objective_fields(objective, where, problems),
            }
        )

    npcs = c.get("npcs", [])
    _unique(npcs, "id", "npc", problems)
    for index, npc in enumerate(npcs):
        where = f"npc {npc.get('id')!r}"
        fields, home = records.npc_fields(npc, where, problems)
        plan.npcs.append(
            {
                "key": _text(npc, "id", where, problems),
                "order": index,
                "home": home if home in location_slugs else None,
                "fields": fields,
            }
        )

    sets, items, rules = c.get("collectibleSets", []), c.get("items", []), c.get("rewardRules", [])
    set_ids = _unique(sets, "id", "collectible set", problems)
    item_ids = _unique(items, "id", "item", problems)
    _unique(rules, "id", "reward rule", problems)
    for collectible_set in sets:
        where = f"collectible set {collectible_set.get('id')!r}"
        fields, completion = records.collectible_set_fields(collectible_set, where, problems)
        if completion is not None and completion not in item_ids:
            problems.append(f"{where}: unknown completion item {completion!r}")
        plan.collectible_sets.append(
            {
                "key": _text(collectible_set, "id", where, problems),
                "completion_item": completion,
                "fields": fields,
            }
        )
    for item in items:
        where = f"item {item.get('id')!r}"
        fields, set_id = records.item_fields(item, where, problems)
        if set_id is not None and set_id not in set_ids:
            problems.append(f"{where}: unknown collectible set {set_id!r}")
        plan.items.append(
            {"key": _text(item, "id", where, problems), "set": set_id, "fields": fields}
        )
    for rule in rules:
        where = f"reward rule {rule.get('id')!r}"
        fields, granted = records.reward_rule_fields(rule, where, problems)
        for item_id in granted:
            if item_id not in item_ids:
                problems.append(f"{where}: unknown item {item_id!r}")
        plan.reward_rules.append(
            {"key": _text(rule, "id", where, problems), "items": granted, "fields": fields}
        )


# --- Applying ---------------------------------------------------------------------------------


def _counter() -> dict[str, int]:
    # `skipped`: Django-owned, and the export holds what Django already publishes.
    # `conflicts`: Django-owned, and the export differs; kept as a draft, never applied
    # (ADR-047 J and Q2). Both are always zero for kinds that are not authorable (assets).
    return {"created": 0, "updated": 0, "unchanged": 0, "skipped": 0, "conflicts": 0, "missing": 0}


AUTHORABLE_MODELS = (
    World,
    Location,
    Adventure,
    AdventureStep,
    Quest,
    LearningObjective,
    NpcDefinition,
    CollectibleSet,
    ItemDefinition,
    RewardRule,
    Story,
)


def _upsert(
    model,
    lookup: dict[str, Any],
    fields: dict[str, Any],
    release,
    counts,
    *,
    catalog=None,
    conflicts: list[str] | None = None,
):
    """Creates or updates one imported row; catalog fields apply only on creation.

    Returns (row, applied). `applied` is False for a Django-owned record, whose content and
    relations the import must leave alone (ADR-047): its row only learns it was in this release.
    """
    authorable = model in AUTHORABLE_MODELS
    existing = model.objects.filter(**lookup).first()
    if existing is None:
        row = model.objects.create(**lookup, **fields, **(catalog or {}), last_seen_release=release)
        counts["created"] += 1
        if authorable:
            authoring.record_published(
                row, fields["source"], origin=RevisionOrigin.IMPORT, release=release
            )
        return row, True
    if authorable and existing.authority == ContentAuthority.DJANGO:
        existing.last_seen_release = release
        existing.save(update_fields=["last_seen_release"])
        if fields["source"] == existing.source:
            counts["skipped"] += 1
        else:
            counts["conflicts"] += 1
            authoring.record_import_draft(existing, fields["source"], release)
            if conflicts is not None:
                kind = authoring.kind_for(existing)
                conflicts.append(f"{kind.name} {kind.key_of(existing)}")
        return existing, False
    changed = [name for name, value in fields.items() if getattr(existing, name) != value]
    for name in changed:
        setattr(existing, name, fields[name])
    existing.last_seen_release = release
    existing.save(update_fields=[*changed, "last_seen_release"])
    counts["updated" if changed else "unchanged"] += 1
    if authorable and (changed or existing.published_revision_id is None):
        authoring.record_published(
            existing, fields["source"], origin=RevisionOrigin.IMPORT, release=release
        )
    return existing, True


def _catalog(order: int) -> dict[str, Any]:
    return {"active": True, "sort_order": order * SORT_ORDER_STEP}


def _apply(plan: Plan, release: ContentRelease, conflicts: list[str]) -> dict[str, dict[str, int]]:
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
            "stories",
        )
    }

    assets: dict[str, ContentAsset] = {}
    for record in plan.assets:
        assets[record["key"]], _ = _upsert(
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
            conflicts=conflicts,
        )[0]
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
            conflicts=conflicts,
        )[0]
        for r in plan.locations
    }
    adventures = {}
    for r in plan.adventures:
        fields = {
            **r["fields"],
            "world": worlds.get(r["world"]),
            "location": locations.get(r["location"]),
        }
        adventures[r["key"]], _ = _upsert(
            Adventure,
            {"slug": r["key"]},
            fields,
            release,
            counts["adventures"],
            catalog=_catalog(r["order"]),
            conflicts=conflicts,
        )
    for r in plan.steps:
        _upsert(
            AdventureStep,
            {"adventure": adventures[r["adventure"]], "step_id": r["key"]},
            r["fields"],
            release,
            counts["steps"],
            conflicts=conflicts,
        )
    for r in plan.quests:
        quest, applied = _upsert(
            Quest,
            {"slug": r["key"]},
            {**r["fields"], "world": worlds.get(r["world"])},
            release,
            counts["quests"],
            catalog=_catalog(r["order"]),
            conflicts=conflicts,
        )
        if applied:
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
            conflicts=conflicts,
        )
    for r in plan.npcs:
        _upsert(
            NpcDefinition,
            {"npc_id": r["key"]},
            {**r["fields"], "home_location": locations.get(r["home"])},
            release,
            counts["npcs"],
            catalog=_catalog(r["order"]),
            conflicts=conflicts,
        )
    sets, applied_sets = {}, set()
    for r in plan.collectible_sets:
        sets[r["key"]], applied = _upsert(
            CollectibleSet,
            {"set_id": r["key"]},
            r["fields"],
            release,
            counts["collectible_sets"],
            conflicts=conflicts,
        )
        if applied:
            applied_sets.add(r["key"])
    items = {
        r["key"]: _upsert(
            ItemDefinition,
            {"item_id": r["key"]},
            {**r["fields"], "collectible_set": sets.get(r["set"])},
            release,
            counts["items"],
            conflicts=conflicts,
        )[0]
        for r in plan.items
    }
    for r in plan.collectible_sets:  # second pass: the completion item needs the item rows
        if r["key"] not in applied_sets:
            continue
        collectible_set = sets[r["key"]]
        completion = items.get(r["completion_item"]) if r["completion_item"] else None
        if collectible_set.completion_item_id != (completion.pk if completion else None):
            collectible_set.completion_item = completion
            collectible_set.save(update_fields=["completion_item"])
    for r in plan.reward_rules:
        rule, applied = _upsert(
            RewardRule,
            {"rule_id": r["key"]},
            r["fields"],
            release,
            counts["reward_rules"],
            conflicts=conflicts,
        )
        if applied:
            rule.items.set([items[item_id] for item_id in r["items"]])

    for r in plan.stories:
        story, applied = _upsert(
            Story,
            {"slug": r["key"]},
            r["fields"],
            release,
            counts["stories"],
            catalog=_catalog(r["order"]),
            conflicts=conflicts,
        )
        if applied:
            story.adventures.set([adventures[slug] for slug in r["adventures"]])

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
        ("stories", Story),
    ):
        counts[name]["missing"] = model.objects.exclude(last_seen_release=release).count()
    return counts


def _refuse_django_owned_npcs(plan: Plan) -> None:
    """An export NPC id that a Django-authored NPC already owns fails the import (ADR-053).

    Without this the import would overwrite a staff-authored character or claim it as its own.
    """
    keys = [r["key"] for r in plan.npcs]
    owned = sorted(
        NpcDefinition.objects.filter(npc_id__in=keys, origin=AssetOrigin.DJANGO).values_list(
            "npc_id", flat=True
        )
    )
    if owned:
        raise ContentImportError(
            [f"npc {npc_id!r} is a Django-authored NPC; rename one of them" for npc_id in owned]
        )


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
        _refuse_django_owned_npcs(plan)
        report.counts = _apply(plan, release, report.conflicts)
        release.report = {**report.as_dict(), "schema_validated": bundle.schema_validated}
        release.save(update_fields=["report"])
        report.release_id = release.pk
        if dry_run:
            transaction.set_rollback(True)
            report.release_id = None
    return report
