import { createCapabilityRegistry, type CapabilityDefinition } from './capabilities';
import { validationFailed, validationOk } from './errors';

interface JumpConfig {
  jumpHeight: number;
}

const jump: CapabilityDefinition<JumpConfig> = {
  id: 'movement.jump',
  version: '1.0.0',
  description: 'Jumping',
  requires: ['movement.locomotion'],
  defaults: { jumpHeight: 1.2 },
  validate(input) {
    const merged = { ...this.defaults, ...(input as Partial<JumpConfig>) };
    return merged.jumpHeight >= 0.2 && merged.jumpHeight <= 2.5
      ? validationOk(merged)
      : validationFailed([{ path: 'jumpHeight', message: 'must be 0.2 to 2.5' }]);
  },
};
const locomotion: CapabilityDefinition<Record<string, never>> = {
  id: 'movement.locomotion',
  version: '1.0.0',
  description: 'Walking',
  defaults: {},
  validate: () => validationOk({}),
};

describe('capability registry', () => {
  it('orders dependencies first and adds required capabilities with defaults', () => {
    const registry = createCapabilityRegistry();
    registry.register(jump);
    registry.register(locomotion);
    const resolution = registry.resolve([{ id: 'movement.jump', config: { jumpHeight: 0.9 } }]);
    expect(resolution.ok).toBe(true);
    expect(resolution.order.map((r) => r.definition.id)).toEqual(['movement.locomotion', 'movement.jump']);
    expect(resolution.order[1]!.config).toEqual({ jumpHeight: 0.9 });
  });

  it('reports invalid config, unknown and duplicate capabilities with paths', () => {
    const registry = createCapabilityRegistry();
    registry.register(jump);
    registry.register(locomotion);
    const resolution = registry.resolve([
      { id: 'movement.jump', config: { jumpHeight: 9 } },
      { id: 'movement.jump' },
      { id: 'movement.fly' },
    ]);
    expect(resolution.ok).toBe(false);
    expect(resolution.issues.map((i) => i.path)).toEqual(
      expect.arrayContaining(['capabilities.movement.jump.jumpHeight', 'capabilities[1]', 'capabilities.movement.fly']),
    );
  });

  it('rejects cycles', () => {
    const registry = createCapabilityRegistry();
    registry.register({ ...locomotion, id: 'test.a', requires: ['test.b'] });
    registry.register({ ...locomotion, id: 'test.b', requires: ['test.a'] });
    const resolution = registry.resolve([{ id: 'test.a' }]);
    expect(resolution.ok).toBe(false);
    expect(resolution.issues.some((i) => i.message.includes('cycle'))).toBe(true);
  });

  it('validates ids, versions and duplicates at registration', () => {
    const registry = createCapabilityRegistry();
    expect(() => registry.register({ ...locomotion, id: 'nonamespace' })).toThrow();
    expect(() => registry.register({ ...locomotion, version: '1' })).toThrow();
    registry.register(locomotion);
    expect(() => registry.register(locomotion)).toThrow();
  });
});
