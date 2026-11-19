"""North Pole: The Missing Christmas Star. The 3D Area's rows (NP-009 to NP-039, ADR-080).

Assembly only. Every piece of content lives in its own module, so each stays testable and owned:

- `north_pole_layout`: the scene (bounds, atmosphere, colliders, platforming, effects), the
  placements, the chest spots and the spawn (layout is code, ADR-033 item 4, ADR-047 H).
- `north_pole_puzzles`: the 27 puzzles' per-age-band parameters, recorded as their first
  published revisions (origin SEED); administrators edit them in Django Admin afterwards and a
  re-run never overwrites anything (ADR-047).
- `north_pole_assets`: the `ContentAsset` definitions awaiting their models (stand-ins until an
  administrator publishes a GLB).

Catalog content (the Realm, the Place, the NPCs, the nine quests, items, sets and reward rules)
comes from the export (`northPoleContent.ts`): run `load_content` first. Every row is created as
DRAFT; `publish_north_pole` (development only) publishes. Nothing here grades answers, grants
rewards or calls AI: the play API does that with the shared rules.
"""

from __future__ import annotations

from apps.catalog.models import ContentAsset, Location, NpcDefinition, Quest, RewardRule
from apps.education.models import ChallengeSpec
from apps.question_studio.models import QuestionPool
from apps.users.models import AgeBand

from . import north_pole_layout as layout
from .models import (
    ChestPresentation,
    PlacementKind,
    SpawnPoint,
    TreasureChest,
    WorldObjectPlacement,
    WorldRegion,
)
from .engine_bridge import engine_bridge_problems
from .north_pole_assets import ASSETS, content_asset_defaults
from .north_pole_puzzles import ENTITY_IDS, PUZZLES
from .platforming import layout_problems
from .seeding import record_seed_revision, seed_puzzle

REGION_ID = layout.REGION_ID
PLACE_SLUG = "north-pole-village"
REALM_SLUG = "north-pole"
QUEST_IDS = (
    "np-q01-welcome",
    "np-q02-toy-workshop",
    "np-q03-candy-cane-forest",
    "np-q04-frozen-lake",
    "np-q05-missing-reindeer",
    "np-q06-gingerbread-mystery",
    "np-q07-snowflake-mountain",
    "np-q08-restore-the-star",
    "np-q09-christmas-eve",
)
COMPLETION_KEY = "NORTH_POLE_ADVENTURE_COMPLETE"

# Chests (contract section 5): id -> (presentation, required key, world key, reward rule, specs).
# Specs per band: (skill, min, max, response mode, choices). Sprouts count to 5 with 3 picture
# choices; Pathfinders add within 10; Explorers subtract (workshop) or add (mountain) within 10.
_WORKSHOP = {
    AgeBand.SPROUT: ("counting-sets", 1, 5, "CHOICE", 3),
    AgeBand.PATHFINDER: ("addition-within-ten", 1, 10, "CHOICE", 4),
    AgeBand.EXPLORER: ("subtraction-within-ten", 2, 10, "CHOICE", 4),
}
_LEVER = {
    AgeBand.SPROUT: ("counting-sets", 1, 5, "CHOICE", 3),
    AgeBand.PATHFINDER: ("addition-within-ten", 1, 10, "CHOICE", 4),
    AgeBand.EXPLORER: ("addition-within-ten", 2, 10, "CHOICE", 4),
}
_PRACTICE = {
    AgeBand.SPROUT: ("counting-sets", 1, 5, "CHOICE", 3),
    AgeBand.PATHFINDER: ("subtraction-within-ten", 1, 10, "CHOICE", 4),
    AgeBand.EXPLORER: ("subtraction-within-ten", 2, 10, "NUMBER_INPUT", 0),
}
CHESTS = {
    "np-workshop-gift-chest": (
        ChestPresentation.CHEST,
        "NORTH_POLE_WORKSHOP_PATTERN_FIXED",
        "NORTH_POLE_WORKSHOP_GIFTS_CHECKED",
        "np-rule-workshop-gifts",
        _WORKSHOP,
        "Tinker: Check the gift box. Solve the number puzzle to open it!",
    ),
    "np-mountain-lever-1": (
        ChestPresentation.CHEST,
        "NORTH_POLE_GINGER_REPAIRED",
        "NORTH_POLE_MOUNTAIN_BRIDGE_ONE",
        None,
        _LEVER,
        "Jingle: This lever box raises the first snow bridge. Solve it to cross!",
    ),
    "np-mountain-lever-2": (
        ChestPresentation.CHEST,
        "NORTH_POLE_MOUNTAIN_BRIDGE_ONE",
        "NORTH_POLE_MOUNTAIN_BRIDGE_TWO",
        None,
        _LEVER,
        "Jingle: One more lever box, and the second bridge comes up!",
    ),
    "np-replay-workshop-sums": (
        ChestPresentation.REPLAY,
        "NORTH_POLE_CHRISTMAS_EVE",
        "NORTH_POLE_REPLAY_WORKSHOP",
        None,
        _PRACTICE,
        "Tinker: Want to practise toy sums? Come back any time!",
    ),
    "np-replay-lake-count": (
        ChestPresentation.REPLAY,
        "NORTH_POLE_CHRISTMAS_EVE",
        "NORTH_POLE_REPLAY_LAKE",
        None,
        _PRACTICE,
        "Frosty: Count the ice fish with me again, just for fun!",
    ),
}
# Math chests (not REPLAY) get a Question Studio pool, disabled until staff enable it (ADR-046).
POOLED_CHESTS = ("np-workshop-gift-chest", "np-mountain-lever-1", "np-mountain-lever-2")


class SeedPrerequisiteMissing(LookupError):
    pass


def pickup_rule_id(entity_id: str) -> str:
    """The reward rule a pickup grants (contract section 5): `np-x` -> `np-rule-x`."""
    if entity_id == "np-snowball-collar":
        return "np-rule-snowball-found"
    return "np-rule-" + entity_id.removeprefix("np-")


def _pickups() -> list[dict]:
    return [p for p in layout.PLACEMENTS if p["kind"] == PlacementKind.COLLECTIBLE]


def _required_rule_ids() -> set[str]:
    rules = {body["rewardRuleId"] for body in PUZZLES if body.get("rewardRuleId")}
    rules |= {pickup_rule_id(p["entity_id"]) for p in _pickups()}
    rules |= {spec[3] for spec in CHESTS.values() if spec[3]}
    return rules


def _specs(chest_id: str, table: dict, get_or_create) -> dict:
    out = {}
    for band, (skill, low, high, mode, choices) in table.items():
        spec = get_or_create(
            ChallengeSpec,
            {"slug": f"{chest_id}-{band.lower()}"},
            {
                "title": f"North Pole {chest_id}: {skill}",
                "age_band": band,
                "skill_id": skill,
                "min_value": low,
                "max_value": high,
                "response_mode": mode,
                "choice_count": choices,
            },
        )
        record_seed_revision(spec)
        out[f"{band.lower()}_challenge"] = spec
    return out


def seed_north_pole() -> list[str]:
    """Create the North Pole Area rows that do not exist yet. Returns what was created."""
    created: list[str] = []

    def get_or_create(model, lookup: dict, values: dict):
        row, was_created = model.objects.get_or_create(**lookup, defaults=values)
        if was_created:
            created.append(f"{model.__name__} {row}")
        return row

    place = Location.objects.filter(slug=PLACE_SLUG).first()
    quests = list(Quest.objects.filter(slug__in=QUEST_IDS))
    rules = {r.rule_id: r for r in RewardRule.objects.filter(rule_id__in=_required_rule_ids())}
    npc_ids = {p["npc_id"] for p in layout.PLACEMENTS if p.get("npc_id")}
    npcs = {n.npc_id: n for n in NpcDefinition.objects.filter(npc_id__in=npc_ids)}
    missing = []
    if place is None:
        missing.append(f"Place {PLACE_SLUG}")
    if len(quests) != len(QUEST_IDS):
        missing.append("the nine North Pole quests")
    if set(rules) != _required_rule_ids():
        missing.append(f"reward rules {sorted(_required_rule_ids() - set(rules))}")
    if set(npcs) != npc_ids:
        missing.append(f"NPCs {sorted(npc_ids - set(npcs))}")
    if missing:
        raise SeedPrerequisiteMissing(f"Run load_content first (missing: {'; '.join(missing)}).")

    course = layout.scene().get("platforming", {})
    problems = layout_problems(course, bounds=layout.BOUNDS)
    if problems:
        raise ValueError(f"North Pole course is invalid: {problems}")
    bridge_problems = engine_bridge_problems(layout.scene()["engineBridge"])
    if bridge_problems:
        raise ValueError(f"North Pole engine bridge block is invalid: {bridge_problems}")

    for asset in ASSETS:
        get_or_create(ContentAsset, {"asset_id": asset.asset_id}, content_asset_defaults(asset))

    region = get_or_create(
        WorldRegion,
        {"region_id": REGION_ID},
        {"location": place, "title": "North Pole Village", "scene": layout.scene(), "age_bands": []},
    )
    spawn = layout.SPAWN
    get_or_create(
        SpawnPoint,
        {"region": region, "checkpoint_id": spawn["checkpoint_id"]},
        {
            "label": spawn["label"],
            "x": spawn["x"],
            "z": spawn["z"],
            "yaw": spawn["yaw"],
            "is_default": True,
        },
    )

    for spec in layout.PLACEMENTS:
        npc = npcs.get(spec.get("npc_id", ""))
        is_pickup = spec["kind"] == PlacementKind.COLLECTIBLE
        rule = rules[pickup_rule_id(spec["entity_id"])] if is_pickup else None
        get_or_create(
            WorldObjectPlacement,
            {"region": region, "entity_id": spec["entity_id"]},
            {
                "kind": spec["kind"],
                "label": spec.get("label", ""),
                "asset_id": spec.get("asset_id", ""),
                "npc": npc,
                "interaction_id": npc.interaction_id if npc else "",
                "x": spec["x"],
                "z": spec["z"],
                "elevation": spec.get("elevation", 0.0),
                "rotation_y": spec.get("rotation_y", 0.0),
                "placeholder_width": spec.get("placeholder_width", 1.0),
                "placeholder_height": spec.get("placeholder_height", 1.0),
                "placeholder_depth": spec.get("placeholder_depth", 1.0),
                "pickup_change_key": spec.get("pickup_change_key", "") or "",
                "pickup_reward_rule": rule,
            },
        )

    for order, (chest_id, (presentation, requires, key, rule_id, table, clue)) in enumerate(
        CHESTS.items()
    ):
        spot = layout.CHEST_SPOTS[chest_id]
        get_or_create(
            TreasureChest,
            {"region": region, "entity_id": chest_id},
            {
                "label": spot["label"],
                "presentation": presentation,
                "x": spot["x"],
                "z": spot["z"],
                "elevation": spot.get("elevation", 0.0),
                "rotation_y": spot.get("rotation_y", 0.0),
                "sort_order": 100 + order,
                "required_world_change_key": requires,
                "world_change_key": key,
                "reward_rule": rules.get(rule_id) if rule_id else None,
                "clue": clue,
                **_specs(chest_id, table, get_or_create),
            },
        )
    for chest_id in POOLED_CHESTS:
        get_or_create(
            QuestionPool,
            {"region_id": REGION_ID, "entity_id": chest_id},
            {"name": f"North Pole {chest_id}", "enabled": False, "subject": "MATH"},
        )

    for order, body in enumerate(PUZZLES):
        _, was_created = seed_puzzle(
            region,
            puzzle_id=body["puzzleId"],
            kind=body["kind"],
            entity_ids=ENTITY_IDS[body["puzzleId"]],
            body=body,
            sort_order=order,
        )
        if was_created:
            created.append(f"AreaPuzzle {REGION_ID}:{body['puzzleId']}")

    region.offered_quests.add(*quests)
    record_seed_revision(region)
    return created
