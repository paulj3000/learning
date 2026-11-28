import {
  FOSSIL_RIDGE_CAMP_CHECKPOINTS,
  FOSSIL_RIDGE_CAMP_REGION_ID,
} from '../../discovery/checkpoints';

/**
 * Pure content and geometry for Fossil Ridge Camp in 3D (LAI-2206).
 *
 * Plain numbers rather than `THREE` types, the same split as
 * `dragonsSanctuaryRegion.ts`: this file stays unit-testable with no
 * rendering context, and the manifest (`runtime/manifests/fossilRidgeCamp.ts`)
 * is built from it.
 *
 * ## What carries over from the Phaser camp
 *
 * The Phaser camp (`fossilRidgeCampTilemap.ts`, `fossilRidgeCampDecor.ts`,
 * `fossilRidgeCampZones.ts`) is one flat screen of dig-site sand: the
 * assembled skeleton, the dig tools south-east of it, and the path back to
 * Welcome Harbor on the west edge. The 3D camp keeps that arrangement (the
 * trail in from the west, the skeleton ahead, the tools beside it) and the
 * same three interactions, unchanged, from `FOSSIL_RIDGE_CAMP_INTERACTIONS`.
 * Coordinates are re-authored in metres rather than converted from tiles: a
 * one-tile skeleton does not survive the move to a walkable scale.
 *
 * ## Flat by design (owner, 2026-11-28)
 *
 * The camp is one flat floor. The ridge is cliff faces and boulders at its
 * edges, and the dig pits are roped off: every one is a solid collider, never
 * a slope or a drop. That keeps the Sprouts guided route (LAI-2104S, O6
 * option B) on its first step, B1 (static colliders and hazards), without
 * waiting for terrain height (B2). There is nothing to jump onto or over:
 * no collider is `jumpable` and there is no platforming, so every target is
 * reachable on foot (jumping standard; LAI-JMP-01b: the camp does not use
 * jumping).
 *
 * ## Placeholder art
 *
 * No camp models exist yet (LAI 07). The skeleton, tent and ridge are
 * coloured boxes, with the bundled signpost as the skeleton's display placard; the dig tools reuse the bundled `toolbox` kit piece the
 * Phaser decor already names (`shape: 'TOOLBOX'`). Swapping in final models
 * changes scenery and `assetId`s only, never ids, interactions or colliders.
 */

export { FOSSIL_RIDGE_CAMP_CHECKPOINTS, FOSSIL_RIDGE_CAMP_REGION_ID };

export interface Rect {
  id: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Half the camp's walkable floor, in metres: 32 m east-west by 24 m north-south. */
export const GROUND_HALF_EXTENT_X = 16;
export const GROUND_HALF_EXTENT_Z = 12;

/** Where the child arrives: the trailhead, facing into the camp. */
export const CAMP_SPAWN = FOSSIL_RIDGE_CAMP_CHECKPOINTS[0]!;

/**
 * Walking into this strip on the west edge is the way back to Welcome Harbor.
 * Its id is the Phaser exit interaction's id, so the generic runtime opens the
 * same `fossil-ridge-camp-harbor-exit` interaction the Phaser zone did.
 */
export const HARBOR_EXIT_ZONE: Rect = {
  id: 'fossil-ridge-camp-harbor-exit',
  minX: -GROUND_HALF_EXTENT_X,
  maxX: -14.6,
  minZ: -2,
  maxZ: 2,
};

/** The packed-earth trail from the trailhead to the skeleton display. */
export const CAMP_TRAIL: Rect = {
  id: 'fossil-ridge-camp:trail',
  minX: -GROUND_HALF_EXTENT_X,
  maxX: 0,
  minZ: -1,
  maxZ: 1,
};

/** The assembled skeleton on its display plinth: the dig's payoff. */
export const SKELETON_DISPLAY = {
  entityId: 'fossil-ridge-skeleton',
  label: 'The assembled skeleton',
  x: 2,
  z: -3,
  halfWidth: 3.5,
  halfDepth: 1.6,
  plinthHeight: 0.4,
} as const;

/**
 * The display placard in front of the plinth, facing the trail: what the child
 * walks up to and interacts with to hear about the skeleton. A prop needs a
 * model to be found, and the skeleton itself is placeholder boxes until LAI 07,
 * so the bundled signpost stands in as the placard.
 */
export const SKELETON_PLACARD = { x: 2, z: -1.1 } as const;

/** The dig tools, south-east of the skeleton as in the Phaser decor. */
export const DIG_TOOLS = {
  entityId: 'fossil-ridge-dig-tools',
  label: 'A set of dig tools',
  x: 6.5,
  z: 1.5,
} as const;

/** The camp tent, north of the trail. Scenery with a collider; nothing to do inside. */
export const CAMP_TENT = {
  id: 'fossil-ridge-camp:tent',
  x: -7,
  z: -5,
  halfWidth: 1.6,
  halfDepth: 1.3,
  height: 2,
} as const;

/**
 * The two finished dig pits, roped off. Each is a solid collider over the
 * whole pit, so a child walks round it rather than into it: no drop, no
 * hazard cell, nothing that needs terrain height.
 */
export const DIG_PITS: readonly Rect[] = [
  { id: 'fossil-ridge-camp:pit-west', minX: -7, maxX: -3, minZ: 4, maxZ: 7.5 },
  { id: 'fossil-ridge-camp:pit-east', minX: 8, maxX: 11.5, minZ: 5, maxZ: 8.5 },
];

/** Rope barrier height round a pit, in metres. */
export const PIT_ROPE_HEIGHT = 0.7;

/**
 * The ridge: cliff faces inside the north, east and south edges. The west
 * edge is the trail out, so it has none. Each is a solid collider as tall as
 * it is drawn.
 */
export const RIDGE_FACES: readonly (Rect & { height: number })[] = [
  {
    id: 'fossil-ridge-camp:ridge-north',
    minX: -GROUND_HALF_EXTENT_X,
    maxX: GROUND_HALF_EXTENT_X,
    minZ: -GROUND_HALF_EXTENT_Z,
    maxZ: -10.8,
    height: 6,
  },
  {
    id: 'fossil-ridge-camp:ridge-east',
    minX: 14.8,
    maxX: GROUND_HALF_EXTENT_X,
    minZ: -10.8,
    maxZ: 10.8,
    height: 3.5,
  },
  {
    id: 'fossil-ridge-camp:ridge-south',
    minX: -GROUND_HALF_EXTENT_X,
    maxX: GROUND_HALF_EXTENT_X,
    minZ: 10.8,
    maxZ: GROUND_HALF_EXTENT_Z,
    height: 2.5,
  },
];

/** Boulders at the foot of the north ridge. */
export const RIDGE_BOULDERS: readonly { id: string; x: number; z: number; halfSize: number }[] = [
  { id: 'fossil-ridge-camp:boulder-1', x: -9, z: -9, halfSize: 0.9 },
  { id: 'fossil-ridge-camp:boulder-2', x: -2, z: -9.2, halfSize: 0.9 },
  { id: 'fossil-ridge-camp:boulder-3', x: 6, z: -9, halfSize: 0.9 },
  { id: 'fossil-ridge-camp:boulder-4', x: 11, z: -9.1, halfSize: 0.9 },
];

/**
 * Every solid footprint in the camp as a plain rect, for colliders and for
 * the region's own walkability test. The toolbox is not here: the runtime
 * derives its collider from the kit piece (`derivedColliders.ts`).
 */
export function solidFootprints(): Rect[] {
  return [
    {
      id: `collider:${SKELETON_DISPLAY.entityId}`,
      minX: SKELETON_DISPLAY.x - SKELETON_DISPLAY.halfWidth,
      maxX: SKELETON_DISPLAY.x + SKELETON_DISPLAY.halfWidth,
      minZ: SKELETON_DISPLAY.z - SKELETON_DISPLAY.halfDepth,
      maxZ: SKELETON_DISPLAY.z + SKELETON_DISPLAY.halfDepth,
    },
    {
      id: `collider:${CAMP_TENT.id}`,
      minX: CAMP_TENT.x - CAMP_TENT.halfWidth,
      maxX: CAMP_TENT.x + CAMP_TENT.halfWidth,
      minZ: CAMP_TENT.z - CAMP_TENT.halfDepth,
      maxZ: CAMP_TENT.z + CAMP_TENT.halfDepth,
    },
    ...DIG_PITS.map((pit) => ({ ...pit, id: `collider:${pit.id}` })),
    ...RIDGE_FACES.map((face) => ({
      id: `collider:${face.id}`,
      minX: face.minX,
      maxX: face.maxX,
      minZ: face.minZ,
      maxZ: face.maxZ,
    })),
    ...RIDGE_BOULDERS.map((boulder) => ({
      id: `collider:${boulder.id}`,
      minX: boulder.x - boulder.halfSize,
      maxX: boulder.x + boulder.halfSize,
      minZ: boulder.z - boulder.halfSize,
      maxZ: boulder.z + boulder.halfSize,
    })),
  ];
}
