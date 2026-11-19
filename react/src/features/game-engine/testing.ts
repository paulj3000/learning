import { vi, type Mock } from 'vitest';
import type { HostRenderer } from './hostTypes';

/** A renderer that needs no WebGL, for jsdom tests. */
export type FakeRenderer = HostRenderer & {
  render: Mock<HostRenderer['render']>;
  dispose: Mock<HostRenderer['dispose']>;
  setSize: Mock<HostRenderer['setSize']>;
};

export function createFakeRenderer(): FakeRenderer {
  return {
    domElement: document.createElement('canvas'),
    setSize: vi.fn<HostRenderer['setSize']>(),
    setPixelRatio: vi.fn<HostRenderer['setPixelRatio']>(),
    render: vi.fn<HostRenderer['render']>(),
    dispose: vi.fn<HostRenderer['dispose']>(),
    info: { render: { calls: 3, triangles: 120 }, memory: { geometries: 2, textures: 1 } },
  };
}

/** A manual requestAnimationFrame: tests advance frames explicitly. */
export function installFakeAnimationFrames() {
  let next = 1;
  const pending = new Map<number, FrameRequestCallback>();
  let now = 0;
  const raf = vi.fn((callback: FrameRequestCallback) => {
    const id = next++;
    pending.set(id, callback);
    return id;
  });
  const caf = vi.fn((id: number) => {
    pending.delete(id);
  });
  vi.stubGlobal('requestAnimationFrame', raf);
  vi.stubGlobal('cancelAnimationFrame', caf);
  window.requestAnimationFrame = raf as never;
  window.cancelAnimationFrame = caf as never;
  return {
    raf,
    caf,
    pendingCount: () => pending.size,
    /** Runs the queued frames once, advancing the clock by `ms`. */
    step(ms = 16) {
      now += ms;
      const callbacks = [...pending.values()];
      pending.clear();
      callbacks.forEach((cb) => cb(now));
    },
  };
}
