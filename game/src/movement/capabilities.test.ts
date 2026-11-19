import { createCapabilityRegistry } from '../core/capabilities';
import { movementCapabilities, registerMovementCapabilities } from './capabilities';

function registry() {
  const r = createCapabilityRegistry();
  registerMovementCapabilities(r);
  return r;
}

describe('movement capabilities', () => {
  it('registers all six (checkpoints are gameplay.checkpoints, the one checkpoint system) with valid ids and resolves defaults', () => {
    const r = registry();
    expect(r.list().map((c) => c.id)).toEqual([
      'movement.locomotion',
      'movement.jump',
      'movement.surfaces',
      'movement.externalForces',
      'movement.swimming',
      'movement.climbing',
    ]);
    const resolution = r.resolve(movementCapabilities.map((c) => ({ id: c.id })));
    expect(resolution.ok).toBe(true);
  });

  it('jump pulls in locomotion and accepts enabled:false', () => {
    const r = registry();
    const resolution = r.resolve([{ id: 'movement.jump', config: { enabled: false } }]);
    expect(resolution.ok).toBe(true);
    expect(resolution.order.map((o) => o.definition.id)).toEqual(['movement.locomotion', 'movement.jump']);
    expect(resolution.order[1]!.config).toMatchObject({ enabled: false, allowDoubleJump: false });
  });

  it('applies the jumping standard limits and reports unknown keys', () => {
    const r = registry();
    const bad = r.resolve([{ id: 'movement.jump', config: { jumpHeight: 9, jumpHieght: 1, enabled: 'yes' } }]);
    expect(bad.ok).toBe(false);
    const paths = bad.issues.map((i) => i.path);
    expect(paths).toContain('capabilities.movement.jump.jumpHeight');
    expect(paths).toContain('capabilities.movement.jump.jumpHieght');
    expect(paths).toContain('capabilities.movement.jump.enabled');
    const loco = r.resolve([{ id: 'movement.locomotion', config: { walkSpeed: 99, fly: true } }]);
    expect(loco.issues.map((i) => i.path)).toEqual(
      expect.arrayContaining(['capabilities.movement.locomotion.walkSpeed', 'capabilities.movement.locomotion.fly']),
    );
  });

  it('validates surfaces, forces, swimming and climbing', () => {
    const r = registry();
    const good = r.resolve([
      { id: 'movement.surfaces', config: { profiles: [{ id: 'ice', friction: 0.1, speedMultiplier: 1 }], maxWalkableSlope: 0.8 } },
      { id: 'movement.externalForces', config: { reducedMotionScale: 0.25 } },
      { id: 'movement.swimming', config: { enabled: false } },
      { id: 'movement.climbing' },
    ]);
    expect(good.ok).toBe(true);
    const bad = r.resolve([
      { id: 'movement.surfaces', config: { profiles: [{ id: 'ice', friction: 0 }, { id: 'ice' }, { friction: 'x' }], maxWalkableSlope: -1, extra: 1 } },
      { id: 'movement.externalForces', config: { reducedMotionScale: 3 } },
      { id: 'movement.swimming', config: { enabled: 1 } },
    ]);
    expect(bad.ok).toBe(false);
    const paths = bad.issues.map((i) => i.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        'capabilities.movement.surfaces.profiles[0].friction',
        'capabilities.movement.surfaces.profiles[1].id',
        'capabilities.movement.surfaces.maxWalkableSlope',
        'capabilities.movement.surfaces.extra',
        'capabilities.movement.externalForces.reducedMotionScale',
        'capabilities.movement.swimming.enabled',
      ]),
    );
  });

  it('never throws on garbage input', () => {
    for (const definition of movementCapabilities) {
      for (const garbage of [null, 5, 'x', [], [1], { a: 1 }, { profiles: 7 }, { enabled: {} }]) {
        expect(() => definition.validate(garbage)).not.toThrow();
      }
    }
  });
});
