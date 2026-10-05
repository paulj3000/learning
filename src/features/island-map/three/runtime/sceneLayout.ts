import type { InstancePlacement } from '../assets/assetLoader';
import { runPlacements, WALL_HEIGHT } from '../sceneKit';
import type {
  BoundsSpec,
  BuildingSpec,
  GroundPoint,
  RectZone,
  ThreeLocationManifest,
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

/** Centres of a square tile grid covering `area`. A partial last row/column is dropped, not stretched. */
export function tiledGroundPlacements(area: Omit<RectZone, 'id'>, tileSize: number): GroundPoint[] {
  const columns = Math.floor((area.maxX - area.minX) / tileSize);
  const rows = Math.floor((area.maxZ - area.minZ) / tileSize);
  const tiles: GroundPoint[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      tiles.push({
        x: area.minX + tileSize / 2 + column * tileSize,
        z: area.minZ + tileSize / 2 + row * tileSize,
      });
    }
  }
  return tiles;
}

/** Every solid box the player cannot walk through: boundary, authored colliders, building walls. */
export function solidColliders(manifest: ThreeLocationManifest): BoxBounds[] {
  return [
    ...boundaryWallRects(manifest.bounds).map((rect) => rectToBox(rect, RECT_MIN_Y, WALL_HEIGHT)),
    ...manifest.colliders.map((collider) =>
      rectToBox(collider.rect, collider.minY ?? RECT_MIN_Y, collider.maxY ?? WALL_HEIGHT),
    ),
    ...manifest.buildings.flatMap(buildingWallColliders),
  ];
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
