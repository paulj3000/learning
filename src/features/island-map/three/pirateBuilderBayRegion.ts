import {
  PIRATE_BUILDER_BAY_CHECKPOINTS,
  PIRATE_BUILDER_BAY_REGION_ID,
} from '../../discovery/checkpoints';

/**
 * Pure content and geometry for the Phase 33 Pirate Builder Bay region
 * (`docs/ROADMAP.md` Phase 33, "First-Person Broken Bridge / Pirate Builder
 * Bay Migration"). Same split as `welcomeHarborRegion.ts`: plain numbers,
 * no `three` import, so this stays unit-testable without a rendering
 * context - `pirateBuilderBayScene.ts` is the only file that turns these
 * numbers into `three` objects.
 *
 * Unlike Welcome Harbor, this region's whole point is a single gate: a
 * water channel splits the dock (west) from the cove (east), and only the
 * bridge deck crosses it. `BRIDGE_REPAIRED` (the same `WorldChange.changeKey`
 * the existing "Repair the Moonlight Bridge" adventure already writes,
 * `adventures/content/repairTheMoonlightBridge.ts`) decides which bridge
 * geometry `pirateBuilderBayScene.ts` builds - a real mesh/collider swap at
 * scene-construction time, the Three.js equivalent of the Phaser scene's
 * `tileOverrides` mechanism (`scenes/PirateBuilderBayScene.ts`), not a
 * live mid-session animation. See `docs/IMPLEMENTATION_STATUS.md`'s Phase
 * 33 entry for why that reading of "an actual geometry/state change" was
 * chosen over animating the transition.
 */

export const REGION_ID = PIRATE_BUILDER_BAY_REGION_ID;

/** A rectangular footprint or trigger volume on the ground plane, in world x/z meters. */
export interface RectZone {
  id: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export function isInsideRect(x: number, z: number, zone: RectZone): boolean {
  return x >= zone.minX && x <= zone.maxX && z >= zone.minZ && z <= zone.maxZ;
}

export const GROUND_HALF_EXTENT_X = 16;
export const GROUND_HALF_EXTENT_Z = 7;
const WALL_THICKNESS = 1;

/** The four boundary walls, one thin rect per edge, so the region reads as an enclosed island plot. */
export const BOUNDARY_WALLS: readonly RectZone[] = [
  {
    id: 'boundary-north',
    minX: -GROUND_HALF_EXTENT_X,
    maxX: GROUND_HALF_EXTENT_X,
    minZ: GROUND_HALF_EXTENT_Z,
    maxZ: GROUND_HALF_EXTENT_Z + WALL_THICKNESS,
  },
  {
    id: 'boundary-south',
    minX: -GROUND_HALF_EXTENT_X,
    maxX: GROUND_HALF_EXTENT_X,
    minZ: -GROUND_HALF_EXTENT_Z - WALL_THICKNESS,
    maxZ: -GROUND_HALF_EXTENT_Z,
  },
  {
    id: 'boundary-east',
    minX: GROUND_HALF_EXTENT_X,
    maxX: GROUND_HALF_EXTENT_X + WALL_THICKNESS,
    minZ: -GROUND_HALF_EXTENT_Z,
    maxZ: GROUND_HALF_EXTENT_Z,
  },
  {
    id: 'boundary-west',
    minX: -GROUND_HALF_EXTENT_X - WALL_THICKNESS,
    maxX: -GROUND_HALF_EXTENT_X,
    minZ: -GROUND_HALF_EXTENT_Z,
    maxZ: GROUND_HALF_EXTENT_Z,
  },
];

/**
 * The water channel splitting the dock from the cove (x -3..3), and the
 * bridge deck's own span within it (z -1.5..1.5). Mirrors
 * `pirateBuilderBayTilemap.ts`'s `CHANNEL_TILE_RECT`/`BAY_BRIDGE_TILE_RECT`
 * split: water either side of the deck blocks crossing regardless of
 * repair state, and only the deck span's collider depends on
 * `BRIDGE_REPAIRED`.
 */
export const CHANNEL_MIN_X = -3;
export const CHANNEL_MAX_X = 3;
export const BRIDGE_MIN_Z = -1.5;
export const BRIDGE_MAX_Z = 1.5;

/** Water north of the bridge deck - always blocks crossing, repaired or not. */
export const CHANNEL_NORTH_WATER: RectZone = {
  id: 'channel-north',
  minX: CHANNEL_MIN_X,
  maxX: CHANNEL_MAX_X,
  minZ: BRIDGE_MAX_Z,
  maxZ: GROUND_HALF_EXTENT_Z,
};

/** Water south of the bridge deck - always blocks crossing, repaired or not. */
export const CHANNEL_SOUTH_WATER: RectZone = {
  id: 'channel-south',
  minX: CHANNEL_MIN_X,
  maxX: CHANNEL_MAX_X,
  minZ: -GROUND_HALF_EXTENT_Z,
  maxZ: BRIDGE_MIN_Z,
};

/**
 * The bridge deck's own footprint - a real collider only while unrepaired
 * (`pirateBuilderBayScene.ts` includes this in the collider list only when
 * `bridgeRepaired` is false). Once repaired, this span has no collider at
 * all, so the child walks straight across it.
 */
export const BRIDGE_SPAN: RectZone = {
  id: 'bridge-span',
  minX: CHANNEL_MIN_X,
  maxX: CHANNEL_MAX_X,
  minZ: BRIDGE_MIN_Z,
  maxZ: BRIDGE_MAX_Z,
};

/** Where Pirate Pip stands, on the dock side near the bridge (`docs/ROADMAP.md` Phase 33, "approaches the NPC"). */
export const NPC_SPOT = { x: -5, z: 3 };
export const NPC_ID = 'pirate-pip';

/**
 * Raycast-interactable material props on the dock (roadmap: "searches the
 * world for materials"). Same flavor-only role as the Phase 11 Phaser
 * decor they mirror (`pirateBuilderBayDecor.ts`) - see
 * `docs/IMPLEMENTATION_STATUS.md`'s Phase 33 entry for why they stay
 * flavor rather than becoming a mechanically-required gathering step.
 */
export const ROPE_COIL_SPOT = { x: -9, z: -3 };
export const ROPE_COIL_ID = 'bay-rope-coil';
export const TOOLBOX_SPOT = { x: -9, z: 3 };
export const TOOLBOX_ID = 'bay-toolbox';

/** The hidden treasure chest in the cove (roadmap: "discover new area") - reachable only once the bridge is repaired. */
export const TREASURE_SPOT = { x: 9, z: 0 };
export const TREASURE_ID = 'cove-treasure';

/** The approach zone in front of the bridge on the dock side, where walking up starts (or narrates) the adventure. */
export const BRIDGE_APPROACH_ZONE: RectZone = {
  id: 'bay-bridge-approach',
  minX: -6,
  maxX: CHANNEL_MIN_X,
  minZ: BRIDGE_MIN_Z,
  maxZ: BRIDGE_MAX_Z,
};

/** Phase 26's secret passage, at the far back corner of the cove - reachable only across the repaired bridge. */
export const TIDE_TUNNEL_ZONE: RectZone = {
  id: 'bay-tide-tunnel',
  minX: 13,
  maxX: 15,
  minZ: 4,
  maxZ: 6,
};

/** The path back to Welcome Harbor, at the dock's west edge. */
export const HARBOR_EXIT_ZONE: RectZone = {
  id: 'bay-harbor-exit',
  minX: -GROUND_HALF_EXTENT_X,
  maxX: -14,
  minZ: -2,
  maxZ: 2,
};

/**
 * Where the water surface and the channel bed sit, in world y. The ground
 * is authored as two planes either side of the channel (`DOCK_GROUND` /
 * `COVE_GROUND`) rather than one plane spanning the whole region, so the
 * channel is a real gap with water visible at the bottom of it. It used to
 * be one 32x14 opaque plane with the water quads 5cm *underneath* it,
 * which meant the bay had no visible water at all: the child walked at a
 * flat sand field and stopped dead at an invisible wall.
 */
export const WATER_SURFACE_Y = -0.15;
export const CHANNEL_BED_Y = -1.05;

/** The dock half of the walkable ground, west of the channel. */
export const DOCK_GROUND: RectZone = {
  id: 'dock-ground',
  minX: -GROUND_HALF_EXTENT_X,
  maxX: CHANNEL_MIN_X,
  minZ: -GROUND_HALF_EXTENT_Z,
  maxZ: GROUND_HALF_EXTENT_Z,
};

/** The cove half of the walkable ground, east of the channel. */
export const COVE_GROUND: RectZone = {
  id: 'cove-ground',
  minX: CHANNEL_MAX_X,
  maxX: GROUND_HALF_EXTENT_X,
  minZ: -GROUND_HALF_EXTENT_Z,
  maxZ: GROUND_HALF_EXTENT_Z,
};

/**
 * The whole channel's water surface, bridge span included. The two
 * `CHANNEL_*_WATER` rects above stay exactly as authored because they are
 * collider volumes and must keep flanking the bridge deck; this one is
 * purely what gets drawn, and deliberately runs unbroken under the deck so
 * there is no dry slot showing through the planks.
 */
export const CHANNEL_SURFACE: RectZone = {
  id: 'channel-surface',
  minX: CHANNEL_MIN_X,
  maxX: CHANNEL_MAX_X,
  minZ: -GROUND_HALF_EXTENT_Z,
  maxZ: GROUND_HALF_EXTENT_Z,
};

/** Half-extent of the open sea drawn around the plot, so the world stops at a horizon instead of at the edge of the sand. */
export const SEA_HALF_EXTENT = 120;

/**
 * A path run across the dock, from the Welcome Harbor exit to the bridge
 * approach, passing through the spawn checkpoint at `(-8, 0)`. This used to
 * be a single 1.5m tile that read as a stain on the sand.
 */
export const PATH_RUN: { from: { x: number; z: number }; to: { x: number; z: number } } = {
  from: { x: -14.5, z: 0 },
  to: { x: -3.5, z: 0 },
};

/** The path picked up again on the cove side, running from the bridge to the treasure. */
export const COVE_PATH_RUN: { from: { x: number; z: number }; to: { x: number; z: number } } = {
  from: { x: 3.5, z: 0 },
  to: { x: 8.5, z: 0 },
};

export const FOLIAGE_TREES: readonly { x: number; z: number }[] = [
  { x: -13, z: -5 },
  { x: -13, z: 5 },
  { x: -15.2, z: -5.6 },
  { x: -14.6, z: 5.9 },
  { x: -8.2, z: -6 },
];

export const ROCKS: readonly { x: number; z: number }[] = [
  { x: -9.5, z: -5 },
  { x: -8.5, z: -4.6 },
  { x: -12.2, z: -1.6 },
  { x: -5.4, z: 5.6 },
];

/** Cove-side foliage and rocks, so the east half is somewhere rather than blank sand. */
export const COVE_TREES: readonly { x: number; z: number }[] = [
  { x: 13.5, z: -1.6 },
  { x: 14.6, z: 2.6 },
  { x: 11.8, z: 5.6 },
  { x: 5.4, z: 5.8 },
];

export const COVE_ROCKS: readonly { x: number; z: number }[] = [
  { x: 4.8, z: -6 },
  { x: 6.2, z: -5.4 },
  { x: 15.2, z: -3.2 },
  { x: 10.6, z: 3.4 },
];

/** Two oversized boulders flanking the tide tunnel corner, so Phase 26's secret has a mouth to walk into. */
export const TIDE_TUNNEL_BOULDERS: readonly { x: number; z: number; scale: number }[] = [
  { x: 12.4, z: 4.4, scale: 3.4 },
  { x: 15.4, z: 6.2, scale: 3.8 },
];

/**
 * Boulder lines along the plot edges. The boundary used to be colliders
 * with no mesh at all, so the sand simply ended in mid-air and the child
 * bumped into nothing. Each run skips the channel mouths (which are water)
 * and the Welcome Harbor exit (which is a doorway, not a wall).
 */
export const SHORE_ROCK_SPACING = 2.1;
export const SHORE_ROCK_SCALE = 3;
export const SHORE_ROCK_RUNS: readonly {
  from: { x: number; z: number };
  to: { x: number; z: number };
}[] = [
  {
    from: { x: -GROUND_HALF_EXTENT_X, z: GROUND_HALF_EXTENT_Z },
    to: { x: CHANNEL_MIN_X, z: GROUND_HALF_EXTENT_Z },
  },
  {
    from: { x: CHANNEL_MAX_X, z: GROUND_HALF_EXTENT_Z },
    to: { x: GROUND_HALF_EXTENT_X, z: GROUND_HALF_EXTENT_Z },
  },
  {
    from: { x: -GROUND_HALF_EXTENT_X, z: -GROUND_HALF_EXTENT_Z },
    to: { x: CHANNEL_MIN_X, z: -GROUND_HALF_EXTENT_Z },
  },
  {
    from: { x: CHANNEL_MAX_X, z: -GROUND_HALF_EXTENT_Z },
    to: { x: GROUND_HALF_EXTENT_X, z: -GROUND_HALF_EXTENT_Z },
  },
  {
    from: { x: GROUND_HALF_EXTENT_X, z: -GROUND_HALF_EXTENT_Z },
    to: { x: GROUND_HALF_EXTENT_X, z: GROUND_HALF_EXTENT_Z },
  },
  {
    from: { x: -GROUND_HALF_EXTENT_X, z: -GROUND_HALF_EXTENT_Z },
    to: { x: -GROUND_HALF_EXTENT_X, z: -2.5 },
  },
  {
    from: { x: -GROUND_HALF_EXTENT_X, z: 2.5 },
    to: { x: -GROUND_HALF_EXTENT_X, z: GROUND_HALF_EXTENT_Z },
  },
];

/**
 * A jetty running out over the open sea off the dock's south shore, built
 * from the same `bridge-plank` kit piece the bridge uses. Decoration
 * beyond the boundary collider, not walkable - it exists so the dock looks
 * like a dock from anywhere on the west side.
 */
export const JETTY_RUN: { from: { x: number; z: number }; to: { x: number; z: number } } = {
  from: { x: -11, z: -7.2 },
  to: { x: -11, z: -12.5 },
};
export const JETTY_PLANK_WIDTH = 0.9;

export const MOORING_POSTS: readonly { x: number; z: number }[] = [
  { x: -12.7, z: -7.6 },
  { x: -9.3, z: -7.6 },
  { x: -12.7, z: -12.2 },
  { x: -9.3, z: -12.2 },
];

/** Crates on the dock, some stacked (`y > 0`), and more spilled out of the wreck in the cove. */
export const CRATES: readonly { x: number; z: number; y?: number; rotationY?: number }[] = [
  { x: -12.1, z: -3.2 },
  { x: -12.1, z: -3.2, y: 0.8, rotationY: 0.3 },
  { x: -11.2, z: -3.5, rotationY: -0.2 },
  { x: -6.6, z: -4.6 },
  { x: -5.8, z: -4.7, rotationY: 0.4 },
  { x: -12.4, z: 4.5 },
  { x: -11.6, z: 4.6, rotationY: -0.35 },
  { x: -12.4, z: 4.5, y: 0.8, rotationY: 0.2 },
  { x: 6.6, z: -1.7 },
  { x: 7.3, z: -1.1, rotationY: 0.5 },
  { x: 6.6, z: -1.7, y: 0.8, rotationY: -0.25 },
];

export const BARRELS: readonly { x: number; z: number }[] = [
  { x: -10.5, z: 4.9 },
  { x: -9.8, z: 5.3 },
  { x: -6.2, z: -5.5 },
  { x: -13.6, z: 1.5 },
  { x: 5.9, z: -3.4 },
  { x: 12.9, z: -5.3 },
];

/** The cove's landmark wreck. Its footprint is a real collider, so the child walks around it rather than through it. */
export const SHIPWRECK = { x: 10.6, z: -3.8, rotationY: -0.55 };
export const SHIPWRECK_FOOTPRINT: RectZone = {
  id: 'cove-shipwreck',
  minX: 7.9,
  maxX: 13.3,
  minZ: -5.9,
  maxZ: -1.9,
};

/** Prop footprints that block movement, on top of the boundary/channel colliders. */
export const SOLID_PROPS: readonly RectZone[] = [
  SHIPWRECK_FOOTPRINT,
  { id: 'dock-crates-south', minX: -12.6, maxX: -10.7, minZ: -4, maxZ: -2.7 },
  { id: 'dock-crates-north', minX: -12.9, maxX: -11.1, minZ: 4, maxZ: 5.1 },
  { id: 'cove-crates', minX: 6.1, maxX: 7.8, minZ: -2.2, maxZ: -0.6 },
];

export const PIRATE_BUILDER_BAY_REGION_CHECKPOINTS = PIRATE_BUILDER_BAY_CHECKPOINTS;
