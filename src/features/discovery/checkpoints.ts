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

/** Every authored checkpoint, across every region. Currently just Welcome Harbor's (Phase 32). */
export const ALL_CHECKPOINTS: readonly RegionCheckpoint[] = [...WELCOME_HARBOR_CHECKPOINTS];

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
