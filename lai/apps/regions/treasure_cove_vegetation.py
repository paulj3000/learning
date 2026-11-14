"""Treasure Cove's bushes, flowers and grass (ENV-2, TR-NAT-10).

Decoration only: walk-through, never solid, never interactive. Generated, not hand-placed: a
fixed seed per zone and category, so the result is the same on every run and every visit (the
JSON snapshot pins it), and clustered round each zone's palms, logs and rocks so it reads as
growth rather than a carpet.

Every placement must keep clear of:

- the paths (grass and flowers a step off the edge; bushes further, so a path stays visibly open);
- the encounter spots, Pip and the spawn point (bushes further, so nothing is hidden behind one);
- every collider (walls, trunks, barrels, logs, the channel), so nothing grows through a solid;
- the other scenery, the placeholders and the barrels and logs;
- the water (the shallows, the sea and the channel) and the world's edge.

A candidate that breaks a rule is dropped and another drawn; a zone that runs out of room gets
fewer, never a crowded one. `test_treasure_cove_layout.py` re-checks every rule on the output.
"""

import math
import random

# The asset library models (apps/assets/model_packs.py) and each one's footprint radius in metres
# at scale 1, for spacing.
BUSHES = {"nature-bush-small": 0.6, "nature-bush-medium": 0.72, "nature-bush-large": 1.0}
FLOWERS = {
    "nature-flower-tropical-yellow": 0.26,
    "nature-flower-tropical-blue": 0.26,
    "nature-flower-tropical-pink": 0.28,
    "nature-flower-tropical-purple": 0.26,
}
GRASS = {"nature-grass-short": 0.21, "nature-grass-medium": 0.36, "nature-grass-tall": 0.66}
CATEGORY_MODELS = {"bush": BUSHES, "flower": FLOWERS, "grass": GRASS}

# How far from a path's centre line each category stands (a path tile is 1.5 m wide).
PATH_CLEARANCE = {"bush": 2.0, "flower": 1.0, "grass": 0.95}
# How far from a person, a chest or another encounter spot.
SPOT_CLEARANCE = {"bush": 3.0, "flower": 1.6, "grass": 1.4}
COLLIDER_MARGIN = 0.25
SCENERY_CLEARANCE = 0.6

# Per zone: how many of each, and where it may grow (inside the zone, away from the water).
PLAN = {
    "landing": {"bush": 4, "flower": 6, "grass": 10},
    "beach": {"bush": 3, "flower": 4, "grass": 12},
    "grove": {"bush": 12, "flower": 12, "grass": 30},
    "ruins": {"bush": 6, "flower": 8, "grass": 15},
    "lookout": {"bush": 3, "flower": 5, "grass": 8},
}
ZONE_RECTS = {
    "landing": "cove-zone-landing",
    "beach": "cove-zone-beach",
    "grove": "cove-zone-grove",
    "ruins": "cove-zone-ruins",
    "lookout": "cove-zone-lookout",
}
# Water and edges nothing grows in: the north and east shallows, the channel, the dock.
NO_GROW = [
    {"minX": -36, "maxX": 36, "minZ": 40.0, "maxZ": 44},
    {"minX": 32.0, "maxX": 36, "minZ": -30, "maxZ": 44},
    {"minX": -37, "maxX": 37, "minZ": -40.9, "maxZ": -35.9},
    {"minX": -2.5, "maxX": 2.5, "minZ": 28, "maxZ": 44},
]
# Bushes are kept off the yard's open middle, where the child arrives and Pip stands.
OPEN_YARD = {"minX": -6.5, "maxX": 6.5, "minZ": -1, "maxZ": 21}


def _inside(rect, x, z, margin=0.0) -> bool:
    return (
        rect["minX"] - margin <= x <= rect["maxX"] + margin
        and rect["minZ"] - margin <= z <= rect["maxZ"] + margin
    )


def _segment_distance(px, pz, a, b) -> float:
    (ax, az), (bx, bz) = a, b
    dx, dz = bx - ax, bz - az
    length = dx * dx + dz * dz
    t = 0.0 if length == 0 else max(0.0, min(1.0, ((px - ax) * dx + (pz - az) * dz) / length))
    return math.hypot(px - ax - t * dx, pz - az - t * dz)


def vegetation(layout: dict, *, paths, keep_clear) -> list[dict]:
    """The cove's vegetation for `layout` (scenery, colliders, procedural, props, zones)."""
    zones = {zone["rect"]["id"]: zone["rect"] for zone in layout["zones"]}
    colliders = [c["rect"] for c in layout["colliders"]] + [
        rect for prop in layout["props"] for rect in prop["colliders"]
    ]
    others = [
        (p["x"], p["z"])
        for item in layout["scenery"]
        if item["kind"] == "CLUSTER" and not item["assetId"].startswith("path")
        for p in item["positions"]
    ]
    others += [
        (item["position"]["x"], item["position"]["z"])
        for item in layout["scenery"]
        if item["kind"] == "MODEL"
    ]
    others += [(p["x"], p["z"]) for p in layout["procedural"] if p["shape"] != "PALM"]
    others += [(p["x"], p["z"]) for p in layout["props"]]
    segments = [(a, b) for path in paths for a, b in zip(path, path[1:], strict=False)]
    placed: list[tuple[float, float, float]] = []  # x, z, radius
    out: list[dict] = []

    def fits(category, x, z, radius, rect) -> bool:
        if not _inside(rect, x, z, -radius):
            return False
        if any(_inside(area, x, z, radius) for area in NO_GROW):
            return False
        if category == "bush" and _inside(OPEN_YARD, x, z, radius):
            return False
        if min(_segment_distance(x, z, a, b) for a, b in segments) < PATH_CLEARANCE[category]:
            return False
        if any(math.hypot(x - kx, z - kz) < SPOT_CLEARANCE[category] for kx, kz in keep_clear):
            return False
        if any(_inside(c, x, z, radius + COLLIDER_MARGIN) for c in colliders):
            return False
        if any(math.hypot(x - ox, z - oz) < SCENERY_CLEARANCE + radius for ox, oz in others):
            return False
        return all(math.hypot(x - px, z - pz) >= radius + pr + 0.1 for px, pz, pr in placed)

    for zone, plan in PLAN.items():
        rect = zones[ZONE_RECTS[zone]]
        # Anchors: what plants grow round in this zone (palm trunks, logs, barrels, boulders).
        anchors = [
            (p["x"], p["z"])
            for p in layout["procedural"]
            if p["shape"] == "PALM" and _inside(rect, p["x"], p["z"])
        ] + [(p["x"], p["z"]) for p in layout["props"] if _inside(rect, p["x"], p["z"])]
        for category in ("bush", "flower", "grass"):
            models = CATEGORY_MODELS[category]
            names = sorted(models)
            rng = random.Random(f"treasure-cove-vegetation:{zone}:{category}")
            made = 0
            for _attempt in range(400):
                if made >= plan[category]:
                    break
                if anchors and rng.random() < 0.8:
                    ax, az = anchors[rng.randrange(len(anchors))]
                    angle, reach = rng.uniform(0, 2 * math.pi), rng.uniform(1.0, 3.2)
                    x, z = ax + math.cos(angle) * reach, az + math.sin(angle) * reach
                else:
                    x = rng.uniform(rect["minX"], rect["maxX"])
                    z = rng.uniform(rect["minZ"], rect["maxZ"])
                asset_id = names[rng.randrange(len(names))]
                scale = round(rng.uniform(0.85, 1.2), 2)
                yaw = round(rng.uniform(0, 2 * math.pi), 2)
                radius = models[asset_id] * scale
                x, z = round(x, 2), round(z, 2)
                if not fits(category, x, z, radius, rect):
                    continue
                placed.append((x, z, radius))
                out.append(
                    {
                        "id": f"cove-{zone}-{category}-{made}",
                        "assetId": asset_id,
                        "x": x,
                        "z": z,
                        "rotationY": yaw,
                        "scale": scale,
                        "colliders": [],
                    }
                )
                made += 1
    return out
