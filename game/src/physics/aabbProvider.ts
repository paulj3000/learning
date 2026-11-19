/**
 * The default `PhysicsProvider`: the shared controller's axis-aligned box model (GE-020).
 *
 * It keeps the live `Box3[]` and `jumpable` set that `FirstPersonController` reads (pass
 * `provider.boxes` and `provider.jumpableBoxes` as `colliders` and `jumpableColliders`).
 * Boxes are mutated in place on `updateCollider`, so a moving platform or opening door
 * changes what the controller sees without rebuilding anything. TRIGGER colliders are kept
 * for overlap queries only: they never enter the blocking array and never block a ray.
 * No physics dependency (jumping standard: none without an ADR).
 */

import { Box3, Vector3 } from 'three';
import { EngineError } from '../core/errors';
import type { ColliderSpec, PhysicsProvider, RayHit } from '../contracts/physics';
import type { Vec3Like } from '../contracts/player';

export interface AabbPhysicsProvider extends PhysicsProvider {
  /** Blocking boxes (SOLID and JUMPABLE), read live by the controller. */
  readonly boxes: Box3[];
  /** The JUMPABLE subset of `boxes`, read live by the controller. */
  readonly jumpableBoxes: Set<Box3>;
  /** The collider id owning a box from `boxes` (to name what the child stands on). */
  idOfBox(box: Box3): string | null;
}

export const AABB_PROVIDER_ID = 'lai.aabb';

interface Entry {
  spec: ColliderSpec;
  box: Box3;
}

function finiteVec(v: Readonly<Vec3Like>): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

function assertBounds(id: string, min: Readonly<Vec3Like>, max: Readonly<Vec3Like>): void {
  if (!finiteVec(min) || !finiteVec(max) || min.x > max.x || min.y > max.y || min.z > max.z) {
    throw new EngineError('VALIDATION_FAILED', `Collider "${id}" needs finite bounds with min <= max`, { id });
  }
}

export function createAabbPhysicsProvider(): AabbPhysicsProvider {
  const entries = new Map<string, Entry>();
  const boxes: Box3[] = [];
  const jumpableBoxes = new Set<Box3>();
  const owners = new Map<Box3, string>();
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of [...listeners]) {
      listener();
    }
  };

  const provider: AabbPhysicsProvider = {
    id: AABB_PROVIDER_ID,
    boxes,
    jumpableBoxes,
    idOfBox: (box) => owners.get(box) ?? null,
    addCollider(spec) {
      if (spec.gate && spec.kind === 'JUMPABLE') {
        throw new EngineError('VALIDATION_FAILED', `Gate collider "${spec.id}" cannot be jumpable (gates are never jumpable)`, {
          id: spec.id,
        });
      }
      if (entries.has(spec.id)) {
        throw new EngineError('DUPLICATE_ID', `Collider "${spec.id}" already exists`, { id: spec.id });
      }
      assertBounds(spec.id, spec.min, spec.max);
      const box = new Box3(new Vector3(spec.min.x, spec.min.y, spec.min.z), new Vector3(spec.max.x, spec.max.y, spec.max.z));
      entries.set(spec.id, { spec: { ...spec, min: { ...spec.min }, max: { ...spec.max } }, box });
      if (spec.kind !== 'TRIGGER') {
        boxes.push(box);
        owners.set(box, spec.id);
        if (spec.kind === 'JUMPABLE') {
          jumpableBoxes.add(box);
        }
      }
      notify();
    },
    updateCollider(id, min, max) {
      const entry = entries.get(id);
      if (!entry) {
        throw new EngineError('UNKNOWN_ID', `Collider "${id}" does not exist`, { id });
      }
      assertBounds(id, min, max);
      entry.box.min.set(min.x, min.y, min.z);
      entry.box.max.set(max.x, max.y, max.z);
      entry.spec = { ...entry.spec, min: { ...min }, max: { ...max } };
      notify();
    },
    removeCollider(id) {
      const entry = entries.get(id);
      if (!entry) {
        return false;
      }
      entries.delete(id);
      const index = boxes.indexOf(entry.box);
      if (index >= 0) {
        boxes.splice(index, 1);
      }
      jumpableBoxes.delete(entry.box);
      owners.delete(entry.box);
      notify();
      return true;
    },
    hasCollider: (id) => entries.has(id),
    getCollider: (id) => entries.get(id)?.spec,
    colliders: () => [...entries.values()].map((e) => e.spec),
    raycast(origin, direction, maxDistance, filter) {
      const length = Math.hypot(direction.x, direction.y, direction.z);
      if (!(length > 0) || !(maxDistance > 0) || !finiteVec(origin)) {
        return null;
      }
      const d = { x: direction.x / length, y: direction.y / length, z: direction.z / length };
      let best: RayHit | null = null;
      for (const { spec, box } of entries.values()) {
        if (spec.kind === 'TRIGGER' || (filter && !filter(spec))) {
          continue;
        }
        const t = slab(origin, d, box, maxDistance);
        if (t !== null && (best === null || t < best.distance)) {
          best = {
            colliderId: spec.id,
            distance: t,
            point: { x: origin.x + d.x * t, y: origin.y + d.y * t, z: origin.z + d.z * t },
          };
        }
      }
      return best;
    },
    overlaps(min, max) {
      const found: string[] = [];
      for (const { spec, box } of entries.values()) {
        if (box.min.x < max.x && box.max.x > min.x && box.min.y < max.y && box.max.y > min.y && box.min.z < max.z && box.max.z > min.z) {
          found.push(spec.id);
        }
      }
      return found;
    },
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return provider;
}

/** Slab method: distance along a unit ray to a box within `maxDistance`, or null. */
function slab(o: Readonly<Vec3Like>, d: Readonly<Vec3Like>, box: Box3, maxDistance: number): number | null {
  let near = 0;
  let far = maxDistance;
  const axes: [number, number, number, number][] = [
    [o.x, d.x, box.min.x, box.max.x],
    [o.y, d.y, box.min.y, box.max.y],
    [o.z, d.z, box.min.z, box.max.z],
  ];
  for (const [origin, dir, lo, hi] of axes) {
    if (Math.abs(dir) < 1e-12) {
      if (origin < lo || origin > hi) {
        return null;
      }
      continue;
    }
    let t1 = (lo - origin) / dir;
    let t2 = (hi - origin) / dir;
    if (t1 > t2) {
      [t1, t2] = [t2, t1];
    }
    near = Math.max(near, t1);
    far = Math.min(far, t2);
    if (near > far) {
      return null;
    }
  }
  return near;
}
