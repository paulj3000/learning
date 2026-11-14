import { PlatformSystem, type PlatformEvent, type PlatformState } from '../platforms/platformSystem';
import { createPlatformPresentation } from '../platforms/platformPresentation';
import type { CollisionProfiles } from './collisionProfile';
import { locationAssetIds } from './locationAssetUsage';
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
import { cloneAssetScene } from '../assets/cloneAsset';
import { ALL_CHECKPOINTS, resolveSpawnCheckpoint } from '../../../discovery/checkpoints';
import { areRequirementsMet, type WorldInteractionContext } from '../../worldObjects';
import { FirstPersonController, type Gait } from '../firstPersonController';
import type { LocomotionConfiguration } from '../locomotionConfiguration';
import type { SprintMode } from '../pointerControls';
import {
  colliderObstruction,
  lookDirection,
  PlayerCameraController,
  THIRD_PERSON_ENTRY_PITCH,
  thirdPersonPitch,
  type PlayerCameraFrame,
} from '../playerCamera';
import { AvatarFacing, createPlayerAvatar, type PlayerAvatar } from '../playerAvatar';
import type { PlayerAvatarModel } from '../playerAvatarCatalog';
import {
  initialCameraMode,
  resolvePlayerAvatar,
  resolvePlayerCamera,
  type CameraMode,
  type PlayerCameraConfiguration,
} from '../playerPresentation';
import type { JumpConfiguration } from '../jumpConfiguration';
import { attachPointerControls, type PointerControls } from '../pointerControls';
import {
  APPROACH_RANGE_METERS,
  EYE_HEIGHT,
  fitRendererToParent,
  RAYCAST_RANGE_METERS,
  runPlacements,
} from '../sceneKit';
import type { ThreeEngineHandle } from '../engineHandle';
import type { WorldEngineEventBus } from '../worldEngineEvents';
import { SOURCE_WORLD_EXTENSIONS } from '../extensions';
import type {
  ChildPlacement,
  LoadedModel,
  WorldExtensionMount,
  WorldExtensionRegistry,
} from './extensionRegistry';
import type {
  ModelAnchor,
  PlaceholderSize,
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
import { installE2EProbe } from './e2eProbe';
import { createMaterialLibrary } from './visual/materialLibrary';
import { createMoteField, type MoteField } from './visual/motes';
import {
  DEFAULT_RENDER_QUALITY,
  pixelRatioFor,
  selectLightsForQuality,
  type RenderQuality,
} from './visual/renderQuality';
import { buildSurfaceGeometry } from './visual/surfaceGeometry';

export type { ChildPlacement, LoadedModel } from './extensionRegistry';

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
  /** Optional so test doubles need not implement it; `WebGLRenderer` does. */
  setPixelRatio?(ratio: number): void;
}

export interface LocationEngineAssets {
  /** Resolves a shared, cached model; the runtime clones `scene` before placing it. */
  loadModel(assetId: string): Promise<LoadedModel>;
  /** One instanced draw call of `assetId` at every placement. */
  instanced(assetId: string, placements: readonly InstancePlacement[]): Promise<Object3D>;
  /** A fresh, LOD-aware copy of `assetId`. */
  withLod(assetId: string): Promise<Object3D>;
  /**
   * Staff-configured collision profiles for these asset ids (Asset Manager), from the same
   * resolver the models come from. Absent, or an id missing from the answer: built-in defaults.
   */
  collisionProfiles?(assetIds: readonly string[]): Promise<CollisionProfiles>;
}

export interface LocationEngineDeps<R extends RendererLike> {
  createRenderer(): R;
  assets: LocationEngineAssets;
  attachControls(
    renderer: R,
    controller: FirstPersonController,
    options: {
      onInteract: () => void;
      /** LAI-JMP-01a: V and the gamepad camera button. */
      onToggleCamera?: () => void;
      /** LAI-JMP-01a: the location's look sensitivity. */
      lookSensitivity?: () => number;
      /** Running & sprinting: hold or toggle Shift. */
      sprintMode?: () => SprintMode;
    },
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
  /**
   * Moves the child to a spot they could stand on: inside the bounds and
   * clear of every collider as it is now. `false`, and no move, otherwise.
   * Generic: the accessible equivalent of walking, for any region.
   */
  placeChild(placement: ChildPlacement): boolean;
  /** Where the child is and which way they face. */
  childPlacement(): Required<ChildPlacement>;
  /** What a mounted extension returned as `api`, for its React half. `undefined` if none. */
  extensionApi(extensionId: string): unknown;
  /**
   * LAI-JMP-01: one jump press from a control the engine does not own (the
   * HUD's on-screen Jump button). Edge-triggered like Space; ignored where
   * jumping is off.
   */
  pressJump(): void;
  /** The jump tuning this location plays with (`manifest.movement.jump` over the defaults). */
  readonly jump: Readonly<JumpConfiguration>;
  /** Forgets held keys, drags and buttons, e.g. when a panel opens over the scene. */
  resetInput(): void;
  /**
   * LAI-JMP-02 / LAI-JMP-04: raises (or clears) a platform `SIGNAL`, e.g. when the child completes
   * an educational challenge that opens a lift. Ignored where nothing listens for it.
   */
  signalPlatforms(name: string, on?: boolean): void;
  /** The platforms' live state (position, present, moving), for HUD hints and tests. */
  platforms(): readonly PlatformState[];
  /** LAI-JMP-01a: the perspective the child is seeing now. */
  cameraMode(): CameraMode;
  /**
   * Switches perspective. `false`, and no change, where the location does not
   * allow switching. Fires `onCameraModeChange` on a real change.
   */
  setCameraMode(mode: CameraMode): boolean;
  /** Switches to the other perspective, where allowed. Returns the mode now in force. */
  toggleCameraMode(): CameraMode;
  /** The camera tuning this location plays with (`manifest.player.camera` over the defaults). */
  readonly camera: Readonly<PlayerCameraConfiguration>;
  /** The child's avatar, while third-person can show it; `null` where the location turns it off. */
  readonly avatar: PlayerAvatar | null;
  /** Running & sprinting: the walking, running and sprinting tuning this location plays with. */
  readonly locomotion: Readonly<LocomotionConfiguration>;
  /** Running & sprinting: switches how Shift sprints (a child's setting). */
  setSprintMode(mode: SprintMode): void;
  /** Settles once every asynchronously loaded piece has been placed or has failed. Never rejects. */
  readonly ready: Promise<void>;
}

export interface LocationEngineOptions {
  /** The child's last saved checkpoint (`ChildWorldState.lastCheckpointId`), if any. */
  startCheckpointId?: string;
  /** What `requirements` on scenery and colliders are checked against. Defaults to no world state. */
  worldState?: WorldInteractionContext;
  /**
   * How much the scene may cost to draw (`visual/renderQuality.ts`).
   * Appearance only: colliders, interactions and bindings are identical at
   * every tier. Defaults to MEDIUM.
   */
  quality?: RenderQuality;
  /** `prefers-reduced-motion`: decorative motion (motes) holds still. Defaults to false. */
  reducedMotion?: boolean;
  /** The device pixel ratio, capped by the tier. Defaults to `window.devicePixelRatio`. */
  devicePixelRatio?: number;
  /**
   * LAI-JMP-01a: the child's saved perspective. Used where the location allows
   * switching; otherwise, or when absent, the location's default.
   */
  cameraMode?: CameraMode;
  /** LAI-JMP-01a: the child's `ChildProfile.avatarKey`, for their avatar's look. */
  avatarKey?: string | null;
  /**
   * LAI-JMP-01c: the published model for the child's avatar identity (the play API's answer),
   * possibly still on its way. The placeholder shows until it has loaded; the scene never waits.
   */
  publishedAvatar?: PlayerAvatarModel | null | Promise<PlayerAvatarModel | null>;
  /**
   * LAI-JMP-01c: how avatar models are loaded (the Django asset resolver and loader, for a
   * published model). Defaults to the location's own loader.
   */
  loadAvatarModel?: (ref: string) => Promise<LoadedModel>;
  /** LAI-JMP-01a: the perspective changed (V, a button, the gamepad), so the view can save it. */
  onCameraModeChange?: (mode: CameraMode) => void;
  /** Running & sprinting: hold Shift to sprint (default) or press it to toggle. */
  sprintMode?: SprintMode;
}

/** The outdoor rig `sceneKit.createSceneBootstrap` defaults to; manifest lighting overrides per field. */
const DEFAULT_LIGHTING = {
  ambientIntensity: 0.65,
  sunIntensity: 0.8,
  sunPosition: { x: 8, y: 14, z: 6 },
};

/** Placeholder stand-in size for an NPC whose model has not loaded (as every region used). */
const NPC_PLACEHOLDER_SIZE: PlaceholderSize = { width: 0.4, height: 0.6, depth: 0.2 };
/** Stand-in size for a prop, collectible or scenery model that fails to load and names none (TR-7a). */
export const MISSING_MODEL_SIZE: PlaceholderSize = { width: 0.6, height: 0.6, depth: 0.6 };
/**
 * Colour of the stand-in for a model that failed to load (TR-7a): loud on
 * purpose, so a missing or unpublished asset is noticed and fixed rather
 * than mistaken for content. The failure itself is logged by `track`.
 */
export const MISSING_MODEL_COLOR = 0xff2bd6;
/** A floor whose tiles failed to load becomes one plain plane, so the child never walks on sky. */
export const MISSING_GROUND_COLOR = 0x8fbf6a;
/** The camera's field of view, degrees, before any sprint widening. */
const BASE_FIELD_OF_VIEW = 70;
/** Metres between footsteps at each gait (longer strides when faster). */
const STRIDE_METRES: Readonly<Record<'walk' | 'run' | 'sprint', number>> = {
  walk: 0.75,
  run: 1.0,
  sprint: 1.2,
};
/** Frames longer than this (a background tab) are clamped so the player cannot tunnel through walls. */
const MAX_FRAME_SECONDS = 0.1;
/** With `interactionAssist`: how far ahead, on the ground, an interactable takes focus without aiming. */
export const ASSIST_RANGE_METERS = 3;
/** With `interactionAssist`: how far off straight ahead (radians, either side) it may be. About 40 degrees. */
export const ASSIST_HALF_ANGLE = 0.7;
/** The focus marker's name, so tests and debugging can find it. */
export const FOCUS_MARKER_NAME = 'interaction-assist:focus-marker';
const FOCUS_MARKER_COLOR = 0xf4d35e;

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
    BASE_FIELD_OF_VIEW,
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
  const quality = options.quality ?? DEFAULT_RENDER_QUALITY;
  const placedLights = new Map<string, PointLight>();
  const gatedLights = (manifest.lights ?? []).filter((light) =>
    areRequirementsMet(light.requirements, worldState),
  );
  // A lower tier keeps the lights that matter most (`priority`), never a different gameplay.
  for (const light of selectLightsForQuality(gatedLights, quality)) {
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
  renderer.setPixelRatio?.(
    pixelRatioFor(
      options.devicePixelRatio ??
        (typeof window === 'undefined' ? undefined : window.devicePixelRatio),
      quality,
    ),
  );
  renderer.setSize(parent.clientWidth, parent.clientHeight);
  parent.appendChild(renderer.domElement);

  // Movement: colliders (gated ones only while their requirements hold),
  // controller, spawn at an authored checkpoint.
  const solids = solidColliders(manifest, worldState).map((solid) => ({
    id: solid.id,
    box: toBox3(solid.box),
    jumpable: solid.jumpable === true,
  }));
  const colliders = solids.map((solid) => solid.box);
  // LAI-JMP-01: only authored low obstacles are jumpable; walls, gates, the
  // world's edge and anything an extension adds stay solid at every height.
  const jumpableColliders = new Set(
    solids.filter((solid) => solid.jumpable).map((solid) => solid.box),
  );
  const playableMargin = manifest.bounds.wallThickness + 1;
  // LAI-JMP-02 / LAI-JMP-04: platforms are jumpable boxes in the same live collider list,
  // moved in place each frame; the controller stays authoritative for the child.
  const platformSystem = manifest.platforming
    ? new PlatformSystem(manifest.platforming, {
        colliders,
        jumpable: jumpableColliders,
        worldState,
        zones: new Map(manifest.zones.map((zone) => [zone.rect.id, zone.rect] as const)),
        reducedMotion: options.reducedMotion === true,
      })
    : null;
  const controller = new FirstPersonController({
    ...(platformSystem
      ? {
          isSafeGround: (x: number, y: number, z: number) => platformSystem.isSafeGround(x, y, z),
          recoveryPoint: () => platformSystem.recoveryPoint(),
        }
      : {}),
    colliders,
    jumpableColliders,
    jump: manifest.movement?.jump,
    // Running & sprinting: per-location speeds (walking pace defaults to the old 4 m/s).
    locomotion: manifest.movement?.locomotion,
    // A safety net behind the boundary walls: anyone who ends up past them goes back.
    isInPlayableArea: (x, z) =>
      Math.abs(x) <= manifest.bounds.halfExtentX + playableMargin &&
      Math.abs(z) <= manifest.bounds.halfExtentZ + playableMargin,
  });
  /*
    LAI-JMP-01a: how the player is seen. One camera controller for both
    perspectives, over the same live colliders the controller walks into, and
    one avatar that only copies the controller's position. Neither moves the
    player.
  */
  const cameraConfig = resolvePlayerCamera(manifest.player?.camera);
  const avatarConfig = resolvePlayerAvatar(manifest.player?.avatar);
  const playerCamera = new PlayerCameraController(
    cameraConfig,
    initialCameraMode(cameraConfig, options.cameraMode),
    {
      eyeHeight: EYE_HEIGHT,
      reducedMotion: options.reducedMotion,
      obstruction: colliderObstruction(colliders),
    },
  );
  if (playerCamera.mode === 'third-person') {
    controller.pitch = THIRD_PERSON_ENTRY_PITCH;
  }
  const avatar: PlayerAvatar | null = avatarConfig.enabled
    ? createPlayerAvatar({
        avatarKey: options.avatarKey,
        config: avatarConfig,
        loadModel: options.loadAvatarModel ?? ((ref) => deps.assets.loadModel(ref)),
        published: options.publishedAvatar,
        reducedMotion: () => options.reducedMotion === true,
      })
    : null;
  const avatarFacing = new AvatarFacing(controller.yaw);
  if (avatar) {
    avatar.setPose(controller.position, controller.yaw);
    avatar.setVisible(false);
    scene.add(avatar.root);
  }
  /*
    LAI-JMP-01c: the avatar celebrates a world change and a find. Presentation only: it listens
    to events that already happened and changes nothing.
  */
  const stopCelebrating = avatar
    ? [
        bus.on('WorldStateChanged', () => avatar.celebrate()),
        bus.on('CollectiblePickedUp', () => avatar.celebrate()),
      ]
    : [];

  let sprintMode: SprintMode = options.sprintMode ?? 'hold';
  /** The last ground gait reported, so `PlayerGaitChanged` fires once per change. */
  let reportedGait: Gait = 'idle';
  /** Distance walked since the last footstep, metres. */
  let strideTravelled = 0;
  const footstepFrom = { x: controller.position.x, z: controller.position.z };

  /** The last frame's camera, for aiming an interaction between frames. */
  let lastCameraFrame: PlayerCameraFrame | null = null;

  function setCameraMode(mode: CameraMode): boolean {
    if (disposed) return false;
    if (mode === playerCamera.mode) return true;
    if (!cameraConfig.allowModeSwitch) return false;
    playerCamera.setMode(mode);
    lastCameraFrame = null;
    if (mode === 'third-person') {
      // A gentle look down over the shoulder, unless already looking further down.
      controller.pitch = Math.min(thirdPersonPitch(controller.pitch), THIRD_PERSON_ENTRY_PITCH);
    }
    options.onCameraModeChange?.(mode);
    return true;
  }

  function toggleCameraMode(): CameraMode {
    setCameraMode(playerCamera.mode === 'first-person' ? 'third-person' : 'first-person');
    return playerCamera.mode;
  }
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

  function placeChild(placement: ChildPlacement): boolean {
    if (disposed) return false;
    if (!Number.isFinite(placement.x) || !Number.isFinite(placement.z)) return false;
    if (
      Math.abs(placement.x) > manifest.bounds.halfExtentX ||
      Math.abs(placement.z) > manifest.bounds.halfExtentZ
    ) {
      return false;
    }
    return controller.teleportTo(placement.x, placement.z, placement.yaw);
  }

  function childPlacement(): Required<ChildPlacement> {
    return { x: controller.position.x, z: controller.position.z, yaw: controller.yaw };
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

  /**
   * Asset Manager collision profiles: once they arrive, the derived boxes are rebuilt from them
   * (authored colliders, gates and extension boxes are untouched). A new box is never put where
   * the child is standing, so a profile arriving mid-visit cannot trap them.
   */
  function applyCollisionProfiles(profiles: CollisionProfiles): void {
    if (disposed || profiles.size === 0) return;
    const isDerived = (solid: { id?: string }) => solid.id?.startsWith('derived:') === true;
    for (let index = solids.length - 1; index >= 0; index -= 1) {
      const solid = solids[index]!;
      if (!isDerived(solid)) continue;
      const at = colliders.indexOf(solid.box);
      if (at >= 0) colliders.splice(at, 1);
      jumpableColliders.delete(solid.box);
      solids.splice(index, 1);
    }
    const here = controller.position;
    for (const solid of solidColliders(manifest, worldState, profiles).filter(isDerived)) {
      const box = toBox3(solid.box);
      if (here.x >= box.min.x && here.x <= box.max.x && here.z >= box.min.z && here.z <= box.max.z) {
        continue;
      }
      const jumpable = solid.jumpable === true;
      solids.push({ id: solid.id, box, jumpable });
      colliders.push(box);
      if (jumpable) jumpableColliders.add(box);
    }
  }
  const platformPresentation =
    platformSystem && manifest.platforming
      ? createPlatformPresentation(platformSystem, manifest.platforming, {
          reducedMotion: options.reducedMotion === true,
          loadModel: (assetId) => deps.assets.loadModel(assetId),
          clone: cloneAssetScene,
          track,
        })
      : null;
  if (platformPresentation) scene.add(platformPresentation.root);

  if (deps.assets.collisionProfiles) {
    const ids = locationAssetIds(manifest, {
      extensionAssetIds: () => [],
      lowDetailIdOf: () => undefined,
    });
    track(
      deps.assets.collisionProfiles(ids).then(applyCollisionProfiles),
      'collision profiles',
    );
  }

  /**
   * TR-7a: a primitive box standing in for a model that could not be
   * resolved or loaded. Standing on `into`'s origin, or centred on it for a
   * `CENTRE`-anchored model, and named after the asset so it is easy to find
   * when debugging. Focus, label and interaction are unaffected because they
   * belong to the entity's root, which a raycast reaches through this box.
   */
  function addMissingModel(
    into: Object3D,
    assetId: string,
    size: PlaceholderSize,
    anchor: ModelAnchor | undefined,
    color: number = MISSING_MODEL_COLOR,
  ): void {
    if (disposed) return;
    const box = ownMesh(
      new BoxGeometry(size.width, size.height, size.depth),
      new MeshStandardMaterial({ color }),
    );
    box.name = `missing-model:${assetId}`;
    box.position.y = anchor === 'CENTRE' ? 0 : size.height / 2;
    into.add(box);
  }

  /** Runs `onFailure` when `work` fails, then fails anyway, so `track` still logs the cause. */
  function orPlaceholder(work: Promise<void>, onFailure: () => void): Promise<void> {
    return work.catch((error: unknown) => {
      onFailure();
      throw error;
    });
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
    // Kept if the model never arrives (TR-7a): the NPC can still be found and talked to.
    const placeholderSize = npc.placeholderSize ?? NPC_PLACEHOLDER_SIZE;
    const placeholder = ownMesh(
      new BoxGeometry(placeholderSize.width, placeholderSize.height, placeholderSize.depth),
      new MeshStandardMaterial({ color: npc.placeholderColor }),
    );
    placeholder.name = `placeholder:${npc.assetId}`;
    placeholder.position.y = placeholderSize.height / 2;
    root.add(placeholder);
    scene.add(root);
    entityRoots.set(npc.entityId, root);
    focusTargets.push({ entityId: npc.entityId, kind: 'NPC', root, focusable: true });

    track(
      deps.assets.loadModel(npc.assetId).then(({ scene: source, animations }) => {
        const model = cloneAssetScene(source);
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
      orPlaceholder(
        deps.assets.loadModel(assetId).then(({ scene: source, animations }) => {
          const model = cloneAssetScene(source);
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
        () =>
          addMissingModel(root, assetId, prop.placeholderSize ?? MISSING_MODEL_SIZE, prop.anchor),
      ),
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
      orPlaceholder(
        deps.assets.loadModel(assetId).then(({ scene: source, animations }) => {
          const model = cloneAssetScene(source);
          if (!addWhenLive(model, root)) return;
          loopIdle(model, animations, collectible.idleClip);
        }),
        () =>
          addMissingModel(
            root,
            assetId,
            collectible.placeholderSize ?? MISSING_MODEL_SIZE,
            undefined,
          ),
      ),
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
        track(
          orPlaceholder(placeInstanced(root, item.assetId, tiles), () => {
            if (disposed) return;
            const width = item.area.maxX - item.area.minX;
            const depth = item.area.maxZ - item.area.minZ;
            const floor = ownMesh(
              new PlaneGeometry(width, depth),
              new MeshStandardMaterial({ color: MISSING_GROUND_COLOR, side: DoubleSide }),
            );
            floor.name = `missing-model:${item.assetId}`;
            floor.rotation.x = -Math.PI / 2;
            floor.position.set(item.area.minX + width / 2, item.y ?? 0, item.area.minZ + depth / 2);
            root.add(floor);
          }),
          `scenery ${item.id}`,
        );
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
          orPlaceholder(
            deps.assets.loadModel(item.assetId).then(({ scene: source, animations }) => {
              const model = cloneAssetScene(source);
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
            () => {
              if (disposed) return;
              const spot = new Group();
              spot.position.set(item.position.x, item.position.y, item.position.z);
              spot.rotation.y = item.rotation?.y ?? 0;
              if (item.scale)
                spot.scale.set(item.scale.x ?? 1, item.scale.y ?? 1, item.scale.z ?? 1);
              addMissingModel(
                spot,
                item.assetId,
                item.placeholderSize ?? MISSING_MODEL_SIZE,
                item.anchor,
              );
              root.add(spot);
            },
          ),
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

  /*
    Built architecture (SC-R02-01): floors, walls and ceilings drawn with a
    shared material preset and world-scaled UVs, one merged draw call per
    surface. The library owns every preset material and texture; the
    geometries are owned like any other the runtime builds. Each surface's
    root is registered with the scenery roots, so an extension can find it.
  */
  const materialLibrary = createMaterialLibrary(manifest.materials ?? [], { quality });
  for (const surface of manifest.surfaces ?? []) {
    if (!areRequirementsMet(surface.requirements, worldState)) continue;
    const root = new Group();
    root.name = surface.id;
    scene.add(root);
    sceneryRoots.set(surface.id, root);
    const metersPerRepeat = materialLibrary.spec(surface.materialId)?.metersPerRepeat ?? 1;
    const geometry = buildSurfaceGeometry(surface.faces, metersPerRepeat);
    ownedGeometries.push(geometry);
    if (!geometry.getAttribute('position')) continue;
    const mesh = new Mesh(geometry, materialLibrary.get(surface.materialId));
    mesh.name = `surface:${surface.id}`;
    root.add(mesh);
  }

  // Atmosphere: motes, capped by the tier and still under reduced motion.
  const moteFields: MoteField[] = [];
  for (const effect of manifest.effects ?? []) {
    if (!areRequirementsMet(effect.requirements, worldState)) continue;
    const field = createMoteField(effect, quality);
    if (!field) continue;
    field.setTime(0);
    scene.add(field.points);
    moteFields.push(field);
    if (!options.reducedMotion) {
      let seconds = 0;
      frameCallbacks.add((deltaSeconds) => {
        seconds += deltaSeconds;
        field.setTime(seconds);
      });
    }
  }

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
          addWhenLive(cloneAssetScene(source), mover);
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

  function raycastFocus(): FocusTarget | null {
    const aimable = focusTargets.filter((target) => target.focusable);
    if (aimable.length === 0) return null;
    // Raycasts read world matrices, which otherwise only refresh inside
    // `render`; a model swapped in since the last frame would be missed.
    for (const target of aimable) target.root.updateMatrixWorld(true);
    // From the child, never from a third-person camera metres behind them, so
    // reach is the same in both perspectives (LAI-JMP-01a). In first-person
    // this is exactly the screen-centre ray from the camera, as before.
    aimRay(raycaster.ray.origin, raycaster.ray.direction);
    // Sprites (labels, beacons) face the camera and need it to be hit-tested.
    raycaster.camera = camera;
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
    return manifest.interactionAssist ? nearestAhead(aimable) : null;
  }

  /**
   * Forgiving aim (`interactionAssist`): the interactable closest to straight
   * ahead and near, measured on the ground so looking up or down does not
   * matter. Only consulted when the centre ray hits nothing, so aiming at
   * one thing still wins over standing near another.
   */
  const toTarget = new Vector3();
  function nearestAhead(aimable: readonly FocusTarget[]): FocusTarget | null {
    const forwardX = Math.sin(controller.yaw);
    const forwardZ = Math.cos(controller.yaw);
    let best: FocusTarget | null = null;
    let bestScore = Infinity;
    for (const target of aimable) {
      target.root.getWorldPosition(toTarget);
      const dx = toTarget.x - controller.position.x;
      const dz = toTarget.z - controller.position.z;
      const distance = Math.hypot(dx, dz);
      if (distance > ASSIST_RANGE_METERS) continue;
      const angle =
        distance < 1e-3
          ? 0
          : Math.acos(Math.max(-1, Math.min(1, (dx * forwardX + dz * forwardZ) / distance)));
      if (angle > ASSIST_HALF_ANGLE) continue;
      // Nearer and straighter ahead both count; a thing right in front beats one off to the side.
      const score = distance * (1 + angle);
      if (score < bestScore) {
        best = target;
        bestScore = score;
      }
    }
    return best;
  }

  /*
    The focus marker (`interactionAssist`): one small gold cone, point down,
    bobbing just above whatever has focus. One mesh for the whole region,
    moved rather than rebuilt, so it costs a single draw call.
  */
  const focusMarker = manifest.interactionAssist
    ? ownMesh(
        new ConeGeometry(0.16, 0.32, 4),
        new MeshStandardMaterial({ color: FOCUS_MARKER_COLOR, emissive: FOCUS_MARKER_COLOR }),
      )
    : null;
  if (focusMarker) {
    focusMarker.name = FOCUS_MARKER_NAME;
    focusMarker.rotation.x = Math.PI;
    focusMarker.visible = false;
    scene.add(focusMarker);
  }
  const markerBounds = new Box3();
  let markerTarget: FocusTarget | null = null;
  let markerTop = 0;
  let markerClock = 0;
  function placeFocusMarker(target: FocusTarget | null, deltaSeconds: number): void {
    if (!focusMarker) return;
    if (target !== markerTarget) {
      markerTarget = target;
      // Measured on each focus change, so a model that loaded since is included.
      markerTop = target ? markerBounds.setFromObject(target.root).max.y : 0;
    }
    focusMarker.visible = target !== null;
    if (!target) return;
    markerClock += deltaSeconds;
    target.root.getWorldPosition(toTarget);
    const top = Number.isFinite(markerTop) ? markerTop : toTarget.y + 1;
    focusMarker.position.set(toTarget.x, top + 0.35 + Math.sin(markerClock * 3) * 0.08, toTarget.z);
    focusMarker.rotation.y += deltaSeconds * 1.5;
  }

  /** The line interactions are aimed along: from the player, through the screen-centre reticle. */
  function aimRay(origin: Vector3, direction: Vector3): void {
    if (lastCameraFrame) {
      origin.copy(lastCameraFrame.aimOrigin);
      lookDirection(lastCameraFrame.yaw, lastCameraFrame.pitch, direction);
      return;
    }
    origin.set(controller.position.x, controller.position.y + EYE_HEIGHT, controller.position.z);
    lookDirection(controller.yaw, controller.pitch, direction);
  }

  function interact(): void {
    if (disposed) return;
    const target = raycastFocus();
    if (!target) return;
    // The avatar's small gesture, where its model has one. Presentation only.
    avatar?.interact();
    // An extension may own this entity's interaction entirely (a plate going
    // into a socket is a move inside a puzzle, not a domain event).
    // A platform switch (an interactive prop a platform names) flips its platform.
    if (platformSystem?.isSwitch(target.entityId)) {
      platformSystem.toggleSwitch(target.entityId);
      return;
    }
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

  const controls = deps.attachControls(renderer, controller, {
    onInteract: interact,
    onToggleCamera: () => void toggleCameraMode(),
    lookSensitivity: () => cameraConfig.rotationSensitivity,
    sprintMode: () => sprintMode,
  });
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
        isBlocked: (x, z) =>
          colliders.some(
            (box) => x >= box.min.x && x <= box.max.x && z >= box.min.z && z <= box.max.z,
          ),
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
        playerPosition: () => ({ x: controller.position.x, z: controller.position.z }),
        teleportPlayer: (x, z, yaw) => {
          controller.teleport(x, z, yaw);
          playerCamera.reset();
          avatarFacing.snap(yaw);
        },
        now: () => deps.now(),
        placeChild,
        childPlacement,
        reducedMotion: options.reducedMotion === true,
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

  function emitPlatformEvent(event: PlatformEvent): void {
    switch (event.type) {
      case 'ACTIVATED':
        bus.emit('PlatformActivated', { platformId: event.platformId, ...(event.cue ? { cue: event.cue } : {}) });
        return;
      case 'MOVING':
        bus.emit('PlatformMoving', { platformId: event.platformId, ...(event.cue ? { cue: event.cue } : {}) });
        return;
      case 'STOPPED':
        bus.emit('PlatformStopped', { platformId: event.platformId, ...(event.cue ? { cue: event.cue } : {}) });
        return;
      case 'VANISHED':
        bus.emit('PlatformVanished', { platformId: event.platformId });
        return;
      case 'APPEARED':
        bus.emit('PlatformAppeared', { platformId: event.platformId });
        return;
      case 'BOUNCED':
        bus.emit('PlayerBounced', { platformId: event.platformId, ...(event.cue ? { cue: event.cue } : {}) });
        return;
      case 'PLATE_PRESSED':
        bus.emit('PressurePlatePressed', { plateId: event.plateId });
        return;
      case 'PLATE_RELEASED':
        bus.emit('PressurePlateReleased', { plateId: event.plateId });
        return;
      case 'SWITCH':
        bus.emit('PlatformSwitchToggled', { entityId: event.entityId, on: event.on });
        return;
      case 'CHECKPOINT':
        bus.emit('CourseCheckpointReached', { checkpointId: event.checkpointId, label: event.label });
        return;
      case 'GOAL':
        bus.emit('PlatformGoalReached', { goalId: event.goalId });
        return;
      case 'RECOVERED_TO':
        // Reported with PlayerRecovered (the controller's own event this frame).
        return;
    }
  }

  let lastFrameAt = deps.now();
  let frameHandle = 0;

  function frame(): void {
    if (disposed) return;
    const now = deps.now();
    const delta = Math.min((now - lastFrameAt) / 1000, MAX_FRAME_SECONDS);
    lastFrameAt = now;

    // Platforms move (and carry their rider) before the child does, so a step off a moving
    // platform starts from where it really is.
    if (platformSystem) {
      platformSystem.update(delta, controller);
      for (const event of platformSystem.consumeEvents()) emitPlatformEvent(event);
    }

    controls.update(delta);
    platformPresentation?.update(delta);

    // LAI-JMP-01: jumps, landings and safe returns, as typed events for sound
    // and anything else listening. The engine decides nothing about them.
    for (const event of controller.consumeEvents()) {
      switch (event.type) {
        case 'JUMPED':
          bus.emit('PlayerJumped', { airJump: event.airJump });
          break;
        case 'LANDED':
          playerCamera.landed(event.impactSpeed);
          bus.emit('PlayerLanded', { impactSpeed: event.impactSpeed });
          break;
        case 'RECOVERED':
          playerCamera.reset();
          bus.emit('PlayerRecovered', {
            reason: event.reason,
            ...(platformSystem ? { checkpointId: platformSystem.latestCheckpointId() } : {}),
          });
          break;
        case 'LAUNCHED':
          // A bounce pad; the platform system reports it as PlayerBounced.
          break;
      }
    }

    // Third-person keeps the look within its own range, so the orbit never dives under the ground.
    if (playerCamera.mode === 'third-person') controller.pitch = thirdPersonPitch(controller.pitch);
    const gait = controller.gait;
    const view = playerCamera.update(delta, {
      feet: controller.position,
      grounded: controller.grounded,
      yaw: controller.yaw,
      pitch: controller.pitch,
      sprinting: controller.grounded ? gait === 'sprint' : reportedGait === 'sprint',
    });
    lastCameraFrame = view;
    camera.position.copy(view.position);
    const fov = BASE_FIELD_OF_VIEW + view.fovOffset;
    if (camera.fov !== fov) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }

    // Running & sprinting: gait changes and footsteps on the ground, for sound.
    const stepX = controller.position.x - footstepFrom.x;
    const stepZ = controller.position.z - footstepFrom.z;
    footstepFrom.x = controller.position.x;
    footstepFrom.z = controller.position.z;
    if (controller.grounded) {
      if (gait !== reportedGait) {
        reportedGait = gait;
        bus.emit('PlayerGaitChanged', { gait });
      }
      if (gait === 'idle') {
        strideTravelled = 0;
      } else {
        // A teleport is not a step: only count ordinary movement.
        const moved = Math.hypot(stepX, stepZ);
        if (moved < 2) strideTravelled += moved;
        if (strideTravelled >= STRIDE_METRES[gait]) {
          strideTravelled = 0;
          bus.emit('PlayerFootstep', { gait });
        }
      }
    }
    // +PI: the controller's forward at yaw 0 is +Z, a camera's default forward is -Z.
    camera.rotation.y = view.yaw + Math.PI;
    camera.rotation.x = view.pitch;
    camera.updateMatrixWorld();

    // The avatar follows the controller; it never leads it.
    if (avatar) {
      const facingYaw = avatarFacing.update(delta, controller.horizontalVelocity);
      avatar.setPose(controller.position, facingYaw);
      avatar.setVisible(view.avatarVisible);
      avatar.animate(
        delta,
        controller.movementState,
        controller.horizontalSpeed,
        controller.walkSpeed,
        controller.runSpeed,
      );
    }

    for (const mixer of mixers) mixer.update(delta);
    for (const callback of frameCallbacks) callback(delta);

    const focused = raycastFocus();
    placeFocusMarker(focused, delta);
    const step = tracker.step(controller.position, focused?.entityId ?? null);
    for (const entityId of step.approachedEntityIds) bus.emit('NpcApproached', { entityId });
    if (step.focusChanged) bus.emit('InteractableFocused', step.focusChanged);
    for (const zoneId of step.enteredZoneIds) bus.emit('PlayerEnteredZone', { zoneId });
    for (const zoneId of step.leftZoneIds ?? []) bus.emit('PlayerLeftZone', { zoneId });

    renderer.render(scene, camera);
    frameHandle = deps.requestFrame(frame);
  }
  frameHandle = deps.requestFrame(frame);

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    uninstallProbe?.();
    deps.cancelFrame(frameHandle);
    controls.dispose();
    for (const stop of stopCelebrating) stop();
    avatar?.dispose();
    stopFitting();
    for (const mounted of extensionMounts.values()) mounted.dispose?.();
    frameCallbacks.clear();
    for (const mixer of mixers) {
      mixer.stopAllAction();
      mixer.uncacheRoot(mixer.getRoot());
    }
    platformSystem?.dispose();
    platformPresentation?.dispose();
    for (const geometry of ownedGeometries) geometry.dispose();
    for (const material of ownedMaterials) material.dispose();
    materialLibrary.dispose();
    for (const field of moteFields) field.dispose();
    scene.clear();
    renderer.dispose();
    if (renderer.domElement.parentElement === parent) {
      parent.removeChild(renderer.domElement);
    }
  }

  // Browser acceptance suites only (`vite --mode e2e`); compiled out of every other build.
  const uninstallProbe =
    import.meta.env.MODE === 'e2e'
      ? installE2EProbe({
          controller,
          targets: focusTargets,
          walkable,
          focused: () => raycastFocus()?.entityId ?? null,
          scene,
        })
      : null;

  const ready = Promise.all(pending).then(() => undefined);

  return {
    dispose,
    interact,
    placeChild,
    childPlacement,
    extensionApi: (extensionId) => extensionMounts.get(extensionId)?.api,
    pressJump: () => {
      if (!disposed) controller.pressJump();
    },
    jump: controller.jump,
    resetInput: () => controls.resetInput(),
    cameraMode: () => playerCamera.mode,
    setCameraMode,
    toggleCameraMode,
    camera: cameraConfig,
    avatar,
    locomotion: controller.speeds,
    setSprintMode: (mode) => {
      sprintMode = mode;
    },
    signalPlatforms: (name, on = true) => {
      if (!disposed) platformSystem?.signal(name, on);
    },
    platforms: () => platformSystem?.platforms ?? [],
    ready,
  };
}
