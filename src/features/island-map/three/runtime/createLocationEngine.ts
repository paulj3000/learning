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
  LoopOnce,
  LoopRepeat,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
  type AnimationAction,
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
import { areRequirementsMet, type WorldInteractionContext } from '../../worldObjects';
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
import { SOURCE_WORLD_EXTENSIONS } from '../extensions';
import type { LoadedModel, WorldExtensionMount, WorldExtensionRegistry } from './extensionRegistry';
import type {
  ModelAnchor,
  ScaleSpec,
  ScenerySpec,
  ThreeLocationManifest,
} from './locationManifest';
import {
  buildingDoorPlacement,
  buildingRoofPlacement,
  buildingWallPlacements,
  NO_WORLD_STATE,
  resolveEnvironment,
  scatterPlacements,
  solidColliders,
  tiledGroundPlacements,
  triggerVolumes,
  walkableProbe,
  type BoxBounds,
} from './sceneLayout';
import { WorldTriggerTracker } from './worldTriggerTracker';

export type { LoadedModel } from './extensionRegistry';

/**
 * The generic Three.js location runtime (`docs/engine/03_GENERIC_3D_WORLD_RUNTIME.md`,
 * `docs/engine/10_IMPLEMENTATION_PHASES.md` Phases 3 and 7). One function
 * that turns any `ThreeLocationManifest` into a walkable first-person
 * scene, replacing the skeleton each `*Scene.ts` repeats: bootstrap,
 * colliders, controller and spawn, scenery, NPCs, props, collectibles,
 * ambient movers, raycast focus and interact, edge-triggered events, frame
 * loop, disposal.
 *
 * It never branches on a location slug or region id. Everything
 * region-specific comes from the manifest, and anything bespoke comes from
 * an extension the manifest names (`extensionRegistry.ts`). Scenery and
 * colliders with `requirements` are included or left out once, when the
 * scene is built, against the child's world state; a change during the
 * visit is the job of whatever caused it (an extension), as it was in the
 * per-region scenes.
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
  /** What a mounted extension returned as `api`, for its React half. `undefined` if none. */
  extensionApi(extensionId: string): unknown;
  /** Settles once every asynchronously loaded piece has been placed or has failed. Never rejects. */
  readonly ready: Promise<void>;
}

export interface LocationEngineOptions {
  /** The child's last saved checkpoint (`ChildWorldState.lastCheckpointId`), if any. */
  startCheckpointId?: string;
  /** What `requirements` on scenery and colliders are checked against. Defaults to no world state. */
  worldState?: WorldInteractionContext;
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

type EntityKind = 'NPC' | 'PROP' | 'COLLECTIBLE';

interface FocusTarget {
  entityId: string;
  kind: EntityKind;
  root: Object3D;
  /** False while an extension is carrying it; see `setFocusable`. */
  focusable: boolean;
  /** Props only: plays the authored interact clip the first time. */
  onFirstInteract?: () => void;
}

/** An NPC's animation state, so an extension can play a gesture and have it return to idle. */
interface NpcAnimator {
  mixer: AnimationMixer;
  clips: readonly AnimationClip[];
  idle?: AnimationClip;
}

function toBox3(bounds: BoxBounds): Box3 {
  return new Box3(
    new Vector3(bounds.minX, bounds.minY, bounds.minZ),
    new Vector3(bounds.maxX, bounds.maxY, bounds.maxZ),
  );
}

/**
 * How far to drop a ground-pivoted model so its middle sits where the
 * manifest put it. Zero for the default `BOTTOM` anchor, and measured from
 * the loaded model for `CENTRE` - half its own height, after any scale.
 */
function centreDrop(model: Object3D, anchor: ModelAnchor | undefined): number {
  if (anchor !== 'CENTRE') return 0;
  return new Box3().setFromObject(model).getSize(new Vector3()).y / 2;
}

function scaleOf(scale: ScaleSpec | undefined): InstancePlacement['scale'] {
  return scale ? { x: scale.x, y: scale.y, z: scale.z } : undefined;
}

export function createLocationEngine<R extends RendererLike>(
  parent: HTMLElement,
  bus: WorldEngineEventBus,
  manifest: ThreeLocationManifest,
  options: LocationEngineOptions,
  deps: LocationEngineDeps<R>,
): LocationEngine {
  let disposed = false;
  const worldState = options.worldState ?? NO_WORLD_STATE;
  const ownedGeometries: BufferGeometry[] = [];
  const ownedMaterials: Material[] = [];
  const mixers: AnimationMixer[] = [];
  const frameCallbacks = new Set<(deltaSeconds: number) => void>();
  const extensionMounts = new Map<string, WorldExtensionMount>();

  function ownMesh(geometry: BufferGeometry, material: Material): Mesh {
    ownedGeometries.push(geometry);
    ownedMaterials.push(material);
    return new Mesh(geometry, material);
  }

  // Scene, camera, lights, renderer.
  const scene = new Scene();
  // The environment this child's world state resolves to: a harbour whose
  // lighthouse turns again has a different sky from one that is still dark.
  const environment = resolveEnvironment(manifest, worldState);
  scene.background = new Color(environment.backgroundColor);
  const camera = new PerspectiveCamera(
    70,
    parent.clientWidth > 0 && parent.clientHeight > 0
      ? parent.clientWidth / parent.clientHeight
      : 1,
    0.1,
    150,
  );
  camera.rotation.order = 'YXZ';
  const lighting = { ...DEFAULT_LIGHTING, ...environment.lighting };
  scene.add(new AmbientLight(0xffffff, lighting.ambientIntensity));
  const sun = new DirectionalLight(0xffffff, lighting.sunIntensity);
  sun.position.set(lighting.sunPosition.x, lighting.sunPosition.y, lighting.sunPosition.z);
  scene.add(sun);

  /*
    Placed lights, for the rooms the sun does not reach. Gated ones are
    included or left out with everything else that reads world state, so a
    doorway that only glows once it is open is a light with a requirement
    rather than a line of code in a scene.
  */
  const placedLights = new Map<string, PointLight>();
  for (const light of manifest.lights ?? []) {
    if (!areRequirementsMet(light.requirements, worldState)) continue;
    const point = new PointLight(
      light.color,
      light.intensity,
      light.distance ?? 0,
      light.decay ?? 2,
    );
    point.position.set(light.position.x, light.position.y, light.position.z);
    point.name = light.id;
    scene.add(point);
    placedLights.set(light.id, point);
  }

  const renderer = deps.createRenderer();
  renderer.setSize(parent.clientWidth, parent.clientHeight);
  parent.appendChild(renderer.domElement);

  // Movement: colliders (gated ones only while their requirements hold),
  // controller, spawn at an authored checkpoint.
  const solids = solidColliders(manifest, worldState).map((solid) => ({
    id: solid.id,
    box: toBox3(solid.box),
  }));
  const colliders = solids.map((solid) => solid.box);
  const controller = new FirstPersonController({ colliders });
  /** Where the child could stand, which is where `SCATTER` scenery must not go. */
  const walkable = walkableProbe(manifest, worldState);
  const spawn = resolveSpawnCheckpoint(manifest.regionId, options.startCheckpointId);
  controller.position.set(spawn.x, 0, spawn.z);
  controller.yaw = spawn.yaw;

  function removeCollider(id: string): boolean {
    const solid = solids.find((candidate) => candidate.id === id);
    if (!solid) return false;
    const index = colliders.indexOf(solid.box);
    if (index < 0) return false;
    colliders.splice(index, 1);
    return true;
  }

  const focusTargets: FocusTarget[] = [];
  const npcAnimators = new Map<string, NpcAnimator>();
  const sceneryRoots = new Map<string, Object3D>();
  /** Extensions that take over what interacting with one of their entities does. */
  const interactHandlers = new Set<(entityId: string) => boolean>();
  /** Roots of NPCs, props and collectibles, so an extension can fill one in. */
  const entityRoots = new Map<string, Object3D>();
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

  function loopIdle(model: Object3D, animations: readonly AnimationClip[], clip?: string) {
    const idle = clip ? animations.find((candidate) => candidate.name === clip) : undefined;
    const mixer = new AnimationMixer(model);
    if (idle) mixer.clipAction(idle).play();
    mixers.push(mixer);
    return { mixer, idle };
  }

  // NPCs: a placeholder box under a root group until the model arrives, so
  // a model swap never changes what the raycast targets.
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
    entityRoots.set(npc.entityId, root);
    focusTargets.push({ entityId: npc.entityId, kind: 'NPC', root, focusable: true });

    track(
      deps.assets.loadModel(npc.assetId).then(({ scene: source, animations }) => {
        const model = source.clone(true);
        if (!addWhenLive(model, root)) return;
        // Removed, not hidden: a raycast does not skip invisible meshes.
        root.remove(placeholder);
        const { mixer, idle } = loopIdle(model, animations, npc.idleClip);
        // A gesture plays a few times, then the NPC goes back to idling.
        mixer.addEventListener('finished', () => {
          mixer.stopAllAction();
          if (idle) mixer.clipAction(idle).play();
        });
        npcAnimators.set(npc.entityId, { mixer, clips: animations, idle });
      }),
      `npc ${npc.entityId}`,
    );
  }

  function playNpcGesture(entityId: string, clipName: string, repetitions: number): void {
    const animator = npcAnimators.get(entityId);
    const clip = animator?.clips.find((candidate) => candidate.name === clipName);
    if (!animator || !clip) return;
    animator.mixer.stopAllAction();
    const action = animator.mixer.clipAction(clip);
    action.reset();
    action.setLoop(LoopRepeat, repetitions);
    action.play();
  }

  /*
    Props: interactive objects bound to an interaction. Gated ones are
    included or left out once, when the scene is built, like scenery and
    colliders - so a dark cave and a lit one are two props sharing an
    interaction rather than a branch in here.
  */
  const presentProps = manifest.props.filter((prop) =>
    areRequirementsMet(prop.requirements, worldState),
  );
  for (const prop of presentProps) {
    const root = new Group();
    root.name = prop.label;
    root.position.set(prop.position.x, prop.elevation ?? 0, prop.position.z);
    root.rotation.y = prop.rotationY ?? 0;
    scene.add(root);
    entityRoots.set(prop.entityId, root);
    let interactAction: AnimationAction | null = null;
    let interacted = false;
    focusTargets.push({
      entityId: prop.entityId,
      kind: 'PROP',
      root,
      focusable: true,
      onFirstInteract: () => {
        if (interacted || !interactAction) return;
        interacted = true;
        interactAction.setLoop(LoopOnce, 1);
        interactAction.clampWhenFinished = true;
        interactAction.play();
      },
    });

    // No `assetId` means an extension fills this root in (placeholder
    // machinery); focus, label and interaction are unchanged either way.
    if (prop.assetId === undefined) continue;
    const assetId = prop.assetId;
    track(
      deps.assets.loadModel(assetId).then(({ scene: source, animations }) => {
        const model = source.clone(true);
        // A wall-mounted prop's `elevation` is where its middle sits, so the
        // ground-pivoted model drops by half its own measured height.
        model.position.y -= centreDrop(model, prop.anchor);
        if (!addWhenLive(model, root)) return;
        const clip = prop.interactClip
          ? animations.find((candidate) => candidate.name === prop.interactClip)
          : undefined;
        if (clip) {
          const mixer = new AnimationMixer(model);
          mixers.push(mixer);
          interactAction = mixer.clipAction(clip);
        }
      }),
      `prop ${prop.entityId}`,
    );
  }

  /*
    Only the collectibles this child's world state allows. One that records a
    world change carries a `WORLD_CHANGE_ABSENT` requirement on its own key
    (validation requires it), so once it has been picked up it is simply
    never built again, which is what keeps it picked up (Phase 8).
  */
  const presentCollectibles = manifest.collectibles.filter((collectible) =>
    areRequirementsMet(collectible.requirements, worldState),
  );
  for (const collectible of presentCollectibles) {
    const root = new Group();
    root.name = collectible.label;
    root.position.set(collectible.position.x, collectible.elevation ?? 0, collectible.position.z);
    scene.add(root);
    entityRoots.set(collectible.entityId, root);
    focusTargets.push({
      entityId: collectible.entityId,
      kind: 'COLLECTIBLE',
      root,
      focusable: true,
    });

    if (collectible.assetId === undefined) continue;
    const assetId = collectible.assetId;
    track(
      deps.assets.loadModel(assetId).then(({ scene: source, animations }) => {
        const model = source.clone(true);
        if (!addWhenLive(model, root)) return;
        loopIdle(model, animations, collectible.idleClip);
      }),
      `collectible ${collectible.entityId}`,
    );
  }

  async function placeInstanced(
    into: Object3D,
    assetId: string,
    placements: readonly InstancePlacement[],
  ): Promise<void> {
    if (placements.length === 0) return;
    const instanced = await deps.assets.instanced(assetId, placements);
    if (!addWhenLive(instanced, into)) return;
    // The loader clones geometry per instanced mesh; the material stays shared with the cache.
    if (instanced instanceof Mesh) ownedGeometries.push(instanced.geometry);
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
    track(placeInstanced(scene, assetId, placements), `building piece ${assetId}`);
  }

  /**
   * Every scenery item gets its own root group, created now, so an
   * extension can find it by id (`sceneryRoot`) before its content loads.
   * A flat plane's and a box's root sit at their anchor, so moving or
   * scaling the root moves the surface (the tide trial's water).
   */
  function buildScenery(item: ScenerySpec): void {
    const root = new Group();
    root.name = item.id;
    scene.add(root);
    sceneryRoots.set(item.id, root);
    switch (item.kind) {
      case 'TILED_GROUND': {
        const tiles = tiledGroundPlacements(item.area, item.tileSize, item.coverage).map(
          (tile) => ({ position: { x: tile.x, y: item.y ?? 0, z: tile.z } }),
        );
        track(placeInstanced(root, item.assetId, tiles), `scenery ${item.id}`);
        return;
      }
      case 'SCATTER': {
        const scattered = scatterPlacements(
          item.area,
          item.spacing,
          item.seed,
          walkable,
          item.clearance,
        );
        track(placeInstanced(root, item.assetId, scattered), `scenery ${item.id}`);
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
        root.position.set(item.area.minX + width / 2, item.y, item.area.minZ + depth / 2);
        root.add(plane);
        return;
      }
      case 'BOX': {
        const width = item.area.maxX - item.area.minX;
        const depth = item.area.maxZ - item.area.minZ;
        const height = item.maxY - item.minY;
        const box = ownMesh(
          new BoxGeometry(width, height, depth),
          new MeshStandardMaterial({ color: item.color }),
        );
        box.position.y = height / 2;
        root.position.set(item.area.minX + width / 2, item.minY, item.area.minZ + depth / 2);
        root.add(box);
        return;
      }
      case 'CLUSTER': {
        const placements = item.positions.map((position) => ({
          position: { x: position.x, y: position.y ?? 0, z: position.z },
          rotationY: position.rotationY,
          scale: scaleOf(position.scale),
        }));
        track(placeInstanced(root, item.assetId, placements), `scenery ${item.id}`);
        return;
      }
      case 'LOD_PLACEMENTS':
        for (const position of item.positions) {
          track(
            deps.assets.withLod(item.assetId).then((object) => {
              object.position.set(position.x, position.y ?? 0, position.z);
              object.rotation.y = position.rotationY ?? 0;
              addWhenLive(object, root);
            }),
            `scenery ${item.id}`,
          );
        }
        return;
      case 'MODEL':
        track(
          deps.assets.loadModel(item.assetId).then(({ scene: source, animations }) => {
            const model = source.clone(true);
            if (item.rotation)
              model.rotation.set(item.rotation.x, item.rotation.y, item.rotation.z);
            if (item.scale)
              model.scale.set(item.scale.x ?? 1, item.scale.y ?? 1, item.scale.z ?? 1);
            model.position.set(
              item.position.x,
              item.position.y - centreDrop(model, item.anchor),
              item.position.z,
            );
            if (!addWhenLive(model, root)) return;
            if (item.idleClip) loopIdle(model, animations, item.idleClip);
          }),
          `scenery ${item.id}`,
        );
        return;
      case 'RUN':
        track(
          placeInstanced(root, item.assetId, runPlacements(item.from, item.to, item.segmentLength)),
          `scenery ${item.id}`,
        );
        return;
    }
  }
  manifest.scenery
    .filter((item) => areRequirementsMet(item.requirements, worldState))
    .forEach(buildScenery);

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
    const aimable = focusTargets.filter((target) => target.focusable);
    if (aimable.length === 0) return null;
    // Raycasts read world matrices, which otherwise only refresh inside
    // `render`; a model swapped in since the last frame would be missed.
    for (const target of aimable) target.root.updateMatrixWorld(true);
    raycaster.setFromCamera(screenCentre, camera);
    const hits = raycaster.intersectObjects(
      aimable.map((target) => target.root),
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
    // An extension may own this entity's interaction entirely (a plate going
    // into a socket is a move inside a puzzle, not a domain event).
    for (const handler of interactHandlers) {
      if (handler(target.entityId)) return;
    }
    switch (target.kind) {
      case 'NPC':
        bus.emit('ObjectInteracted', {
          entityId: target.entityId,
          interactionId: `${target.entityId}:talk`,
        });
        return;
      case 'PROP':
        bus.emit('ObjectInteracted', {
          entityId: target.entityId,
          interactionId: `${target.entityId}:interact`,
        });
        target.onFirstInteract?.();
        return;
      case 'COLLECTIBLE':
        bus.emit('ObjectInteracted', {
          entityId: target.entityId,
          interactionId: `${target.entityId}:collect`,
        });
        bus.emit('CollectiblePickedUp', { entityId: target.entityId });
        scene.remove(target.root);
        focusTargets.splice(focusTargets.indexOf(target), 1);
        return;
    }
  }

  const controls = deps.attachControls(renderer, controller, { onInteract: interact });
  const stopFitting = deps.fitToParent(parent, camera, renderer);

  // Extensions the manifest declares, found by id, never by location. A
  // broken one is skipped with a warning rather than taking the region down.
  for (const binding of manifest.extensions) {
    const extension = deps.extensions.get(binding.extensionId);
    if (!extension) {
      console.warn(`[location ${manifest.regionId}] unknown extension ${binding.extensionId}`);
      continue;
    }
    // What this binding declared it loads (engine Phase 10). Enforced here so
    // the validator and the usage index, which read the declaration, can
    // never disagree with what the extension really fetches.
    const declaredAssetIds = new Set(extension.assetIds?.(binding.config) ?? []);
    try {
      const mounted = extension.mount({
        scene,
        camera,
        bus,
        manifest,
        config: binding.config,
        addCollider: (box) => colliders.push(box),
        removeCollider,
        sceneryRoot: (id) => sceneryRoots.get(id),
        entityRoot: (entityId) => entityRoots.get(entityId),
        worldState,
        playNpcGesture,
        npcAnimator: (entityId) => npcAnimators.get(entityId),
        interceptInteract: (handler) => {
          interactHandlers.add(handler);
          return () => interactHandlers.delete(handler);
        },
        setFocusable: (entityId, focusable) => {
          const target = focusTargets.find((candidate) => candidate.entityId === entityId);
          if (target) target.focusable = focusable;
        },
        loadModel: (assetId) =>
          declaredAssetIds.has(assetId)
            ? deps.assets.loadModel(assetId)
            : Promise.reject(
                new Error(
                  `extension ${binding.extensionId} loaded "${assetId}" without declaring it in assetIds`,
                ),
              ),
        onFrame: (callback) => {
          frameCallbacks.add(callback);
          return () => frameCallbacks.delete(callback);
        },
        now: () => deps.now(),
      });
      extensionMounts.set(binding.extensionId, mounted ?? {});
    } catch (error) {
      console.warn(
        `[location ${manifest.regionId}] extension ${binding.extensionId} failed to mount`,
        error,
      );
    }
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
    for (const mounted of extensionMounts.values()) mounted.dispose?.();
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

  return {
    dispose,
    interact,
    extensionApi: (extensionId) => extensionMounts.get(extensionId)?.api,
    ready,
  };
}
