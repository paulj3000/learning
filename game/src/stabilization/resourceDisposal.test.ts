import { PerspectiveCamera, Scene } from 'three';
import { describe, expect, it } from 'vitest';
import type { CapabilityRequest } from '../core/capabilities';
import type { EventMap } from '../core/eventBus';
import type { EngineRuntime } from '../core/runtime';
import { HostViewService, type HostView } from '../engine/host';
import { createStandardEngine, type StandardEngineHandle } from '../engine/standardEngine';
import { createAabbPhysicsProvider } from '../physics/aabbProvider';

/**
 * Wave 2 stabilization, area 1 (engine side): start/dispose cycles of the standard engine leave
 * zero resources, entities, systems, bus listeners, services and scene children, and repeated
 * cycles do not grow any count. Disposing while the start is still awaiting its setup wins.
 */

const DT = 1 / 60;

const FULL_REQUESTS: CapabilityRequest[] = [
  { id: 'movement.locomotion' },
  { id: 'movement.jump' },
  { id: 'camera.thirdPerson' },
  { id: 'camera.collision' },
  { id: 'character.avatar' },
  { id: 'character.animation' },
  {
    id: 'gameplay.checkpoints',
    config: {
      checkpoints: [
        { id: 'cp.a', courseId: 'course.a', position: { x: 0, y: 0, z: 0 }, label: 'the dock' },
      ],
    },
  },
  {
    id: 'gameplay.collectibles',
    config: { collectibles: [{ id: 'coin.a', position: { x: 5, y: 0, z: 0 } }] },
  },
  {
    id: 'gameplay.doors',
    config: {
      doors: [{ id: 'door.a', position: { x: 8, y: 0, z: 0 }, size: { x: 0.4, y: 2, z: 2 } }],
    },
  },
  {
    id: 'gameplay.puzzles',
    config: {
      puzzles: [
        { id: 'puz.a', kind: 'SEQUENCE', steps: ['s1', 's2'], alternativeActionId: 'action.skip' },
      ],
    },
  },
];

function fakeView(): HostView {
  return {
    renderer: {
      info: { render: { calls: 0, triangles: 0 }, memory: { geometries: 0, textures: 0 } },
    } as unknown as HostView['renderer'],
    scene: new Scene(),
    camera: new PerspectiveCamera(60, 1, 0.1, 100),
    canvas: {} as HTMLCanvasElement,
    size: () => ({ width: 800, height: 600 }),
  };
}

interface Counts {
  resources: number;
  entities: number;
  systems: number;
  listeners: number;
  services: number;
}

function counts(runtime: EngineRuntime<EventMap>): Counts {
  return {
    resources: runtime.resources.count(),
    entities: runtime.world.size,
    systems: runtime.systems.ids().length,
    listeners: runtime.events.listenerCount(),
    services: runtime.services.ids().length,
  };
}

const ZERO: Counts = { resources: 0, entities: 0, systems: 0, listeners: 0, services: 0 };

async function start(
  view: HostView,
  requests = FULL_REQUESTS,
  physics = createAabbPhysicsProvider(),
) {
  const handle = await createStandardEngine({
    id: 'disposal-test',
    requests,
    input: () => ({ move: { forward: 1, strafe: 0 } }),
    physics,
    startYaw: Math.PI / 2,
    provide: (rt) => rt.services.provide(HostViewService, view),
  });
  return { handle, physics };
}

function tick(handle: StandardEngineHandle, steps: number): void {
  for (let i = 0; i < steps; i += 1) handle.runtime.tick(DT);
}

describe('standard engine disposal', () => {
  it('a started engine holds resources, entities, systems and scene children', async () => {
    const view = fakeView();
    const { handle } = await start(view);
    const live = counts(handle.runtime);
    expect(live.resources).toBeGreaterThan(0);
    expect(live.entities).toBeGreaterThan(0);
    expect(live.systems).toBeGreaterThan(0);
    expect(live.listeners).toBeGreaterThan(0);
    expect(view.scene.children.length).toBe(1);
    handle.dispose();
  });

  it('dispose leaves zero resources, entities, systems, listeners, services and scene children', async () => {
    const view = fakeView();
    const { handle } = await start(view);
    tick(handle, 30);
    handle.dispose();
    expect(handle.runtime.state).toBe('disposed');
    expect(counts(handle.runtime)).toEqual(ZERO);
    expect(view.scene.children).toHaveLength(0);
  });

  it('removes the colliders the engine components added (doors) from a shared provider', async () => {
    const physics = createAabbPhysicsProvider();
    physics.addCollider({
      id: 'authored.wall',
      kind: 'SOLID',
      min: { x: 20, y: 0, z: -1 },
      max: { x: 21, y: 2, z: 1 },
    });
    const { handle } = await start(fakeView(), FULL_REQUESTS, physics);
    expect(physics.hasCollider('door.a')).toBe(true);
    handle.dispose();
    expect(physics.hasCollider('door.a')).toBe(false);
    expect(physics.hasCollider('authored.wall')).toBe(true);
  });

  it('dispose is idempotent and ticking a disposed engine does nothing', async () => {
    const view = fakeView();
    const { handle } = await start(view);
    handle.dispose();
    expect(() => handle.dispose()).not.toThrow();
    expect(() => tick(handle, 5)).not.toThrow();
    expect(counts(handle.runtime)).toEqual(ZERO);
  });

  it('a disposed engine delivers no events to listeners it had', async () => {
    const { handle } = await start(fakeView());
    let heard = 0;
    handle.runtime.events.on('PlayerGaitChanged' as never, (() => (heard += 1)) as never);
    handle.dispose();
    handle.runtime.events.emit('PlayerGaitChanged' as never, { gait: 'walk' } as never);
    expect(heard).toBe(0);
  });

  it('20 start/dispose cycles do not grow any count, scene children or colliders', async () => {
    const view = fakeView();
    const physics = createAabbPhysicsProvider();
    const baselineColliders = physics.colliders().length;
    let firstLive: Counts | null = null;
    for (let cycle = 0; cycle < 20; cycle += 1) {
      const { handle } = await start(view, FULL_REQUESTS, physics);
      tick(handle, 10);
      const live = counts(handle.runtime);
      firstLive ??= live;
      expect(live).toEqual(firstLive);
      expect(view.scene.children).toHaveLength(1);
      handle.dispose();
      expect(counts(handle.runtime)).toEqual(ZERO);
      expect(view.scene.children).toHaveLength(0);
      expect(physics.colliders()).toHaveLength(baselineColliders);
    }
  });

  it('an invalid request fails start and disposes everything it installed', async () => {
    const view = fakeView();
    let captured: EngineRuntime<EventMap> | null = null;
    await expect(
      createStandardEngine({
        id: 'bad',
        requests: [{ id: 'movement.locomotion' }, { id: 'gameplay.nonexistent' }],
        input: () => ({ move: { forward: 0, strafe: 0 } }),
        provide: (rt) => {
          captured = rt;
          rt.services.provide(HostViewService, view);
        },
      }),
    ).rejects.toBeDefined();
    expect(captured!.state).toBe('disposed');
    expect(counts(captured!)).toEqual(ZERO);
    expect(view.scene.children).toHaveLength(0);
  });

  it('a throwing setup disposes the engine, leaves zero counts and rethrows', async () => {
    const view = fakeView();
    let captured: EngineRuntime<EventMap> | null = null;
    await expect(
      createStandardEngine({
        id: 'setup-throws',
        requests: FULL_REQUESTS,
        input: () => ({ move: { forward: 0, strafe: 0 } }),
        provide: (rt) => {
          captured = rt;
          rt.services.provide(HostViewService, view);
        },
        setup: () => {
          throw new Error('asset load failed');
        },
      }),
    ).rejects.toThrow('asset load failed');
    expect(captured!.state).toBe('disposed');
    expect(counts(captured!)).toEqual(ZERO);
    expect(view.scene.children).toHaveLength(0);
  });

  describe('dispose during start', () => {
    async function disposeDuringSetup(view: HostView) {
      let captured: EngineRuntime<EventMap> | null = null;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let entered!: () => void;
      const inSetup = new Promise<void>((resolve) => (entered = resolve));
      const pending = createStandardEngine({
        id: 'dispose-during-start',
        requests: FULL_REQUESTS,
        input: () => ({ move: { forward: 0, strafe: 0 } }),
        provide: (rt) => {
          captured = rt;
          rt.services.provide(HostViewService, view);
        },
        setup: async () => {
          entered();
          await gate;
        },
      });
      await inSetup;
      expect(captured!.state).toBe('starting');
      captured!.dispose();
      release();
      const result = await pending.then(
        (h) => ({ ok: true as const, h }),
        (e: unknown) => ({ ok: false as const, e }),
      );
      return { captured: captured as unknown as EngineRuntime<EventMap>, result };
    }

    it('wins: the runtime ends disposed, never running, with zero counts and an empty scene', async () => {
      const view = fakeView();
      const { captured } = await disposeDuringSetup(view);
      expect(captured.state).toBe('disposed');
      expect(counts(captured)).toEqual(ZERO);
      expect(view.scene.children).toHaveLength(0);
    });

    it('a tick after the dispose is a no-op and does not revive the runtime', async () => {
      const view = fakeView();
      const { captured } = await disposeDuringSetup(view);
      expect(() => captured.tick(DT)).not.toThrow();
      expect(captured.state).toBe('disposed');
      expect(counts(captured)).toEqual(ZERO);
    });

    it('settles (an already-disposed handle or a rejection), never hangs and never yields a live handle', async () => {
      const { result } = await disposeDuringSetup(fakeView());
      if (result.ok) {
        expect(result.h.runtime.state).toBe('disposed');
      } else {
        expect(result.e).toBeInstanceOf(Error);
      }
    });
  });
});
