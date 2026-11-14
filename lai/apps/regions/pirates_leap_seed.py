"""Treasure Cove: Pirate's Leap (LAI-JMP-03), a platforming adventure inside the existing cove.

Seed-owned layout (ADR-033, LAI-0805): the course's platforms, plates, checkpoints, water pools,
goal and section zones live in `WorldRegion.scene["platforming"]`, versioned separately from the
cove's scenery (`scene["piratesLeapVersion"]`), so a cove layout upgrade (palm trees, barrels,
logs: another workstream) never wipes the course and the course never touches that layout.
Staff tune speeds, pauses, bounce height and on/off in Django Admin (`platformTuning`, ADR-059).

The rows (quest offer, chests, collectibles, signpost) use the canonical catalogue: the quest,
items and reward rules come from the content export (`treasureRushContent.ts`, `load_content`).

Course, in the cove's empty south-west (x -15 to -35, z -17 to -36), every section with a
walking route around it, so no jump is ever required to finish:

1. Learn to Leap: three low steps by the training yard; Pip's riddle drum (optional counting).
2. Barrel Crossing: barrels over a small pool; a shell on the middle barrel.
3. Fallen Log Trail: logs over a pool, gaps a walking jump clears and a running jump clears easily.
4. The Moving Dock: a ferry that waits at each bank; checkpoints before and after.
5. The Pirate Lift: a pressure plate wakes a lift to the treasure ledge (step on, no jump).
6. The Secret Treasure: a crow's nest with the chest; a bounce drum as a shortcut. Solving Pip's
   riddle raises a hidden plank bridge over the barrel pool (an optional educational unlock).
"""

from __future__ import annotations

import json
from pathlib import Path

from django.db.models import Q

from apps.catalog.models import ItemDefinition, Quest, RewardRule
from apps.education.models import ChallengeSpec
from apps.users.models import AgeBand

from .models import PlacementKind, TreasureChest, WorldObjectPlacement, WorldRegion
from .platforming import layout_problems
from .treasure_cove_layout import BOUNDS

LEAP_VERSION = 1
LEAP_QUEST_ID = "pirates-leap"
LEAP_CHEST_ID = "cove-leap-chest"
LEAP_CHEST_KEY = "PIRATES_LEAP_CHEST_OPENED"
LEAP_RIDDLE_ID = "cove-leap-riddle"
LEAP_RIDDLE_KEY = "PIRATES_LEAP_RIDDLE_SOLVED"
LEAP_SHELL_KEY = "PIRATES_LEAP_SHELL_FOUND"
LEAP_FEATHER_KEY = "PIRATES_LEAP_FEATHER_FOUND"
LEAP_SIGNPOST_ID = "cove-leap-signpost"
LEAP_SHELL_ID = "cove-leap-shell"
LEAP_FEATHER_ID = "cove-leap-feather"
LEDGE_TOP = 3.2
NEST_TOP = 3.4

# --- the course (metres; x west is negative, z south is negative) ----------------------------


def _box(pid, x, z, width, height, depth, y=0.0, **extra):
    return {
        "id": pid,
        "size": {"width": width, "height": height, "depth": depth},
        "position": {"x": x, "y": y, "z": z},
        **extra,
    }


def _rect(rid, min_x, max_x, min_z, max_z):
    return {"id": rid, "minX": min_x, "maxX": max_x, "minZ": min_z, "maxZ": max_z}


WOOD = 0xC58B4F
BARREL = 0x9C6B3C
STONE = 0xA7A9AC


def leap_platforming() -> dict:
    """The whole course as `scene["platforming"]` (validated by `platforming.layout_problems`)."""
    platforms = [
        # 1. Learn to Leap: a walkable step, then two hops, each a little higher.
        _box("leap-step-1", -17.0, -19.0, 1.4, 0.25, 1.4, color=WOOD),
        _box("leap-step-2", -18.6, -19.0, 1.4, 0.5, 1.4, color=WOOD),
        _box("leap-step-3", -20.2, -19.0, 1.4, 0.8, 1.4, color=WOOD),
        # 2. Barrel Crossing: 0.6 m gaps between barrels over the pool.
        _box("leap-barrel-1", -22.6, -19.0, 1.2, 0.9, 1.2, color=BARREL, assetId="barrel"),
        _box("leap-barrel-2", -24.4, -19.0, 1.2, 0.9, 1.2, color=BARREL, assetId="barrel"),
        _box("leap-barrel-3", -26.2, -19.0, 1.2, 0.9, 1.2, color=BARREL, assetId="barrel"),
        # Riddle reward: a plank bridge over the pool (walkable, no jump) appears when solved.
        _box(
            "leap-secret-bridge",
            -24.4,
            -17.9,
            6.4,
            0.2,
            1.0,
            color=0xF2C94C,
            activation={"trigger": "SIGNAL", "source": f"world:{LEAP_RIDDLE_KEY}", "hiddenUntilActive": True},
        ),
        # 3. Fallen Log Trail: logs with 1.0 and 1.2 m gaps (a walking jump clears 2.5 m).
        _box("leap-log-1", -29.0, -22.8, 1.0, 0.5, 2.0, color=0x7B5235),
        _box("leap-log-2", -29.0, -25.8, 1.0, 0.5, 2.0, color=0x7B5235),
        _box("leap-log-3", -29.0, -29.0, 1.0, 0.5, 2.0, color=0x7B5235),
        # A barrel that sinks a while after you stand on it, then bobs back up (optional).
        _box(
            "leap-sinking-barrel",
            -31.0,
            -25.8,
            1.2,
            0.5,
            1.2,
            color=0xA78BFA,
            vanish={"mode": "STAND", "visibleSeconds": 3, "hiddenSeconds": 2.5, "warningSeconds": 1},
        ),
        # 4. The Moving Dock: top at 0.2 m, so a child steps on without jumping; it waits 3 s.
        _box(
            "leap-moving-dock",
            -26.4,
            -33.0,
            2.4,
            0.4,
            2.4,
            y=-0.2,
            color=0x3FA7D6,
            motion={"path": [{"x": 4.0, "y": 0.0, "z": 0.0}], "speed": 1.2, "pauseSeconds": 3},
        ),
        # 5. The Pirate Lift: woken by the plate; up 3 m to the ledge, waits 3 s at each end.
        _box(
            "leap-lift",
            -18.0,
            -28.0,
            2.4,
            0.2,
            2.4,
            color=0x3FA7D6,
            motion={"path": [{"x": 0.0, "y": 3.0, "z": 0.0}], "speed": 0.8, "pauseSeconds": 3},
            activation={"trigger": "PLATE", "source": "leap-lift-plate"},
        ),
        _box("leap-ledge", -18.0, -25.4, 3.0, LEDGE_TOP, 2.8, color=STONE),
        # 6. The Secret Treasure: a crow's nest one small step up from the ledge.
        _box("leap-nest", -18.0, -23.0, 2.4, NEST_TOP - LEDGE_TOP, 2.0, y=LEDGE_TOP, color=WOOD),
        # A bounce drum beside the ledge: an optional shortcut straight up.
        _box("leap-bounce-drum", -15.6, -25.4, 1.6, 0.3, 1.6, color=0xF26B8A, bounce={"height": 3.8}),
    ]
    return {
        "platforms": platforms,
        "pressurePlates": [{"id": "leap-lift-plate", "position": {"x": -20.6, "z": -30.0}, "latch": True}],
        "checkpoints": [
            {"id": "leap-cp-yard", "x": -15.8, "z": -18.0, "yaw": 1.57, "label": "the training yard"},
            {"id": "leap-cp-barrels", "x": -28.6, "z": -19.0, "yaw": 3.14, "label": "the barrel bank"},
            {"id": "leap-cp-logs", "x": -28.8, "z": -32.6, "yaw": -1.57, "label": "the log landing"},
            {"id": "leap-cp-dock", "x": -19.8, "z": -33.0, "yaw": 0.0, "label": "the far dock"},
        ],
        "hazards": [
            {"id": "leap-pool-barrels", "rect": _rect("leap-pool-barrels", -27.4, -21.6, -20.2, -17.4)},
            {"id": "leap-pool-logs", "rect": _rect("leap-pool-logs", -31.8, -27.2, -30.4, -21.6)},
            {"id": "leap-pool-dock", "rect": _rect("leap-pool-dock", -27.6, -21.2, -34.6, -31.6)},
        ],
        "goals": [{"id": "leap-goal-nest", "rect": _rect("leap-goal-nest", -19.2, -16.8, -24.0, -22.0)}],
        # Section narration in Pip's voice (zones; the client merges them into the manifest).
        "zones": [
            _zone("leap-zone-learn", -21.2, -14.6, -21.6, -16.6, "Pip: Welcome to Pirate's Leap! Walk onto the first step, then press Jump to hop up the others."),
            _zone("leap-zone-barrels", -27.6, -21.4, -21.0, -16.8, "Pip: Barrel Crossing! Jump from barrel to barrel. You can walk round the pool too."),
            _zone("leap-zone-logs", -32.2, -27.0, -31.0, -21.2, "Pip: The Fallen Log Trail. Run before you jump to go further!"),
            _zone("leap-zone-dock", -27.8, -21.0, -35.0, -31.2, "Pip: The Moving Dock. Wait for it to stop, then step on and ride across."),
            _zone("leap-zone-lift", -21.4, -16.4, -30.8, -26.8, "Pip: Step on the gold plate to wake the Pirate Lift, then ride it up!"),
            _zone("leap-zone-nest", -19.6, -16.4, -24.2, -21.6, "Pip: You found my secret treasure! Open the chest."),
        ],
    }


def _zone(zid, min_x, max_x, min_z, max_z, message):
    return {"rect": _rect(zid, min_x, max_x, min_z, max_z), "enterMessage": message}


def upgrade_pirates_leap(region: WorldRegion) -> bool:
    """Write the course into the scene when it is missing or older than `LEAP_VERSION`."""
    scene = dict(region.scene) if isinstance(region.scene, dict) else {}
    if scene.get("piratesLeapVersion", 0) >= LEAP_VERSION:
        return False
    course = leap_platforming()
    problems = layout_problems(course, bounds=BOUNDS)
    if problems:
        raise ValueError(f"Pirate's Leap layout is invalid: {problems}")
    scene["platforming"] = course
    scene["piratesLeapVersion"] = LEAP_VERSION
    region.scene = scene
    region.version += 1
    region.save(update_fields=["scene", "version", "updated_at"])
    return True


# --- rows (catalogue-backed) -----------------------------------------------------------------

_SPECS = {
    # The riddle: count with Pip (optional; it only raises the bonus bridge).
    "riddle": {
        AgeBand.SPROUT: ("counting-sets", 1, 4, "CHOICE", 3),
        AgeBand.PATHFINDER: ("counting-sets", 2, 8, "CHOICE", 3),
        AgeBand.EXPLORER: ("addition-within-ten", 1, 6, "CHOICE", 4),
    },
    # The secret treasure: kept gentle for younger children, every band a choice.
    "chest": {
        AgeBand.SPROUT: ("counting-sets", 1, 5, "CHOICE", 3),
        AgeBand.PATHFINDER: ("counting-sets", 3, 10, "CHOICE", 4),
        AgeBand.EXPLORER: ("addition-within-ten", 2, 10, "CHOICE", 4),
    },
}


def _specs(encounter: str, get_or_create) -> dict:
    out = {}
    for band, (skill, low, high, mode, choices) in _SPECS[encounter].items():
        out[f"{band.lower()}_challenge"] = get_or_create(
            ChallengeSpec,
            {"slug": f"pirates-leap-{encounter}-{band.lower()}"},
            {
                "title": f"Pirate's Leap {encounter}: {skill}",
                "age_band": band,
                "skill_id": skill,
                "min_value": low,
                "max_value": high,
                "response_mode": mode,
                "choice_count": choices,
            },
        )
    return out


REWARD_RULE_IDS = (
    "reward-pirates-leap-chest",
    "reward-pirates-leap-riddle",
    "reward-pirates-leap-shell",
    "reward-pirates-leap-feather",
)


def seed_pirates_leap(region: WorldRegion, get_or_create) -> list[str]:
    """Create Pirate's Leap's rows that do not exist yet. Needs `load_content` first."""
    notes: list[str] = []
    rules = {rule.rule_id: rule for rule in RewardRule.objects.filter(rule_id__in=REWARD_RULE_IDS)}
    quest = Quest.objects.filter(slug=LEAP_QUEST_ID).first()
    if len(rules) != len(REWARD_RULE_IDS) or quest is None:
        return ["Pirate's Leap skipped: run `manage.py load_content` first (quest and rewards)."]
    if upgrade_pirates_leap(region):
        notes.append(f"Pirate's Leap course v{LEAP_VERSION}")
    region.offered_quests.add(quest)

    get_or_create(
        WorldObjectPlacement,
        {"region": region, "entity_id": LEAP_SIGNPOST_ID},
        {
            "kind": PlacementKind.PROP,
            "label": "Pirate's Leap: training course",
            "asset_id": "signpost",
            "x": -14.8,
            "z": -16.8,
            "rotation_y": 2.36,
            "placeholder_width": 0.6,
            "placeholder_height": 1.6,
            "placeholder_depth": 0.2,
        },
    )
    for entity_id, label, x, z, elevation, key, rule_id in (
        (LEAP_SHELL_ID, "Sparkly shell", -24.4, -19.0, 1.3, LEAP_SHELL_KEY, "reward-pirates-leap-shell"),
        (LEAP_FEATHER_ID, "Parrot feather", -29.0, -29.0, 0.9, LEAP_FEATHER_KEY, "reward-pirates-leap-feather"),
    ):
        get_or_create(
            WorldObjectPlacement,
            {"region": region, "entity_id": entity_id},
            {
                "kind": PlacementKind.COLLECTIBLE,
                "label": label,
                "x": x,
                "z": z,
                "elevation": elevation,
                "placeholder_width": 0.4,
                "placeholder_height": 0.3,
                "placeholder_depth": 0.4,
                "pickup_change_key": key,
                "pickup_reward_rule": rules[rule_id],
            },
        )
    get_or_create(
        TreasureChest,
        {"region": region, "entity_id": LEAP_RIDDLE_ID},
        {
            "label": "Pip's riddle drum",
            "asset_id": "",
            "open_clip": "",
            "x": -16.2,
            "z": -21.2,
            "placeholder_width": 0.9,
            "placeholder_height": 0.8,
            "placeholder_depth": 0.9,
            "sort_order": 10,
            "reward_rule": rules["reward-pirates-leap-riddle"],
            "world_change_key": LEAP_RIDDLE_KEY,
            "clue": "Answer Pip's counting riddle to raise a secret bridge. It is just for fun!",
            **_specs("riddle", get_or_create),
        },
    )
    get_or_create(
        TreasureChest,
        {"region": region, "entity_id": LEAP_CHEST_ID},
        {
            "label": "Pip's secret treasure",
            "x": -18.0,
            "z": -22.8,
            "elevation": NEST_TOP,
            "rotation_y": 0.0,
            "placeholder_width": 1.2,
            "placeholder_height": 0.9,
            "placeholder_depth": 0.8,
            "sort_order": 11,
            "reward_rule": rules["reward-pirates-leap-chest"],
            "world_change_key": LEAP_CHEST_KEY,
            "clue": "My secret treasure is up in the crow's nest. Ride the Pirate Lift to reach it!",
            **_specs("chest", get_or_create),
        },
    )
    return notes


def leap_rows(region: WorldRegion) -> dict:
    """What a region has of Pirate's Leap (tests and the QA report)."""
    return {
        "chests": list(
            TreasureChest.objects.filter(region=region, entity_id__in=[LEAP_CHEST_ID, LEAP_RIDDLE_ID])
            .order_by("entity_id")
            .values_list("entity_id", flat=True)
        ),
        "collectibles": list(
            WorldObjectPlacement.objects.filter(
                Q(entity_id=LEAP_SHELL_ID) | Q(entity_id=LEAP_FEATHER_ID), region=region
            ).values_list("entity_id", flat=True)
        ),
        "items": list(
            ItemDefinition.objects.filter(item_id__startswith="pirates-leap-").values_list(
                "item_id", flat=True
            )
        ),
    }


# --- snapshot for the frontend tests (kept equal by `tests/test_pirates_leap.py`) ------------

COURSE_SNAPSHOT_PATH = Path(__file__).with_name("pirates_leap_course.json")


def write_snapshot() -> None:
    COURSE_SNAPSHOT_PATH.write_text(json.dumps(leap_platforming(), indent=1, sort_keys=True) + "\n")


if __name__ == "__main__":
    write_snapshot()  # silent: application code does not print (test_privacy_logging)
