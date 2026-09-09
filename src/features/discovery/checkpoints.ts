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

export const CLOCKWORK_HARBOR_REGION_ID = 'clockwork-harbor';

/**
 * Clockwork Harbor's checkpoints (`docs/regions/clockwork.md` section 5,
 * "Region Layout", and section 9's Phase 3 build list). One per district a
 * child has a reason to walk back to, and `harbor-entrance` is deliberately
 * first: `resolveSpawnCheckpoint` falls back to a region's first authored
 * checkpoint, and arriving at the harbor gate is the only spawn that makes
 * sense for a child who has never been here.
 *
 * `lighthouse-lamp` sits inside the lighthouse rather than on its doorstep,
 * so a child who left mid-repair comes back to the machine they were
 * working on instead of to the bottom of the stairs.
 *
 * Yaw follows `firstPersonController.ts`'s convention (`forwardX =
 * sin(yaw)`, `forwardZ = cos(yaw)`): 0 faces +Z, PI/2 faces +X.
 */
export const CLOCKWORK_HARBOR_CHECKPOINTS: readonly RegionCheckpoint[] = [
  {
    id: 'clockwork-harbor:harbor-entrance',
    regionId: CLOCKWORK_HARBOR_REGION_ID,
    label: 'the harbor gate',
    x: 0,
    z: 18,
    yaw: Math.PI,
  },
  {
    id: 'clockwork-harbor:docks',
    regionId: CLOCKWORK_HARBOR_REGION_ID,
    label: 'the docks',
    x: 0,
    z: 8,
    yaw: Math.PI,
  },
  {
    id: 'clockwork-harbor:lighthouse-door',
    regionId: CLOCKWORK_HARBOR_REGION_ID,
    label: 'the lighthouse door',
    /*
      Outside the tower, on its doorstep. The lighthouse's open side is its
      east wall (`clockworkHarborRegion.ts`'s `LIGHTHOUSE.wallSides` omits
      `east`, at x = -12), so this sits just clear of the interior and faces
      back into the doorway - a child returning here arrives at the door
      rather than already standing in the machine room, which is what
      `lighthouse-lamp` is for.
    */
    x: -11,
    z: 0,
    yaw: -Math.PI / 2,
  },
  {
    id: 'clockwork-harbor:lighthouse-lamp',
    regionId: CLOCKWORK_HARBOR_REGION_ID,
    label: 'the lighthouse machine room',
    x: -16.5,
    z: 0,
    yaw: Math.PI / 2,
  },
  {
    id: 'clockwork-harbor:marketplace',
    regionId: CLOCKWORK_HARBOR_REGION_ID,
    label: 'the marketplace',
    x: 6,
    z: -6,
    yaw: 0,
  },
];

export const DRAGONS_SANCTUARY_REGION_ID = 'dragons-sanctuary';

/**
 * The Dragon's Sanctuary's checkpoints (`docs/regions/dragons-sanctuary-
 * roadmap.md` Phase 1, "Minimum Explorable Sanctuary").
 *
 * `gate` is first, and deliberately: `resolveSpawnCheckpoint` falls back to
 * a region's first authored checkpoint, and a child who has never been here
 * arrives through the gate. Walking in past the ruined arch and seeing the
 * valley open up is the region's whole first impression; spawning anywhere
 * else would spend it.
 *
 * `forge-hearth` sits inside the forge rather than on its doorstep, for the
 * reason `clockwork-harbor:lighthouse-lamp` does: a child who left partway
 * through Rekindle the Forge comes back to the hearth they were working on,
 * not to the door.
 *
 * No checkpoint is authored at the crystal cavern or the hatchery. Both are
 * sealed in this phase, and a checkpoint is a place a child has stood - one
 * authored at a gate they cannot open would be a spawn point they can never
 * legitimately save at.
 *
 * Yaw follows `firstPersonController.ts`'s convention (`forwardX =
 * sin(yaw)`, `forwardZ = cos(yaw)`): 0 faces +Z, PI/2 faces +X. The valley
 * runs south to north, so most of these face -Z (`Math.PI`), inward.
 */
export const DRAGONS_SANCTUARY_CHECKPOINTS: readonly RegionCheckpoint[] = [
  {
    id: 'dragons-sanctuary:gate',
    regionId: DRAGONS_SANCTUARY_REGION_ID,
    label: 'the sanctuary gate',
    x: 0,
    z: 21,
    yaw: Math.PI,
  },
  {
    id: 'dragons-sanctuary:valley',
    regionId: DRAGONS_SANCTUARY_REGION_ID,
    label: 'the central valley',
    x: 0,
    z: 6,
    yaw: Math.PI,
  },
  {
    id: 'dragons-sanctuary:roost',
    regionId: DRAGONS_SANCTUARY_REGION_ID,
    label: "Ember's roost",
    x: 0,
    z: -12,
    yaw: Math.PI,
  },
  {
    id: 'dragons-sanctuary:lodge-door',
    regionId: DRAGONS_SANCTUARY_REGION_ID,
    label: 'the Keeper Lodge door',
    /*
      On the doorstep, not inside. The lodge's open side is its east wall
      (`dragonsSanctuaryRegion.ts`'s `KEEPER_LODGE.wallSides` omits `east`,
      at x = -14), so this stands just clear of it facing back through the
      doorway.
    */
    x: -13,
    z: 3,
    yaw: -Math.PI / 2,
  },
  {
    id: 'dragons-sanctuary:forge-door',
    regionId: DRAGONS_SANCTUARY_REGION_ID,
    label: 'the forge door',
    x: 13,
    z: 3,
    yaw: Math.PI / 2,
  },
  {
    id: 'dragons-sanctuary:forge-hearth',
    regionId: DRAGONS_SANCTUARY_REGION_ID,
    label: 'the forge hearth',
    x: 18,
    z: 3,
    yaw: Math.PI / 2,
  },
  {
    id: 'dragons-sanctuary:sky-cliff-view',
    regionId: DRAGONS_SANCTUARY_REGION_ID,
    label: 'the sky cliff lookout',
    x: 0,
    z: -24,
    yaw: Math.PI,
  },
];

export const ALL_CHECKPOINTS: readonly RegionCheckpoint[] = [
  ...WELCOME_HARBOR_CHECKPOINTS,
  ...PIRATE_BUILDER_BAY_CHECKPOINTS,
  ...STORYKEEPER_CASTLE_CHECKPOINTS,
  ...WONDERWILD_FOREST_CHECKPOINTS,
  ...WONDERWILD_HIVE_CHECKPOINTS,
  ...CLOCKWORK_HARBOR_CHECKPOINTS,
  ...DRAGONS_SANCTUARY_CHECKPOINTS,
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
