import { describe, expect, it } from 'vitest';
import { BUZZ_AND_THE_WAGGLE_DANCE } from '../../adventures/content/buzzAndTheWaggleDance';
import {
  ALL_ENTITY_IDS,
  ALL_SPOTS,
  BUZZ_SPOT,
  BUZZ_WAGGLE_RUN,
  COMB_WALLS,
  DANCE_FLOOR,
  FLOOR,
  GROUND_HALF_EXTENT_X,
  GROUND_HALF_EXTENT_Z,
  HIVE_MOUTH_SPOT,
  SISTER_BEE_SPOTS,
  SISTER_WAGGLE_RUN,
  WONDERWILD_HIVE_REGION_CHECKPOINTS,
  ZONES,
  findZone,
  isWalkable,
} from './wonderwildHiveRegion';
import { isInsideRect, rectsOverlap } from './wonderwildForestRegion';
import type { RectZone } from './wonderwildForestRegion';

const GRID_STEP = 0.25;
const SPAWN = WONDERWILD_HIVE_REGION_CHECKPOINTS[0];

function reachableFrom(start: { x: number; z: number }): Set<string> {
  const key = (x: number, z: number) => `${Math.round(x / GRID_STEP)}:${Math.round(z / GRID_STEP)}`;
  const snap = (value: number) => Math.round(value / GRID_STEP) * GRID_STEP;
  const startX = snap(start.x);
  const startZ = snap(start.z);
  if (!isWalkable(startX, startZ)) return new Set();

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
      if (seen.has(cellKey) || !isWalkable(x, z)) continue;
      seen.add(cellKey);
      queue.push({ x, z });
    }
  }
  return seen;
}

function wasReached(reached: Set<string>, x: number, z: number): boolean {
  return reached.has(`${Math.round(x / GRID_STEP)}:${Math.round(z / GRID_STEP)}`);
}

describe('wonderwildHiveRegion shell', () => {
  it('walls the comb on all four sides', () => {
    expect(COMB_WALLS).toHaveLength(4);
    const ids = COMB_WALLS.map((wall) => wall.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('encloses the room: stepping off the floor is always blocked', () => {
    for (let x = -GROUND_HALF_EXTENT_X; x <= GROUND_HALF_EXTENT_X; x += GRID_STEP) {
      expect(isWalkable(x, -GROUND_HALF_EXTENT_Z)).toBe(false);
      expect(isWalkable(x, GROUND_HALF_EXTENT_Z)).toBe(false);
    }
    for (let z = -GROUND_HALF_EXTENT_Z; z <= GROUND_HALF_EXTENT_Z; z += GRID_STEP) {
      expect(isWalkable(-GROUND_HALF_EXTENT_X, z)).toBe(false);
      expect(isWalkable(GROUND_HALF_EXTENT_X, z)).toBe(false);
    }
  });

  it('leaves the middle of the room walkable', () => {
    expect(isWalkable(0, 0)).toBe(true);
    expect(isInsideRect(0, 0, FLOOR)).toBe(true);
  });
});

describe('wonderwildHiveRegion reachability', () => {
  it('spawns the child at the hive mouth, walkable', () => {
    expect(SPAWN.id).toBe('wonderwild-hive:entrance');
    expect(isWalkable(SPAWN.x, SPAWN.z)).toBe(true);
  });

  it('reaches every checkpoint, zone, and spot from the spawn point', () => {
    const reached = reachableFrom(SPAWN);
    for (const checkpoint of WONDERWILD_HIVE_REGION_CHECKPOINTS) {
      expect(isWalkable(checkpoint.x, checkpoint.z), `${checkpoint.id} is not walkable`).toBe(true);
      expect(wasReached(reached, checkpoint.x, checkpoint.z), `${checkpoint.id} is cut off`).toBe(
        true,
      );
    }
    for (const spot of ALL_SPOTS) {
      expect(isWalkable(spot.x, spot.z), `${spot.entityId} is inside a wall`).toBe(true);
      expect(wasReached(reached, spot.x, spot.z), `${spot.entityId} is unreachable`).toBe(true);
    }
  });

  it('keeps the way back out reachable', () => {
    const reached = reachableFrom(SPAWN);
    const mouth = findZone('wonderwild-hive-mouth') as RectZone;
    const x = (mouth.minX + mouth.maxX) / 2;
    const z = (mouth.minZ + mouth.maxZ) / 2;
    expect(isWalkable(x, z)).toBe(true);
    expect(wasReached(reached, x, z)).toBe(true);
  });
});

describe('wonderwildHiveRegion the dance', () => {
  it('waggles exactly as many times as count-the-waggles grades', () => {
    // The whole point of beat 7: the child counts a thing that happens, and
    // the thing that happens is authored from the step's own answer rather
    // than typed twice. Content and question can never drift apart.
    const step = BUZZ_AND_THE_WAGGLE_DANCE.steps.find((s) => s.id === 'count-the-waggles');
    expect(step).toBeDefined();
    expect(step?.presentation.kind).toBe('number-input');
    const presentation = step?.presentation as { kind: 'number-input'; correctValue: number };
    expect(BUZZ_WAGGLE_RUN.waggleCount).toBe(presentation.correctValue);
  });

  it("makes Buzz's run visibly longer than her sister's", () => {
    // Beat 6 asks what a long waggle means, and "long" compared to what has
    // never been on screen. The comparison is the room's whole contribution
    // to `observe-the-dance`; it adds no step and no authored text.
    const lengthOf = (run: typeof BUZZ_WAGGLE_RUN): number =>
      Math.hypot(run.toX - run.fromX, run.toZ - run.fromZ);
    expect(lengthOf(BUZZ_WAGGLE_RUN)).toBeGreaterThan(2 * lengthOf(SISTER_WAGGLE_RUN));
    expect(BUZZ_WAGGLE_RUN.waggleCount).toBeGreaterThan(SISTER_WAGGLE_RUN.waggleCount);
  });

  it('keeps the whole of both runs on walkable comb, inside the dance floor', () => {
    for (const run of [BUZZ_WAGGLE_RUN, SISTER_WAGGLE_RUN]) {
      for (let t = 0; t <= 1; t += 0.05) {
        const x = run.fromX + (run.toX - run.fromX) * t;
        const z = run.fromZ + (run.toZ - run.fromZ) * t;
        expect(isWalkable(x, z), `${run.id} leaves the floor`).toBe(true);
      }
    }
    for (let t = 0; t <= 1; t += 0.05) {
      const x = BUZZ_WAGGLE_RUN.fromX + (BUZZ_WAGGLE_RUN.toX - BUZZ_WAGGLE_RUN.fromX) * t;
      const z = BUZZ_WAGGLE_RUN.fromZ + (BUZZ_WAGGLE_RUN.toZ - BUZZ_WAGGLE_RUN.fromZ) * t;
      expect(isInsideRect(x, z, DANCE_FLOOR)).toBe(true);
    }
  });

  it('puts the whole run in front of a child standing anywhere in the approach zone', () => {
    // Beat 7's third requirement: countable from where the child is standing,
    // without moving. The zone faces +Z, so every point of the run must be
    // north of every point of the zone.
    const zone = findZone('wonderwild-hive-dance-floor') as RectZone;
    expect(Math.min(BUZZ_WAGGLE_RUN.fromZ, BUZZ_WAGGLE_RUN.toZ)).toBeGreaterThan(zone.maxZ);
    expect(rectsOverlap(zone, DANCE_FLOOR)).toBe(false);
    // ...and close enough to count: five waggles at fifteen metres is a guess.
    const farthest = Math.hypot(
      BUZZ_WAGGLE_RUN.toX - (zone.minX + zone.maxX) / 2,
      BUZZ_WAGGLE_RUN.toZ - zone.minZ,
    );
    expect(farthest).toBeLessThanOrEqual(6);
  });

  it('stands Buzz on the dance floor and her three sisters around it', () => {
    expect(isInsideRect(BUZZ_SPOT.x, BUZZ_SPOT.z, DANCE_FLOOR)).toBe(true);
    expect(SISTER_BEE_SPOTS).toHaveLength(3);
    for (const sister of SISTER_BEE_SPOTS) {
      expect(isInsideRect(sister.x, sister.z, DANCE_FLOOR), 'a sister blocks the dance').toBe(
        false,
      );
      const distance = Math.hypot(sister.x - BUZZ_SPOT.x, sister.z - BUZZ_SPOT.z);
      expect(distance, 'a sister watching from across the room is not watching').toBeLessThan(5);
    }
  });
});

describe('wonderwildHiveRegion entity spots', () => {
  it('has unique entity ids', () => {
    expect(new Set(ALL_ENTITY_IDS).size).toBe(ALL_ENTITY_IDS.length);
  });

  it('shares no entity id with the forest region', async () => {
    const forest = await import('./wonderwildForestRegion');
    for (const id of ALL_ENTITY_IDS) {
      expect(forest.ALL_ENTITY_IDS).not.toContain(id);
    }
  });

  it('has unique zone ids and finds them by id', () => {
    const ids = ZONES.map((zone) => zone.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const zone of ZONES) {
      expect(findZone(zone.id)).toEqual(zone);
    }
    expect(findZone('not-a-zone')).toBeUndefined();
  });

  it('puts the hive mouth at the west end, beside the way out', () => {
    const mouth = findZone('wonderwild-hive-mouth') as RectZone;
    expect(HIVE_MOUTH_SPOT.x).toBeLessThan(mouth.minX);
  });
});
