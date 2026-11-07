import { describe, expect, it, vi } from 'vitest';
import { createWebAudioEngine } from './AudioEngine';
import { FakeContext, okResponse, type FakeSource } from './testing/fakes';
import type { SpatialParams } from './AudioTypes';

function setup() {
  const contexts: FakeContext[] = [];
  const engine = createWebAudioEngine({
    createContext: () => {
      const context = new FakeContext();
      contexts.push(context);
      return context as unknown as AudioContext;
    },
    fetchImpl: vi.fn(async () => okResponse()) as unknown as typeof fetch,
    unlockTimeoutMs: 20,
  });
  return { engine, contexts };
}

const params = (overrides: Partial<SpatialParams> = {}): SpatialParams => ({
  position: [1, 2, 3],
  refDistance: 2,
  maxDistance: 25,
  rolloffFactor: 1.5,
  distanceModel: 'inverse',
  orientation: undefined,
  coneInnerAngle: 360,
  coneOuterAngle: 360,
  coneOuterGain: 0,
  ...overrides,
});

async function play(engine: ReturnType<typeof setup>['engine'], spatial?: SpatialParams) {
  const loaded = await engine.load('test://a', {
    stream: false,
    signal: new AbortController().signal,
  });
  return engine.play(
    loaded,
    { channel: 'sfx', loop: true, volume: 1, playbackRate: 1, fadeInMs: 0, spatial },
    vi.fn(),
  );
}

describe('the engine places sounds on its one shared context', () => {
  it('adds a panner with the requested parameters between the voice gain and its channel', async () => {
    const { engine, contexts } = setup();
    await engine.unlock();
    await play(engine, params());
    expect(contexts).toHaveLength(1); // no second AudioContext
    const panner = contexts[0]!.panners[0]!;
    expect(panner.refDistance).toBe(2);
    expect(panner.maxDistance).toBe(25);
    expect(panner.rolloffFactor).toBe(1.5);
    expect(panner.distanceModel).toBe('inverse');
    expect([panner.positionX.value, panner.positionY.value, panner.positionZ.value]).toEqual([
      1, 2, 3,
    ]);
    // gain -> panner -> channel
    expect(panner.connected).toHaveLength(1);
  });

  it('creates no panner for a plain sound', async () => {
    const { engine, contexts } = setup();
    await engine.unlock();
    await play(engine);
    expect(contexts[0]!.panners).toHaveLength(0);
  });

  it('moves and orients a positional voice, and a plain voice has no such methods', async () => {
    const { engine, contexts } = setup();
    await engine.unlock();
    const voice = await play(
      engine,
      params({ orientation: [0, 0, -1], coneInnerAngle: 30, coneOuterAngle: 90 }),
    );
    voice.setPosition?.(7, 8, 9);
    voice.setOrientation?.(1, 0, 0);
    const panner = contexts[0]!.panners[0]!;
    expect([panner.positionX.value, panner.positionY.value, panner.positionZ.value]).toEqual([
      7, 8, 9,
    ]);
    expect(panner.orientationX.value).toBe(1);
    expect(panner.coneInnerAngle).toBe(30);
    const plain = await play(engine);
    expect(plain.setPosition).toBeUndefined();
  });

  it('disconnects the panner when the voice stops, leaking no node', async () => {
    const { engine, contexts } = setup();
    await engine.unlock();
    const voice = await play(engine, params());
    voice.stop(0);
    expect(contexts[0]!.panners[0]!.disconnected).toBe(true);
    // A later move is a safe no-op.
    expect(() => voice.setPosition?.(1, 1, 1)).not.toThrow();
    const sources = contexts[0]!.sources as FakeSource[];
    expect(sources[0]!.stops.length).toBeGreaterThan(0);
  });

  it('moves the listener without allocating a second one', async () => {
    const { engine, contexts } = setup();
    await engine.unlock();
    engine.setListener?.({ position: [4, 5, 6], forward: [0, 0, -1], up: [0, 1, 0] });
    const listener = contexts[0]!.listener;
    expect([listener.positionX.value, listener.positionY.value, listener.positionZ.value]).toEqual([
      4, 5, 6,
    ]);
    expect(listener.forwardZ.value).toBe(-1);
    expect(engine.supportsSpatial).toBe(true);
  });
});
