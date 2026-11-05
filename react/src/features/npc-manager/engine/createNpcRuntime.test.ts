import { AnimationClip, Group, Mesh, NumberKeyframeTrack, Object3D } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  BehaviorController,
  BehaviorControllerArgs,
  BehaviorFrame,
  NpcEngineEvent,
  NpcSpawn,
} from '../contracts/engine';
import type { RuntimeCharacter, RuntimePlacement } from '../contracts/types';
import {
  DEFAULT_PLACEHOLDER,
  NpcModelLoadError,
  createNpcRuntime,
  hysteresisFor,
  type LoadedNpcModel,
  type NpcModelLoader,
  type NpcRuntimeOptions,
} from './createNpcRuntime';

function character(npcId = 'pirate-pip'): RuntimeCharacter {
  return {
    npcId,
    displayName: 'Pirate Pip',
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
        model: { assetId: 'npc-pip', version: null },
        portrait: null,
        scale: 1,
        rotationOffsetY: 0,
        positionOffsetY: 0,
        animationMap: { idle: 'Idle', wave: 'Wave', talk: 'Talk' },
        extras: [],
      },
      {
        variantKey: 'tall',
        displayName: 'Tall',
        model: { assetId: 'npc-pip-tall', version: 2 },
        portrait: null,
        scale: 1.5,
        rotationOffsetY: 0.5,
        positionOffsetY: 0.25,
        animationMap: { idle: 'Idle' },
        extras: [],
      },
    ],
  };
}

function placement(overrides: Partial<RuntimePlacement> = {}): RuntimePlacement {
  return {
    placementKey: 'cove-pip',
    npcId: 'pirate-pip',
    variant: 'classic',
    behavior: null,
    position: { x: 0, y: 0, z: 0 },
    rotationY: 0,
    scale: 1,
    interactionRadius: 2,
    ...overrides,
  };
}

function spawn(overrides: Partial<RuntimePlacement> = {}): NpcSpawn {
  return { placement: placement(overrides), character: character() };
}

function modelWithClips(): LoadedNpcModel {
  const scene = new Group();
  scene.name = 'pip-model';
  const body = new Object3D();
  body.name = 'Body';
  scene.add(body);
  const clip = (name: string, duration: number) =>
    new AnimationClip(name, duration, [
      new NumberKeyframeTrack('Body.position[x]', [0, duration], [0, 1]),
    ]);
  return { scene, animations: [clip('Idle', 1), clip('Wave', 0.5), clip('Talk', 1)] };
}

/** A loader whose loads the test settles by hand. */
function manualLoader() {
  const calls: {
    ref: { assetId: string; version: number | null };
    signal: AbortSignal;
    resolve: (model: LoadedNpcModel) => void;
    reject: (error: unknown) => void;
  }[] = [];
  const loadModel: NpcModelLoader = (ref, signal) =>
    new Promise((resolve, reject) => calls.push({ ref, signal, resolve, reject }));
  return { loadModel, calls };
}

async function flush() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

function setup(overrides: Partial<NpcRuntimeOptions> = {}) {
  const parent = new Group();
  const loader = manualLoader();
  const events: NpcEngineEvent[] = [];
  const runtime = createNpcRuntime({
    parent,
    loadModel: loader.loadModel,
    reducedMotion: () => false,
    loadTimeoutMs: 0,
    ...overrides,
  });
  runtime.subscribe((event) => events.push(event));
  return { parent, runtime, events, calls: loader.calls };
}

function types(events: NpcEngineEvent[]) {
  return events.map((event) => event.type);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('mounting and loading', () => {
  it('shows a placeholder at once, then swaps in the model', async () => {
    const { parent, runtime, events, calls } = setup();
    runtime.mount([spawn()]);
    const root = runtime.rootOf('cove-pip')!;
    expect(root.parent).toBe(parent);
    const placeholder = root.children[0] as Mesh;
    expect(placeholder.name).toBe('npc-placeholder:cove-pip');
    expect(placeholder.position.y).toBe(DEFAULT_PLACEHOLDER.height / 2);
    expect(calls[0].ref).toEqual({ assetId: 'npc-pip', version: null });
    expect(events).toEqual([]);

    const model = modelWithClips();
    calls[0].resolve(model);
    await flush();
    expect(root.children).toEqual([model.scene]);
    expect(events).toEqual([
      { type: 'npc.loaded', placementKey: 'cove-pip', npcId: 'pirate-pip', placeholder: false },
    ]);
  });

  it('keeps the placeholder when the model fails, and still reports a spawn', async () => {
    const { runtime, events, calls } = setup();
    runtime.mount([spawn()]);
    calls[0].reject(new NpcModelLoadError('invalid_model'));
    await flush();
    expect(runtime.rootOf('cove-pip')!.children[0].name).toBe('npc-placeholder:cove-pip');
    expect(events).toEqual([
      {
        type: 'npc.load_failed',
        placementKey: 'cove-pip',
        npcId: 'pirate-pip',
        reason: 'invalid_model',
      },
      { type: 'npc.loaded', placementKey: 'cove-pip', npcId: 'pirate-pip', placeholder: true },
    ]);
    // Still talkable.
    expect(runtime.requestInteract('cove-pip', 'touch')).toBe(true);
  });

  it('reports any other loader error as model_unavailable', async () => {
    const { runtime, events, calls } = setup();
    runtime.mount([spawn()]);
    calls[0].reject(new Error('network'));
    await flush();
    expect(events[0]).toMatchObject({ type: 'npc.load_failed', reason: 'model_unavailable' });
  });

  it('times a slow load out and ignores the late model', async () => {
    vi.useFakeTimers();
    const { runtime, events, calls } = setup({ loadTimeoutMs: 1000 });
    runtime.mount([spawn()]);
    vi.advanceTimersByTime(1000);
    expect(events[0]).toMatchObject({ type: 'npc.load_failed', reason: 'timeout' });
    expect(calls[0].signal.aborted).toBe(true);
    calls[0].resolve(modelWithClips());
    await flush();
    expect(runtime.rootOf('cove-pip')!.children[0].name).toBe('npc-placeholder:cove-pip');
    expect(types(events)).toEqual(['npc.load_failed', 'npc.loaded']);
  });

  it('applies position, facing and scale with the variant offsets', () => {
    const { runtime, calls } = setup();
    runtime.mount([
      spawn({
        variant: 'tall',
        position: { x: 3, y: 1, z: -2 },
        rotationY: 1,
        scale: 2,
      }),
    ]);
    const root = runtime.rootOf('cove-pip')!;
    expect(root.position.toArray()).toEqual([3, 1.25, -2]);
    expect(root.rotation.y).toBeCloseTo(1.5);
    expect(root.scale.toArray()).toEqual([3, 3, 3]);
    expect(calls[0].ref).toEqual({ assetId: 'npc-pip-tall', version: 2 });
    runtime.update(0.016, null);
    expect(root.position.x).toBe(3);
    expect(root.rotation.y).toBeCloseTo(1.5);
  });

  it('re-mounting replaces the set and discards the aborted loads', async () => {
    const { parent, runtime, events, calls } = setup();
    runtime.mount([spawn(), spawn({ placementKey: 'second' })]);
    const first = runtime.rootOf('cove-pip')!;
    runtime.mount([spawn({ placementKey: 'third' })]);
    expect(runtime.placements()).toEqual(['third']);
    expect(first.parent).toBeNull();
    expect(parent.children).toHaveLength(1);
    expect(calls[0].signal.aborted && calls[1].signal.aborted).toBe(true);
    calls[0].resolve(modelWithClips());
    calls[1].reject(new Error('late'));
    await flush();
    expect(events).toEqual([]);
    expect(first.children[0].name).toBe('npc-placeholder:cove-pip');
  });

  it('ignores a duplicate placement key', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { runtime } = setup();
    runtime.mount([spawn(), spawn()]);
    expect(runtime.placements()).toEqual(['cove-pip']);
    warn.mockRestore();
  });
});

describe('proximity and interaction', () => {
  it('emits approached and left with hysteresis', () => {
    const { runtime, events } = setup();
    runtime.mount([spawn({ interactionRadius: 2 })]);
    runtime.update(0.016, { x: 5, z: 0 });
    expect(events).toEqual([]);
    runtime.update(0.016, { x: 1.9, z: 0 });
    expect(types(events)).toEqual(['npc.approached']);
    expect(runtime.isNear('cove-pip')).toBe(true);
    runtime.update(0.016, { x: 1.5, z: 0 });
    // Just outside the radius but inside the hysteresis band: still near.
    runtime.update(0.016, { x: 2 + hysteresisFor(2) - 0.01, z: 0 });
    expect(types(events)).toEqual(['npc.approached']);
    runtime.update(0.016, { x: 2 + hysteresisFor(2) + 0.01, z: 0 });
    expect(types(events)).toEqual(['npc.approached', 'npc.left']);
    expect(runtime.isNear('cove-pip')).toBe(false);
  });

  it('hiding an NPC leaves it and blocks interaction', () => {
    const { runtime, events } = setup();
    runtime.mount([spawn()]);
    runtime.update(0.016, { x: 0.5, z: 0 });
    runtime.send({ type: 'set_visible', placementKey: 'cove-pip', visible: false });
    expect(runtime.rootOf('cove-pip')!.visible).toBe(false);
    expect(types(events)).toEqual(['npc.approached', 'npc.left']);
    runtime.update(0.016, { x: 0.5, z: 0 });
    expect(types(events)).toEqual(['npc.approached', 'npc.left']);
    expect(runtime.requestInteract('cove-pip', 'keyboard')).toBe(false);
    expect(runtime.interactionTargets()).toEqual([]);
  });

  it('turns a raycast hit or a request into interact_requested', () => {
    const { runtime, events } = setup();
    runtime.mount([spawn()]);
    const hit = runtime.rootOf('cove-pip')!.children[0];
    expect(runtime.pick(hit)).toBe('cove-pip');
    expect(runtime.pick(new Object3D())).toBeNull();
    expect(runtime.interactionTargets()).toEqual([runtime.rootOf('cove-pip')]);
    expect(runtime.requestInteract('cove-pip', 'pointer')).toBe(true);
    expect(runtime.requestInteract('nobody', 'pointer')).toBe(false);
    expect(events).toEqual([
      {
        type: 'npc.interact_requested',
        placementKey: 'cove-pip',
        npcId: 'pirate-pip',
        via: 'pointer',
      },
    ]);
  });
});

describe('commands', () => {
  function fakeBehavior() {
    const frame: BehaviorFrame = { x: 0, z: 0, yaw: 0, locomotion: 'idle', events: [] };
    const controller = {
      update: vi.fn(() => ({ ...frame, events: [...frame.events] })),
      interrupt: vi.fn(),
      resume: vi.fn(),
      react: vi.fn(() => 'wave' as const),
      state: vi.fn(() => 'idle' as const),
      dispose: vi.fn(),
    } satisfies BehaviorController;
    const factory = vi.fn((args: BehaviorControllerArgs) => {
      void args;
      return controller;
    });
    return { controller, factory, frame };
  }

  async function loaded(overrides: Partial<NpcRuntimeOptions> = {}) {
    const ctx = setup(overrides);
    ctx.runtime.mount([spawn()]);
    ctx.calls[0].resolve(modelWithClips());
    await flush();
    ctx.events.length = 0;
    return ctx;
  }

  it('passes the placement to the injected behaviour factory and applies its frames', async () => {
    const behavior = fakeBehavior();
    const { runtime, events } = await loaded({ behaviorFactory: behavior.factory });
    expect(behavior.factory.mock.calls[0][0]).toMatchObject({
      placementKey: 'cove-pip',
      spec: null,
      home: { x: 0, z: 0, yaw: 0 },
    });
    behavior.frame.x = 1;
    behavior.frame.z = 2;
    behavior.frame.yaw = 0.3;
    behavior.frame.events = [{ type: 'npc.waypoint_reached', placementKey: 'cove-pip', index: 0 }];
    runtime.update(0.016, null);
    const root = runtime.rootOf('cove-pip')!;
    expect([root.position.x, root.position.z, root.rotation.y]).toEqual([1, 2, 0.3]);
    expect(types(events)).toEqual(['npc.waypoint_reached']);
  });

  it('forwards animate and finishes a one-shot with animation_finished', async () => {
    const { runtime, events } = await loaded();
    runtime.send({ type: 'animate', placementKey: 'cove-pip', state: 'wave' });
    for (let i = 0; i < 20; i += 1) runtime.update(1 / 30, null);
    expect(events).toContainEqual({
      type: 'npc.animation_finished',
      placementKey: 'cove-pip',
      state: 'wave',
    });
  });

  it('stop_animation ends a looping talk without a finished event', async () => {
    const { runtime, events } = await loaded();
    runtime.send({ type: 'animate', placementKey: 'cove-pip', state: 'talk', priority: 2 });
    runtime.update(2, null);
    runtime.send({ type: 'stop_animation', placementKey: 'cove-pip', priority: 2 });
    runtime.update(2, null);
    expect(types(events)).not.toContain('npc.animation_finished');
  });

  it('forwards interrupt and resume once each', async () => {
    const behavior = fakeBehavior();
    const { runtime } = await loaded({ behaviorFactory: behavior.factory });
    runtime.send({ type: 'interrupt_behavior', placementKey: 'cove-pip', reason: 'dialogue' });
    runtime.send({ type: 'interrupt_behavior', placementKey: 'cove-pip', reason: 'dialogue' });
    expect(behavior.controller.interrupt).toHaveBeenCalledTimes(1);
    expect(behavior.controller.interrupt).toHaveBeenCalledWith('dialogue');
    runtime.send({ type: 'resume_behavior', placementKey: 'cove-pip' });
    runtime.send({ type: 'resume_behavior', placementKey: 'cove-pip' });
    expect(behavior.controller.resume).toHaveBeenCalledTimes(1);
  });

  it('react asks the behaviour for the reaction and plays it', async () => {
    const behavior = fakeBehavior();
    const { runtime, events } = await loaded({ behaviorFactory: behavior.factory });
    runtime.send({ type: 'react', event: 'answer.correct' });
    expect(behavior.controller.react).toHaveBeenCalledWith('answer.correct');
    for (let i = 0; i < 20; i += 1) runtime.update(1 / 30, null);
    expect(events).toContainEqual({
      type: 'npc.animation_finished',
      placementKey: 'cove-pip',
      state: 'wave',
    });
  });

  it('the built-in controller plays configured reactions only', async () => {
    const ctx = setup();
    ctx.runtime.mount([
      spawn({
        behavior: {
          key: 'cheer',
          type: 'stationary',
          parameters: { boundsRadius: 15, reactions: { 'answer.correct': 'wave' } },
        },
      }),
    ]);
    ctx.runtime.send({ type: 'react', event: 'answer.incorrect' });
    ctx.runtime.send({ type: 'react', event: 'answer.correct', placementKey: 'cove-pip' });
    for (let i = 0; i < 30; i += 1) ctx.runtime.update(1 / 30, null);
    const finished = ctx.events.filter((e) => e.type === 'npc.animation_finished');
    expect(finished).toEqual([
      { type: 'npc.animation_finished', placementKey: 'cove-pip', state: 'wave' },
    ]);
  });

  it('face turns toward the player, snapping under reduced motion', () => {
    const smooth = setup();
    smooth.runtime.mount([spawn()]);
    smooth.runtime.send({ type: 'face', placementKey: 'cove-pip', target: 'player' });
    smooth.runtime.update(0.1, { x: 10, z: 0 });
    const turned = smooth.runtime.rootOf('cove-pip')!.rotation.y;
    expect(turned).toBeGreaterThan(0);
    expect(turned).toBeLessThan(Math.PI / 2);

    const still = setup({ reducedMotion: () => true });
    still.runtime.mount([spawn()]);
    still.runtime.send({ type: 'face', placementKey: 'cove-pip', target: { yaw: 1 } });
    still.runtime.update(0.016, null);
    expect(still.runtime.rootOf('cove-pip')!.rotation.y).toBeCloseTo(1);
    still.runtime.send({ type: 'resume_behavior', placementKey: 'cove-pip' });
    still.runtime.update(0.016, null);
    // Back under the behaviour's own facing (home).
    expect(still.runtime.rootOf('cove-pip')!.rotation.y).toBeLessThan(1);
  });

  it('the built-in controller faces a nearby player when facePlayer is set', () => {
    const ctx = setup();
    ctx.runtime.mount([
      spawn({
        behavior: {
          key: 'greeter',
          type: 'stationary',
          parameters: { boundsRadius: 15, reactions: {}, facePlayer: true },
        },
      }),
    ]);
    for (let i = 0; i < 30; i += 1) ctx.runtime.update(1 / 30, { x: 0, z: -3 });
    expect(Math.abs(ctx.runtime.rootOf('cove-pip')!.rotation.y)).toBeCloseTo(Math.PI);
  });

  it('placeholder bob stays still under reduced motion', () => {
    const ctx = setup({ reducedMotion: () => true });
    ctx.runtime.mount([spawn()]);
    for (let i = 0; i < 10; i += 1) ctx.runtime.update(1 / 30, null);
    const placeholder = ctx.runtime.rootOf('cove-pip')!.children[0];
    expect(placeholder.position.y).toBe(DEFAULT_PLACEHOLDER.height / 2);
    const moving = setup();
    moving.runtime.mount([spawn()]);
    for (let i = 0; i < 10; i += 1) moving.runtime.update(1 / 30, null);
    expect(moving.runtime.rootOf('cove-pip')!.children[0].position.y).not.toBe(
      DEFAULT_PLACEHOLDER.height / 2,
    );
  });
});

describe('dispose', () => {
  it('aborts loads, detaches roots, disposes owned placeholders, and is idempotent', async () => {
    const { parent, runtime, events, calls } = setup();
    runtime.mount([spawn()]);
    const placeholder = runtime.rootOf('cove-pip')!.children[0] as Mesh;
    const geometryDispose = vi.spyOn(placeholder.geometry, 'dispose');
    runtime.dispose();
    runtime.dispose();
    expect(calls[0].signal.aborted).toBe(true);
    expect(parent.children).toEqual([]);
    expect(geometryDispose).toHaveBeenCalledTimes(1);
    calls[0].resolve(modelWithClips());
    await flush();
    runtime.update(0.016, { x: 0, z: 0 });
    runtime.mount([spawn()]);
    runtime.send({ type: 'animate', placementKey: 'cove-pip', state: 'wave' });
    expect(runtime.requestInteract('cove-pip', 'pointer')).toBe(false);
    expect(runtime.placements()).toEqual([]);
    expect(events).toEqual([]);
  });

  it('never disposes the shared model geometry', async () => {
    const { runtime, calls } = setup();
    runtime.mount([spawn()]);
    const model = modelWithClips();
    const mesh = new Mesh();
    model.scene.add(mesh);
    const dispose = vi.spyOn(mesh.geometry, 'dispose');
    calls[0].resolve(model);
    await flush();
    runtime.dispose();
    expect(dispose).not.toHaveBeenCalled();
  });
});
