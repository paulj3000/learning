import {
  WONDERWILD_HIVE_CHECKPOINTS,
  WONDERWILD_HIVE_REGION_ID,
} from '../../discovery/checkpoints';
import type { EntitySpot, RectZone } from './wonderwildForestRegion';
import { isInsideRect } from './wonderwildForestRegion';

/**
 * Pure content and geometry for the inside of the beehive
 * (`docs/WONDERWILD_FOREST_3D_ROADMAP.md` WF-0, storyboard section 3). The
 * second half of Wonderwild Forest, and its own region: beats 4 to 9 happen
 * here, and nothing else does.
 *
 * **The child does not shrink; the hive is built enormous.**
 * `firstPersonController.ts` moves on a flat plane at a fixed `EYE_HEIGHT` of
 * 1.6m, and there is no scale term anywhere in the controller, the camera rig
 * or `sceneKit.ts`. So this region is authored in ordinary metres with a comb
 * cell about 1.4m across and Buzz about 1.2m tall, and the region change is
 * what sells the shrink. That transition is a **cut over a fade, never a
 * zoom** (storyboard section 3): reduced motion is a stated accessibility
 * requirement and a zoom-to-tiny is the most motion-sensitive thing this
 * island could contain.
 *
 * **The comb is a floor, not a wall.** Real honeybees dance on vertical comb;
 * this controller has no vertical traversal and no climbing. Nothing the
 * adventure *claims* changes - a longer waggle run still means a farther food
 * source - so it is a staging simplification, not a factual one, and it is
 * noted as such in `docs/CONTENT_SOURCES.md`.
 *
 * This region is deliberately **not** an `ISLAND_LOCATIONS` entry and not in
 * `homeIsland.ts`. `castle-writing-room` is the near-miss precedent and the
 * distinction matters: the Writing Room is a *location* a child chooses to go
 * back to. The inside of a beehive is a *region the adventure passes
 * through*. A child cannot decide to visit it, so putting it on the island
 * map would be a lie about what it is.
 */

export const REGION_ID = WONDERWILD_HIVE_REGION_ID;

/** 14m x 10m. One room; there is nothing here but the comb and the dance. */
export const GROUND_HALF_EXTENT_X = 7;
export const GROUND_HALF_EXTENT_Z = 5;

const WALL_THICKNESS = 0.5;

/** The whole floor is walkable; the comb walls are the only colliders. */
export const FLOOR: RectZone = {
  id: 'hive:floor',
  minX: -GROUND_HALF_EXTENT_X,
  maxX: GROUND_HALF_EXTENT_X,
  minZ: -GROUND_HALF_EXTENT_Z,
  maxZ: GROUND_HALF_EXTENT_Z,
};

/**
 * Four comb walls, one thin rect per edge. Straddling the floor edge rather
 * than sitting outside it, the same call `storykeeperCastleRegion.ts` makes:
 * an overlapping collider is harmless, a seam is a hole the child walks
 * through.
 */
export const COMB_WALLS: readonly RectZone[] = [
  {
    id: 'hive-wall:north',
    minX: -GROUND_HALF_EXTENT_X - WALL_THICKNESS,
    maxX: GROUND_HALF_EXTENT_X + WALL_THICKNESS,
    minZ: GROUND_HALF_EXTENT_Z - WALL_THICKNESS / 2,
    maxZ: GROUND_HALF_EXTENT_Z + WALL_THICKNESS,
  },
  {
    id: 'hive-wall:south',
    minX: -GROUND_HALF_EXTENT_X - WALL_THICKNESS,
    maxX: GROUND_HALF_EXTENT_X + WALL_THICKNESS,
    minZ: -GROUND_HALF_EXTENT_Z - WALL_THICKNESS,
    maxZ: -GROUND_HALF_EXTENT_Z + WALL_THICKNESS / 2,
  },
  {
    id: 'hive-wall:east',
    minX: GROUND_HALF_EXTENT_X - WALL_THICKNESS / 2,
    maxX: GROUND_HALF_EXTENT_X + WALL_THICKNESS,
    minZ: -GROUND_HALF_EXTENT_Z - WALL_THICKNESS,
    maxZ: GROUND_HALF_EXTENT_Z + WALL_THICKNESS,
  },
  {
    id: 'hive-wall:west',
    minX: -GROUND_HALF_EXTENT_X - WALL_THICKNESS,
    maxX: -GROUND_HALF_EXTENT_X + WALL_THICKNESS / 2,
    minZ: -GROUND_HALF_EXTENT_Z - WALL_THICKNESS,
    maxZ: GROUND_HALF_EXTENT_Z + WALL_THICKNESS,
  },
];

export function isOnFloor(x: number, z: number): boolean {
  return isInsideRect(x, z, FLOOR);
}

export function isBlocked(x: number, z: number): boolean {
  return COMB_WALLS.some((wall) => isInsideRect(x, z, wall));
}

export function isWalkable(x: number, z: number): boolean {
  return isOnFloor(x, z) && !isBlocked(x, z);
}

/**
 * The raised, marked patch of comb the dance happens on. A place, so beat 6's
 * "watch" and beat 7's "count" have somewhere to happen rather than being
 * something that occurs wherever the child happens to be looking.
 */
export const DANCE_FLOOR: RectZone = {
  id: 'hive-dance-floor',
  minX: -1.8,
  maxX: 1.8,
  minZ: -0.6,
  maxZ: 2.6,
};

export const BUZZ_ID = 'buzz';
export const BUZZ_SPOT: EntitySpot = { entityId: BUZZ_ID, x: 0, z: 0 };

/**
 * "Her sisters watch closely" (`buzzAndTheWaggleDance.ts`'s `meet-buzz`).
 * Three, not twenty: `npc-buzz` is multi-part, so each is an
 * `instantiateAsset` clone rather than an instanced draw call, and three is
 * what the authored text says.
 */
export const SISTER_BEE_SPOTS: readonly EntitySpot[] = [
  { entityId: 'sister-bee-1', x: -2.6, z: 1.6 },
  { entityId: 'sister-bee-2', x: 2.6, z: 1.6 },
  { entityId: 'sister-bee-3', x: 0, z: 3.4 },
];

/**
 * A straight waggle run: where it starts, where it ends, and how many
 * waggles happen along it.
 *
 * `waggleCount` is **not** a rendering detail. It is the answer to
 * `count-the-waggles`, and `wonderwildHiveRegion.test.ts` asserts it equals
 * that step's own `correctValue` rather than trusting the number typed here -
 * the same authoring check the castle's nine carved stars get against
 * `count-the-stars`. Content and question can never drift apart.
 */
export interface WaggleRun {
  id: string;
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
  waggleCount: number;
}

/**
 * Buzz's run. Long, and aligned north so a child standing on the dance floor
 * and looking at her sees its whole length rather than its foreshortening.
 *
 * Beat 7 imposes three requirements on how this is played, and they are
 * requirements rather than preferences (roadmap WF-5): exactly five discrete
 * waggles, replayable on demand at no cost, and countable from inside
 * `DANCE_FLOOR_APPROACH` without moving. That last one is why the run's
 * geometry is authored here and asserted, rather than being chosen in the
 * scene file.
 */
export const BUZZ_WAGGLE_RUN: WaggleRun = {
  id: 'buzz-waggle-run',
  fromX: 0,
  fromZ: -0.2,
  toX: 0,
  toZ: 2.2,
  waggleCount: 5,
};

/**
 * A sister's run, over a much shorter distance. This is the whole reason beat
 * 6 is worth building in 3D: the adventure says "Buzz waggles for a long
 * time", and long compared to what has never been on screen. It adds no step,
 * no option, and no authored text - only the comparison the existing
 * `observe-the-dance` question already assumes the child can make.
 */
export const SISTER_WAGGLE_RUN: WaggleRun = {
  id: 'sister-waggle-run',
  fromX: 3.6,
  fromZ: 0.2,
  toX: 3.6,
  toZ: 1,
  waggleCount: 2,
};

/** Capped honey cells along the north wall. Scenery, and the room's warm light source. */
export const HONEY_CELL_SPOTS: readonly EntitySpot[] = [
  { entityId: 'honey-cell-1', x: -4.2, z: 4.3 },
  { entityId: 'honey-cell-2', x: -2.6, z: 4.3 },
  { entityId: 'honey-cell-3', x: -1, z: 4.3 },
  { entityId: 'honey-cell-4', x: 0.6, z: 4.3 },
  { entityId: 'honey-cell-5', x: 2.2, z: 4.3 },
  { entityId: 'honey-cell-6', x: 3.8, z: 4.3 },
];

/** The way back out to the hive clearing, at the west end. Beat 9. */
export const HIVE_MOUTH_SPOT: EntitySpot = { entityId: 'hive-mouth', x: -6.6, z: 0 };

export const ZONES: readonly RectZone[] = [
  { id: 'wonderwild-hive-mouth', minX: -6.2, maxX: -5.2, minZ: -1, maxZ: 1 },
  // Where the child stands to watch. South of the run, facing it, and sized
  // so the whole of `BUZZ_WAGGLE_RUN` is in front of them from anywhere in it.
  { id: 'wonderwild-hive-dance-floor', minX: -1.6, maxX: 1.6, minZ: -3.4, maxZ: -1.4 },
];

export function findZone(zoneId: string): RectZone | undefined {
  return ZONES.find((zone) => zone.id === zoneId);
}

export const ALL_SPOTS: readonly EntitySpot[] = [
  BUZZ_SPOT,
  ...SISTER_BEE_SPOTS,
  ...HONEY_CELL_SPOTS,
  HIVE_MOUTH_SPOT,
];

export const ALL_ENTITY_IDS: readonly string[] = ALL_SPOTS.map((spot) => spot.entityId);

export const WONDERWILD_HIVE_REGION_CHECKPOINTS = WONDERWILD_HIVE_CHECKPOINTS;
