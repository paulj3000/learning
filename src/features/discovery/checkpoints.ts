/**
 * Checkpoint-based position saving for explorable first-person regions
 * (docs/ROADMAP.md Phase 32: "checkpoint-based position saving (never
 * trusting raw coordinates as durable state)").
 *
 * Deliberately lives in the World State layer (`src/features/discovery/`,
 * which already owns `ChildWorldState`) rather than in
 * `src/features/island-map/three/`. Per ADR-008 in `docs/DECISIONS.md`, the
 * World Engine (Three.js) may depend downward on World State, but World
 * State must never depend back up on rendering code - so a checkpoint's
 * authored id vocabulary and coordinates live here, and the Three.js scene
 * imports them, not the other way around.
 *
 * A checkpoint is a small authored set of named, walkable spots per region.
 * `ChildWorldState.lastCheckpointId` stores one of these ids and nothing
 * else - never a raw x/y/z a client could forge into an out-of-bounds or
 * inside-a-wall spawn point.
 */

export interface RegionCheckpoint {
  id: string;
  regionId: string;
  /** Child-facing name of this spot, for a "you're back at ___" HUD toast. */
  label: string;
  x: number;
  z: number;
  /** Radians. The yaw the child faces on spawn/respawn here. */
  yaw: number;
}

export const WELCOME_HARBOR_REGION_ID = 'welcome-harbor';

export const WELCOME_HARBOR_CHECKPOINTS: readonly RegionCheckpoint[] = [
  {
    id: 'welcome-harbor:dock',
    regionId: WELCOME_HARBOR_REGION_ID,
    label: 'the dock',
    x: 0,
    z: 8,
    yaw: Math.PI,
  },
  {
    id: 'welcome-harbor:lookout',
    regionId: WELCOME_HARBOR_REGION_ID,
    label: 'the lookout tower',
    x: -7,
    z: -3,
    yaw: 0,
  },
  {
    id: 'welcome-harbor:shed',
    regionId: WELCOME_HARBOR_REGION_ID,
    label: 'the dockside shed',
    x: 7,
    z: -3,
    yaw: Math.PI,
  },
];

export const PIRATE_BUILDER_BAY_REGION_ID = 'pirate-builder-bay';

export const PIRATE_BUILDER_BAY_CHECKPOINTS: readonly RegionCheckpoint[] = [
  {
    id: 'pirate-builder-bay:dock',
    regionId: PIRATE_BUILDER_BAY_REGION_ID,
    label: 'the dock',
    x: -8,
    z: 0,
    yaw: Math.PI / 2,
  },
  {
    id: 'pirate-builder-bay:bridge-approach',
    regionId: PIRATE_BUILDER_BAY_REGION_ID,
    label: 'the bridge',
    x: -5,
    z: 0,
    yaw: Math.PI / 2,
  },
  {
    id: 'pirate-builder-bay:cove',
    regionId: PIRATE_BUILDER_BAY_REGION_ID,
    label: 'the cove',
    x: 9,
    z: 0,
    yaw: -Math.PI / 2,
  },
];

export const STORYKEEPER_CASTLE_REGION_ID = 'storykeeper-castle';

/**
 * Storykeeper Castle's checkpoints (`docs/STORYKEEPER_CASTLE_3D_ROADMAP.md`
 * SC-0). One per room a child has a reason to come back to, and `entrance`
 * is deliberately first: `resolveSpawnCheckpoint` falls back to a region's
 * first authored checkpoint, and arriving at the doors is the only spawn
 * that makes sense for a child who has never been here.
 *
 * Yaw follows `firstPersonController.ts`'s convention (`forwardX =
 * sin(yaw)`, `forwardZ = cos(yaw)`): 0 faces +Z, PI/2 faces +X.
 */
export const STORYKEEPER_CASTLE_CHECKPOINTS: readonly RegionCheckpoint[] = [
  {
    id: 'storykeeper-castle:entrance',
    regionId: STORYKEEPER_CASTLE_REGION_ID,
    label: 'the castle doors',
    x: -12,
    z: 0,
    yaw: Math.PI / 2,
  },
  {
    id: 'storykeeper-castle:story-hall',
    regionId: STORYKEEPER_CASTLE_REGION_ID,
    label: 'the story hall',
    x: -6,
    z: 0,
    yaw: Math.PI / 2,
  },
  {
    id: 'storykeeper-castle:gallery',
    regionId: STORYKEEPER_CASTLE_REGION_ID,
    label: 'the Character Gallery',
    x: -4.5,
    z: 8,
    yaw: 0,
  },
  {
    id: 'storykeeper-castle:tower',
    regionId: STORYKEEPER_CASTLE_REGION_ID,
    label: 'the Setting Tower',
    x: 7.5,
    z: 7.5,
    yaw: 0,
  },
  {
    id: 'storykeeper-castle:library',
    regionId: STORYKEEPER_CASTLE_REGION_ID,
    label: 'the Great Library',
    x: 7,
    z: -6,
    yaw: Math.PI / 2,
  },
];

/** Every authored checkpoint, across every region (Phase 32's Welcome Harbor, Phase 33's Pirate Builder Bay, SC-0's Storykeeper Castle). */
export const WONDERWILD_FOREST_REGION_ID = 'wonderwild-forest';

/**
 * Wonderwild Forest's checkpoints (`docs/WONDERWILD_FOREST_3D_ROADMAP.md`
 * WF-0). One per glade a child has a reason to come back to, and
 * `harbor-path` is deliberately first: `resolveSpawnCheckpoint` falls back to
 * a region's first authored checkpoint, and arriving at the way in is the
 * only spawn that makes sense for a child who has never been here.
 *
 * `pond` sits on the bank rather than out on the water, which is a collider
 * (`wonderwildForestRegion.ts`'s `POND_WATER`). A checkpoint a child cannot
 * stand on is a spawn point that strands them.
 */
export const WONDERWILD_FOREST_CHECKPOINTS: readonly RegionCheckpoint[] = [
  {
    id: 'wonderwild-forest:harbor-path',
    regionId: WONDERWILD_FOREST_REGION_ID,
    label: 'the path into the forest',
    x: -16,
    z: 0,
    yaw: Math.PI / 2,
  },
  {
    id: 'wonderwild-forest:wonder-wall',
    regionId: WONDERWILD_FOREST_REGION_ID,
    label: 'the Wonder Wall',
    x: 0,
    z: -2,
    yaw: 0,
  },
  {
    id: 'wonderwild-forest:hive-clearing',
    regionId: WONDERWILD_FOREST_REGION_ID,
    label: 'the hive clearing',
    x: 12,
    z: 0,
    yaw: Math.PI / 2,
  },
  {
    id: 'wonderwild-forest:pond',
    regionId: WONDERWILD_FOREST_REGION_ID,
    label: 'the pond',
    x: 9,
    z: 6.8,
    yaw: 0,
  },
  {
    id: 'wonderwild-forest:cave-mouth',
    regionId: WONDERWILD_FOREST_REGION_ID,
    label: 'the cave mouth',
    x: 11,
    z: -8,
    yaw: Math.PI,
  },
];

export const WONDERWILD_HIVE_REGION_ID = 'wonderwild-hive';

/**
 * Inside the beehive (`docs/WONDERWILD_FOREST_3D_ROADMAP.md` WF-0). Its own
 * region, entered only by being shrunk mid-adventure and left only through
 * the hive mouth - which is why it is a region here and not an
 * `ISLAND_LOCATIONS` entry.
 */
export const WONDERWILD_HIVE_CHECKPOINTS: readonly RegionCheckpoint[] = [
  {
    id: 'wonderwild-hive:entrance',
    regionId: WONDERWILD_HIVE_REGION_ID,
    label: 'the hive mouth',
    x: -5,
    z: 0,
    yaw: Math.PI / 2,
  },
  {
    id: 'wonderwild-hive:dance-floor',
    regionId: WONDERWILD_HIVE_REGION_ID,
    label: 'the dance floor',
    x: 0,
    z: -2,
    yaw: 0,
  },
];

export const ALL_CHECKPOINTS: readonly RegionCheckpoint[] = [
  ...WELCOME_HARBOR_CHECKPOINTS,
  ...PIRATE_BUILDER_BAY_CHECKPOINTS,
  ...STORYKEEPER_CASTLE_CHECKPOINTS,
  ...WONDERWILD_FOREST_CHECKPOINTS,
  ...WONDERWILD_HIVE_CHECKPOINTS,
];

export const KNOWN_CHECKPOINT_IDS: readonly string[] = ALL_CHECKPOINTS.map(
  (checkpoint) => checkpoint.id,
);

export function findCheckpoint(id: string | undefined): RegionCheckpoint | undefined {
  return id ? ALL_CHECKPOINTS.find((checkpoint) => checkpoint.id === id) : undefined;
}

/**
 * Where a child spawns when entering `regionId`: their last saved
 * checkpoint if it belongs to this region, otherwise the region's first
 * authored checkpoint. Total by construction (never returns `undefined`) so
 * a view never has to invent a fallback position of its own - the same
 * "never strand the child" discipline `resolveNpcLocation` uses for NPC
 * schedules.
 */
export function resolveSpawnCheckpoint(
  regionId: string,
  lastCheckpointId: string | undefined,
): RegionCheckpoint {
  const stored = findCheckpoint(lastCheckpointId);
  if (stored && stored.regionId === regionId) {
    return stored;
  }
  const fallback = ALL_CHECKPOINTS.find((checkpoint) => checkpoint.regionId === regionId);
  if (!fallback) {
    throw new Error(`No checkpoints authored for region "${regionId}"`);
  }
  return fallback;
}
