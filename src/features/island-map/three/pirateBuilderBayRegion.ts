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

export const PIRATE_BUILDER_BAY_REGION_CHECKPOINTS = PIRATE_BUILDER_BAY_CHECKPOINTS;
