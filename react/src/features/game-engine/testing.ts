import { vi } from 'vitest';
import type { HostRenderer } from './hostTypes';

/** A renderer that needs no WebGL, for jsdom tests. */
export function createFakeRenderer(): HostRenderer & {
  render: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  setSize: ReturnType<typeof vi.fn>;
} {
  return {
    domElement: document.createElement('canvas'),
    setSize: vi.fn(),
    setPixelRatio: vi.fn(),
    render: vi.fn(),
    dispose: vi.fn(),
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
