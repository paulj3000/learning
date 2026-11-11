import { AnimationClip, AnimationMixer, Group, NumberKeyframeTrack, Object3D } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBehaviorController } from '../behavior/createBehaviorController';
import type { BehaviorControllerFactory, NpcEngineEvent, NpcSpawn } from '../contracts/engine';
import type { BehaviorSpec, RuntimePlacement } from '../contracts/types';
import {
  MAX_STEP_SECONDS,
  createNpcRuntime,
  type LoadedNpcModel,
  type NpcModelLoader,
  type NpcRuntimeOptions,
} from './createNpcRuntime';

/**
 * LAI-NPC-037: performance and lifecycle of the NPC runtime, measured with fakes
 * (docs/NPC_MANAGER_PERFORMANCE.md). Counts are exact; the one timing budget is deliberately
 * generous so it cannot flake on a loaded CI machine. Device frame times need owner profiling.
 */

function spawnAt(
  key: string,
  x: number,
  z: number,
  behavior: BehaviorSpec | null = null,
  assetId = 'npc-pip',
): NpcSpawn {
  const placement: RuntimePlacement = {
    placementKey: key,
    npcId: 'pip',
    variant: 'classic',
    behavior,
    position: { x, y: 0, z },
    rotationY: 0,
    scale: 1,
    interactionRadius: 2,
  };
  return {
    placement,
    character: {
      npcId: 'pip',
      displayName: 'Pip',
      role: 'QUEST_GIVER',
      ageBands: [],
      personality: {},
      dialogueMode: 'AUTHORED',
      voiceProfile: null,
      defaultVariant: 'classic',
      variants: [
        {
          variantKey: 'classic',
          displayName: 'Classic',
          model: { assetId, version: 1 },
          portrait: null,
          scale: 1,
          rotationOffsetY: 0,
          positionOffsetY: 0,
          animationMap: { idle: 'Idle', walk: 'Walk', wave: 'Wave' },
          extras: [],
        },
      ],
    },
  };
}

const patrol = (speed = 1.5): BehaviorSpec => ({
  key: 'patrol',
  type: 'patrol',
  parameters: {
    boundsRadius: 20,
    reactions: {},
    speed,
    loop: true,
    waypoints: [
      { x: 6, z: 0 },
      { x: 6, z: 6, pauseSeconds: 0.5 },
      { x: 0, z: 6 },
      { x: 0, z: 0 },
    ],
  },
});

function clip(name: string, duration: number) {
  return new AnimationClip(name, duration, [
    new NumberKeyframeTrack('Body.position[y]', [0, duration], [0, 0.1]),
  ]);
}
const CLIPS = [clip('Idle', 1), clip('Walk', 0.8), clip('Wave', 0.5)];

/** A counting loader whose models carry a release spy. */
function countingLoader() {
  const calls: string[] = [];
  const releases: ReturnType<typeof vi.fn>[] = [];
  const loadModel: NpcModelLoader = async (ref) => {
    calls.push(`${ref.assetId}@${ref.version}`);
    const scene = new Group();
    const body = new Object3D();
    body.name = 'Body';
    scene.add(body);
    const release = vi.fn();
    releases.push(release);
    return { scene, animations: CLIPS, release } satisfies LoadedNpcModel;
  };
  return { loadModel, calls, releases };
}

async function flush() {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

const factory: BehaviorControllerFactory = (args) =>
  createBehaviorController({ ...args, random: seeded(7) });

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

function setup(overrides: Partial<NpcRuntimeOptions> = {}) {
  const parent = new Group();
  const loader = countingLoader();
  const events: NpcEngineEvent[] = [];
  const runtime = createNpcRuntime({
    parent,
    loadModel: loader.loadModel,
    reducedMotion: () => false,
    loadTimeoutMs: 0,
    behaviorFactory: factory,
    ...overrides,
  });
  runtime.subscribe((event) => events.push(event));
  return { parent, runtime, events, ...loader };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('incremental mount', () => {
  it('keeps unchanged NPCs, disposes removed or changed ones and adds new ones', async () => {
    const { runtime, calls, releases } = setup();
    runtime.mount([spawnAt('a', 0, 0), spawnAt('b', 3, 0), spawnAt('c', 6, 0)]);
    await flush();
    const rootA = runtime.rootOf('a');
    const rootB = runtime.rootOf('b');
    const modelA = rootA!.children[0];
    expect(calls).toHaveLength(3);

    runtime.mount([spawnAt('a', 0, 0), spawnAt('b', 4, 0), spawnAt('d', 9, 0)]);
    await flush();
    expect(runtime.placements()).toEqual(['a', 'b', 'd']);
    expect(runtime.rootOf('a')).toBe(rootA); // unchanged: same root, same model
    expect(rootA!.children[0]).toBe(modelA);
    expect(runtime.rootOf('b')).not.toBe(rootB); // moved: rebuilt
    expect(rootB!.parent).toBeNull();
    expect(calls).toHaveLength(5); // b (changed) and d (new) only
    // b's old model and c's were released exactly once; a's is still held.
    expect(releases.map((r) => r.mock.calls.length)).toEqual([0, 1, 1, 0, 0]);
  });

  it('mounting the same placements again rebuilds and reloads nothing', async () => {
    const { runtime, calls, events } = setup();
    const spawns = Array.from({ length: 20 }, (_, i) => spawnAt(`n${i}`, i, 0, patrol()));
    runtime.mount(spawns);
    await flush();
    runtime.update(0.5, { x: 0, z: 0 });
    const roots = spawns.map((s) => runtime.rootOf(s.placement.placementKey));
    const before = events.length;
    runtime.mount(spawns.map((s) => structuredClone(s)));
    await flush();
    expect(calls).toHaveLength(20);
    expect(spawns.map((s) => runtime.rootOf(s.placement.placementKey))).toEqual(roots);
    expect(events.slice(before)).toEqual([]); // no left, no loaded
  });
});

describe('distance-aware updates', () => {
  /** Where the walker is at each whole second (the far one flushed by a near frame). */
  function walked(far: boolean, frames: readonly number[]) {
    const { runtime } = setup({ farDistance: 30 });
    runtime.mount([spawnAt('walker', 0, 0, patrol(2))]);
    const near = { x: 3, z: 3 };
    const player = far ? { x: 500, z: 500 } : near;
    let distance = 0;
    let last = { x: 0, z: 0 };
    for (const dt of frames) {
      runtime.update(dt, player);
      const root = runtime.rootOf('walker')!;
      distance += Math.hypot(root.position.x - last.x, root.position.z - last.z);
      last = { x: root.position.x, z: root.position.z };
    }
    runtime.update(0, near); // applies any time a far NPC still holds
    const root = runtime.rootOf('walker')!;
    distance += Math.hypot(root.position.x - last.x, root.position.z - last.z);
    return { x: root.position.x, z: root.position.z, distance };
  }

  it('a far NPC covers the same distance and route over time as a near one', () => {
    // 0.09 + 0.24 frames push a far NPC's pending time past one behaviour step (0.25 s).
    const frames = Array.from({ length: 120 }, (_, i) => (i % 2 === 0 ? 0.09 : 0.24));
    const near = walked(false, frames);
    const far = walked(true, frames);
    expect(near.distance).toBeGreaterThan(20); // it really walked (2 m/s for ~20 s, pauses)
    expect(far.distance).toBeCloseTo(near.distance, 1);
    expect(Math.hypot(near.x - far.x, near.z - far.z)).toBeLessThan(0.05);
  });

  it('far NPCs call behaviour and mixer less often, with steps the controller accepts', async () => {
    const steps: number[] = [];
    const spy: BehaviorControllerFactory = (args) => {
      const inner = factory(args);
      return {
        ...inner,
        update(dt, player) {
          if (args.placementKey === 'far') steps.push(dt);
          return inner.update(dt, player);
        },
      };
    };
    const { runtime } = setup({ behaviorFactory: spy });
    runtime.mount([spawnAt('near', 0, 0, patrol()), spawnAt('far', 100, 0, patrol())]);
    await flush();
    const mixerUpdate = vi.spyOn(AnimationMixer.prototype, 'update');
    for (let i = 0; i < 60; i += 1) runtime.update(1 / 60, { x: 0, z: 0 });
    // Near: 60 mixer updates; far: one per 0.1 s.
    expect(mixerUpdate.mock.calls.length).toBeLessThanOrEqual(60 + 10);
    expect(steps.length).toBeLessThanOrEqual(10);
    expect(steps.every((dt) => dt <= MAX_STEP_SECONDS)).toBe(true);
    const total = steps.reduce((sum, dt) => sum + dt, 0);
    expect(total).toBeGreaterThan(1 - 0.1 - 1e-9); // the time is kept, not dropped
  });

  it('hidden and off-screen NPCs animate at the reduced rate but still finish one-shots', async () => {
    const onScreen = vi.fn(() => false);
    const { runtime, events } = setup({ isOnScreen: onScreen });
    runtime.mount([spawnAt('a', 0, 0)]);
    await flush();
    const mixerUpdate = vi.spyOn(AnimationMixer.prototype, 'update');
    runtime.send({ type: 'animate', placementKey: 'a', state: 'wave' });
    for (let i = 0; i < 60; i += 1) runtime.update(1 / 60, { x: 0, z: 0 });
    expect(mixerUpdate.mock.calls.length).toBeLessThanOrEqual(10);
    expect(events).toContainEqual({
      type: 'npc.animation_finished',
      placementKey: 'a',
      state: 'wave',
    });
    // Proximity still updates every frame.
    expect(runtime.isNear('a')).toBe(true);
    expect(onScreen).toHaveBeenCalledWith(runtime.rootOf('a'), 'a');
  });

  it('applies a scripted play step from the behaviour frame', async () => {
    const { runtime, events } = setup();
    runtime.mount([
      spawnAt('s', 0, 0, {
        key: 'beat',
        type: 'scripted',
        parameters: {
          boundsRadius: 10,
          reactions: {},
          loop: false,
          steps: [{ action: 'play', state: 'wave' }],
        },
      }),
    ]);
    await flush();
    for (let i = 0; i < 60; i += 1) runtime.update(1 / 60, null);
    expect(events).toContainEqual({
      type: 'npc.animation_finished',
      placementKey: 's',
      state: 'wave',
    });
  });
});

describe('per-frame work', () => {
  it('never traverses the scene or calls the loader while updating', async () => {
    const { runtime, calls } = setup();
    runtime.mount(Array.from({ length: 20 }, (_, i) => spawnAt(`n${i}`, i * 3, 0, patrol())));
    await flush();
    const traverse = vi.spyOn(Object3D.prototype, 'traverse');
    const loadsBefore = calls.length;
    for (let i = 0; i < 300; i += 1) runtime.update(1 / 60, { x: i * 0.1, z: 0 });
    expect(traverse).not.toHaveBeenCalled();
    expect(calls.length).toBe(loadsBefore);
  });

  it('updates 20 animated, moving NPCs well within budget', async () => {
    const { runtime } = setup();
    const spawns = Array.from({ length: 20 }, (_, i) =>
      spawnAt(`n${i}`, (i % 5) * 8, Math.floor(i / 5) * 8, i % 4 === 3 ? null : patrol()),
    );
    runtime.mount(spawns);
    await flush();
    for (let i = 0; i < 60; i += 1) runtime.update(1 / 60, { x: 0, z: 0 }); // warm up
    const frames = 600;
    const start = performance.now();
    for (let i = 0; i < frames; i += 1) {
      runtime.update(1 / 60, { x: 10 + Math.sin(i / 60) * 10, z: 10 });
    }
    const perFrameMs = (performance.now() - start) / frames;
    // Target on a tablet: under 1 ms (owner profiling). Here: a generous ceiling.
    expect(perFrameMs).toBeLessThan(8);
  });
});

describe('disposal', () => {
  it('stops and uncaches the mixer of a removed NPC and releases its model once', async () => {
    const { runtime, releases } = setup();
    runtime.mount([spawnAt('a', 0, 0), spawnAt('b', 1, 0)]);
    await flush();
    const stop = vi.spyOn(AnimationMixer.prototype, 'stopAllAction');
    const uncacheRoot = vi.spyOn(AnimationMixer.prototype, 'uncacheRoot');
    const uncacheClip = vi.spyOn(AnimationMixer.prototype, 'uncacheClip');
    runtime.mount([spawnAt('a', 0, 0)]);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(uncacheRoot).toHaveBeenCalledTimes(1);
    expect(uncacheClip).toHaveBeenCalledTimes(CLIPS.length);
    runtime.dispose();
    runtime.dispose();
    expect(releases.map((r) => r.mock.calls.length)).toEqual([1, 1]);
  });

  it('releases a model that arrives after its NPC is gone', async () => {
    let resolve!: (model: LoadedNpcModel) => void;
    const release = vi.fn();
    const { runtime } = setup({ loadModel: () => new Promise((r) => (resolve = r)) });
    runtime.mount([spawnAt('a', 0, 0)]);
    runtime.mount([]);
    resolve({ scene: new Group(), animations: [], release });
    await flush();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('a throwing release never breaks disposal', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { runtime, parent } = setup({
      loadModel: async () => ({
        scene: new Group(),
        animations: [],
        release: () => {
          throw new Error('boom');
        },
      }),
    });
    runtime.mount([spawnAt('a', 0, 0), spawnAt('b', 1, 0)]);
    await flush();
    runtime.dispose();
    expect(parent.children).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('removes listeners on dispose', async () => {
    const { runtime, events } = setup();
    runtime.mount([spawnAt('a', 0, 0)]);
    runtime.dispose();
    runtime.update(0.1, { x: 0, z: 0 });
    expect(runtime.requestInteract('a', 'touch')).toBe(false);
    expect(events).toEqual([]);
  });
});
