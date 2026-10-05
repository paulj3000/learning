import type { InstancePlacement } from '../assets/assetLoader';
import { areRequirementsMet, type WorldInteractionContext } from '../../worldObjects';
import { runPlacements, WALL_HEIGHT } from '../sceneKit';
import type {
  BoundsSpec,
  BuildingSpec,
  GroundPoint,
  RectZone,
  LightingSpec,
  ThreeLocationManifest,
  TileCoverage,
  WallSide,
} from './locationManifest';

/**
 * Pure layout math the generic runtime turns a manifest into
 * (`docs/engine/10_IMPLEMENTATION_PHASES.md` Phase 3). Plain numbers in and
 * out, no `three` scene objects, so every collider, trigger and placement is
 * unit-testable without a rendering context. `createLocationEngine.ts` is
 * the only file that turns these into `Box3`s and meshes.
 *
 * Each function is lifted from the per-region code it replaces (mostly
 * `welcomeHarborScene.ts`, the reference region), keeping its numbers, so a
 * migrated region collides and triggers exactly where it did before.
 */

/** An axis-aligned box in world meters, the plain-data twin of `THREE.Box3`. */
export interface BoxBounds {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

/** Default vertical extent of a ground-plane rect turned into a collider or trigger (as `sceneKit.toBox3`). */
const RECT_MIN_Y = -1;
/** Building interiors trigger up to this height, so a tall building's whole interior counts. */
const INTERIOR_MAX_Y = 6;
/** Checkpoint triggers reach this height. */
const CHECKPOINT_MAX_Y = 3;
/** Wall collider half-thickness either side of a building's footprint edge. */
const BUILDING_WALL_HALF_THICKNESS = 0.2;
/** A child with no world changes, items or discoveries: what requirements see when none is given. */
export const NO_WORLD_STATE: WorldInteractionContext = {
  worldChangeKeys: [],
  ownedItemIds: [],
  discoveryIds: [],
};

/** Width of one `wall` kit panel, which a building side is tiled with. */
export const WALL_PANEL_WIDTH_METERS = 2;

const ALL_SIDES: readonly WallSide[] = ['north', 'south', 'east', 'west'];

function rectToBox(rect: Omit<RectZone, 'id'>, minY: number, maxY: number): BoxBounds {
  return { minX: rect.minX, minY, minZ: rect.minZ, maxX: rect.maxX, maxY, maxZ: rect.maxZ };
}

/** The four thin boundary rects every region used to write out by hand, one per edge. */
export function boundaryWallRects(bounds: BoundsSpec): RectZone[] {
  const { halfExtentX: hx, halfExtentZ: hz, wallThickness: t } = bounds;
  return [
    { id: 'boundary-north', minX: -hx, maxX: hx, minZ: hz, maxZ: hz + t },
    { id: 'boundary-south', minX: -hx, maxX: hx, minZ: -hz - t, maxZ: -hz },
    { id: 'boundary-east', minX: hx, maxX: hx + t, minZ: -hz, maxZ: hz },
    { id: 'boundary-west', minX: -hx - t, maxX: -hx, minZ: -hz, maxZ: hz },
  ];
}

/** One collider per walled side; the missing side has none, so it is a real doorway. */
export function buildingWallColliders(building: BuildingSpec): BoxBounds[] {
  const { x, z, halfWidth, halfDepth, height } = building;
  const t = BUILDING_WALL_HALF_THICKNESS;
  return building.wallSides.map((side) => {
    switch (side) {
      case 'north':
        return {
          minX: x - halfWidth,
          minY: 0,
          minZ: z - halfDepth - t,
          maxX: x + halfWidth,
          maxY: height,
          maxZ: z - halfDepth + t,
        };
      case 'south':
        return {
          minX: x - halfWidth,
          minY: 0,
          minZ: z + halfDepth - t,
          maxX: x + halfWidth,
          maxY: height,
          maxZ: z + halfDepth + t,
        };
      case 'east':
        return {
          minX: x + halfWidth - t,
          minY: 0,
          minZ: z - halfDepth,
          maxX: x + halfWidth + t,
          maxY: height,
          maxZ: z + halfDepth,
        };
      case 'west':
        return {
          minX: x - halfWidth - t,
          minY: 0,
          minZ: z - halfDepth,
          maxX: x - halfWidth + t,
          maxY: height,
          maxZ: z + halfDepth,
        };
    }
  });
}

/** The two ground corners of one side of a building's footprint. */
export function buildingSideRun(
  building: BuildingSpec,
  side: WallSide,
): { from: GroundPoint; to: GroundPoint } {
  const { x, z, halfWidth, halfDepth } = building;
  switch (side) {
    case 'north':
      return {
        from: { x: x - halfWidth, z: z - halfDepth },
        to: { x: x + halfWidth, z: z - halfDepth },
      };
    case 'south':
      return {
        from: { x: x - halfWidth, z: z + halfDepth },
        to: { x: x + halfWidth, z: z + halfDepth },
      };
    case 'east':
      return {
        from: { x: x + halfWidth, z: z - halfDepth },
        to: { x: x + halfWidth, z: z + halfDepth },
      };
    case 'west':
      return {
        from: { x: x - halfWidth, z: z - halfDepth },
        to: { x: x - halfWidth, z: z + halfDepth },
      };
  }
}

/** The first side with no wall, where the door piece goes. `undefined` for a fully walled building. */
export function buildingDoorSide(building: BuildingSpec): WallSide | undefined {
  return ALL_SIDES.find((side) => !building.wallSides.includes(side));
}

/**
 * Wall panels tiled along every walled side. Each panel's y-scale stretches
 * the `WALL_HEIGHT`-tall kit piece to the building's own height, so the roof
 * sits flush on top.
 */
export function buildingWallPlacements(building: BuildingSpec): InstancePlacement[] {
  const heightScale = building.height / WALL_HEIGHT;
  return building.wallSides.flatMap((side) => {
    const run = buildingSideRun(building, side);
    return runPlacements(run.from, run.to, WALL_PANEL_WIDTH_METERS).map((placement) => ({
      ...placement,
      scale: { y: heightScale },
    }));
  });
}

/** One roof piece on top of the building, scaled to its footprint. */
export function buildingRoofPlacement(building: BuildingSpec): InstancePlacement {
  const radius = Math.max(building.halfWidth, building.halfDepth) * 1.3;
  return {
    position: { x: building.x, y: building.height, z: building.z },
    rotationY: Math.PI / 4,
    scale: { x: radius / 1.5, y: 1, z: radius / 1.5 },
  };
}

/** One door piece centred in the doorway, or nothing for a fully walled building. */
export function buildingDoorPlacement(building: BuildingSpec): InstancePlacement | undefined {
  const side = buildingDoorSide(building);
  if (!side) return undefined;
  const run = buildingSideRun(building, side);
  return { position: { x: (run.from.x + run.to.x) / 2, y: 0, z: (run.from.z + run.to.z) / 2 } };
}

/**
 * Centres of a square tile grid over `area`.
 *
 * `INSIDE` keeps every tile within the area and drops a partial last row or
 * column, which is what a floor inside walls wants. `COVER` centres the grid
 * and rounds the count up instead, so the area is covered edge to edge and
 * the overhang falls outside - what open ground and trails want, where a
 * dropped last row reads as a bare strip at the far edge.
 */
export function tiledGroundPlacements(
  area: Omit<RectZone, 'id'>,
  tileSize: number,
  coverage: TileCoverage = 'INSIDE',
): GroundPoint[] {
  const width = area.maxX - area.minX;
  const depth = area.maxZ - area.minZ;
  const cover = coverage === 'COVER';
  const columns = cover ? Math.max(1, Math.ceil(width / tileSize)) : Math.floor(width / tileSize);
  const rows = cover ? Math.max(1, Math.ceil(depth / tileSize)) : Math.floor(depth / tileSize);
  const firstX = cover
    ? (area.minX + area.maxX) / 2 - ((columns - 1) * tileSize) / 2
    : area.minX + tileSize / 2;
  const firstZ = cover
    ? (area.minZ + area.maxZ) / 2 - ((rows - 1) * tileSize) / 2
    : area.minZ + tileSize / 2;
  const tiles: GroundPoint[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      tiles.push({ x: firstX + column * tileSize, z: firstZ + row * tileSize });
    }
  }
  return tiles;
}

/** A tiny deterministic PRNG, so a scatter looks the same on every load and in every screenshot. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/**
 * Deterministic placements for a `SCATTER` scenery item: sample `area` on a
 * `spacing` grid, jitter each candidate inside its own cell, and keep only
 * the ones that are nowhere near anywhere the child can stand.
 *
 * Lifted unchanged from `wonderwildForestScene.ts`, which still re-exports
 * it, so a migrated forest scatters its trees in exactly the same places.
 * Two things in it are deliberate rather than incidental:
 *
 * - **It samples the area, not the blocked rects.** The forest's tree line is
 *   derived as the complement of its walkable set, so it arrives as many
 *   narrow strips, and gridding each one gave fourteen trees for a whole
 *   forest. Density would then depend on how the complement happened to be
 *   cut up, which is an implementation detail and nothing to do with how a
 *   forest should look.
 * - **Clearance is checked four points around the candidate**, not just at
 *   it, because a tree has a trunk: one placed hard against the edge of a
 *   trail is off the trail and still in the child's way.
 */
export function scatterPlacements(
  area: Omit<RectZone, 'id'>,
  spacing: number,
  seed: number,
  walkable: (x: number, z: number) => boolean,
  clearance = 0.8,
): InstancePlacement[] {
  const random = seededRandom(seed);
  const cols = Math.max(1, Math.floor((area.maxX - area.minX) / spacing));
  const rows = Math.max(1, Math.floor((area.maxZ - area.minZ) / spacing));
  const cellWidth = (area.maxX - area.minX) / cols;
  const cellDepth = (area.maxZ - area.minZ) / rows;

  const placements: InstancePlacement[] = [];
  for (let col = 0; col < cols; col += 1) {
    for (let row = 0; row < rows; row += 1) {
      // Jitter inside the cell so the scatter does not read as a grid.
      const x = area.minX + (col + 0.15 + random() * 0.7) * cellWidth;
      const z = area.minZ + (row + 0.15 + random() * 0.7) * cellDepth;
      const rotationY = random() * Math.PI * 2;
      const blocksSomeone =
        walkable(x, z) ||
        walkable(x + clearance, z) ||
        walkable(x - clearance, z) ||
        walkable(x, z + clearance) ||
        walkable(x, z - clearance);
      if (blocksSomeone) continue;
      placements.push({ position: { x, y: 0, z }, rotationY });
    }
  }
  return placements;
}

/** Which way is "into the room" for a wall on this side of a floor. */
const INWARD_OFFSET: Readonly<Record<WallSide, { x: number; z: number }>> = {
  north: { x: 0, z: -1 },
  south: { x: 0, z: 1 },
  east: { x: -1, z: 0 },
  west: { x: 1, z: 0 },
};

/** The centre line of a wall rect, running along its long axis. */
export function wallCentreLine(wall: Omit<RectZone, 'id'>): {
  from: GroundPoint;
  to: GroundPoint;
} {
  const centreX = (wall.minX + wall.maxX) / 2;
  const centreZ = (wall.minZ + wall.maxZ) / 2;
  return wall.maxX - wall.minX >= wall.maxZ - wall.minZ
    ? { from: { x: wall.minX, z: centreZ }, to: { x: wall.maxX, z: centreZ } }
    : { from: { x: centreX, z: wall.minZ }, to: { x: centreX, z: wall.maxZ } };
}

/**
 * Panel placements covering one interior wall segment exactly, on its own
 * room-facing side (engine Phase 9, lifted from `storykeeperCastleScene.ts`).
 *
 * Two things in it are load-bearing rather than cosmetic:
 *
 * - **Each room draws its own face.** Interior wall colliders straddle the
 *   edge they sit on, so a shared wall produces two overlapping colliders;
 *   drawing both rooms' panels on the centre line would put two coplanar
 *   surfaces in the same place and make them shimmer. Insetting each onto
 *   its own side is both correct - a shared wall has two faces - and gives
 *   the wall a readable thickness in a doorway.
 * - **Panels are scaled to the exact quotient.** Tiling whole panels would
 *   overhang a wall whose length is not a multiple of the panel width, and
 *   an overhang here is not cosmetic: it grows across an archway gap and
 *   bricks up a doorway the collider still lets the child walk through.
 */
export function wallPanelPlacements(
  wall: Omit<RectZone, 'id'>,
  side: WallSide,
  panelWidth: number,
  wallThickness: number,
): InstancePlacement[] {
  const offset = INWARD_OFFSET[side];
  const inset = wallThickness / 2;
  const line = wallCentreLine(wall);
  const from = { x: line.from.x + offset.x * inset, z: line.from.z + offset.z * inset };
  const to = { x: line.to.x + offset.x * inset, z: line.to.z + offset.z * inset };

  const length = Math.hypot(to.x - from.x, to.z - from.z);
  const segments = Math.max(1, Math.round(length / panelWidth));
  const exactWidth = length / segments;

  return runPlacements(from, to, panelWidth).map((placement) => ({
    ...placement,
    scale: { x: exactWidth / panelWidth },
  }));
}

/**
 * The yaw that turns something standing against a wall to face into its
 * room, from which of the room's four edges it is nearest. Derived rather
 * than authored per spot, so moving a portrait along its wall cannot leave
 * it facing into the stonework.
 */
export function facingIntoRoom(spot: GroundPoint, floor: Omit<RectZone, 'id'>): number {
  const toNorth = floor.maxZ - spot.z;
  const toSouth = spot.z - floor.minZ;
  const toEast = floor.maxX - spot.x;
  const toWest = spot.x - floor.minX;
  const nearest = Math.min(toNorth, toSouth, toEast, toWest);
  if (nearest === toNorth) return Math.PI;
  if (nearest === toSouth) return 0;
  if (nearest === toEast) return -Math.PI / 2;
  return Math.PI / 2;
}

/**
 * The yaw that turns something at `from` to look at `to`, in the forward
 * convention `firstPersonController.ts` uses: forward is
 * `(sin(yaw), cos(yaw))`.
 */
export function yawTowards(from: GroundPoint, to: GroundPoint): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

/**
 * Whether a child could stand at a ground point: inside the walkable bounds
 * and in none of the manifest's own colliders.
 *
 * Building walls and the derived boundary are deliberately not consulted.
 * The boundary sits *outside* the bounds, which this already excludes, and a
 * building's walls are drawn from its own kit rather than scattered into.
 */
export function walkableProbe(
  manifest: ThreeLocationManifest,
  context: WorldInteractionContext = NO_WORLD_STATE,
): (x: number, z: number) => boolean {
  const { halfExtentX, halfExtentZ } = manifest.bounds;
  const blocked = manifest.colliders
    .filter((collider) => areRequirementsMet(collider.requirements, context))
    .map((collider) => collider.rect);
  return (x, z) => {
    if (Math.abs(x) > halfExtentX || Math.abs(z) > halfExtentZ) return false;
    return !blocked.some(
      (rect) => x >= rect.minX && x <= rect.maxX && z >= rect.minZ && z <= rect.maxZ,
    );
  };
}

/** A solid box, with the manifest collider id it came from when it has one. */
export interface SolidCollider {
  /** The authored `ColliderSpec.rect.id`; absent for boundary and building walls. */
  id?: string;
  box: BoxBounds;
}

/**
 * Every solid box the player cannot walk through: boundary, authored
 * colliders whose requirements hold in `context`, and building walls.
 */
export function solidColliders(
  manifest: ThreeLocationManifest,
  context: WorldInteractionContext = NO_WORLD_STATE,
): SolidCollider[] {
  return [
    ...boundaryWallRects(manifest.bounds).map((rect) => ({
      box: rectToBox(rect, RECT_MIN_Y, WALL_HEIGHT),
    })),
    ...manifest.colliders
      .filter((collider) => areRequirementsMet(collider.requirements, context))
      .map((collider) => ({
        id: collider.rect.id,
        box: rectToBox(collider.rect, collider.minY ?? RECT_MIN_Y, collider.maxY ?? WALL_HEIGHT),
      })),
    ...manifest.buildings.flatMap(buildingWallColliders).map((box) => ({ box })),
  ];
}

/**
 * The environment this world state resolves to: the base sky and lighting
 * with the first matching variant merged over it, field by field.
 */
export function resolveEnvironment(
  manifest: ThreeLocationManifest,
  context: WorldInteractionContext = NO_WORLD_STATE,
): { backgroundColor: number; lighting?: LightingSpec } {
  const variant = manifest.environment.variants?.find((candidate) =>
    areRequirementsMet(candidate.requirements, context),
  );
  return {
    backgroundColor: variant?.backgroundColor ?? manifest.environment.backgroundColor,
    lighting:
      variant?.lighting || manifest.environment.lighting
        ? { ...manifest.environment.lighting, ...variant?.lighting }
        : undefined,
  };
}

/** The first status line whose requirements hold, or `undefined` when a region authors none. */
export function resolveStatusLine(
  manifest: ThreeLocationManifest,
  context: WorldInteractionContext = NO_WORLD_STATE,
): string | undefined {
  return manifest.copy.statusLines?.find((line) => areRequirementsMet(line.requirements, context))
    ?.text;
}

/** Every "things to do" note whose requirements hold, in authored order. */
export function resolveThingsToDoNotes(
  manifest: ThreeLocationManifest,
  context: WorldInteractionContext = NO_WORLD_STATE,
): string[] {
  return (manifest.copy.thingsToDoNotes ?? [])
    .filter((note) => areRequirementsMet(note.requirements, context))
    .map((note) => note.text);
}

export type TriggerKind = 'CHECKPOINT' | 'INTERIOR' | 'ZONE';

/** A volume that emits `PlayerEnteredZone` with `id` when the player steps in. */
export interface TriggerVolume {
  id: string;
  kind: TriggerKind;
  box: BoxBounds;
}

/**
 * Every trigger volume, in the order the runtime checks them: checkpoints,
 * then building interiors, then authored zones. `checkpoints` are the
 * region's `RegionCheckpoint`s, whose positions stay owned by
 * `discovery/checkpoints.ts` (ADR-008).
 */
export function triggerVolumes(
  manifest: ThreeLocationManifest,
  checkpoints: readonly { id: string; x: number; z: number }[],
): TriggerVolume[] {
  const half = manifest.checkpoints.triggerHalfSize;
  const byId = new Map(checkpoints.map((checkpoint) => [checkpoint.id, checkpoint]));
  return [
    ...manifest.checkpoints.ids.flatMap((id): TriggerVolume[] => {
      const checkpoint = byId.get(id);
      if (!checkpoint) return [];
      return [
        {
          id,
          kind: 'CHECKPOINT',
          box: {
            minX: checkpoint.x - half,
            minY: RECT_MIN_Y,
            minZ: checkpoint.z - half,
            maxX: checkpoint.x + half,
            maxY: CHECKPOINT_MAX_Y,
            maxZ: checkpoint.z + half,
          },
        },
      ];
    }),
    ...manifest.buildings.map((building): TriggerVolume => ({
      id: building.interiorZone.id,
      kind: 'INTERIOR',
      box: rectToBox(building.interiorZone, RECT_MIN_Y, INTERIOR_MAX_Y),
    })),
    ...manifest.zones.map((zone): TriggerVolume => ({
      id: zone.rect.id,
      kind: 'ZONE',
      box: rectToBox(zone.rect, RECT_MIN_Y, WALL_HEIGHT),
    })),
  ];
}

export function boxContains(box: BoxBounds, point: { x: number; y: number; z: number }): boolean {
  return (
    point.x >= box.minX &&
    point.x <= box.maxX &&
    point.y >= box.minY &&
    point.y <= box.maxY &&
    point.z >= box.minZ &&
    point.z <= box.maxZ
  );
}
