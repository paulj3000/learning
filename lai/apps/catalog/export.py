"""Deterministic export of published content, and the content checks (LAI-0814, ADR-047 L).

`build_export` reads each authorable record's *published revision* and lays it out in the
existing export format, so `manage.py load_content --path DIR` can promote it to another
environment under the same import rules (ownership, conflict report, dry run). Drafts are left
out unless `include_drafts` is set (for a review environment); a draft that is included is
marked in the manifest and never published by an import.

The manifest adds, beside the importer's own keys, one entry per record: kind, id, revision id
and number, owner, publish time, what it depends on, and a checksum of its body. Everything is
sorted, so the same published content always produces the same bytes and the same digest.

`check_content` is the gate before exporting and before a merge: every published body passes
the same validation publishing runs (schema, references, copy rules, safety screening), every
row still matches its published revision, and every reference points at an exported record.
It reads and reports; it never writes.
"""

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from django.db import models

from apps.core import content_schema

from . import authoring, references
from .importer import ContentImportError
from .models import (
    Adventure,
    AssetOrigin,
    CollectibleSet,
    ContentAsset,
    ItemDefinition,
    LearningObjective,
    Location,
    LocationAsset,
    NpcDefinition,
    Quest,
    RevisionStatus,
    RewardRule,
    Story,
    World,
)

SCHEMA_VERSION = 3
EXPORT_TOOL = {"name": "lai-django-export", "version": "1.0.0"}

# (file, collection key, model, kind name): the order here is the order of the manifest.
COLLECTIONS = (
    ("islands.json", "islands", World, "island"),
    ("locations.json", "locations", Location, "place"),
    ("adventures.json", "adventures", Adventure, "adventure"),
    ("adventures.json", "learningObjectives", LearningObjective, "learning-objective"),
    ("quests.json", "quests", Quest, "quest"),
    ("npcs.json", "npcs", NpcDefinition, "npc"),
    ("rewards.json", "collectibleSets", CollectibleSet, "collectible-set"),
    ("rewards.json", "items", ItemDefinition, "item"),
    ("rewards.json", "rewardRules", RewardRule, "reward-rule"),
    ("stories.json", "stories", Story, "story"),
)
# Collections the file schema requires but Django does not hold; exported empty and listed.
NOT_HELD = {"adventures.json": ["wonderWallQuestions"]}


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, ensure_ascii=False, indent=2) + "\n"


def body_checksum(body: Any) -> str:
    return _sha256(json.dumps(body, sort_keys=True, ensure_ascii=False).encode())


# --- Dependencies --------------------------------------------------------------------------------


def _strings_under(value: Any, key: str):
    if isinstance(value, dict):
        for k, v in value.items():
            if k == key and isinstance(v, str):
                yield v
            elif k == key and isinstance(v, list):
                yield from (x for x in v if isinstance(x, str))
            else:
                yield from _strings_under(v, key)
    elif isinstance(value, list):
        for item in value:
            yield from _strings_under(item, key)


_REFERENCE_KEYS = {
    "locationSlug": "place",
    "homeLocationSlug": "place",
    "worldSlug": "island",
    "adventureSlug": "adventure",
    "templateSlug": "adventure",
    "questId": "quest",
    "giverNpcId": "npc",
    "itemId": "item",
    "itemIds": "item",
    "completionItemId": "item",
    "setId": "collectible-set",
}


def dependencies(kind: str, body: dict) -> list[str]:
    """`kind:key` of every other record this body names, sorted and unique."""
    found = set()
    for key, target in _REFERENCE_KEYS.items():
        found.update(f"{target}:{value}" for value in _strings_under(body, key))
    own = body.get("slug") or body.get("id") or body.get("code")
    found.discard(f"{kind}:{own}")
    return sorted(found)


# --- Building ------------------------------------------------------------------------------------


@dataclass
class ExportedRecord:
    kind: str
    key: str
    revision_id: str
    revision_number: int
    authority: str
    published_at: str | None
    draft: bool
    depends_on: list[str]
    sha256: str

    def as_dict(self) -> dict:
        return {
            "kind": self.kind,
            "id": self.key,
            "revision": {"id": self.revision_id, "number": self.revision_number},
            "authority": self.authority,
            "publishedAt": self.published_at,
            "draft": self.draft,
            "dependsOn": self.depends_on,
            "sha256": self.sha256,
        }


@dataclass
class ExportPlan:
    collections: dict[str, dict[str, list]] = field(default_factory=dict)
    records: list[ExportedRecord] = field(default_factory=list)
    problems: list[str] = field(default_factory=list)


def _chosen_revision(row, include_drafts: bool):
    """(revision, is_draft): the published revision, or with `include_drafts` the newest open
    draft or submitted version when there is one."""
    if include_drafts:
        open_one = (
            authoring.revisions_for(row)
            .filter(status__in=[RevisionStatus.DRAFT, RevisionStatus.SUBMITTED])
            .first()
        )
        if open_one is not None:
            return open_one, True
    return row.published_revision, False


def build_export(*, include_drafts: bool = False) -> ExportPlan:
    plan = ExportPlan()
    for file_name, key, model, kind_name in COLLECTIONS:
        entries = plan.collections.setdefault(file_name, {}).setdefault(key, [])
        ordering = [f.name for f in model._meta.fields if f.name == "sort_order"]
        key_field = authoring.kinds()[kind_name].key_field
        rows = model.objects.select_related("published_revision").order_by(*ordering, key_field)
        for row in rows:
            revision, draft = _chosen_revision(row, include_drafts)
            if revision is None:
                plan.problems.append(
                    f"{kind_name} {authoring.kind_for(row).key_of(row)}: no published version"
                )
                continue
            body = json.loads(json.dumps(revision.body))
            if isinstance(row, Adventure):
                body["steps"] = [
                    _chosen_revision(step, include_drafts)[0].body
                    for step in row.steps.select_related("published_revision").order_by("position")
                    if _chosen_revision(step, include_drafts)[0] is not None
                ]
            entries.append(body)
            plan.records.append(
                ExportedRecord(
                    kind=kind_name,
                    key=authoring.kind_for(row).key_of(row),
                    revision_id=str(revision.pk),
                    revision_number=revision.number,
                    authority=row.authority,
                    published_at=revision.published_at.isoformat()
                    if revision.published_at
                    else None,
                    draft=draft,
                    depends_on=dependencies(kind_name, revision.body),
                    sha256=body_checksum(body),
                )
            )
    # Assets from the export (Django-created assets belong to the Asset Manager, ADR-045).
    assets = list(
        ContentAsset.objects.filter(origin=AssetOrigin.EXPORT)
        .exclude(source={})
        .order_by("asset_id")
        .values_list("source", flat=True)
    )
    by_location: dict[str, list[str]] = {}
    for link in LocationAsset.objects.select_related("location", "asset").order_by(
        "location__slug", "position"
    ):
        by_location.setdefault(link.location.slug, []).append(link.asset.asset_id)
    plan.collections["assets.json"] = {
        "assets": assets,
        "locationAssets": [
            {"regionSlug": slug, "assetIds": ids} for slug, ids in sorted(by_location.items())
        ],
    }
    for file_name, missing in NOT_HELD.items():
        for key in missing:
            plan.collections[file_name].setdefault(key, [])
    return plan


def write_export(plan: ExportPlan, directory: Path) -> dict:
    """Write the files and manifest. Returns the manifest."""
    directory.mkdir(parents=True, exist_ok=True)
    files = []
    for file_name in sorted(plan.collections):
        body = {"schemaVersion": SCHEMA_VERSION, **plan.collections[file_name]}
        text = canonical(body)
        (directory / file_name).write_text(text, encoding="utf-8")
        files.append(
            {
                "path": file_name,
                "sha256": _sha256(text.encode()),
                "counts": {k: len(v) for k, v in plan.collections[file_name].items()},
            }
        )
    digest = _sha256("\n".join(f"{f['path']}:{f['sha256']}" for f in files).encode())
    manifest = {
        "schemaVersion": SCHEMA_VERSION,
        "contentDigest": digest,
        "exportTool": EXPORT_TOOL,
        "files": files,
        "knownAmbiguities": [],
        "excludesDrafts": not any(r.draft for r in plan.records),
        "notExported": NOT_HELD,
        "records": [r.as_dict() for r in plan.records],
    }
    (directory / "manifest.json").write_text(canonical(manifest), encoding="utf-8")
    return manifest


def verify_manifest_records(directory: Path) -> None:
    """Integrity check for promotion: every record listed in the manifest is in the files with
    the checksum the manifest states, and every dependency is either exported or named as
    external. Raises `ContentImportError` listing every mismatch. No manifest `records` (the
    TypeScript export): nothing to verify."""
    try:
        manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return  # `read_export` reports an unreadable manifest
    listed = manifest.get("records")
    if not listed:
        return
    problems: list[str] = []
    bodies: dict[tuple[str, str], Any] = {}
    kind_of = {key: kind for _, key, _, kind in COLLECTIONS}
    key_of = {
        "learning-objective": "code",
        "adventure": "slug",
        "place": "slug",
        "island": "slug",
        "story": "slug",
    }
    for file_name in {f for f, *_ in COLLECTIONS}:
        try:
            data = json.loads((directory / file_name).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        for collection, entries in data.items():
            kind = kind_of.get(collection)
            if kind is None or not isinstance(entries, list):
                continue
            for entry in entries:
                ident = entry.get(key_of.get(kind, "id"))
                bodies[(kind, ident)] = entry
    present = set(bodies)
    for record in listed:
        ident = (record.get("kind"), record.get("id"))
        body = bodies.get(ident)
        if body is None:
            problems.append(f"{ident[0]} {ident[1]}: listed in the manifest but not in the files")
        elif body_checksum(body) != record.get("sha256"):
            problems.append(f"{ident[0]} {ident[1]}: checksum differs from the manifest")
        for dependency in record.get("dependsOn", []):
            target, _, name = dependency.partition(":")
            # Story-only pseudo-locations have no Place by design, so "place" is never required.
            if (target, name) not in present and target in set(kind_of.values()) - {"place"}:
                problems.append(f"{ident[0]} {ident[1]}: depends on {dependency}, not exported")
    if problems:
        raise ContentImportError(problems)


# --- Checks --------------------------------------------------------------------------------------


@dataclass
class CheckReport:
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    checked: int = 0

    @property
    def ok(self) -> bool:
        return not self.errors


def check_content(*, schema_files: bool = True) -> CheckReport:
    """Everything that must hold before content leaves an environment. Read-only."""
    report = CheckReport()
    exported_keys: set[str] = set()
    plan = build_export()
    report.errors.extend(plan.problems)
    exported_keys.update(f"{r.kind}:{r.key}" for r in plan.records)

    for _, _, model, kind_name in COLLECTIONS:
        kind = authoring.kinds()[kind_name]
        for row in model.objects.select_related("published_revision"):
            revision = row.published_revision
            if revision is None:
                continue  # already reported by build_export
            report.checked += 1
            name = f"{kind_name} {kind.key_of(row)}"
            if revision.body != row.source:
                report.errors.append(f"{name}: the row no longer matches its published version")
            for problem in authoring.validate(row, revision.body):
                report.errors.append(f"{name}: {problem}")
    for record in plan.records:
        for dependency in record.depends_on:
            if dependency in exported_keys:
                continue
            message = f"{record.kind} {record.key}: depends on {dependency}, which is not exported"
            # Story-only pseudo-locations have no Place by design (the export's known ambiguity).
            (report.warnings if dependency.startswith("place:") else report.errors).append(message)
    if schema_files:
        for file_name, collections in plan.collections.items():
            try:
                content_schema.validate_file(
                    file_name, {"schemaVersion": SCHEMA_VERSION, **collections}
                )
            except content_schema.ContentSchemaError as error:
                report.errors.extend(f"{file_name}: {m}" for m in error.errors[:20])
    for orphan in references.find_orphans():
        report.warnings.append(
            f"{orphan.model}.{orphan.field}: {orphan.value!r} names no record "
            f"({orphan.rows} row(s))"
        )
    return report


def pending_drafts() -> list[str]:
    """Records with an open draft or submitted version (informational for a release)."""
    names = []
    for _, _, model, kind_name in COLLECTIONS:
        kind = authoring.kinds()[kind_name]
        for row in model.objects.all():
            open_ones: models.QuerySet = authoring.revisions_for(row).filter(
                status__in=[RevisionStatus.DRAFT, RevisionStatus.SUBMITTED]
            )
            if open_ones.exists():
                names.append(f"{kind_name} {kind.key_of(row)}")
    return names
