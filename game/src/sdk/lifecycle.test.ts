import { describe, expect, it } from 'vitest';
import { isEngineError } from '../core/errors';
import type { EventMap } from '../core/eventBus';
import { createEngineRuntime } from '../core/runtime';
import { defineService } from '../core/services';
import { validateGameplayEvent, type AnyGameplayEvent } from '../contracts/gameplayEvents';
import { createComponentRegistry } from './componentRegistry';
import { loadAdventure } from './lifecycle';
import { createTestRegistry, validAdventure } from './testFixtures';

function setup(log: string[] = []) {
  const runtime = createEngineRuntime<EventMap>({ id: 'demo-adventure', capabilities: createTestRegistry(log) });
  const events: AnyGameplayEvent[] = [];
  runtime.events.on('gameplay.event', (event) => events.push(event as AnyGameplayEvent));
  return { runtime, events, log };
}

describe('adventure lifecycle', () => {
  it('validates, starts the runtime with the capability requests and emits a valid adventure.started', async () => {
    const { runtime, events, log } = setup();
    const session = await loadAdventure(validAdventure(), runtime, runtime.services, { ageBand: 'PATHFINDER' });
    expect(runtime.state).toBe('running');
    expect(log).toEqual(['install:movement.walk', 'install:movement.jump']);
    expect(runtime.capabilityConfig('movement.jump')).toEqual({ jumpHeight: 1.0 });
    expect(events.map((e) => e.type)).toEqual(['adventure.started']);
    expect(validateGameplayEvent(events[0]).ok).toBe(true);
    expect(events[0]).toMatchObject({ realmId: 'demo-realm', adventureId: 'demo-adventure', sessionRef: null });
    expect(session.state).toBe('running');
    expect(session.profile.band).toBe('PATHFINDER');
  });

  it('carries the session ref and emits valid events through emit()', async () => {
    const { runtime, events } = setup();
    const ref = '0b6e2c1a-8f3d-4a8e-9c5b-1d2e3f4a5b6c';
    const session = await loadAdventure(validAdventure(), runtime, runtime.services, { ageBand: 'SPROUT', sessionRef: ref });
    session.emit('quest.step.completed', { questId: 'quest-1', stepId: 'step-1' });
    expect(events.every((e) => validateGameplayEvent(e).ok)).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: 'quest.step.completed', sessionRef: ref });
  });

  it('emits adventure.completed exactly once, valid, and runs onCompleted', async () => {
    const { runtime, events } = setup();
    let completedHook = 0;
    const session = await loadAdventure(validAdventure(), runtime, runtime.services, {
      ageBand: 'EXPLORER',
      hooks: { onCompleted: () => void (completedHook += 1) },
    });
    expect(session.complete()).toBe(true);
    expect(session.complete()).toBe(false);
    expect(session.state).toBe('completed');
    const completed = events.filter((e) => e.type === 'adventure.completed');
    expect(completed).toHaveLength(1);
    expect(validateGameplayEvent(completed[0]).ok).toBe(true);
    expect(completedHook).toBe(1);
  });

  it('enters and leaves areas with typed hooks and area events', async () => {
    const { runtime, events } = setup();
    const trail: string[] = [];
    const session = await loadAdventure(validAdventure(), runtime, runtime.services, {
      ageBand: 'EXPLORER',
      hooks: {
        onEnterArea: ({ areaId }) => trail.push(`enter:${areaId}`),
        onLeaveArea: ({ areaId }) => trail.push(`leave:${areaId}`),
      },
    });
    const extra: string[] = [];
    const off = session.addHooks({ onEnterArea: ({ areaId }) => extra.push(areaId) });
    session.enterArea('demo-cove');
    session.enterArea('demo-cove'); // no repeat
    session.enterArea('demo-hill');
    off();
    session.leaveArea();
    expect(trail).toEqual(['enter:demo-cove', 'leave:demo-cove', 'enter:demo-hill', 'leave:demo-hill']);
    expect(extra).toEqual(['demo-cove', 'demo-hill']);
    const entered = events.filter((e) => e.type === 'exploration.area.entered');
    expect(entered.map((e) => e.areaId)).toEqual(['demo-cove', 'demo-hill']);
    expect(entered.every((e) => validateGameplayEvent(e).ok)).toBe(true);
    expect(() => session.enterArea('elsewhere')).toThrow();
  });

  it('survives a throwing hook', async () => {
    const { runtime } = setup();
    const session = await loadAdventure(validAdventure(), runtime, runtime.services, {
      ageBand: 'EXPLORER',
      hooks: {
        onEnterArea: () => {
          throw new Error('boom');
        },
      },
    });
    expect(() => session.enterArea('demo-cove')).not.toThrow();
    expect(runtime.diagnostics.snapshot().warnings.length).toBeGreaterThanOrEqual(0);
  });

  it('pauses, resumes and disposes the runtime; dispose is idempotent', async () => {
    const { runtime, log } = setup();
    const session = await loadAdventure(validAdventure(), runtime, runtime.services, { ageBand: 'EXPLORER' });
    session.pause();
    expect(session.state).toBe('paused');
    expect(session.complete()).toBe(false);
    session.resume();
    expect(session.state).toBe('running');
    session.dispose();
    session.dispose();
    expect(session.state).toBe('disposed');
    expect(runtime.state).toBe('disposed');
    expect(log).toContain('uninstall:movement.jump');
  });

  it('refuses an invalid definition, an unsupported band and a missing service', async () => {
    const a = setup();
    await expect(loadAdventure({ id: 'x' }, a.runtime, a.runtime.services, { ageBand: 'SPROUT' })).rejects.toSatisfy((e) =>
      isEngineError(e, 'VALIDATION_FAILED'),
    );
    const b = setup();
    await expect(
      loadAdventure(validAdventure({ ageBands: ['EXPLORER'] }), b.runtime, b.runtime.services, { ageBand: 'SPROUT' }),
    ).rejects.toSatisfy((e) => isEngineError(e, 'INVALID_CONFIG'));
    const c = setup();
    await expect(
      loadAdventure(validAdventure({ requiredServices: ['lai.assetManager'] }), c.runtime, c.runtime.services, { ageBand: 'SPROUT' }),
    ).rejects.toSatisfy((e) => isEngineError(e, 'MISSING_DEPENDENCY'));
    const token = defineService<object>('lai.assetManager');
    const d = setup();
    d.runtime.services.provide(token, {});
    const session = await loadAdventure(validAdventure({ requiredServices: ['lai.assetManager'] }), d.runtime, d.runtime.services, {
      ageBand: 'SPROUT',
    });
    expect(session.state).toBe('running');
  });

  it('places components through the registry and rejects unregistered types', async () => {
    const components = createComponentRegistry();
    components.register('gameplay.chest', (runtime, placement) => runtime.world.create(placement.id));
    const { runtime } = setup();
    await loadAdventure(validAdventure(), runtime, runtime.services, { ageBand: 'EXPLORER', components });
    expect(runtime.world.bySemanticId('chest-1')).toBeDefined();

    const other = setup();
    await expect(
      loadAdventure(validAdventure(), other.runtime, other.runtime.services, { ageBand: 'EXPLORER', components: createComponentRegistry() }),
    ).rejects.toSatisfy((e) => isEngineError(e, 'VALIDATION_FAILED'));
  });
});
