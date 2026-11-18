"""The Heart of Firepeak's 3D Area, placements and puzzles (design sections 4, 6, 7 and 8).

Two kinds of content, kept apart as ADR-047 requires:

- **Layout** (code, ADR-033, LAI-0805): `firepeak_heart_layout.py` (zones, gates, platforms,
  checkpoints, effects, placements). Spatial layouts are not Django-administered; the scene carries
  `firepeakHeartVersion` like Pirate's Leap, so a development database upgrades when the layout
  changes (`upgrade_firepeak_heart`) without touching authored copy or staff platform tuning.
- **Authored content** (Django-authoritative once seeded): the fourteen puzzles' per-age-band
  parameters (`firepeak_heart_content.py`), recorded as their first published revisions (origin
  SEED). Re-running this seed never overwrites anything an administrator changed.

Everything non-spatial (the Place, the five NPCs, the quest, items and reward rules) is catalogue
content from the export: run `load_content` first. Rows are created as DRAFT;
`publish_firepeak_heart` (development only) publishes them. The seed never edits Firepeak Volcano
(`firepeak_seed.py`): that adventure and its saves stay exactly as they are.

Placements are create-only. A later layout version moves platforms, colliders and effects through
`upgrade_firepeak_heart`; moving an already-seeded placement is an administrator's edit in Django
Admin (or a new data migration), never a silent overwrite.
"""

# ruff: noqa: E402
from __future__ import annotations

import json
import os
from pathlib import Path

if __name__ == "__main__":  # `python -m apps.regions.firepeak_heart_seed` rewrites the snapshot
    import django

    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.local")
    django.setup()

from django.db import transaction

from apps.catalog.models import (
    AssetOrigin,
    ContentAsset,
    Location,
    NpcDefinition,
    Quest,
    RewardRule,
)

from . import firepeak_heart_content as content
from . import firepeak_heart_layout as layout
from .models import PlacementKind, SpawnPoint, WorldObjectPlacement, WorldRegion
from .platforming import layout_problems
from .seeding import record_seed_revision, seed_puzzle

REGION_ID = layout.REGION_ID
PLACE_SLUG = layout.PLACE_SLUG
QUEST_ID = layout.QUEST_ID
HEART_VERSION = layout.HEART_VERSION
NPC_IDS = ("flint", "kindle", "professor-basalt", "cinder", "ignis")
ASSET_TAG = "firepeak-heart"
SPAWN_ID = "fh-cp-landing"


class SeedPrerequisiteMissing(LookupError):
    pass


def reward_rule_ids() -> set[str]:
    rules = {row[3]["rewardRuleId"] for row in content.puzzle_rows() if row[3]["rewardRuleId"]}
    rules |= {p["pickup_rule"] for p in layout.placements() if p.get("pickup_rule")}
    return rules


# --- the version gate (like Pirate's Leap) -----------------------------------------------------

SPATIAL_KEYS = ("bounds", "groundAssetId", "colliders", "effects", "platforming")


def upgrade_firepeak_heart(region: WorldRegion) -> bool:
    """Write the layout into the scene when it is missing or older than `HEART_VERSION`.

    Only spatial keys change: authored copy and environment (ADR-047 revisions) and staff
    `platformTuning` are kept. Returns whether anything changed.
    """
    scene = dict(region.scene) if isinstance(region.scene, dict) else {}
    if scene.get("firepeakHeartVersion", 0) >= HEART_VERSION:
        return False
    fresh = layout.scene()
    problems = layout_problems(fresh["platforming"], bounds=fresh["bounds"])
    if problems:
        raise ValueError(f"Heart of Firepeak layout is invalid: {problems}")
    for key in SPATIAL_KEYS:
        scene[key] = fresh[key]
    for key in ("copy", "environment"):
        scene.setdefault(key, fresh[key])
    scene["firepeakHeartVersion"] = HEART_VERSION
    region.scene = scene
    region.version += 1
    region.save(update_fields=["scene", "version", "updated_at"])
    return True


# --- rows --------------------------------------------------------------------------------------


@transaction.atomic
def seed_firepeak_heart() -> list[str]:
    """Create the rows that do not exist yet. Returns what was created."""
    created: list[str] = []

    def get_or_create(model, lookup: dict, values: dict):
        row, was_created = model.objects.get_or_create(**lookup, defaults=values)
        if was_created:
            created.append(f"{model.__name__} {row}")
        return row

    try:
        place = Location.objects.get(slug=PLACE_SLUG)
        quest = Quest.objects.get(slug=QUEST_ID)
        npcs = {npc_id: NpcDefinition.objects.get(npc_id=npc_id) for npc_id in NPC_IDS}
        wanted = reward_rule_ids()
        rules = {r.rule_id: r for r in RewardRule.objects.filter(rule_id__in=wanted)}
        if set(rules) != wanted:
            raise RewardRule.DoesNotExist(", ".join(sorted(wanted - set(rules))))
    except (
        Location.DoesNotExist,
        NpcDefinition.DoesNotExist,
        Quest.DoesNotExist,
        RewardRule.DoesNotExist,
    ) as error:
        raise SeedPrerequisiteMissing(
            f"Run load_content first (the Heart of Firepeak export is missing: {error})."
        ) from error

    for asset_id, (kind, category, name) in layout.ASSET_DEFS.items():
        get_or_create(
            ContentAsset,
            {"asset_id": asset_id},
            {
                "kind": kind,
                "origin": AssetOrigin.DJANGO,
                "category": category,
                "display_name": name,
                "description": (
                    "Heart of Firepeak model. Not delivered yet; the game draws a stand-in."
                ),
                "tags": [ASSET_TAG],
            },
        )

    region = get_or_create(
        WorldRegion,
        {"region_id": REGION_ID},
        {
            "location": place,
            "title": "Heart of Firepeak",
            "scene": layout.scene(),
            "age_bands": ["PATHFINDER", "EXPLORER"],
        },
    )
    if upgrade_firepeak_heart(region):
        created.append(f"layout v{HEART_VERSION} for {REGION_ID}")
    get_or_create(
        SpawnPoint,
        {"region": region, "checkpoint_id": SPAWN_ID},
        {
            "label": "Explorer's Landing",
            "x": 0.0,
            "z": 90.0,
            "yaw": layout.FACING_NORTH_TO_SOUTH,
            "is_default": True,
        },
    )

    for spec in layout.placements():
        width, height, depth = spec["size"]
        npc = npcs[spec["npc"]] if spec["kind"] == "NPC" else None
        pickup_rule = rules[spec["pickup_rule"]] if spec.get("pickup_rule") else None
        get_or_create(
            WorldObjectPlacement,
            {"region": region, "entity_id": spec["entity_id"]},
            {
                "kind": PlacementKind(spec["kind"]),
                "label": spec["label"],
                "asset_id": spec["asset"],
                "npc": npc,
                "interaction_id": npc.interaction_id if npc else "",
                "x": spec["x"],
                "z": spec["z"],
                "elevation": spec["elevation"],
                "rotation_y": spec["rotation_y"],
                "placeholder_width": width,
                "placeholder_height": height,
                "placeholder_depth": depth,
                "pickup_change_key": spec.get("pickup_key", ""),
                "pickup_reward_rule": pickup_rule,
            },
        )

    for order, (puzzle_id, kind, entity_ids, puzzle_body) in enumerate(content.puzzle_rows()):
        _, was_created = seed_puzzle(
            region,
            puzzle_id=puzzle_id,
            kind=kind,
            entity_ids=entity_ids,
            body=puzzle_body,
            sort_order=order,
        )
        if was_created:
            created.append(f"AreaPuzzle {REGION_ID}:{puzzle_id}")

    if not region.offered_quests.exists():
        region.offered_quests.add(quest)
    record_seed_revision(region)
    return created


# --- snapshot for the frontend tests (kept equal to the seed by the layout tests) ---------------

SNAPSHOT_PATH = Path(__file__).with_name("firepeak_heart_scene.json")


def snapshot() -> dict:
    """What the Vitest region test loads: the scene, spawn, placements, puzzles and assets."""
    return {
        "scene": layout.scene(),
        "spawn": {
            "checkpointId": SPAWN_ID,
            "label": "Explorer's Landing",
            "x": 0.0,
            "z": 90.0,
            "yaw": layout.FACING_NORTH_TO_SOUTH,
        },
        "placements": layout.placements(),
        "puzzles": [
            {"puzzleId": pid, "kind": kind, "title": b["title"], "entityIds": entities}
            for pid, kind, entities, b in content.puzzle_rows()
        ],
        "assets": [
            {"assetId": asset_id, "kind": kind} for asset_id, (kind, _c, _n) in layout.ASSET_DEFS.items()
        ],
    }


def write_snapshot() -> None:
    SNAPSHOT_PATH.write_text(json.dumps(snapshot(), indent=1, sort_keys=True) + "\n")


if __name__ == "__main__":
    write_snapshot()  # silent: application code does not print (test_privacy_logging)
