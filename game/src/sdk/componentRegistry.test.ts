import { describe, expect, it } from 'vitest';
import { isEngineError } from '../core/errors';
import type { EventMap } from '../core/eventBus';
import { createEngineRuntime } from '../core/runtime';
import { createComponentRegistry } from './componentRegistry';

describe('component registry', () => {
  it('creates entities from placements', () => {
    const registry = createComponentRegistry();
    registry.register('gameplay.chest', (runtime, placement) => runtime.world.create(placement.id));
    const runtime = createEngineRuntime<EventMap>({ id: 'r' });
    const handles = registry.createAll(runtime, [
      { id: 'a', type: 'gameplay.chest', areaId: 'x' },
      { id: 'b', type: 'gameplay.chest', areaId: 'x' },
    ]);
    expect(handles).toHaveLength(2);
    expect(runtime.world.bySemanticId('b')).toBe(handles[1]);
    expect(registry.list()).toEqual(['gameplay.chest']);
  });

  it('rejects duplicates, malformed ids and unknown types', () => {
    const registry = createComponentRegistry();
    registry.register('gameplay.chest', () => 1 as never);
    expect(() => registry.register('gameplay.chest', () => 1 as never)).toThrow(
      /already registered/,
    );
    try {
      registry.register('gameplay.chest', () => 1 as never);
    } catch (error) {
      expect(isEngineError(error, 'DUPLICATE_ID')).toBe(true);
    }
    expect(() => registry.register('Chest', () => 1 as never)).toThrow();
    const runtime = createEngineRuntime<EventMap>({ id: 'r' });
    expect(() => registry.create(runtime, { id: 'z', type: 'gameplay.nope', areaId: 'x' })).toThrow(
      /not registered/,
    );
  });
});
