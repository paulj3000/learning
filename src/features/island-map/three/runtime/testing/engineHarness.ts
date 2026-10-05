import { vi, type Mock } from 'vitest';
import {
  AnimationClip,
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  type PerspectiveCamera,
  type Scene,
} from 'three';
import {
  createLocationEngine,
  type LocationEngineDeps,
  type LoadedModel,
} from '../createLocationEngine';
import { createWorldExtensionRegistry, type WorldExtension } from '../extensionRegistry';
import { WELCOME_HARBOR_MANIFEST } from '../manifests/welcomeHarbor';
import type { ThreeLocationManifest } from '../locationManifest';
import type { FirstPersonController } from '../../firstPersonController';
import type { WorldInteractionContext } from '../../../worldObjects';
import { WorldEngineEventBus, type WorldEngineEventMap } from '../../worldEngineEvents';

/**
 * Test-only harness for `createLocationEngine`: a renderer that records
 * `render` calls, assets that resolve to simple boxes, manual frame stepping
 * and a manual clock, and "controls" that let each test move the player
 * directly. Everything else (scene graph, colliders, raycasts, triggers,
 * disposal) is the real runtime. Never imported by production code.
 */

/** A 1.8 m tall box standing on the ground, so an eye-height ray hits it. */
export function standingBox(): LoadedModel {
  const geometry = new BoxGeometry(0.6, 1.8, 0.6);
  geometry.translate(0, 0.9, 0);
  return {
    scene: new Mesh(geometry, new MeshBasicMaterial()),
    animations: [new AnimationClip('Idle', 1, [])],
  };
}

export type Drive = (controller: FirstPersonController, deltaSeconds: number) => void;

export interface Harness {
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

export interface FakeRenderer {
  domElement: HTMLCanvasElement;
  setSize: Mock<(width: number, height: number) => void>;
  render: Mock<(scene: Scene, camera: PerspectiveCamera) => void>;
  dispose: Mock<() => void>;
}

export function mount(
  options: {
    manifest?: ThreeLocationManifest;
    startCheckpointId?: string;
    loadModel?: (assetId: string) => Promise<LoadedModel>;
    extensions?: readonly WorldExtension[];
    parent?: HTMLDivElement;
    worldState?: WorldInteractionContext;
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
    { startCheckpointId: options.startCheckpointId, worldState: options.worldState },
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
export function standAt(x: number, z: number, yaw: number): Drive {
  return (controller) => {
    controller.position.set(x, 0, z);
    controller.yaw = yaw;
    controller.pitch = 0;
  };
}

export function walk(yaw: number): Drive {
  return (controller, delta) => {
    controller.yaw = yaw;
    controller.update(delta, { forward: 1, strafe: 0 });
  };
}

export const named = (events: Harness['events'], name: keyof WorldEngineEventMap) =>
  events.filter((event) => event.name === name).map((event) => event.detail);

/** Heights of what stands at Pip's spot: 0.6 is the placeholder box, 1.8 the loaded model. */
export function pipChildHeights(scene: Scene): number[] {
  const pip = scene.getObjectByName('Pip');
  if (!pip) throw new Error('Pip is not in the scene');
  return pip.children.map((child) => ((child as Mesh).geometry as BoxGeometry).parameters.height);
}

/** yaw 0 faces +Z and PI faces -Z (`firstPersonController.ts`). */
export const FACE_SOUTH = Math.PI;
export const FACE_NORTH = 0;
