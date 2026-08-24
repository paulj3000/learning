import { WELCOME_HARBOR_CHECKPOINTS, WELCOME_HARBOR_REGION_ID } from '../../discovery/checkpoints';

/**
 * Pure content and geometry for the Phase 32 Welcome Harbor region
 * (`docs/ROADMAP.md` Phase 32, "First-Person Island Village / Welcome
 * Harbor"): where its two enterable buildings, its one placed NPC, its
 * ambient creature's flight path, and its instanced scenery sit. Plain
 * numbers rather than `THREE.Vector3`/`THREE.Box3`, mirroring
 * `worldObjects.ts`/`zones.ts`'s split from their Phaser scene files, so
 * this stays unit-testable without a rendering context - `welcomeHarborScene.ts`
 * is the only file that turns these numbers into `three` objects.
 *
 * Checkpoint *positions* are authored here (an authored id needs a place to
 * spawn); the checkpoint *id vocabulary and persistence* live one layer
 * down in `src/features/discovery/checkpoints.ts`, per ADR-008's rule that
 * World State must never depend on World Engine code.
 */

export const REGION_ID = WELCOME_HARBOR_REGION_ID;

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

export const GROUND_HALF_EXTENT = 12;
const WALL_THICKNESS = 1;

/** The four boundary walls, one thin rect per edge, so the region reads as an enclosed island plot. */
export const BOUNDARY_WALLS: readonly RectZone[] = [
  {
    id: 'boundary-north',
    minX: -GROUND_HALF_EXTENT,
    maxX: GROUND_HALF_EXTENT,
    minZ: GROUND_HALF_EXTENT,
    maxZ: GROUND_HALF_EXTENT + WALL_THICKNESS,
  },
  {
    id: 'boundary-south',
    minX: -GROUND_HALF_EXTENT,
    maxX: GROUND_HALF_EXTENT,
    minZ: -GROUND_HALF_EXTENT - WALL_THICKNESS,
    maxZ: -GROUND_HALF_EXTENT,
  },
  {
    id: 'boundary-east',
    minX: GROUND_HALF_EXTENT,
    maxX: GROUND_HALF_EXTENT + WALL_THICKNESS,
    minZ: -GROUND_HALF_EXTENT,
    maxZ: GROUND_HALF_EXTENT,
  },
  {
    id: 'boundary-west',
    minX: -GROUND_HALF_EXTENT - WALL_THICKNESS,
    maxX: -GROUND_HALF_EXTENT,
    minZ: -GROUND_HALF_EXTENT,
    maxZ: GROUND_HALF_EXTENT,
  },
];

export interface BuildingDefinition {
  id: string;
  /** Child-facing name, used by the HUD toast when the child walks inside. */
  label: string;
  /** Center of the building footprint. */
  x: number;
  z: number;
  halfWidth: number;
  halfDepth: number;
  height: number;
  /** Each wall segment is a solid collider; the missing side is the doorway, so no wall list means no gap to walk through. */
  wallSides: readonly ('north' | 'south' | 'east' | 'west')[];
  /** The trigger volume that fires `PlayerEnteredZone` once the child steps inside. */
  interiorZone: RectZone;
}

/**
 * Two enterable buildings (roadmap: "enterable buildings"). Each omits one
 * wall side as its doorway - real geometry, not a locked door with no way
 * through - and its `interiorZone` is a shade smaller than the footprint so
 * the trigger fires only once the child has actually stepped inside.
 */
export const BUILDINGS: readonly BuildingDefinition[] = [
  {
    id: 'lookout-tower',
    label: 'the lookout tower',
    x: -7,
    z: -6,
    halfWidth: 2,
    halfDepth: 2,
    height: 4,
    wallSides: ['north', 'east', 'west'],
    interiorZone: { id: 'lookout-tower:interior', minX: -8.5, maxX: -5.5, minZ: -7.5, maxZ: -4.5 },
  },
  {
    id: 'dockside-shed',
    label: 'the dockside shed',
    x: 7,
    z: -6,
    halfWidth: 1.75,
    halfDepth: 1.75,
    height: 2.5,
    wallSides: ['north', 'east', 'west'],
    interiorZone: { id: 'dockside-shed:interior', minX: 5.5, maxX: 8.5, minZ: -7.5, maxZ: -4.5 },
  },
];

/** Where Pip stands (`docs/ROADMAP.md` Phase 32, "NPC placement with proximity + raycast interaction"). */
export const NPC_SPOT = { x: 1.5, z: -1 };
export const NPC_ID = 'pirate-pip';

/**
 * A looping flight path for the ambient gull (roadmap: "ambient creatures
 * and environmental animation"). Four points a `CatmullRomCurve3` closes
 * into a smooth loop above the water at the region's south edge; purely
 * decorative, never raycast-interactive.
 */
export const AMBIENT_GULL_PATH: readonly { x: number; y: number; z: number }[] = [
  { x: -4, y: 3.5, z: 9 },
  { x: 4, y: 4.5, z: 8 },
  { x: 3, y: 3.5, z: 10.5 },
  { x: -3, y: 4.5, z: 10.5 },
];

/**
 * Positions for the instanced crate cluster near the dock (roadmap
 * performance-budget deliverable: "instancing for repeated scenery").
 * Generated rather than hand-listed since the shape (a loose ring) matters,
 * not any one position.
 */
export const SCENERY_CLUSTER: readonly { x: number; z: number }[] = Array.from(
  { length: 10 },
  (_, index) => {
    const angle = (index / 10) * Math.PI * 2;
    const radius = 3.4;
    return { x: 4 + Math.cos(angle) * radius, z: 4 + Math.sin(angle) * radius };
  },
);

/**
 * Foliage kit placements (`docs/ROADMAP.md` Phase 34: "foliage kit").
 * Trees are placed individually (`placeWithLod` in `sceneKit.ts`) rather
 * than instanced, since each needs its own distance check against the
 * camera to swap in `foliage-tree-lod1` - the one concrete LOD pair in the
 * first asset pack. Bushes have no LOD variant, so they are instanced
 * (`FOLIAGE_BUSHES`) the same way `SCENERY_CLUSTER` already is.
 */
export const FOLIAGE_TREES: readonly { x: number; z: number }[] = [
  { x: -10, z: -1 },
  { x: 9.5, z: -2 },
  { x: 2, z: -9.5 },
];

export const FOLIAGE_BUSHES: readonly { x: number; z: number }[] = [
  { x: -4, z: -9.5 },
  { x: -3, z: -9 },
  { x: 9, z: -9 },
  { x: 9.8, z: -8.5 },
];

/** A decorative fence run in the open field south of both buildings (roadmap: "modular kits ... fences"). No collider - purely visual, like the door kit piece. */
export const FENCE_RUN: { from: { x: number; z: number }; to: { x: number; z: number } } = {
  from: { x: -2, z: -9.5 },
  to: { x: 2, z: -9.5 },
};

/** One collectible (roadmap: "one collectible"), wired to the same `CollectiblePickedUp` event the Phase 31 sandbox already established. */
export const COLLECTIBLE_SPOT = { x: -1.5, z: -3 };
export const COLLECTIBLE_ID = 'harbor-collectible-gem';

export const WELCOME_HARBOR_REGION_CHECKPOINTS = WELCOME_HARBOR_CHECKPOINTS;

export function findBuildingByInteriorZoneId(zoneId: string): BuildingDefinition | undefined {
  return BUILDINGS.find((building) => building.interiorZone.id === zoneId);
}
