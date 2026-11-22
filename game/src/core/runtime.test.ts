import { validationOk } from './errors';
import { defineComponent } from './entities';
import { createEngineRuntime } from './runtime';

type Events = { 'test.stepped': { step: number } };

const Counter = defineComponent<{ n: number }>('test.counter');

function makeRuntime() {
  return createEngineRuntime<Events>({ id: 'test-area', timestep: { stepSeconds: 1 / 60 } });
}

describe('engine runtime lifecycle', () => {
  it('moves created -> starting -> running -> paused -> running -> disposed', async () => {
    const runtime = makeRuntime();
    const states: string[] = [];
    runtime.events.on('engine.stateChanged', ({ state }) => states.push(state));
    await runtime.start();
    runtime.pause();
    runtime.resume();
    runtime.dispose();
    runtime.dispose();
    expect(states).toEqual(['starting', 'running', 'paused', 'running', 'disposing', 'disposed']);
  });

  it('rejects a second start', async () => {
    const runtime = makeRuntime();
    await runtime.start();
    await expect(runtime.start()).rejects.toThrow(/Cannot start/);
  });

  it('lets dispose during an awaited setup win', async () => {
    const runtime = makeRuntime();
    let release!: () => void;
    const pending = runtime.start([], () => new Promise<void>((resolve) => (release = resolve)));
    runtime.dispose();
    release();
    await pending;
    expect(runtime.state).toBe('disposed');
  });

  it('disposes what was installed when setup fails', async () => {
    const runtime = makeRuntime();
    const disposed = vi.fn();
    await expect(
      runtime.start([], (rt) => {
        rt.resources.track(disposed);
        throw new Error('scene failed');
      }),
    ).rejects.toThrow('scene failed');
    expect(disposed).toHaveBeenCalled();
    expect(runtime.state).toBe('disposed');
  });
});

describe('engine runtime simulation', () => {
  it('runs simulation systems at a fixed step and presentation once per frame', async () => {
    const runtime = makeRuntime();
    const steps: number[] = [];
    let frames = 0;
    runtime.systems.add({ id: 'sim', phase: 'simulation', update: ({ step }) => steps.push(step) });
    runtime.systems.add({ id: 'draw', phase: 'presentation', update: () => (frames += 1) });
    await runtime.start();
    runtime.tick(3 / 60);
    expect(steps).toEqual([1, 2, 3]);
    expect(frames).toBe(1);
    runtime.pause();
    runtime.tick(1);
    expect(steps).toHaveLength(3);
    runtime.resume();
    runtime.tick(1 / 60);
    expect(steps).toEqual([1, 2, 3, 4]);
  });

  it('orders systems by phase then order', async () => {
    const runtime = makeRuntime();
    const order: string[] = [];
    runtime.systems.add({ id: 'post', phase: 'postSimulation', update: () => order.push('post') });
    runtime.systems.add({
      id: 'sim-late',
      phase: 'simulation',
      order: 10,
      update: () => order.push('sim-late'),
    });
    runtime.systems.add({
      id: 'sim-early',
      phase: 'simulation',
      order: -1,
      update: () => order.push('sim-early'),
    });
    runtime.systems.add({ id: 'input', phase: 'input', update: () => order.push('input') });
    await runtime.start();
    runtime.tick(1 / 60);
    expect(order).toEqual(['input', 'sim-early', 'sim-late', 'post']);
  });

  it('installs capabilities in dependency order and uninstalls in reverse on dispose', async () => {
    const runtime = makeRuntime();
    const log: string[] = [];
    runtime.capabilities.register({
      id: 'test.base',
      version: '1.0.0',
      description: 'base',
      defaults: { speed: 1 },
      validate: (input) => validationOk({ speed: 1, ...(input as object) }),
      install: (rt) => {
        log.push('install base');
        const e = rt.world.create('thing');
        rt.world.add(e, Counter, { n: 0 });
        return () => log.push('uninstall base');
      },
    });
    runtime.capabilities.register({
      id: 'test.feature',
      version: '1.0.0',
      description: 'feature',
      requires: ['test.base'],
      defaults: {},
      validate: () => validationOk({}),
      install: () => {
        log.push('install feature');
        return () => log.push('uninstall feature');
      },
    });
    await runtime.start([{ id: 'test.feature' }]);
    expect([...runtime.installed.keys()]).toEqual(['test.base', 'test.feature']);
    expect(runtime.capabilityConfig<{ speed: number }>('test.base')).toEqual({ speed: 1 });
    runtime.dispose();
    expect(log).toEqual(['install base', 'install feature', 'uninstall feature', 'uninstall base']);
    expect(runtime.world.size).toBe(0);
  });

  it('refuses to start with invalid capability config', async () => {
    const runtime = makeRuntime();
    await expect(runtime.start([{ id: 'movement.unknown' }])).rejects.toThrow(/invalid/);
    expect(runtime.state).toBe('disposed');
  });

  it('records diagnostics without child data', async () => {
    const runtime = makeRuntime();
    await runtime.start();
    runtime.tick(1 / 60);
    const snapshot = runtime.diagnostics.snapshot();
    expect(snapshot.frame.frames).toBe(1);
    expect(snapshot.gauges.entities).toBe(0);
  });
});
