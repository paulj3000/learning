import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  AnimationClip,
  Box3,
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  type PerspectiveCamera,
  type Scene,
  Vector3,
} from 'three';
import {
  createLocationEngine,
  type LocationEngineDeps,
  type LoadedModel,
} from './createLocationEngine';
import { createWorldExtensionRegistry, type WorldExtension } from './extensionRegistry';
import { WELCOME_HARBOR_MANIFEST } from './manifests/welcomeHarbor';
import type { ThreeLocationManifest } from './locationManifest';
import type { FirstPersonController } from '../firstPersonController';
import { WorldEngineEventBus, type WorldEngineEventMap } from '../worldEngineEvents';

/**
 * The generic runtime driven entirely through injected fakes: a renderer
 * that records `render` calls, assets that resolve to simple boxes, manual
 * frame stepping and a manual clock, and "controls" that let each test move
 * the player directly. Everything else (scene graph, colliders, raycasts,
 * triggers, disposal) is the real code. Covers the world-runtime acceptance
 * tests in `docs/engine/11_ACCEPTANCE_TESTS.md` (W1 to W7, AS3, B4).
 */

/** A 1.8 m tall box standing on the ground, so an eye-height ray hits it. */
function standingBox(): LoadedModel {
  const geometry = new BoxGeometry(0.6, 1.8, 0.6);
  geometry.translate(0, 0.9, 0);
  return {
    scene: new Mesh(geometry, new MeshBasicMaterial()),
    animations: [new AnimationClip('Idle', 1, [])],
  };
}

type Drive = (controller: FirstPersonController, deltaSeconds: number) => void;

interface Harness {
  engine: ReturnType<typeof createLocationEngine>;
  parent: HTMLDivElement;
  deps: LocationEngineDeps<FakeRenderer>;
  renderer: FakeRenderer;
  controls: { update: Mock<(deltaSeconds: number) => void>; dispose: Mock<() => void> };
  stopFitting: Mock<() => void>;
  events: { name: keyof WorldEngineEventMap; detail: unknown }[];
  runFrames(count: number, milliseconds?: number): void;
  setDrive(drive: Drive): void;
  pressInteractKey(): void;
  camera(): PerspectiveCamera;
  scene(): Scene;
}

interface FakeRenderer {
  domElement: HTMLCanvasElement;
  setSize: Mock<(width: number, height: number) => void>;
  render: Mock<(scene: Scene, camera: PerspectiveCamera) => void>;
  dispose: Mock<() => void>;
}

function mount(
  options: {
    manifest?: ThreeLocationManifest;
    startCheckpointId?: string;
    loadModel?: (assetId: string) => Promise<LoadedModel>;
    extensions?: readonly WorldExtension[];
    parent?: HTMLDivElement;
  } = {},
): Harness {
  const parent = options.parent ?? document.createElement('div');
  const queued: (() => void)[] = [];
  let handle = 0;
  let clock = 0;
  let drive: Drive = () => undefined;
  let onInteract: () => void = () => undefined;
  let controller: FirstPersonController | null = null;

  const renderer: FakeRenderer = {
    domElement: document.createElement('canvas'),
    setSize: vi.fn<(width: number, height: number) => void>(),
    render: vi.fn<(scene: Scene, camera: PerspectiveCamera) => void>(),
    dispose: vi.fn<() => void>(),
  };
  const controls = {
    update: vi.fn((delta: number) => {
      if (controller) drive(controller, delta);
    }),
    dispose: vi.fn<() => void>(),
  };
  const stopFitting = vi.fn<() => void>();
  const deps: LocationEngineDeps<FakeRenderer> = {
    createRenderer: () => renderer,
    assets: {
      loadModel: options.loadModel ?? (async () => standingBox()),
      instanced: vi.fn(async () => new Mesh(new BoxGeometry(), new MeshBasicMaterial())),
      withLod: vi.fn(async () => new Group()),
    },
    attachControls: (_renderer, attached, attachOptions) => {
      controller = attached;
      onInteract = attachOptions.onInteract;
      return controls;
    },
    fitToParent: () => stopFitting,
    requestFrame: (callback) => {
      queued.push(callback);
      handle += 1;
      return handle;
    },
    cancelFrame: vi.fn(),
    now: () => clock,
    extensions: createWorldExtensionRegistry(options.extensions ?? []),
  };

  const bus = new WorldEngineEventBus();
  const events: Harness['events'] = [];
  for (const name of [
    'NpcApproached',
    'InteractableFocused',
    'PlayerEnteredZone',
    'ObjectInteracted',
    'CollectiblePickedUp',
  ] as const) {
    bus.on(name, (detail) => events.push({ name, detail }));
  }

  const engine = createLocationEngine(
    parent,
    bus,
    options.manifest ?? WELCOME_HARBOR_MANIFEST,
    { startCheckpointId: options.startCheckpointId },
    deps,
  );

  const lastRender = () => {
    const call = renderer.render.mock.calls.at(-1);
    if (!call) throw new Error('nothing rendered yet');
    return call;
  };

  return {
    engine,
    parent,
    deps,
    renderer,
    controls,
    stopFitting,
    events,
    runFrames(count, milliseconds = 16) {
      for (let index = 0; index < count; index += 1) {
        clock += milliseconds;
        queued.shift()?.();
      }
    },
    setDrive(next) {
      drive = next;
    },
    pressInteractKey: () => onInteract(),
    camera: () => lastRender()[1],
    scene: () => lastRender()[0],
  };
}

/** Puts the player at a spot facing a direction, without walking there. */
function standAt(x: number, z: number, yaw: number): Drive {
  return (controller) => {
    controller.position.set(x, 0, z);
    controller.yaw = yaw;
    controller.pitch = 0;
  };
}

function walk(yaw: number): Drive {
  return (controller, delta) => {
    controller.yaw = yaw;
    controller.update(delta, { forward: 1, strafe: 0 });
  };
}

const named = (events: Harness['events'], name: keyof WorldEngineEventMap) =>
  events.filter((event) => event.name === name).map((event) => event.detail);

/** Heights of what stands at Pip's spot: 0.6 is the placeholder box, 1.8 the loaded model. */
function pipChildHeights(scene: Scene): number[] {
  const pip = scene.getObjectByName('Pip');
  if (!pip) throw new Error('Pip is not in the scene');
  return pip.children.map((child) => ((child as Mesh).geometry as BoxGeometry).parameters.height);
}

/** yaw 0 faces +Z and PI faces -Z (`firstPersonController.ts`). */
const FACE_SOUTH = Math.PI;
const FACE_NORTH = 0;

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  warn.mockRestore();
});

describe('createLocationEngine: spawn and checkpoints', () => {
  it('spawns a first-time child at the region’s first authored checkpoint (W1)', () => {
    const harness = mount();
    harness.runFrames(1);
    expect(harness.camera().position.toArray()).toEqual([0, 1.6, 8]);
  });

  it('spawns a returning child at their saved checkpoint', () => {
    const harness = mount({ startCheckpointId: 'welcome-harbor:shed' });
    harness.runFrames(1);
    expect(harness.camera().position.toArray()).toEqual([7, 1.6, -3]);
  });

  it('ignores a saved checkpoint from another region', () => {
    const harness = mount({ startCheckpointId: 'pirate-builder-bay:dock' });
    harness.runFrames(1);
    expect(harness.camera().position.toArray()).toEqual([0, 1.6, 8]);
  });

  it('reports the authored checkpoint id it stands in, for the view to save (W2)', () => {
    const harness = mount();
    harness.runFrames(2);
    expect(named(harness.events, 'PlayerEnteredZone')).toEqual([{ zoneId: 'welcome-harbor:dock' }]);
  });
});

describe('createLocationEngine: movement, collision and zones', () => {
  it('stops the player at the manifest boundary (W3)', () => {
    const harness = mount();
    harness.setDrive(walk(FACE_NORTH));
    harness.runFrames(400);
    const z = harness.camera().position.z;
    expect(z).toBeLessThan(12);
    expect(z).toBeGreaterThan(11);
  });

  it('lets the player through a doorway, fires the interior zone, then stops at the back wall (W4)', () => {
    const harness = mount({ startCheckpointId: 'welcome-harbor:lookout' });
    harness.setDrive(walk(FACE_SOUTH));
    harness.runFrames(200);
    expect(named(harness.events, 'PlayerEnteredZone')).toEqual([
      { zoneId: 'welcome-harbor:lookout' },
      { zoneId: 'lookout-tower:interior' },
    ]);
    expect(harness.camera().position.z).toBeGreaterThan(-7.8);
  });

  it('reports approaching an NPC once as the player walks past (W5)', () => {
    const harness = mount();
    harness.setDrive(walk(FACE_SOUTH));
    harness.runFrames(400);
    expect(named(harness.events, 'NpcApproached')).toEqual([{ entityId: 'pirate-pip' }]);
  });
});

describe('createLocationEngine: focus and interaction', () => {
  it('focuses and interacts with an NPC by its semantic entity id (W6)', async () => {
    const harness = mount();
    await harness.engine.ready;
    harness.setDrive(standAt(1.5, 1, FACE_SOUTH));
    harness.runFrames(1);
    expect(named(harness.events, 'InteractableFocused')).toEqual([{ entityId: 'pirate-pip' }]);

    harness.engine.interact();
    harness.pressInteractKey();
    expect(named(harness.events, 'ObjectInteracted')).toEqual([
      { entityId: 'pirate-pip', interactionId: 'pirate-pip:talk' },
      { entityId: 'pirate-pip', interactionId: 'pirate-pip:talk' },
    ]);
  });

  it('picks a collectible up once and removes it from the world', async () => {
    const harness = mount();
    await harness.engine.ready;
    harness.setDrive(standAt(-1.5, -1, FACE_SOUTH));
    harness.runFrames(1);
    expect(named(harness.events, 'InteractableFocused')).toEqual([
      { entityId: 'harbor-collectible-gem' },
    ]);

    harness.engine.interact();
    harness.engine.interact();
    harness.runFrames(1);
    expect(named(harness.events, 'CollectiblePickedUp')).toEqual([
      { entityId: 'harbor-collectible-gem' },
    ]);
    expect(named(harness.events, 'InteractableFocused').at(-1)).toEqual({ entityId: null });
  });

  it('does nothing when interacting with empty air', async () => {
    const harness = mount();
    await harness.engine.ready;
    harness.setDrive(standAt(0, 8, FACE_NORTH));
    harness.runFrames(1);
    harness.engine.interact();
    expect(named(harness.events, 'ObjectInteracted')).toEqual([]);
  });
});

describe('createLocationEngine: assets', () => {
  it('keeps an NPC’s placeholder when its model fails to load, without failing the region (AS3)', async () => {
    const harness = mount({
      loadModel: async (assetId) => {
        if (assetId === 'npc-pip') throw new Error('404');
        return standingBox();
      },
    });
    await expect(harness.engine.ready).resolves.toBeUndefined();
    harness.runFrames(1);
    expect(pipChildHeights(harness.scene())).toEqual([0.6]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('npc pirate-pip'), expect.any(Error));
  });

  it('swaps the placeholder for the loaded model once it resolves', async () => {
    const harness = mount();
    await harness.engine.ready;
    harness.runFrames(1);
    expect(pipChildHeights(harness.scene())).toEqual([1.8]);
  });

  it('builds every scenery kind from the manifest', async () => {
    const harness = mount();
    await harness.engine.ready;
    // Ground, rocks, bushes, fence and the three building pieces are instanced; trees are LOD.
    expect(harness.deps.assets.instanced).toHaveBeenCalledWith('ground-tile', expect.any(Array));
    expect(harness.deps.assets.instanced).toHaveBeenCalledWith('wall', expect.any(Array));
    expect(harness.deps.assets.instanced).toHaveBeenCalledWith('fence', expect.any(Array));
    expect(harness.deps.assets.withLod).toHaveBeenCalledTimes(3);
  });
});

describe('createLocationEngine: ambient movers', () => {
  it('moves an ambient creature along its loop', () => {
    const harness = mount();
    harness.runFrames(1);
    const scene = harness.scene();
    const gull = scene.children.find(
      (child: Object3D) =>
        child instanceof Group && child.children[0] instanceof Mesh && child.position.y > 3,
    );
    const before = gull?.position.clone();
    harness.runFrames(30);
    expect(gull).toBeDefined();
    expect(gull?.position.equals(before!)).toBe(false);
  });
});

describe('createLocationEngine: extensions', () => {
  it('mounts a declared extension by id with its config, and cleans it up once (B4)', () => {
    const cleanup = vi.fn();
    const onFrame = vi.fn();
    const extension: WorldExtension = {
      id: 'test-bell',
      mount: vi.fn((context) => {
        context.onFrame(onFrame);
        return cleanup;
      }),
    };
    const harness = mount({
      manifest: {
        ...WELCOME_HARBOR_MANIFEST,
        extensions: [{ extensionId: 'test-bell', config: { rings: 3 } }],
      },
      extensions: [extension],
    });
    expect(extension.mount).toHaveBeenCalledWith(expect.objectContaining({ config: { rings: 3 } }));
    harness.runFrames(3);
    expect(onFrame).toHaveBeenCalledTimes(3);

    harness.engine.dispose();
    harness.engine.dispose();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('lets an extension add a collider the player cannot pass', () => {
    const harness = mount({
      manifest: {
        ...WELCOME_HARBOR_MANIFEST,
        extensions: [{ extensionId: 'test-gate', config: {} }],
      },
      extensions: [
        {
          id: 'test-gate',
          mount: (context) => {
            context.addCollider(new Box3(new Vector3(-3, -1, 9.5), new Vector3(3, 3, 10.5)));
          },
        },
      ],
    });
    harness.setDrive(walk(FACE_NORTH));
    harness.runFrames(200);
    expect(harness.camera().position.z).toBeLessThan(9.5);
  });

  it('skips an unknown extension instead of failing the region', () => {
    const harness = mount({
      manifest: {
        ...WELCOME_HARBOR_MANIFEST,
        extensions: [{ extensionId: 'not-registered', config: {} }],
      },
    });
    harness.runFrames(1);
    expect(harness.renderer.render).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('not-registered'));
  });
});

describe('createLocationEngine: cleanup (W7)', () => {
  it('stops the loop and releases the renderer, input and resize observer', () => {
    const harness = mount();
    harness.runFrames(3);
    const renders = harness.renderer.render.mock.calls.length;

    harness.engine.dispose();
    expect(harness.deps.cancelFrame).toHaveBeenCalled();
    expect(harness.controls.dispose).toHaveBeenCalledTimes(1);
    expect(harness.stopFitting).toHaveBeenCalledTimes(1);
    expect(harness.renderer.dispose).toHaveBeenCalledTimes(1);
    expect(harness.parent.contains(harness.renderer.domElement)).toBe(false);

    harness.runFrames(5);
    expect(harness.renderer.render.mock.calls.length).toBe(renders);
  });

  it('leaves nothing behind across repeated mounts in the same container', () => {
    const parent = document.createElement('div');
    for (let round = 0; round < 3; round += 1) {
      const harness = mount({ parent });
      harness.runFrames(2);
      expect(parent.children).toHaveLength(1);
      harness.engine.dispose();
      expect(parent.children).toHaveLength(0);
    }
  });

  it('does not add a model that finishes loading after dispose', async () => {
    let resolveModel: (model: LoadedModel) => void = () => undefined;
    const harness = mount({
      loadModel: (assetId) =>
        assetId === 'npc-pip'
          ? new Promise<LoadedModel>((resolve) => {
              resolveModel = resolve;
            })
          : Promise.resolve(standingBox()),
    });
    harness.runFrames(1);
    const pip = harness.scene().getObjectByName('Pip');
    harness.engine.dispose();
    resolveModel(standingBox());
    await harness.engine.ready;
    expect(pip?.children).toHaveLength(1);
    expect(harness.scene().children).toHaveLength(0);
  });
});
