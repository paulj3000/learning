import { describe, expect, it } from 'vitest';
import { CLOCKWORK_HARBOR_REGION_ID, resolveSpawnCheckpoint } from '../../discovery/checkpoints';
import {
  AMBIENT_GULL_PATH,
  BOUNDARY_WALLS,
  CLOCK_TOWER,
  CLOCKWORK_HARBOR_REGION_CHECKPOINTS,
  COLLIDERS,
  DISTRICT_LABELS,
  DISTRICT_ZONES,
  DOCK_CLUTTER,
  DOCK_DECK,
  GOLDEN_GEAR_SPOTS,
  GROUND_HALF_EXTENT,
  HARBOR_GATE,
  LIGHTHOUSE,
  LIGHTHOUSE_MECHANISM,
  MARKET_STALLS,
  NPC_SPOTS,
  REGION_ID,
  WATER_ZONES,
  findDistrictZone,
  isInsideRect,
} from './clockworkHarborRegion';

function insideAnyCollider(x: number, z: number): boolean {
  return COLLIDERS.some((collider) => isInsideRect(x, z, collider));
}

function onGround(x: number, z: number): boolean {
  return Math.abs(x) <= GROUND_HALF_EXTENT && Math.abs(z) <= GROUND_HALF_EXTENT;
}

describe('region identity', () => {
  it('uses the region id the World State layer owns', () => {
    expect(REGION_ID).toBe(CLOCKWORK_HARBOR_REGION_ID);
  });

  it('authors checkpoints that all belong to this region', () => {
    for (const checkpoint of CLOCKWORK_HARBOR_REGION_CHECKPOINTS) {
      expect(checkpoint.regionId).toBe(REGION_ID);
    }
  });

  it('spawns a first-time visitor at the harbor gate', () => {
    expect(resolveSpawnCheckpoint(REGION_ID, undefined).id).toBe(
      'clockwork-harbor:harbor-entrance',
    );
  });

  it('spawns a returning child back where they left off', () => {
    expect(resolveSpawnCheckpoint(REGION_ID, 'clockwork-harbor:marketplace').id).toBe(
      'clockwork-harbor:marketplace',
    );
  });

  it('ignores a checkpoint saved in another region', () => {
    expect(resolveSpawnCheckpoint(REGION_ID, 'welcome-harbor:dock').id).toBe(
      'clockwork-harbor:harbor-entrance',
    );
  });
});

describe('checkpoints are standable', () => {
  it('never places a checkpoint inside a collider', () => {
    // A checkpoint a child cannot stand on is a spawn point that strands them.
    for (const checkpoint of CLOCKWORK_HARBOR_REGION_CHECKPOINTS) {
      expect(
        insideAnyCollider(checkpoint.x, checkpoint.z),
        `${checkpoint.id} spawns inside a collider`,
      ).toBe(false);
    }
  });

  it('never places a checkpoint off the ground plane', () => {
    for (const checkpoint of CLOCKWORK_HARBOR_REGION_CHECKPOINTS) {
      expect(onGround(checkpoint.x, checkpoint.z), `${checkpoint.id} is off the plot`).toBe(true);
    }
  });

  it('puts the lighthouse checkpoints where their names claim', () => {
    const lamp = CLOCKWORK_HARBOR_REGION_CHECKPOINTS.find(
      (c) => c.id === 'clockwork-harbor:lighthouse-lamp',
    );
    expect(lamp).toBeDefined();
    // The machine-room checkpoint must actually be in the machine room.
    expect(isInsideRect(lamp!.x, lamp!.z, LIGHTHOUSE.interiorZone)).toBe(true);

    const door = CLOCKWORK_HARBOR_REGION_CHECKPOINTS.find(
      (c) => c.id === 'clockwork-harbor:lighthouse-door',
    );
    expect(isInsideRect(door!.x, door!.z, LIGHTHOUSE.interiorZone)).toBe(false);
  });
});

describe('the lighthouse is enterable', () => {
  it('leaves exactly one side open as a doorway', () => {
    expect(LIGHTHOUSE.wallSides).toHaveLength(3);
    expect(LIGHTHOUSE.wallSides).not.toContain('east');
  });

  it('puts the power mechanism inside, where the child has to walk to reach it', () => {
    expect(
      isInsideRect(LIGHTHOUSE_MECHANISM.x, LIGHTHOUSE_MECHANISM.z, LIGHTHOUSE.interiorZone),
    ).toBe(true);
  });

  it('does not wall off its own interior with a collider', () => {
    expect(insideAnyCollider(LIGHTHOUSE_MECHANISM.x, LIGHTHOUSE_MECHANISM.z)).toBe(false);
  });
});

describe('districts', () => {
  it('gives every zone a child-facing label', () => {
    for (const zone of DISTRICT_ZONES) {
      expect(DISTRICT_LABELS[zone.id], `${zone.id} has no label`).toBeTruthy();
    }
    expect(Object.keys(DISTRICT_LABELS)).toHaveLength(DISTRICT_ZONES.length);
  });

  it('gives every zone a positive footprint', () => {
    for (const zone of DISTRICT_ZONES) {
      expect(zone.maxX).toBeGreaterThan(zone.minX);
      expect(zone.maxZ).toBeGreaterThan(zone.minZ);
    }
  });

  it('does not overlap two districts, so a step never fires two toasts', () => {
    for (let i = 0; i < DISTRICT_ZONES.length; i += 1) {
      for (let j = i + 1; j < DISTRICT_ZONES.length; j += 1) {
        const a = DISTRICT_ZONES[i];
        const b = DISTRICT_ZONES[j];
        const overlaps = a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ;
        expect(overlaps, `${a.id} overlaps ${b.id}`).toBe(false);
      }
    }
  });

  it('looks a zone up by id', () => {
    expect(findDistrictZone('clockwork-harbor:zone:docks')?.minX).toBe(-8);
    expect(findDistrictZone('nope')).toBeUndefined();
  });

  it('keeps every district on the ground plane', () => {
    for (const zone of DISTRICT_ZONES) {
      expect(onGround(zone.minX, zone.minZ)).toBe(true);
      expect(onGround(zone.maxX, zone.maxZ)).toBe(true);
    }
  });
});

describe('the dock and the water', () => {
  it('keeps the walkable deck clear of the water colliders', () => {
    // The deck runs between the two water zones; walking it must not be blocked.
    for (let z = DOCK_DECK.minZ; z <= DOCK_DECK.maxZ; z += 0.5) {
      expect(insideAnyCollider(0, z), `dock deck blocked at z=${z}`).toBe(false);
    }
  });

  it('makes open water solid, so a child cannot walk out of the world', () => {
    for (const water of WATER_ZONES) {
      const midX = (water.minX + water.maxX) / 2;
      const midZ = (water.minZ + water.maxZ) / 2;
      expect(insideAnyCollider(midX, midZ), `${water.id} is walkable`).toBe(true);
    }
  });

  it('places dock clutter off the deck itself', () => {
    for (const crate of DOCK_CLUTTER) {
      expect(isInsideRect(crate.x, crate.z, DOCK_DECK), 'clutter blocks the deck').toBe(false);
    }
  });
});

describe('NPCs and props', () => {
  it('gives every NPC a distinct id and a readable label', () => {
    expect(new Set(NPC_SPOTS.map((npc) => npc.id)).size).toBe(NPC_SPOTS.length);
    for (const npc of NPC_SPOTS) expect(npc.label.length).toBeGreaterThan(0);
  });

  it('never stands an NPC inside a collider', () => {
    for (const npc of NPC_SPOTS) {
      expect(insideAnyCollider(npc.x, npc.z), `${npc.id} is stuck in geometry`).toBe(false);
    }
  });

  it('puts the Harbor Master on the path from the gate to the dock', () => {
    const master = NPC_SPOTS.find((npc) => npc.id === 'harbor-master');
    expect(master).toBeDefined();
    // He must be reachable on the deck a child walks in along.
    expect(isInsideRect(master!.x, master!.z, DOCK_DECK)).toBe(true);
  });

  it('gives the interactive props stable, region-prefixed ids', () => {
    for (const id of [LIGHTHOUSE_MECHANISM.id, HARBOR_GATE.id]) {
      expect(id.startsWith('clockwork-harbor:prop:')).toBe(true);
    }
  });
});

describe('golden gears', () => {
  it('places only ids the harbor actually authors', () => {
    for (const spot of GOLDEN_GEAR_SPOTS) {
      expect(spot.id).toMatch(/^golden-gear-\d{2}$/);
    }
  });

  it('places each gear somewhere distinct and reachable', () => {
    expect(new Set(GOLDEN_GEAR_SPOTS.map((spot) => spot.id)).size).toBe(GOLDEN_GEAR_SPOTS.length);
    for (const spot of GOLDEN_GEAR_SPOTS) {
      expect(onGround(spot.x, spot.z), `${spot.id} is off the plot`).toBe(true);
    }
  });
});

describe('boundaries and ambience', () => {
  it('closes the plot on all four sides', () => {
    expect(BOUNDARY_WALLS).toHaveLength(4);
    // Just outside each edge is solid.
    expect(insideAnyCollider(0, GROUND_HALF_EXTENT + 0.5)).toBe(true);
    expect(insideAnyCollider(0, -GROUND_HALF_EXTENT - 0.5)).toBe(true);
    expect(insideAnyCollider(GROUND_HALF_EXTENT + 0.5, 0)).toBe(true);
    expect(insideAnyCollider(-GROUND_HALF_EXTENT - 0.5, 0)).toBe(true);
  });

  it('flies the gull above head height, on a closed loop', () => {
    expect(AMBIENT_GULL_PATH.length).toBeGreaterThanOrEqual(4);
    for (const point of AMBIENT_GULL_PATH) {
      expect(point.y).toBeGreaterThan(2);
    }
  });

  it('keeps the market stalls and clock tower solid', () => {
    for (const stall of MARKET_STALLS) {
      expect(insideAnyCollider(stall.x, stall.z), `${stall.id} is walkable`).toBe(true);
    }
    expect(insideAnyCollider(CLOCK_TOWER.x, CLOCK_TOWER.z)).toBe(true);
  });
});
