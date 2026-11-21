import { isEngineError } from '../core/errors';
import type { ColliderSpec } from '../contracts/physics';
import { FirstPersonController } from '../movement/firstPersonController';
import { createAabbPhysicsProvider } from './aabbProvider';

const box = (
  id: string,
  kind: ColliderSpec['kind'],
  min: [number, number, number],
  max: [number, number, number],
  extra: Partial<ColliderSpec> = {},
): ColliderSpec => ({
  id,
  kind,
  min: { x: min[0], y: min[1], z: min[2] },
  max: { x: max[0], y: max[1], z: max[2] },
  ...extra,
});

describe('AABB physics provider', () => {
  it('keeps live blocking and jumpable arrays and leaves triggers out of them', () => {
    const p = createAabbPhysicsProvider();
    p.addCollider(box('wall', 'SOLID', [1, 0, -1], [2, 3, 1]));
    p.addCollider(box('crate', 'JUMPABLE', [3, 0, -1], [4, 1, 1]));
    p.addCollider(box('zone', 'TRIGGER', [5, 0, -1], [6, 1, 1]));
    expect(p.boxes).toHaveLength(2);
    expect(p.jumpableBoxes.size).toBe(1);
    expect(p.colliders().map((c) => c.id)).toEqual(['wall', 'crate', 'zone']);
    expect(p.idOfBox(p.boxes[1]!)).toBe('crate');
    expect(p.removeCollider('crate')).toBe(true);
    expect(p.removeCollider('crate')).toBe(false);
    expect(p.boxes).toHaveLength(1);
    expect(p.jumpableBoxes.size).toBe(0);
  });

  it('rejects a jumpable gate, duplicates, unknown updates and bad bounds', () => {
    const p = createAabbPhysicsProvider();
    expect(() =>
      p.addCollider(box('g', 'JUMPABLE', [0, 0, 0], [1, 1, 1], { gate: true })),
    ).toThrowError(expect.objectContaining({ code: 'VALIDATION_FAILED' }));
    p.addCollider(box('g', 'SOLID', [0, 0, 0], [1, 1, 1], { gate: true }));
    expect(() => p.addCollider(box('g', 'SOLID', [0, 0, 0], [1, 1, 1]))).toThrowError(
      expect.objectContaining({ code: 'DUPLICATE_ID' }),
    );
    expect(() => p.updateCollider('nope', { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 })).toThrowError(
      expect.objectContaining({ code: 'UNKNOWN_ID' }),
    );
    try {
      p.addCollider(box('bad', 'SOLID', [2, 0, 0], [1, 1, 1]));
    } catch (error) {
      expect(isEngineError(error, 'VALIDATION_FAILED')).toBe(true);
    }
    expect(p.hasCollider('bad')).toBe(false);
  });

  it('updates a box in place so the controller sees a moving platform', () => {
    const p = createAabbPhysicsProvider();
    p.addCollider(box('wall', 'SOLID', [2, 0, -1], [3, 2, 1]));
    const live = p.boxes[0]!;
    const calls: number[] = [];
    const off = p.onChange(() => calls.push(1));
    p.updateCollider('wall', { x: 8, y: 0, z: -1 }, { x: 9, y: 2, z: 1 });
    expect(p.boxes[0]).toBe(live);
    expect(live.min.x).toBe(8);
    expect(p.getCollider('wall')?.min.x).toBe(8);
    expect(calls).toHaveLength(1);
    off();
    p.removeCollider('wall');
    expect(calls).toHaveLength(1);
  });

  it('blocks the controller on a solid collider and lets it walk where a trigger is', () => {
    const p = createAabbPhysicsProvider();
    p.addCollider(box('wall', 'SOLID', [2, 0, -2], [3, 3, 2]));
    p.addCollider(box('zone', 'TRIGGER', [-3, 0, -2], [-1, 3, 2]));
    const c = new FirstPersonController({ colliders: p.boxes, jumpableColliders: p.jumpableBoxes });
    c.yaw = Math.PI / 2; // forward is +x
    for (let i = 0; i < 120; i += 1) c.update(1 / 60, { forward: 1, strafe: 0 });
    expect(c.position.x).toBeLessThan(2);
    c.yaw = -Math.PI / 2;
    for (let i = 0; i < 240; i += 1) c.update(1 / 60, { forward: 1, strafe: 0 });
    expect(c.position.x).toBeLessThan(-3);
  });

  it('raycasts with the slab method, skipping triggers and filtered colliders', () => {
    const p = createAabbPhysicsProvider();
    p.addCollider(box('near', 'SOLID', [2, 0, -1], [3, 2, 1]));
    p.addCollider(box('far', 'SOLID', [6, 0, -1], [7, 2, 1], { cameraIgnores: true }));
    p.addCollider(box('zone', 'TRIGGER', [0.5, 0, -1], [1.5, 2, 1]));
    const o = { x: 0, y: 1, z: 0 };
    const hit = p.raycast(o, { x: 2, y: 0, z: 0 }, 20);
    expect(hit).toMatchObject({ colliderId: 'near' });
    expect(hit!.distance).toBeCloseTo(2);
    expect(hit!.point.x).toBeCloseTo(2);
    expect(
      p.raycast(o, { x: 1, y: 0, z: 0 }, 20, (s) => !s.cameraIgnores && s.id !== 'near'),
    ).toBeNull();
    expect(p.raycast(o, { x: 1, y: 0, z: 0 }, 1.5)).toBeNull();
    expect(p.raycast(o, { x: 0, y: 0, z: 0 }, 5)).toBeNull();
    expect(p.raycast(o, { x: 0, y: 0, z: 1 }, 5)).toBeNull();
    expect(p.raycast({ x: 2.5, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }, 5)).toMatchObject({
      colliderId: 'near',
      distance: 0,
    });
  });

  it('reports overlaps of every kind, not mere contact', () => {
    const p = createAabbPhysicsProvider();
    p.addCollider(box('a', 'SOLID', [0, 0, 0], [1, 1, 1]));
    p.addCollider(box('z', 'TRIGGER', [0.5, 0, 0.5], [2, 1, 2]));
    expect(p.overlaps({ x: 0.9, y: 0, z: 0.9 }, { x: 1.2, y: 1, z: 1.2 }).sort()).toEqual([
      'a',
      'z',
    ]);
    expect(p.overlaps({ x: 1, y: 0, z: 0 }, { x: 1.4, y: 1, z: 0.4 })).toEqual([]);
  });
});
