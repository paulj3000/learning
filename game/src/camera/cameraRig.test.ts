import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { ColliderSpec, PhysicsProvider, RayHit } from '../contracts/physics';
import { createPlayerTransform, type PlayerTransform } from '../contracts/player';
import { MAX_LANDING_DIP } from './cameraHeightFollower';
import {
  applyCameraFrame,
  CameraRig,
  keepCameraOutOfColliders,
  physicsObstruction,
} from './cameraRig';
import { cameraPreferenceKey, type PreferenceStorage } from './cameraPreference';
import { AVATAR_HIDE_DISTANCE } from './playerCamera';

/** A minimal AABB provider for the tests: slab-method raycast over boxes. */
function fakePhysics(specs: ColliderSpec[]): PhysicsProvider {
  const list = [...specs];
  const rayBox = (o: Vector3, d: Vector3, spec: ColliderSpec): number | null => {
    let tMin = 0;
    let tMax = Infinity;
    for (const axis of ['x', 'y', 'z'] as const) {
      const lo = spec.min[axis];
      const hi = spec.max[axis];
      if (Math.abs(d[axis]) < 1e-9) {
        if (o[axis] < lo || o[axis] > hi) return null;
      } else {
        let t1 = (lo - o[axis]) / d[axis];
        let t2 = (hi - o[axis]) / d[axis];
        if (t1 > t2) [t1, t2] = [t2, t1];
        tMin = Math.max(tMin, t1);
        tMax = Math.min(tMax, t2);
        if (tMin > tMax) return null;
      }
    }
    return tMin;
  };
  return {
    id: 'test.aabb',
    addCollider: (spec) => void list.push(spec),
    updateCollider: () => undefined,
    removeCollider: () => false,
    hasCollider: (id) => list.some((s) => s.id === id),
    getCollider: (id) => list.find((s) => s.id === id),
    colliders: () => list,
    raycast(origin, direction, maxDistance, filter): RayHit | null {
      const o = new Vector3(origin.x, origin.y, origin.z);
      const d = new Vector3(direction.x, direction.y, direction.z);
      let best: RayHit | null = null;
      for (const spec of list) {
        if (spec.kind === 'TRIGGER' || (filter && !filter(spec))) continue;
        const t = rayBox(o, d, spec);
        if (t !== null && t <= maxDistance && (!best || t < best.distance)) {
          best = { colliderId: spec.id, distance: t, point: o.clone().addScaledVector(d, t) };
        }
      }
      return best;
    },
    overlaps: (min, max) =>
      list
        .filter(
          (s) =>
            s.min.x <= max.x &&
            s.max.x >= min.x &&
            s.min.y <= max.y &&
            s.max.y >= min.y &&
            s.min.z <= max.z &&
            s.max.z >= min.z,
        )
        .map((s) => s.id),
    onChange: () => () => undefined,
  };
}

function wall(
  id: string,
  min: [number, number, number],
  max: [number, number, number],
  extra: Partial<ColliderSpec> = {},
): ColliderSpec {
  return {
    id,
    kind: 'SOLID',
    min: { x: min[0], y: min[1], z: min[2] },
    max: { x: max[0], y: max[1], z: max[2] },
    ...extra,
  };
}

function transformAt(
  x: number,
  y: number,
  z: number,
  patch: Partial<PlayerTransform> = {},
): PlayerTransform {
  return { ...createPlayerTransform({ x, y, z }, 0), ...patch };
}

function memoryStorage(
  initial: Record<string, string> = {},
): PreferenceStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
}

function settle(rig: CameraRig, transform: PlayerTransform, frames = 120) {
  let frame = rig.update(1 / 60, transform, 1);
  for (let i = 0; i < frames; i += 1) frame = rig.update(1 / 60, transform, 1);
  return frame;
}

describe('camera rig mode and preference', () => {
  it('starts in third-person by default', () => {
    expect(new CameraRig().mode).toBe('third-person');
  });

  it('remembers the choice through the injected storage port and restores it', () => {
    const storage = memoryStorage();
    const rig = new CameraRig({ preference: { childId: 'c1', storage } });
    expect(rig.toggleMode()).toBe('first-person');
    expect(storage.data[cameraPreferenceKey('c1')]).toBe('first-person');
    const next = new CameraRig({ preference: { childId: 'c1', storage } });
    expect(next.mode).toBe('first-person');
  });

  it('works with no storage at all', () => {
    const rig = new CameraRig({ preference: { childId: 'c1', storage: null } });
    expect(rig.toggleMode()).toBe('first-person');
  });

  it('ignores a saved choice and refuses to switch where switching is not allowed', () => {
    const storage = memoryStorage({ [cameraPreferenceKey('c1')]: 'first-person' });
    const rig = new CameraRig({
      config: { allowModeSwitch: false },
      preference: { childId: 'c1', storage },
    });
    expect(rig.mode).toBe('third-person');
    expect(rig.setMode('first-person')).toBe(false);
    expect(rig.mode).toBe('third-person');
  });

  it('puts the first-person eye at eye height and hides the avatar', () => {
    const rig = new CameraRig({ config: { defaultMode: 'first-person' } });
    const frame = settle(rig, transformAt(2, 0, 3));
    expect(frame.mode).toBe('first-person');
    expect(frame.position.x).toBeCloseTo(2);
    expect(frame.position.y).toBeCloseTo(1.6);
    expect(frame.avatarVisible).toBe(false);
  });
});

describe('camera rig reads only the canonical transform', () => {
  it('interpolates between the previous and current collided positions', () => {
    const rig = new CameraRig({ config: { defaultMode: 'first-person' } });
    const base = createPlayerTransform({ x: 0, y: 0, z: 0 });
    const moving: PlayerTransform = {
      ...base,
      previousPosition: { x: 0, y: 0, z: 0 },
      position: { x: 2, y: 0, z: 0 },
    };
    expect(rig.update(1 / 60, moving, 0.5).position.x).toBeCloseTo(1);
    rig.reset();
    expect(rig.update(1 / 60, moving, 1).position.x).toBeCloseTo(2);
  });

  it('follows the collided position when blocked: it never drifts past the transform', () => {
    const rig = new CameraRig({ config: { defaultMode: 'first-person' } });
    const blocked: PlayerTransform = { ...transformAt(5, 0, 5), velocity: { x: 0, y: 0, z: 0 } };
    const a = rig.update(1 / 60, blocked, 1).position.clone();
    const b = settle(rig, blocked, 30).position;
    expect(b.x).toBeCloseTo(a.x);
    expect(b.z).toBeCloseTo(a.z);
  });

  it('reads the transform yaw in the controller convention (0 looks down +Z) by default, and converts a Three.js yaw on request', () => {
    const threejs = new CameraRig({
      config: { defaultMode: 'first-person' },
      yawConvention: 'threejs',
    });
    const controller = new CameraRig({ config: { defaultMode: 'first-person' } });
    const t = transformAt(0, 0, 0, { yaw: 0 });
    const camera = {
      position: new Vector3(),
      rotation: {
        order: 'XYZ',
        y: 0,
        x: 0,
        set(x: number, y: number) {
          this.x = x;
          this.y = y;
        },
      },
    };
    // A Three.js camera at rotation.y = 0 looks down -Z; at PI it looks down +Z.
    applyCameraFrame(threejs.update(1 / 60, t, 1), camera);
    expect(Math.cos(camera.rotation.y)).toBeCloseTo(1);
    applyCameraFrame(controller.update(1 / 60, t, 1), camera);
    expect(Math.cos(camera.rotation.y)).toBeCloseTo(-1);
    applyCameraFrame(controller.update(1 / 60, { ...t, yaw: Math.PI }, 1), camera);
    expect(Math.cos(camera.rotation.y)).toBeCloseTo(1);
    expect(camera.rotation.order).toBe('YXZ');
  });
});

describe('camera collision through the physics provider', () => {
  const behind = wall('back', [-5, 0, -2], [5, 3, -1.6]);

  it('pulls the boom in front of a wall behind the child and never inside it', () => {
    const physics = fakePhysics([behind]);
    // Controller yaw 0 looks +Z, so the boom sits at -Z, into the wall.
    const rig = new CameraRig({ physics, yawConvention: 'controller', config: { distance: 4 } });
    // At once, on the very first frame: never a frame looking through the wall.
    const frame = rig.update(1 / 60, transformAt(0, 0, 0), 1);
    expect(frame.position.z).toBeGreaterThan(-1.6);
    expect(
      physics.overlaps(
        { x: frame.position.x, y: frame.position.y, z: frame.position.z },
        { x: frame.position.x, y: frame.position.y, z: frame.position.z },
      ),
    ).toEqual([]);
  });

  it('ends outside every collider across a sweep of positions and looks', () => {
    const physics = fakePhysics([
      behind,
      wall('left', [-2, 0, -5], [-1.5, 3, 5]),
      wall('crate', [1, 0, 1], [2, 1, 2], { kind: 'JUMPABLE' }),
    ]);
    const rig = new CameraRig({ physics, yawConvention: 'controller' });
    for (let yaw = 0; yaw < Math.PI * 2; yaw += 0.7) {
      for (const pitch of [-1, -0.25, 0.3]) {
        for (const x of [-1, 0, 1.4]) {
          rig.reset();
          const frame = settle(rig, transformAt(x, 0, 0.2, { yaw, pitch }), 3);
          const p = frame.position;
          const inside = physics
            .colliders()
            .filter(
              (s) =>
                p.x >= s.min.x &&
                p.x <= s.max.x &&
                p.y >= s.min.y &&
                p.y <= s.max.y &&
                p.z >= s.min.z &&
                p.z <= s.max.z,
            );
          expect(inside.map((s) => s.id)).toEqual([]);
        }
      }
    }
  });

  it('skips colliders that cameraIgnores', () => {
    const boundary = wall('edge', [-5, 0, -2], [5, 3, -1.6], { cameraIgnores: true });
    const physics = fakePhysics([boundary]);
    const rig = new CameraRig({ physics, yawConvention: 'controller', config: { distance: 4 } });
    const frame = settle(rig, transformAt(0, 0, 0));
    expect(frame.distance).toBeCloseTo(4, 1);
    expect(frame.position.z).toBeLessThan(-1.6);
  });

  it('does not collide when collisionEnabled is false', () => {
    const physics = fakePhysics([behind]);
    const rig = new CameraRig({
      physics,
      yawConvention: 'controller',
      config: { collisionEnabled: false },
    });
    expect(settle(rig, transformAt(0, 0, 0)).distance).toBeCloseTo(4, 1);
  });

  it('ignores a box the follow point is already inside', () => {
    const crate = wall('crate', [-1, 0, -1], [1, 2, 1], { kind: 'JUMPABLE' });
    const probe = physicsObstruction(fakePhysics([crate]));
    expect(probe(new Vector3(0, 1, 0), new Vector3(0, 0, -1), 4)).toBeNull();
  });

  it('lifts the boom over a tall wall behind the child (the existing behaviour is kept)', () => {
    const physics = fakePhysics([wall('tall', [-5, 0, -2.2], [5, 3, -1.9])]);
    const rig = new CameraRig({ physics, yawConvention: 'controller' });
    const frame = settle(rig, transformAt(0, 0, 0, { pitch: -0.25 }), 240);
    expect(frame.pitch).toBeLessThan(-0.25);
    expect(frame.position.y).toBeGreaterThan(1.5);
  });

  it('hides the avatar when the camera is pressed against the child', () => {
    const physics = fakePhysics([wall('close', [-5, 0, -0.8], [5, 3, -0.5])]);
    const rig = new CameraRig({ physics, yawConvention: 'controller' });
    const frame = rig.update(1 / 60, transformAt(0, 0, 0, { pitch: 0 }), 1);
    expect(frame.distance).toBeLessThan(AVATAR_HIDE_DISTANCE);
    expect(frame.avatarVisible).toBe(false);
    expect(frame.position.z).toBeGreaterThan(-0.5);
  });

  it('keepCameraOutOfColliders pulls a position inside a thin collider back to the anchor side', () => {
    const physics = fakePhysics([wall('thin', [-1, 0, 2], [1, 3, 2.05])]);
    const anchor = { x: 0, y: 1.5, z: 0 };
    const position = new Vector3(0, 1.5, 2.02);
    keepCameraOutOfColliders(physics, anchor, position);
    expect(position.z).toBeLessThan(2 - 0.1);
    expect(position.z).toBeGreaterThanOrEqual(0);
  });
});

describe('reduced motion and landing', () => {
  const air = (vy: number) =>
    transformAt(0, 0, 0, { grounded: false, velocity: { x: 0, y: vy, z: 0 }, state: 'FALLING' });
  const eyeY = (reduced: boolean) => {
    const rig = new CameraRig({ config: { defaultMode: 'first-person' }, reducedMotion: reduced });
    rig.update(1 / 60, air(-10), 1);
    rig.update(1 / 60, air(-12), 1);
    // The landing frame: grounded again.
    return rig.update(1 / 60, transformAt(0, 0, 0), 1).position.y;
  };

  it('dips a little on landing, at most 7 cm', () => {
    const dip = 1.6 - eyeY(false);
    expect(dip).toBeGreaterThan(0.02);
    expect(dip).toBeLessThanOrEqual(MAX_LANDING_DIP + 1e-9);
  });

  it('does not dip at all under reduced motion', () => {
    expect(eyeY(true)).toBeCloseTo(1.6, 6);
  });

  it('does not widen the field of view when sprinting under reduced motion', () => {
    const sprint = transformAt(0, 0, 0, { state: 'SPRINT', gait: 'sprint' });
    const normal = new CameraRig();
    const calm = new CameraRig({ reducedMotion: true });
    expect(settle(normal, sprint).fovOffset).toBeGreaterThan(1);
    expect(settle(calm, sprint).fovOffset).toBe(0);
  });
});
