/**
 * The composed `EnvironmentQuery` (contracts/physics.ts): surfaces, forces, water and ladders
 * from the authored volumes, with deterministic precedence.
 *
 * Precedence (stable, independent of declaration order):
 * - **Surface**: highest `priority`; ties go to the smaller volume (the more specific one),
 *   then the lower id. No volume: `DEFAULT_SURFACE`.
 * - **Forces**: every active volume containing the point contributes one `ExternalForce`,
 *   ordered by priority (high first) then id. Each is clamped by its own `maxAcceleration`
 *   after ramp-in and the reduced-motion factor (halved). A force whose push would reach a
 *   hazard within its `runOut` is **omitted** rather than applied (never push into a hazard).
 * - **Medium and water surface**: the highest water surface containing the point wins.
 * - **Climbable**: the lowest id among ladders containing the point.
 *
 * `tick(dt, position)` advances per-volume ramp-in using the child's position; queries
 * themselves are pure reads.
 */

import { DEFAULT_SURFACE, type ClimbableInfo, type EnvironmentQuery, type ExternalForce, type Medium } from '../contracts/physics';
import type { Vec3Like } from '../contracts/player';
import { segmentHitsRect, type Rect } from '../components/geometry';
import { FORCE_LIMITS, type BoxSpec, type EnvironmentVolumesConfig, type ForceVolumeSpec, type SurfaceVolumeSpec } from './volumes';

export interface EnvironmentQueryOptions {
  isSignalOn?: (signalId: string) => boolean;
  isReducedMotion?: () => boolean;
  /** Live hazard footprints (the hazards component), in addition to `config.hazardRects`. */
  hazardRects?: () => readonly Rect[];
}

export interface ComposedEnvironment extends EnvironmentQuery {
  /** Advances force ramp-in. Pass the child's position, or undefined when there is none. */
  tick(dt: number, position: Readonly<Vec3Like> | undefined): void;
  /** Current ramp (0 to 1) of a force volume, for tests and presentation. */
  rampOf(forceId: string): number;
}

const inside = (box: BoxSpec, x: number, y: number, z: number) =>
  x >= box.min.x && x <= box.max.x && y >= box.min.y && y <= box.max.y && z >= box.min.z && z <= box.max.z;

const volumeOf = (box: BoxSpec) => (box.max.x - box.min.x) * (box.max.y - box.min.y) * (box.max.z - box.min.z);

/** Feet may be a little above a thin surface slab and still stand on it. */
const SURFACE_REACH_ABOVE = 0.3;
const SURFACE_REACH_BELOW = 0.1;

export function compareSurfaces(a: SurfaceVolumeSpec, b: SurfaceVolumeSpec): number {
  return b.priority - a.priority || volumeOf(a.box) - volumeOf(b.box) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function createEnvironmentQuery(config: EnvironmentVolumesConfig, options: EnvironmentQueryOptions = {}): ComposedEnvironment {
  const surfaces = [...config.surfaces].sort(compareSurfaces);
  const forces = [...config.forces].sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const ladders = [...config.ladders].sort((a, b) => (a.id < b.id ? -1 : 1));
  const ramps = new Map<string, number>(forces.map((f) => [f.id, f.rampInSeconds <= 0 ? 1 : 0]));
  const signalOn = options.isSignalOn ?? (() => true);
  const reduced = options.isReducedMotion ?? (() => false);

  const hazards = (): readonly Rect[] => (options.hazardRects ? [...config.hazardRects, ...options.hazardRects()] : config.hazardRects);

  const forceActive = (force: ForceVolumeSpec) =>
    (force.signalId === undefined || signalOn(force.signalId)) && !(force.inactiveWhenSignalId !== undefined && options.isSignalOn !== undefined && options.isSignalOn(force.inactiveWhenSignalId));

  const pushesIntoHazard = (force: ForceVolumeSpec, x: number, z: number): boolean => {
    if (!force.neverPushIntoHazard) {
      return false;
    }
    return hazards().some((rect) => segmentHitsRect(x, z, force.direction.x, force.direction.z, force.runOut, rect));
  };

  return {
    surfaceAt(x, y, z) {
      for (const volume of surfaces) {
        const { box } = volume;
        if (x >= box.min.x && x <= box.max.x && z >= box.min.z && z <= box.max.z && y >= box.min.y - SURFACE_REACH_BELOW && y <= box.max.y + SURFACE_REACH_ABOVE) {
          return volume.profile;
        }
      }
      return DEFAULT_SURFACE;
    },
    forcesAt(x, y, z) {
      const out: ExternalForce[] = [];
      for (const force of forces) {
        if (!inside(force.box, x, y, z) || !forceActive(force) || pushesIntoHazard(force, x, z)) {
          continue;
        }
        const length = Math.hypot(force.direction.x, force.direction.y, force.direction.z);
        const scale = reduced() ? FORCE_LIMITS.reducedMotionScale : 1;
        const magnitude = Math.min(force.strength * (ramps.get(force.id) ?? 1) * scale, force.maxAcceleration);
        out.push({
          id: force.id,
          kind: force.kind,
          acceleration: { x: (force.direction.x / length) * magnitude, y: (force.direction.y / length) * magnitude, z: (force.direction.z / length) * magnitude },
          affectsGrounded: force.affectsGrounded,
        });
      }
      return out;
    },
    mediumAt(x, y, z): Medium {
      return config.waters.some((w) => x >= w.box.min.x && x <= w.box.max.x && z >= w.box.min.z && z <= w.box.max.z && y >= w.box.min.y && y < w.box.max.y) ? 'WATER' : 'AIR';
    },
    waterSurfaceAt(x, z) {
      let best: number | null = null;
      for (const w of config.waters) {
        if (x >= w.box.min.x && x <= w.box.max.x && z >= w.box.min.z && z <= w.box.max.z && (best === null || w.box.max.y > best)) {
          best = w.box.max.y;
        }
      }
      return best;
    },
    climbableAt(x, y, z): ClimbableInfo | null {
      for (const ladder of ladders) {
        if (Math.abs(x - ladder.x) <= ladder.halfWidth && Math.abs(z - ladder.z) <= ladder.depth && y >= ladder.bottomY - 0.2 && y <= ladder.topY) {
          return { id: ladder.id, bottomY: ladder.bottomY, topY: ladder.topY, facingYaw: ladder.facingYaw, exitTop: ladder.exitTop };
        }
      }
      return null;
    },
    tick(dt, position) {
      for (const force of forces) {
        const current = ramps.get(force.id) ?? 0;
        const here = position !== undefined && inside(force.box, position.x, position.y, position.z) && forceActive(force);
        if (!here) {
          ramps.set(force.id, 0);
        } else if (force.rampInSeconds <= 0) {
          ramps.set(force.id, 1);
        } else {
          ramps.set(force.id, Math.min(1, current + dt / force.rampInSeconds));
        }
      }
    },
    rampOf: (id) => ramps.get(id) ?? 0,
  };
}

