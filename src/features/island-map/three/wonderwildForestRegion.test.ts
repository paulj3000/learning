import { describe, expect, it } from 'vitest';
import {
  ALL_ENTITY_IDS,
  ALL_SPOTS,
  COLLIDERS,
  GLADES,
  GROUND_HALF_EXTENT_X,
  GROUND_HALF_EXTENT_Z,
  OPEN_GROUND,
  POND_WATER,
  TRAILS,
  TREE_LINE_SEGMENTS,
  WONDERWILD_FOREST_REGION_CHECKPOINTS,
  WONDER_STONE_SPOTS,
  ZONES,
  buildTreeLineSegments,
  findZone,
  isBlocked,
  isInsideRect,
  isOnOpenGround,
  isWalkable,
  rectsOverlap,
} from './wonderwildForestRegion';
import type { RectZone } from './wonderwildForestRegion';

const GRID_STEP = 0.25;

/**
 * Flood fills the forest's walkable ground from one point, on a 0.25m grid.
 * The step is deliberately far smaller than the narrowest trail (2m), so no
 * tree line can be stepped over and no trail can be missed between samples.
 */
function reachableFrom(
  start: { x: number; z: number },
  walkable: (x: number, z: number) => boolean,
): Set<string> {
  const key = (x: number, z: number) => `${Math.round(x / GRID_STEP)}:${Math.round(z / GRID_STEP)}`;
  const snap = (value: number) => Math.round(value / GRID_STEP) * GRID_STEP;

  const startX = snap(start.x);
  const startZ = snap(start.z);
  if (!walkable(startX, startZ)) return new Set();

  const seen = new Set<string>([key(startX, startZ)]);
  const queue: { x: number; z: number }[] = [{ x: startX, z: startZ }];

  while (queue.length > 0) {
    const cell = queue.pop() as { x: number; z: number };
    for (const [dx, dz] of [
      [GRID_STEP, 0],
      [-GRID_STEP, 0],
      [0, GRID_STEP],
      [0, -GRID_STEP],
    ]) {
      const x = cell.x + dx;
      const z = cell.z + dz;
      if (Math.abs(x) > GROUND_HALF_EXTENT_X || Math.abs(z) > GROUND_HALF_EXTENT_Z) continue;
      const cellKey = key(x, z);
      if (seen.has(cellKey) || !walkable(x, z)) continue;
      seen.add(cellKey);
      queue.push({ x, z });
    }
  }
  return seen;
}

function wasReached(reached: Set<string>, x: number, z: number): boolean {
  return reached.has(`${Math.round(x / GRID_STEP)}:${Math.round(z / GRID_STEP)}`);
}

/** Any walkable sample inside this rect, or `null` when the rect has none. */
function walkablePointIn(
  rect: RectZone,
  walkable: (x: number, z: number) => boolean,
): { x: number; z: number } | null {
  for (let x = rect.minX + GRID_STEP; x < rect.maxX; x += GRID_STEP) {
    for (let z = rect.minZ + GRID_STEP; z < rect.maxZ; z += GRID_STEP) {
      const sx = Math.round(x / GRID_STEP) * GRID_STEP;
      const sz = Math.round(z / GRID_STEP) * GRID_STEP;
      if (walkable(sx, sz)) return { x: sx, z: sz };
    }
  }
  return null;
}

const SPAWN = WONDERWILD_FOREST_REGION_CHECKPOINTS[0];

describe('wonderwildForestRegion glades', () => {
  it('has unique glade ids', () => {
    const ids = GLADES.map((glade) => glade.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every glade a child-facing label', () => {
    for (const glade of GLADES) {
      expect(glade.label.length).toBeGreaterThan(0);
      expect(glade.label).not.toMatch(/[_:]/);
    }
  });

  it('keeps every glade inside the region ground extents', () => {
    for (const glade of GLADES) {
      expect(glade.ground.minX).toBeGreaterThanOrEqual(-GROUND_HALF_EXTENT_X);
      expect(glade.ground.maxX).toBeLessThanOrEqual(GROUND_HALF_EXTENT_X);
      expect(glade.ground.minZ).toBeGreaterThanOrEqual(-GROUND_HALF_EXTENT_Z);
      expect(glade.ground.maxZ).toBeLessThanOrEqual(GROUND_HALF_EXTENT_Z);
    }
  });

  it('never overlaps two glades', () => {
    for (let i = 0; i < GLADES.length; i += 1) {
      for (let j = i + 1; j < GLADES.length; j += 1) {
        expect(rectsOverlap(GLADES[i].ground, GLADES[j].ground)).toBe(false);
      }
    }
  });

  it('separates every glade from every other by real tree line, never a shared edge', () => {
    // Glades that merely touch would let a child cross without a trail, which
    // would make `TrailWear` meaningless and beat 2's wayfinding pointless.
    for (let i = 0; i < GLADES.length; i += 1) {
      for (let j = i + 1; j < GLADES.length; j += 1) {
        const a = GLADES[i].ground;
        const b = GLADES[j].ground;
        const gapX = Math.max(a.minX - b.maxX, b.minX - a.maxX);
        const gapZ = Math.max(a.minZ - b.maxZ, b.minZ - a.maxZ);
        expect(Math.max(gapX, gapZ)).toBeGreaterThan(0);
      }
    }
  });
});

describe('wonderwildForestRegion trails', () => {
  it('has unique trail ids and at least one rect each', () => {
    const ids = TRAILS.map((trail) => trail.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const trail of TRAILS) {
      expect(trail.rects.length).toBeGreaterThan(0);
    }
  });

  it('names two real, distinct glades per trail', () => {
    const gladeIds = new Set(GLADES.map((glade) => glade.id));
    for (const trail of TRAILS) {
      const [from, to] = trail.connects;
      expect(gladeIds.has(from)).toBe(true);
      expect(gladeIds.has(to)).toBe(true);
      expect(from).not.toBe(to);
    }
  });

  it('actually touches both glades it claims to connect, with room to spare', () => {
    for (const trail of TRAILS) {
      for (const gladeId of trail.connects) {
        const glade = GLADES.find((candidate) => candidate.id === gladeId);
        expect(glade, `${trail.id} names an unknown glade`).toBeDefined();
        const overlapping = trail.rects.filter((rect) =>
          rectsOverlap(rect, (glade as (typeof GLADES)[number]).ground),
        );
        expect(overlapping.length, `${trail.id} does not reach ${gladeId}`).toBeGreaterThan(0);
        // A connection one grid sample wide is a connection waiting to break.
        const deepest = Math.max(
          ...overlapping.map((rect) => {
            const g = (glade as (typeof GLADES)[number]).ground;
            const overlapX = Math.min(rect.maxX, g.maxX) - Math.max(rect.minX, g.minX);
            const overlapZ = Math.min(rect.maxZ, g.maxZ) - Math.max(rect.minZ, g.minZ);
            return Math.min(overlapX, overlapZ);
          }),
        );
        expect(deepest, `${trail.id} barely grazes ${gladeId}`).toBeGreaterThanOrEqual(0.5);
      }
    }
  });

  it('leaves every trail walkable along its whole length', () => {
    for (const trail of TRAILS) {
      for (const rect of trail.rects) {
        expect(walkablePointIn(rect, isWalkable), `${rect.id} is sealed`).not.toBeNull();
      }
    }
  });

  it('joins every glade to the rest of the forest', () => {
    const connected = new Set(TRAILS.flatMap((trail) => trail.connects));
    for (const glade of GLADES) {
      expect(connected.has(glade.id), `${glade.id} has no trail`).toBe(true);
    }
  });

  it("makes the bee's trail the widest, because it is the only wayfinding beat 2 has", () => {
    const worn = TRAILS.filter((trail) => trail.wear === 'worn');
    expect(worn).toHaveLength(1);
    expect(worn[0].id).toBe('hub-to-hive-clearing');

    const widthOf = (trail: (typeof TRAILS)[number]): number =>
      Math.max(
        ...trail.rects.map((rect) => Math.min(rect.maxX - rect.minX, rect.maxZ - rect.minZ)),
      );
    const wornWidth = widthOf(worn[0]);
    for (const trail of TRAILS) {
      if (trail.wear === 'faint') {
        expect(widthOf(trail), `${trail.id} is as wide as the worn trail`).toBeLessThan(wornWidth);
      }
    }
  });

  it('draws no trail at all to the fern bank, so beat 11 stays unmarked', () => {
    // A drawn trail to the glowing moss would be a signpost pointing at the
    // one thing the storyboard insists nothing points at.
    const toFernBank = TRAILS.filter((trail) => trail.connects.includes('fern-bank'));
    expect(toFernBank.length).toBeGreaterThan(0);
    for (const trail of toFernBank) {
      expect(trail.wear).toBe('none');
    }
  });

  it('keeps every drawn trail clear of the glow-moss discovery zone', () => {
    const mossZone = findZone('wonderwild-glow-moss') as RectZone;
    for (const trail of TRAILS) {
      if (trail.wear === 'none') continue;
      for (const rect of trail.rects) {
        expect(rectsOverlap(rect, mossZone), `${trail.id} runs through the secret`).toBe(false);
      }
    }
  });
});

describe('wonderwildForestRegion tree line', () => {
  it('gives every segment a unique id and a positive footprint', () => {
    const ids = TREE_LINE_SEGMENTS.map((segment) => segment.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const segment of TREE_LINE_SEGMENTS) {
      expect(segment.maxX).toBeGreaterThan(segment.minX);
      expect(segment.maxZ).toBeGreaterThan(segment.minZ);
    }
  });

  it('never overlaps open ground', () => {
    for (const segment of TREE_LINE_SEGMENTS) {
      for (const open of OPEN_GROUND) {
        expect(rectsOverlap(segment, open), `${segment.id} eats into ${open.id}`).toBe(false);
      }
    }
  });

  it('covers the whole region with no gap: every point is open ground or trees', () => {
    // The reason the tree line is derived rather than hand-listed. A hole in
    // this cover is a place the child walks into the void.
    for (let x = -GROUND_HALF_EXTENT_X; x <= GROUND_HALF_EXTENT_X; x += GRID_STEP) {
      for (let z = -GROUND_HALF_EXTENT_Z; z <= GROUND_HALF_EXTENT_Z; z += GRID_STEP) {
        const covered =
          isOnOpenGround(x, z) || TREE_LINE_SEGMENTS.some((seg) => isInsideRect(x, z, seg));
        expect(covered, `nothing covers (${x}, ${z})`).toBe(true);
      }
    }
  });

  it('encloses the forest: no walkable point sits on the region boundary', () => {
    // Derived tree line runs to the ground extents, so unlike the bay this
    // region needs no boundary walls of its own.
    for (let x = -GROUND_HALF_EXTENT_X; x <= GROUND_HALF_EXTENT_X; x += GRID_STEP) {
      expect(isWalkable(x, -GROUND_HALF_EXTENT_Z)).toBe(false);
      expect(isWalkable(x, GROUND_HALF_EXTENT_Z)).toBe(false);
    }
    for (let z = -GROUND_HALF_EXTENT_Z; z <= GROUND_HALF_EXTENT_Z; z += GRID_STEP) {
      expect(isWalkable(-GROUND_HALF_EXTENT_X, z)).toBe(false);
      expect(isWalkable(GROUND_HALF_EXTENT_X, z)).toBe(false);
    }
  });

  it('rebuilds from modified inputs, so the flood fill can be tested against them', () => {
    const withoutTrails = buildTreeLineSegments(GLADES.map((glade) => glade.ground));
    expect(withoutTrails.length).toBeGreaterThan(0);
    expect(withoutTrails).not.toEqual(TREE_LINE_SEGMENTS);
  });

  it('collides against the pond as well as the trees', () => {
    expect(COLLIDERS).toContain(POND_WATER);
    expect(isBlocked(9, 9)).toBe(true);
    expect(isWalkable(9, 9)).toBe(false);
  });

  it('keeps the pond inside its own glade', () => {
    const pondGlade = GLADES.find((glade) => glade.id === 'pond-glade') as (typeof GLADES)[number];
    expect(POND_WATER.minX).toBeGreaterThanOrEqual(pondGlade.ground.minX);
    expect(POND_WATER.maxX).toBeLessThanOrEqual(pondGlade.ground.maxX);
    expect(POND_WATER.minZ).toBeGreaterThanOrEqual(pondGlade.ground.minZ);
    expect(POND_WATER.maxZ).toBeLessThanOrEqual(pondGlade.ground.maxZ);
  });
});

describe('wonderwildForestRegion reachability', () => {
  it('spawns the child somewhere walkable', () => {
    expect(isWalkable(SPAWN.x, SPAWN.z)).toBe(true);
  });

  it('reaches every glade from the spawn point on foot', () => {
    const reached = reachableFrom(SPAWN, isWalkable);
    for (const glade of GLADES) {
      const point = walkablePointIn(glade.ground, isWalkable);
      expect(point, `${glade.id} has no walkable ground`).not.toBeNull();
      expect(
        wasReached(
          reached,
          (point as { x: number; z: number }).x,
          (point as { x: number; z: number }).z,
        ),
        `${glade.id} is unreachable`,
      ).toBe(true);
    }
  });

  it('reaches every checkpoint from the spawn point on foot', () => {
    const reached = reachableFrom(SPAWN, isWalkable);
    for (const checkpoint of WONDERWILD_FOREST_REGION_CHECKPOINTS) {
      expect(isWalkable(checkpoint.x, checkpoint.z), `${checkpoint.id} is not walkable`).toBe(true);
      expect(wasReached(reached, checkpoint.x, checkpoint.z), `${checkpoint.id} is cut off`).toBe(
        true,
      );
    }
  });

  it('reaches the way back out to Welcome Harbor', () => {
    const reached = reachableFrom(SPAWN, isWalkable);
    const exit = findZone('wonderwild-harbor-exit') as RectZone;
    const point = walkablePointIn(exit, isWalkable);
    expect(point).not.toBeNull();
    expect(
      wasReached(
        reached,
        (point as { x: number; z: number }).x,
        (point as { x: number; z: number }).z,
      ),
    ).toBe(true);
  });

  it('is sensitive to the trails: removing one strands the glade behind it', () => {
    // Without this the reachability tests above would pass just as well
    // against a tree line that was wrong everywhere.
    const kept = TRAILS.filter((trail) => trail.id !== 'hub-to-hive-clearing');
    const open = [...GLADES.map((glade) => glade.ground), ...kept.flatMap((trail) => trail.rects)];
    const treeLine = buildTreeLineSegments(open);
    const walkable = (x: number, z: number): boolean =>
      open.some((rect) => isInsideRect(x, z, rect)) &&
      !treeLine.some((seg) => isInsideRect(x, z, seg)) &&
      !isInsideRect(x, z, POND_WATER);

    const reached = reachableFrom(SPAWN, walkable);
    const hive = GLADES.find((glade) => glade.id === 'hive-clearing') as (typeof GLADES)[number];
    const point = walkablePointIn(hive.ground, walkable) as { x: number; z: number };
    expect(point).not.toBeNull();
    expect(wasReached(reached, point.x, point.z)).toBe(false);
  });
});

describe('wonderwildForestRegion zones', () => {
  it('has unique zone ids', () => {
    const ids = ZONES.map((zone) => zone.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('places every zone on walkable ground the child can actually reach', () => {
    const reached = reachableFrom(SPAWN, isWalkable);
    for (const zone of ZONES) {
      const point = walkablePointIn(zone, isWalkable);
      expect(point, `${zone.id} has no walkable ground in it`).not.toBeNull();
      const { x, z } = point as { x: number; z: number };
      expect(wasReached(reached, x, z), `${zone.id} is unreachable`).toBe(true);
    }
  });

  it('never overlaps the arrival zone with the way out', () => {
    const arrival = findZone('wonderwild-harbor-path') as RectZone;
    const exit = findZone('wonderwild-harbor-exit') as RectZone;
    expect(rectsOverlap(arrival, exit)).toBe(false);
  });

  it('keeps the four wonder-stone zones apart from each other', () => {
    // Overlapping them would let one step forward stand at two questions at
    // once, and `wonder-wall` would come down to listener order - the exact
    // defect SC-0 found in the castle's three tower windows.
    const stoneZones = WONDER_STONE_SPOTS.map((spot) => findZone(spot.entityId) as RectZone);
    for (const zone of stoneZones) expect(zone).toBeDefined();

    for (let i = 0; i < stoneZones.length; i += 1) {
      for (let j = i + 1; j < stoneZones.length; j += 1) {
        const a = stoneZones[i];
        const b = stoneZones[j];
        expect(rectsOverlap(a, b)).toBe(false);
        const gapX = Math.max(a.minX - b.maxX, b.minX - a.maxX);
        const gapZ = Math.max(a.minZ - b.maxZ, b.minZ - a.maxZ);
        expect(Math.max(gapX, gapZ), `${a.id} and ${b.id} are too close`).toBeGreaterThanOrEqual(
          1.5,
        );
      }
    }
  });

  it('keeps the unmarked glow-moss secret clear of every other zone', () => {
    const moss = findZone('wonderwild-glow-moss') as RectZone;
    for (const zone of ZONES) {
      if (zone.id === moss.id) continue;
      expect(rectsOverlap(moss, zone), `${zone.id} overlaps the secret`).toBe(false);
    }
  });

  it('keeps the pond zone out of the water', () => {
    const pond = findZone('wonderwild-pond') as RectZone;
    expect(rectsOverlap(pond, POND_WATER)).toBe(false);
  });
});

describe('wonderwildForestRegion entity spots', () => {
  it('has unique entity ids', () => {
    expect(new Set(ALL_ENTITY_IDS).size).toBe(ALL_ENTITY_IDS.length);
  });

  it('places nothing in the trees or in the water', () => {
    for (const spot of ALL_SPOTS) {
      expect(isWalkable(spot.x, spot.z), `${spot.entityId} is unreachable`).toBe(true);
    }
  });

  it('authors exactly four wonder stones, in a shallow arc curving toward the child', () => {
    expect(WONDER_STONE_SPOTS).toHaveLength(4);
    const xs = WONDER_STONE_SPOTS.map((spot) => spot.x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    // Outer stones sit further south than inner ones, so the arc faces in.
    expect(WONDER_STONE_SPOTS[0].z).toBeLessThan(WONDER_STONE_SPOTS[1].z);
    expect(WONDER_STONE_SPOTS[3].z).toBeLessThan(WONDER_STONE_SPOTS[2].z);
  });

  it('gives every wonder stone an approach zone, so a band that cannot aim can still choose', () => {
    for (const spot of WONDER_STONE_SPOTS) {
      const zone = findZone(spot.entityId);
      expect(zone, `${spot.entityId} has no approach zone`).toBeDefined();
      // The zone stands in front of the stone, not on top of it.
      expect((zone as RectZone).maxZ).toBeLessThan(spot.z);
    }
  });

  it('stands the flower patch beside the worn trail, where a child walks past it', () => {
    // Beat 10's payoff lands on ground the child noticed on the way in, or it
    // does not land at all - the debt SC-6 had to pay off in the castle.
    const wornTrail = TRAILS.find((trail) => trail.wear === 'worn') as (typeof TRAILS)[number];
    const patch = ALL_SPOTS.find(
      (spot) => spot.entityId === 'wonderwild-flower-patch',
    ) as (typeof ALL_SPOTS)[number];
    const nearest = Math.min(
      ...wornTrail.rects.map((rect) => {
        const dx = Math.max(rect.minX - patch.x, 0, patch.x - rect.maxX);
        const dz = Math.max(rect.minZ - patch.z, 0, patch.z - rect.maxZ);
        return Math.hypot(dx, dz);
      }),
    );
    expect(nearest).toBeLessThanOrEqual(2);
  });

  it('keeps the glow moss far from every drawn trail', () => {
    const moss = ALL_SPOTS.find(
      (spot) => spot.entityId === 'wonderwild-glow-moss',
    ) as (typeof ALL_SPOTS)[number];
    for (const trail of TRAILS) {
      if (trail.wear === 'none') continue;
      for (const rect of trail.rects) {
        const dx = Math.max(rect.minX - moss.x, 0, moss.x - rect.maxX);
        const dz = Math.max(rect.minZ - moss.z, 0, moss.z - rect.maxZ);
        expect(Math.hypot(dx, dz), `${trail.id} passes the secret`).toBeGreaterThan(2);
      }
    }
  });
});
