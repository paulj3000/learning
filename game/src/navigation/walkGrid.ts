/**
 * The walkable grid for guided tap-to-move (LAI-2104S step B1, owner option B).
 *
 * Pure and flat-ground: it is built from an Area's axis-aligned colliders, platforms and
 * hazard areas and answers "may the child's centre stand here". Terrain height is step B2
 * (it needs a host `groundHeightAt`, GE-L14), so every height here is measured from ground 0.
 *
 * How things rasterise (documented in `docs/engineering/game-engine/guided-movement.md`):
 * - A cell is a square of `cellSize` metres; it is free when its centre is free.
 * - A collider blocks when the controller's own rules say it blocks the body (GE-L16 clearance
 *   and step height, the same `classifySolidBox` the controller uses): a Solid box is a column
 *   (blocks), an overhead lintel (does not), or below ground (does not); a jumpable box blocks
 *   only when it is taller than a step and starts below the body's top. A path never uses a jump.
 * - A blocking box blocks every point closer than `agentRadius + wallClearance` to its
 *   footprint (rounded corners, as the controller's `footprintDistance`).
 * - A hazard area (feet at or below `belowY`, default 0.05, reach ground) blocks every point
 *   closer than `hazardMargin` to it, unless a static, walkable platform covers the point.
 * - A static platform whose top is within one step of the ground is a walkable surface and
 *   opens the hazard under it; a moving, spinning, vanishing, bouncing or switched platform is
 *   never a path (its rest box only blocks, by the collider rule).
 */

import { EngineError } from '../core/errors';
import type { ColliderKind } from '../contracts/physics';
import type { Vec3Like } from '../contracts/player';
import {
  classifySolidBox,
  DEFAULT_CLEARANCE_MARGIN,
  requiredClearance,
} from '../movement/clearance';
import { DEFAULT_BODY_HEIGHT, DEFAULT_STEP_HEIGHT } from '../movement/firstPersonController';
import { DEFAULT_PLAYER_COLLISION } from '../movement/playerCollision';

/** A point on the ground plane, metres. */
export interface GroundXZ {
  x: number;
  z: number;
}

export interface WalkBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** A collider as the grid needs it. A `ColliderSpec` fits (TRIGGER boxes are ignored). */
export interface WalkCollider {
  id?: string;
  min: Readonly<Vec3Like>;
  max: Readonly<Vec3Like>;
  kind?: ColliderKind;
  /** True for a low obstacle the controller may hop onto (kind `JUMPABLE`). */
  jumpable?: boolean;
}

export interface WalkPlatform {
  id?: string;
  min: Readonly<Vec3Like>;
  max: Readonly<Vec3Like>;
  /**
   * Static and always present: only then may its top be walked on. Moving, spinning, vanishing,
   * bouncing and switched platforms are `false` (or absent) and are never a path.
   */
  fixed?: boolean;
}

export interface WalkHazard {
  id?: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Feet at or below this height count as in the hazard. Default 0.05 (the platforming default). */
  belowY?: number;
}

/** A place the child may want to reach: an interaction target, a zone, a checkpoint. */
export type WalkTarget =
  { id: string; x: number; z: number; approachRange?: number } | { id: string; rect: WalkBounds };

export interface WalkabilityInput {
  colliders: readonly WalkCollider[];
  platforms?: readonly WalkPlatform[];
  hazards?: readonly WalkHazard[];
  /** The walkable extent. Absent: the union of every collider, platform and hazard. */
  bounds?: WalkBounds;
  /** Named targets for `isReachable` by id. */
  targets?: readonly WalkTarget[];
}

export interface WalkGridOptions {
  /** Cell side, metres. Default {@link NAV_CELL_SIZE}. Raised automatically past `maxCells`. */
  cellSize?: number;
  /** Largest grid built before the cell size is raised. Default {@link NAV_MAX_CELLS}. */
  maxCells?: number;
  /** Body radius, metres. Default: the controller's `DEFAULT_PLAYER_COLLISION.radius`. */
  agentRadius?: number;
  /** The controller's skin, metres. Default `DEFAULT_PLAYER_COLLISION.skin`. */
  skin?: number;
  /** Extra room kept from every wall so a path never grazes one, metres. Default 0.02. */
  wallClearance?: number;
  /** How far a path stays from a hazard area, metres. Default {@link NAV_HAZARD_MARGIN}. */
  hazardMargin?: number;
  bodyHeight?: number;
  stepHeight?: number;
  /** GE-L16 headroom beyond the body height for a walk-under passage. */
  clearanceMargin?: number;
}

/** Cell side, metres. 0.2 m keeps a 1 m doorway passable (the authored minimum) with room to spare. */
export const NAV_CELL_SIZE = 0.2;
/** Cells in a grid before the cell size is raised (about 126 x 126 m at the default cell size). */
export const NAV_MAX_CELLS = 400_000;
/** The coarsest cell size; an Area too large for it at `maxCells` cannot be gridded. */
export const NAV_MAX_CELL_SIZE = 0.5;
export const NAV_WALL_CLEARANCE = 0.02;
export const NAV_HAZARD_MARGIN = 0.3;
/** Platforms whose top is within a step are walkable (the controller steps up them). */
const EPSILON = 1e-6;
const BUCKET = 2;

interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Distance from a ground point to a rectangle's footprint, 0 inside (the controller's measure). */
function rectDistance(rect: Rect, x: number, z: number): number {
  const dx = Math.max(rect.minX - x, 0, x - rect.maxX);
  const dz = Math.max(rect.minZ - z, 0, z - rect.maxZ);
  return Math.hypot(dx, dz);
}

export interface WalkGrid {
  readonly cellSize: number;
  readonly originX: number;
  readonly originZ: number;
  readonly cols: number;
  readonly rows: number;
  /** Distance a path keeps from a blocking wall (agent radius + skin + clearance), metres. */
  readonly wallInflation: number;
  readonly hazardMargin: number;
  /**
   * The narrowest gap a path is guaranteed to use, metres: two inflations plus one cell for the
   * rasterisation. Anything under `2 * wallInflation` is always blocked.
   */
  readonly guaranteedGap: number;
  /** 1 where blocked. Row-major: `row * cols + col`. */
  readonly blocked: Uint8Array;
  inBounds(col: number, row: number): boolean;
  isFreeCell(col: number, row: number): boolean;
  cellOf(x: number, z: number): { col: number; row: number };
  centerOf(col: number, row: number): GroundXZ;
  /** Exact test of one ground point against every wall and hazard (not the grid). */
  isFreeAt(x: number, z: number): boolean;
  /** Whether the straight walk from a to b stays free, sampled finer than any obstacle is thick. */
  segmentClear(a: GroundXZ, b: GroundXZ): boolean;
}

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function assertBox(label: string, min: Readonly<Vec3Like>, max: Readonly<Vec3Like>): void {
  if (
    !finite(min.x) ||
    !finite(min.y) ||
    !finite(min.z) ||
    !finite(max.x) ||
    !finite(max.y) ||
    !finite(max.z) ||
    min.x > max.x ||
    min.y > max.y ||
    min.z > max.z
  ) {
    throw new EngineError('VALIDATION_FAILED', `${label} needs finite bounds with min <= max`);
  }
}

/** Whether the controller's rules let this box block a body walking on flat ground. */
function blocksWalking(
  box: { min: Readonly<Vec3Like>; max: Readonly<Vec3Like> },
  jumpable: boolean,
  body: { height: number; step: number; clearance: number },
): boolean {
  if (jumpable) {
    return box.max.y > body.step + EPSILON && box.min.y < body.height - EPSILON;
  }
  const cls = classifySolidBox(box, 0, body.clearance);
  if (cls === 'BELOW_GROUND') return false;
  if (cls === 'OVERHEAD') return box.min.y < body.height - EPSILON;
  return true;
}

export function buildWalkGrid(input: WalkabilityInput, options: WalkGridOptions = {}): WalkGrid {
  const agentRadius = options.agentRadius ?? DEFAULT_PLAYER_COLLISION.radius;
  const skin = options.skin ?? DEFAULT_PLAYER_COLLISION.skin;
  const wallInflation = agentRadius + skin + (options.wallClearance ?? NAV_WALL_CLEARANCE);
  const hazardMargin = options.hazardMargin ?? NAV_HAZARD_MARGIN;
  const bodyHeight = options.bodyHeight ?? DEFAULT_BODY_HEIGHT;
  const body = {
    height: bodyHeight,
    step: options.stepHeight ?? DEFAULT_STEP_HEIGHT,
    clearance: requiredClearance(bodyHeight, options.clearanceMargin ?? DEFAULT_CLEARANCE_MARGIN),
  };

  const walls: Rect[] = [];
  const hazards: Rect[] = [];
  const openings: Rect[] = [];
  const extent: Rect = {
    minX: Infinity,
    maxX: -Infinity,
    minZ: Infinity,
    maxZ: -Infinity,
  };
  const grow = (r: Rect) => {
    extent.minX = Math.min(extent.minX, r.minX);
    extent.maxX = Math.max(extent.maxX, r.maxX);
    extent.minZ = Math.min(extent.minZ, r.minZ);
    extent.maxZ = Math.max(extent.maxZ, r.maxZ);
  };

  for (const collider of input.colliders) {
    assertBox(`Collider "${collider.id ?? '?'}"`, collider.min, collider.max);
    const rect = {
      minX: collider.min.x,
      maxX: collider.max.x,
      minZ: collider.min.z,
      maxZ: collider.max.z,
    };
    grow(rect);
    if (collider.kind === 'TRIGGER') continue;
    const jumpable = collider.jumpable ?? collider.kind === 'JUMPABLE';
    if (blocksWalking(collider, jumpable, body)) walls.push(rect);
  }
  for (const platform of input.platforms ?? []) {
    assertBox(`Platform "${platform.id ?? '?'}"`, platform.min, platform.max);
    const rect = {
      minX: platform.min.x,
      maxX: platform.max.x,
      minZ: platform.min.z,
      maxZ: platform.max.z,
    };
    grow(rect);
    // Platforms are jumpable boxes to the controller.
    if (blocksWalking(platform, true, body)) {
      walls.push(rect);
    } else if (
      platform.fixed === true &&
      platform.max.y >= -EPSILON &&
      platform.max.y <= body.step + EPSILON
    ) {
      openings.push(rect);
    }
  }
  for (const hazard of input.hazards ?? []) {
    if (
      !finite(hazard.minX) ||
      !finite(hazard.maxX) ||
      !finite(hazard.minZ) ||
      !finite(hazard.maxZ) ||
      hazard.minX > hazard.maxX ||
      hazard.minZ > hazard.maxZ
    ) {
      throw new EngineError(
        'VALIDATION_FAILED',
        `Hazard "${hazard.id ?? '?'}" needs finite bounds with min <= max`,
      );
    }
    grow(hazard);
    // Feet on flat ground are at 0: a hazard whose belowY is under ground cannot catch a walker.
    if ((hazard.belowY ?? 0.05) >= 0) hazards.push(hazard);
  }

  const bounds: Rect | undefined = input.bounds ?? (finite(extent.minX) ? extent : undefined);
  if (!bounds || !(bounds.maxX > bounds.minX) || !(bounds.maxZ > bounds.minZ)) {
    throw new EngineError(
      'VALIDATION_FAILED',
      'A walk grid needs bounds, or at least one collider that gives it an extent',
    );
  }
  for (const value of [bounds.minX, bounds.maxX, bounds.minZ, bounds.maxZ]) {
    if (!finite(value))
      throw new EngineError('VALIDATION_FAILED', 'Walk grid bounds must be finite');
  }

  const maxCells = options.maxCells ?? NAV_MAX_CELLS;
  let cellSize = options.cellSize ?? NAV_CELL_SIZE;
  if (!(cellSize > 0)) throw new EngineError('VALIDATION_FAILED', 'cellSize must be positive');
  const width = bounds.maxX - bounds.minX;
  const depth = bounds.maxZ - bounds.minZ;
  if ((width / cellSize) * (depth / cellSize) > maxCells) {
    cellSize = Math.max(cellSize, Math.sqrt((width * depth) / maxCells));
    if (cellSize > NAV_MAX_CELL_SIZE) {
      throw new EngineError(
        'VALIDATION_FAILED',
        `Area is too large for a walk grid (${width.toFixed(0)} x ${depth.toFixed(0)} m)`,
        { cellSize },
      );
    }
  }
  const cols = Math.max(1, Math.ceil(width / cellSize));
  const rows = Math.max(1, Math.ceil(depth / cellSize));
  const originX = bounds.minX;
  const originZ = bounds.minZ;

  // Spatial hash for the exact point test: each rect lands in every bucket it can affect.
  const buckets = new Map<number, { walls: number[]; hazards: number[]; openings: number[] }>();
  const bucketKey = (bx: number, bz: number) => bx * 100_003 + bz;
  const bucketOf = (v: number, origin: number) => Math.floor((v - origin) / BUCKET);
  const slot = (bx: number, bz: number) => {
    const key = bucketKey(bx, bz);
    let entry = buckets.get(key);
    if (!entry) {
      entry = { walls: [], hazards: [], openings: [] };
      buckets.set(key, entry);
    }
    return entry;
  };
  const insert = (rects: Rect[], kind: 'walls' | 'hazards' | 'openings', reach: number) => {
    rects.forEach((rect, index) => {
      const x0 = bucketOf(rect.minX - reach, originX);
      const x1 = bucketOf(rect.maxX + reach, originX);
      const z0 = bucketOf(rect.minZ - reach, originZ);
      const z1 = bucketOf(rect.maxZ + reach, originZ);
      for (let bx = x0; bx <= x1; bx += 1) {
        for (let bz = z0; bz <= z1; bz += 1) slot(bx, bz)[kind].push(index);
      }
    });
  };
  insert(walls, 'walls', wallInflation);
  insert(hazards, 'hazards', hazardMargin);
  insert(openings, 'openings', 0);

  const isFreeAt = (x: number, z: number): boolean => {
    if (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ) return false;
    const entry = buckets.get(bucketKey(bucketOf(x, originX), bucketOf(z, originZ)));
    if (!entry) return true;
    for (const index of entry.walls) {
      if (rectDistance(walls[index], x, z) < wallInflation - EPSILON) return false;
    }
    for (const index of entry.hazards) {
      if (rectDistance(hazards[index], x, z) < hazardMargin - EPSILON) {
        const covered = entry.openings.some((open) => rectDistance(openings[open], x, z) === 0);
        if (!covered) return false;
      }
    }
    return true;
  };

  const blocked = new Uint8Array(cols * rows);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x = originX + (col + 0.5) * cellSize;
      const z = originZ + (row + 0.5) * cellSize;
      if (!isFreeAt(x, z)) blocked[row * cols + col] = 1;
    }
  }

  const SAMPLE = 0.1;
  const grid: WalkGrid = {
    cellSize,
    originX,
    originZ,
    cols,
    rows,
    wallInflation,
    hazardMargin,
    guaranteedGap: 2 * wallInflation + cellSize,
    blocked,
    inBounds: (col, row) => col >= 0 && row >= 0 && col < cols && row < rows,
    isFreeCell: (col, row) =>
      col >= 0 && row >= 0 && col < cols && row < rows && blocked[row * cols + col] === 0,
    cellOf: (x, z) => ({
      col: Math.min(cols - 1, Math.max(0, Math.floor((x - originX) / cellSize))),
      row: Math.min(rows - 1, Math.max(0, Math.floor((z - originZ) / cellSize))),
    }),
    centerOf: (col, row) => ({
      x: originX + (col + 0.5) * cellSize,
      z: originZ + (row + 0.5) * cellSize,
    }),
    isFreeAt,
    segmentClear(a, b) {
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      const steps = Math.max(1, Math.ceil(length / SAMPLE));
      for (let i = 1; i <= steps; i += 1) {
        const t = i / steps;
        if (!isFreeAt(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false;
      }
      return true;
    },
  };
  return grid;
}
