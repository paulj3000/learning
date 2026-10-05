import {
  AmbientLight,
  AnimationMixer,
  Box3,
  BoxGeometry,
  CatmullRomCurve3,
  Color,
  ConeGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
  type AnimationClip,
  type BufferGeometry,
  type Camera,
  type Material,
  type Object3D,
} from 'three';
import {
  createInstancedMeshFromAsset,
  instantiateWithLod,
  loadAsset,
  type InstancePlacement,
} from '../assets/assetLoader';
import { ALL_CHECKPOINTS, resolveSpawnCheckpoint } from '../../../discovery/checkpoints';
import { FirstPersonController } from '../firstPersonController';
import { attachPointerControls, type PointerControls } from '../pointerControls';
import {
  APPROACH_RANGE_METERS,
  EYE_HEIGHT,
  fitRendererToParent,
  RAYCAST_RANGE_METERS,
  runPlacements,
} from '../sceneKit';
import type { ThreeEngineHandle } from '../ThreeGameContainer';
import type { WorldEngineEventBus } from '../worldEngineEvents';
import {
  SOURCE_WORLD_EXTENSIONS,
  type WorldExtensionCleanup,
  type WorldExtensionRegistry,
} from './extensionRegistry';
import type { ScenerySpec, ThreeLocationManifest } from './locationManifest';
import {
  buildingDoorPlacement,
  buildingRoofPlacement,
  buildingWallPlacements,
  solidColliders,
  tiledGroundPlacements,
  triggerVolumes,
  type BoxBounds,
} from './sceneLayout';
import { WorldTriggerTracker } from './worldTriggerTracker';

/**
 * The generic Three.js location runtime (`docs/engine/03_GENERIC_3D_WORLD_RUNTIME.md`,
 * `docs/engine/10_IMPLEMENTATION_PHASES.md` Phase 3). One function that
 * turns any `ThreeLocationManifest` into a walkable first-person scene,
 * replacing the skeleton each `*Scene.ts` repeats: bootstrap, colliders,
 * controller and spawn, scenery, NPCs, collectibles, ambient movers,
 * raycast focus and interact, edge-triggered events, frame loop, disposal.
 *
 * It never branches on a location slug or region id. Everything
 * region-specific comes from the manifest, and anything bespoke comes from
 * an extension the manifest names (`extensionRegistry.ts`).
 *
 * Its browser- and network-facing pieces (renderer, asset loading, input,
 * resize, frame scheduling) are injected through `LocationEngineDeps`, so
 * the whole runtime is testable in jsdom with fakes;
 * `DEFAULT_LOCATION_ENGINE_DEPS` wires the real ones.
 *
 * Disposal frees only what this runtime created (primitive geometries and
 * materials, instanced-mesh geometry clones). Loaded glTF geometry and
 * materials belong to `assetLoader.ts`'s cache, which is shared across
 * mounts, so disposing them here would break the next visit.
 */

/** The parts of `WebGLRenderer` the runtime uses. */
export interface RendererLike {
  readonly domElement: HTMLElement;
  setSize(width: number, height: number): void;
  render(scene: Scene, camera: Camera): void;
  dispose(): void;
}

export interface LoadedModel {
  scene: Object3D;
  animations: readonly AnimationClip[];
}

export interface LocationEngineAssets {
  /** Resolves a shared, cached model; the runtime clones `scene` before placing it. */
  loadModel(assetId: string): Promise<LoadedModel>;
  /** One instanced draw call of `assetId` at every placement. */
  instanced(assetId: string, placements: readonly InstancePlacement[]): Promise<Object3D>;
  /** A fresh, LOD-aware copy of `assetId`. */
  withLod(assetId: string): Promise<Object3D>;
}

export interface LocationEngineDeps<R extends RendererLike> {
  createRenderer(): R;
  assets: LocationEngineAssets;
  attachControls(
    renderer: R,
    controller: FirstPersonController,
    options: { onInteract: () => void },
  ): PointerControls;
  /** Keeps the renderer and camera sized to `parent`. Returns the disconnect. */
  fitToParent(parent: HTMLElement, camera: PerspectiveCamera, renderer: R): () => void;
  requestFrame(callback: () => void): number;
  cancelFrame(handle: number): void;
  /** Milliseconds, monotonic. */
  now(): number;
  extensions: WorldExtensionRegistry;
}

export const DEFAULT_LOCATION_ENGINE_DEPS: LocationEngineDeps<WebGLRenderer> = {
  createRenderer: () => new WebGLRenderer({ antialias: true }),
  assets: {
    loadModel: (assetId) => loadAsset(assetId),
    instanced: (assetId, placements) => createInstancedMeshFromAsset(assetId, placements),
    withLod: (assetId) => instantiateWithLod(assetId),
  },
  attachControls: (renderer, controller, options) =>
    attachPointerControls(renderer, controller, options),
  fitToParent: (parent, camera, renderer) => fitRendererToParent(parent, camera, renderer),
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (handle) => cancelAnimationFrame(handle),
  now: () => performance.now(),
  extensions: SOURCE_WORLD_EXTENSIONS,
};

export interface LocationEngine extends ThreeEngineHandle {
  /** Raycasts from the screen centre and acts on whatever interactive entity is there. */
  interact(): void;
  /** Settles once every asynchronously loaded piece has been placed or has failed. Never rejects. */
  readonly ready: Promise<void>;
}

export interface LocationEngineOptions {
  /** The child's last saved checkpoint (`ChildWorldState.lastCheckpointId`), if any. */
  startCheckpointId?: string;
}

/** The outdoor rig `sceneKit.createSceneBootstrap` defaults to; manifest lighting overrides per field. */
const DEFAULT_LIGHTING = {
  ambientIntensity: 0.65,
  sunIntensity: 0.8,
  sunPosition: { x: 8, y: 14, z: 6 },
};

/** Placeholder stand-in size for an NPC whose model has not loaded (as every region used). */
const NPC_PLACEHOLDER_SIZE = { width: 0.4, height: 0.6, depth: 0.2 };
/** Frames longer than this (a background tab) are clamped so the player cannot tunnel through walls. */
const MAX_FRAME_SECONDS = 0.1;

type EntityKind = 'NPC' | 'COLLECTIBLE';

interface FocusTarget {
  entityId: string;
  kind: EntityKind;
  root: Object3D;
}

function toBox3(bounds: BoxBounds): Box3 {
  return new Box3(
    new Vector3(bounds.minX, bounds.minY, bounds.minZ),
    new Vector3(bounds.maxX, bounds.maxY, bounds.maxZ),
  );
}

export function createLocationEngine<R extends RendererLike>(
  parent: HTMLElement,
  bus: WorldEngineEventBus,
  manifest: ThreeLocationManifest,
  options: LocationEngineOptions,
  deps: LocationEngineDeps<R>,
): LocationEngine {
  let disposed = false;
  const ownedGeometries: BufferGeometry[] = [];
  const ownedMaterials: Material[] = [];
  const mixers: AnimationMixer[] = [];
  const frameCallbacks = new Set<(deltaSeconds: number) => void>();
  const extensionCleanups: WorldExtensionCleanup[] = [];

  function ownMesh(geometry: BufferGeometry, material: Material): Mesh {
    ownedGeometries.push(geometry);
    ownedMaterials.push(material);
    return new Mesh(geometry, material);
  }

  // Scene, camera, lights, renderer.
  const scene = new Scene();
  scene.background = new Color(manifest.environment.backgroundColor);
  const camera = new PerspectiveCamera(
    70,
    parent.clientWidth > 0 && parent.clientHeight > 0
      ? parent.clientWidth / parent.clientHeight
      : 1,
    0.1,
    150,
  );
  camera.rotation.order = 'YXZ';
  const lighting = { ...DEFAULT_LIGHTING, ...manifest.environment.lighting };
  scene.add(new AmbientLight(0xffffff, lighting.ambientIntensity));
  const sun = new DirectionalLight(0xffffff, lighting.sunIntensity);
  sun.position.set(lighting.sunPosition.x, lighting.sunPosition.y, lighting.sunPosition.z);
  scene.add(sun);

  const renderer = deps.createRenderer();
  renderer.setSize(parent.clientWidth, parent.clientHeight);
  parent.appendChild(renderer.domElement);

  // Movement: colliders, controller, spawn at an authored checkpoint.
  const colliders = solidColliders(manifest).map(toBox3);
  const controller = new FirstPersonController({ colliders });
  const spawn = resolveSpawnCheckpoint(manifest.regionId, options.startCheckpointId);
  controller.position.set(spawn.x, 0, spawn.z);
  controller.yaw = spawn.yaw;

  // Interactive entities, each under its own root group so a model swap
  // never changes what the raycast targets.
  const focusTargets: FocusTarget[] = [];
  const pending: Promise<void>[] = [];

  function track(work: Promise<void>, what: string): void {
    pending.push(
      work.catch((error: unknown) => {
        // A missing optional asset leaves its placeholder (or nothing) in
        // place rather than breaking the region (acceptance AS3).
        console.warn(`[location ${manifest.regionId}] could not place ${what}`, error);
      }),
    );
  }

  function addWhenLive(object: Object3D, into: Object3D = scene): boolean {
    if (disposed) return false;
    into.add(object);
    return true;
  }

  function playIdle(model: Object3D, animations: readonly AnimationClip[], clip?: string): void {
    if (!clip) return;
    const idle = animations.find((candidate) => candidate.name === clip);
    if (!idle) return;
    const mixer = new AnimationMixer(model);
    mixer.clipAction(idle).play();
    mixers.push(mixer);
  }

  for (const npc of manifest.npcs) {
    const root = new Group();
    root.name = npc.label;
    root.position.set(npc.position.x, 0, npc.position.z);
    root.rotation.y = npc.yaw ?? 0;
    const placeholder = ownMesh(
      new BoxGeometry(
        NPC_PLACEHOLDER_SIZE.width,
        NPC_PLACEHOLDER_SIZE.height,
        NPC_PLACEHOLDER_SIZE.depth,
      ),
      new MeshStandardMaterial({ color: npc.placeholderColor }),
    );
    placeholder.position.y = NPC_PLACEHOLDER_SIZE.height / 2;
    root.add(placeholder);
    scene.add(root);
    focusTargets.push({ entityId: npc.entityId, kind: 'NPC', root });

    track(
      deps.assets.loadModel(npc.assetId).then(({ scene: source, animations }) => {
        const model = source.clone(true);
        if (!addWhenLive(model, root)) return;
        // Removed, not hidden: a raycast does not skip invisible meshes.
        root.remove(placeholder);
        playIdle(model, animations, npc.idleClip);
      }),
      `npc ${npc.entityId}`,
    );
  }

  for (const collectible of manifest.collectibles) {
    const root = new Group();
    root.name = collectible.label;
    root.position.set(collectible.position.x, 0, collectible.position.z);
    scene.add(root);
    focusTargets.push({ entityId: collectible.entityId, kind: 'COLLECTIBLE', root });

    track(
      deps.assets.loadModel(collectible.assetId).then(({ scene: source, animations }) => {
        const model = source.clone(true);
        if (!addWhenLive(model, root)) return;
        playIdle(model, animations, collectible.idleClip);
      }),
      `collectible ${collectible.entityId}`,
    );
  }

  // Buildings: one instanced draw call per kit piece across every building.
  const placementsByAsset = new Map<string, InstancePlacement[]>();
  const addPlacements = (assetId: string, placements: readonly InstancePlacement[]) => {
    placementsByAsset.set(assetId, [...(placementsByAsset.get(assetId) ?? []), ...placements]);
  };
  for (const building of manifest.buildings) {
    addPlacements(building.wallAssetId, buildingWallPlacements(building));
    if (building.roofAssetId)
      addPlacements(building.roofAssetId, [buildingRoofPlacement(building)]);
    const door = buildingDoorPlacement(building);
    if (building.doorAssetId && door) addPlacements(building.doorAssetId, [door]);
  }
  for (const [assetId, placements] of placementsByAsset) {
    track(placeInstanced(assetId, placements), `building piece ${assetId}`);
  }

  async function placeInstanced(
    assetId: string,
    placements: readonly InstancePlacement[],
  ): Promise<void> {
    if (placements.length === 0) return;
    const instanced = await deps.assets.instanced(assetId, placements);
    if (!addWhenLive(instanced)) return;
    // The loader clones geometry per instanced mesh; the material stays shared with the cache.
    if (instanced instanceof Mesh) ownedGeometries.push(instanced.geometry);
  }

  function buildScenery(item: ScenerySpec): void {
    switch (item.kind) {
      case 'TILED_GROUND': {
        const tiles = tiledGroundPlacements(item.area, item.tileSize).map((tile) => ({
          position: { x: tile.x, y: 0, z: tile.z },
        }));
        track(placeInstanced(item.assetId, tiles), `scenery ${item.id}`);
        return;
      }
      case 'FLAT_PLANE': {
        const width = item.area.maxX - item.area.minX;
        const depth = item.area.maxZ - item.area.minZ;
        const plane = ownMesh(
          new PlaneGeometry(width, depth),
          new MeshStandardMaterial({ color: item.color, side: DoubleSide }),
        );
        plane.rotation.x = -Math.PI / 2;
        plane.position.set(item.area.minX + width / 2, item.y, item.area.minZ + depth / 2);
        scene.add(plane);
        return;
      }
      case 'CLUSTER': {
        const placements = item.positions.map((position) => ({
          position: { x: position.x, y: position.y ?? 0, z: position.z },
          rotationY: position.rotationY,
        }));
        track(placeInstanced(item.assetId, placements), `scenery ${item.id}`);
        return;
      }
      case 'LOD_PLACEMENTS':
        for (const position of item.positions) {
          track(
            deps.assets.withLod(item.assetId).then((object) => {
              object.position.set(position.x, position.y ?? 0, position.z);
              object.rotation.y = position.rotationY ?? 0;
              addWhenLive(object);
            }),
            `scenery ${item.id}`,
          );
        }
        return;
      case 'RUN':
        track(
          placeInstanced(item.assetId, runPlacements(item.from, item.to, item.segmentLength)),
          `scenery ${item.id}`,
        );
        return;
    }
  }
  manifest.scenery.forEach(buildScenery);

  // Ambient movers: decorative, never raycast-interactive, never emit events.
  for (const ambient of manifest.ambient) {
    const path = new CatmullRomCurve3(
      ambient.path.map((point) => new Vector3(point.x, point.y, point.z)),
      true,
    );
    const mover = new Group();
    scene.add(mover);
    const appearance = ambient.appearance;
    if ('primitive' in appearance) {
      const cone = ownMesh(
        new ConeGeometry(0.25, 0.9, 4),
        new MeshStandardMaterial({ color: appearance.color }),
      );
      // Point the cone's tip along the mover's forward (+Z), which `lookAt` aims.
      cone.rotation.x = Math.PI / 2;
      mover.add(cone);
    } else {
      track(
        deps.assets.loadModel(appearance.assetId).then(({ scene: source }) => {
          addWhenLive(source.clone(true), mover);
        }),
        `ambient ${ambient.id}`,
      );
    }
    let t = 0;
    frameCallbacks.add((deltaSeconds) => {
      t = (t + deltaSeconds * ambient.loopsPerSecond) % 1;
      mover.position.copy(path.getPointAt(t));
      mover.lookAt(path.getPointAt((t + 0.01) % 1));
    });
  }

  // Raycast focus and interaction, resolved by semantic entity id (acceptance W6).
  const raycaster = new Raycaster();
  raycaster.far = RAYCAST_RANGE_METERS;
  const screenCentre = new Vector2(0, 0);

  function raycastFocus(): FocusTarget | null {
    if (focusTargets.length === 0) return null;
    // Raycasts read world matrices, which otherwise only refresh inside
    // `render`; a model swapped in since the last frame would be missed.
    for (const target of focusTargets) target.root.updateMatrixWorld(true);
    raycaster.setFromCamera(screenCentre, camera);
    const hits = raycaster.intersectObjects(
      focusTargets.map((target) => target.root),
      true,
    );
    for (const hit of hits) {
      let node: Object3D | null = hit.object;
      while (node) {
        const target = focusTargets.find((candidate) => candidate.root === node);
        if (target) return target;
        node = node.parent;
      }
    }
    return null;
  }

  function interact(): void {
    if (disposed) return;
    const target = raycastFocus();
    if (!target) return;
    if (target.kind === 'NPC') {
      bus.emit('ObjectInteracted', {
        entityId: target.entityId,
        interactionId: `${target.entityId}:talk`,
      });
      return;
    }
    bus.emit('ObjectInteracted', {
      entityId: target.entityId,
      interactionId: `${target.entityId}:collect`,
    });
    bus.emit('CollectiblePickedUp', { entityId: target.entityId });
    scene.remove(target.root);
    focusTargets.splice(focusTargets.indexOf(target), 1);
  }

  const controls = deps.attachControls(renderer, controller, { onInteract: interact });
  const stopFitting = deps.fitToParent(parent, camera, renderer);

  // Extensions the manifest declares, found by id, never by location.
  for (const binding of manifest.extensions) {
    const extension = deps.extensions.get(binding.extensionId);
    if (!extension) {
      console.warn(`[location ${manifest.regionId}] unknown extension ${binding.extensionId}`);
      continue;
    }
    const cleanup = extension.mount({
      scene,
      camera,
      bus,
      manifest,
      config: binding.config,
      addCollider: (box) => colliders.push(box),
      onFrame: (callback) => {
        frameCallbacks.add(callback);
        return () => frameCallbacks.delete(callback);
      },
    });
    if (cleanup) extensionCleanups.push(cleanup);
  }

  const tracker = new WorldTriggerTracker(
    triggerVolumes(
      manifest,
      ALL_CHECKPOINTS.filter((checkpoint) => checkpoint.regionId === manifest.regionId),
    ),
    manifest.npcs.map((npc) => ({ entityId: npc.entityId, x: npc.position.x, z: npc.position.z })),
    APPROACH_RANGE_METERS,
  );

  let lastFrameAt = deps.now();
  let frameHandle = 0;

  function frame(): void {
    if (disposed) return;
    const now = deps.now();
    const delta = Math.min((now - lastFrameAt) / 1000, MAX_FRAME_SECONDS);
    lastFrameAt = now;

    controls.update(delta);

    camera.position.set(controller.position.x, EYE_HEIGHT, controller.position.z);
    // +PI: the controller's forward at yaw 0 is +Z, a camera's default forward is -Z.
    camera.rotation.y = controller.yaw + Math.PI;
    camera.rotation.x = controller.pitch;
    camera.updateMatrixWorld();

    for (const mixer of mixers) mixer.update(delta);
    for (const callback of frameCallbacks) callback(delta);

    const step = tracker.step(controller.position, raycastFocus()?.entityId ?? null);
    for (const entityId of step.approachedEntityIds) bus.emit('NpcApproached', { entityId });
    if (step.focusChanged) bus.emit('InteractableFocused', step.focusChanged);
    for (const zoneId of step.enteredZoneIds) bus.emit('PlayerEnteredZone', { zoneId });

    renderer.render(scene, camera);
    frameHandle = deps.requestFrame(frame);
  }
  frameHandle = deps.requestFrame(frame);

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    deps.cancelFrame(frameHandle);
    controls.dispose();
    stopFitting();
    for (const cleanup of extensionCleanups) cleanup();
    frameCallbacks.clear();
    for (const mixer of mixers) {
      mixer.stopAllAction();
      mixer.uncacheRoot(mixer.getRoot());
    }
    for (const geometry of ownedGeometries) geometry.dispose();
    for (const material of ownedMaterials) material.dispose();
    scene.clear();
    renderer.dispose();
    if (renderer.domElement.parentElement === parent) {
      parent.removeChild(renderer.domElement);
    }
  }

  const ready = Promise.all(pending).then(() => undefined);

  return { dispose, interact, ready };
}
