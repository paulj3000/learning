import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  type AnimationClip,
  type Object3D,
} from 'three';
import { createNpcAnimator, type NpcAnimator } from '../animation/npcAnimator';
import type {
  BehaviorController,
  BehaviorControllerFactory,
  InputMethod,
  NpcCommand,
  NpcEngineEvent,
  NpcLoadFailure,
  NpcRuntime,
  NpcSpawn,
  PlayerPose,
} from '../contracts/engine';
import type { NpcAssetRef, RuntimeVariant } from '../contracts/types';
import { ANIMATION_PRIORITY, type AnimationState } from '../contracts/vocabulary';
import { createStationaryBehavior, turnToward, yawToward, TURN_SPEED } from './stationaryBehavior';

/**
 * The NPC renderer (LAI-NPC-008, docs/NPC_MANAGER_CONTRACTS.md section 6, `NpcRuntime`).
 *
 * Places every spawn of an `NpcSceneResponse` under an injected Three.js parent: a placeholder
 * at once, the model when the injected loader delivers it. A model that never arrives leaves
 * the placeholder, so the NPC can still be found and talked to (play is never blocked).
 *
 * Events: `npc.loaded {placeholder:false}` when the model is shown; on failure
 * `npc.load_failed` and then `npc.loaded {placeholder:true}`, so `on_spawn` fires once per
 * spawn either way. Proximity emits `npc.approached` / `npc.left` with hysteresis around each
 * placement's `interactionRadius`. `requestInteract` (and `pick`, for a raycast hit) emit
 * `npc.interact_requested`.
 *
 * Engine module (ADR-020): Three.js and the contracts only. No React, no API client, no
 * network: models come through the injected `loadModel`, which shares the asset cache.
 */

export interface LoadedNpcModel {
  /** A clone this NPC may own and place (`cloneAssetScene`); its geometry is shared. */
  scene: Object3D;
  animations: readonly AnimationClip[];
}

export type NpcModelLoader = (ref: NpcAssetRef, signal: AbortSignal) => Promise<LoadedNpcModel>;

/** A loader error may name its reason; anything else is `model_unavailable`. */
export class NpcModelLoadError extends Error {
  readonly reason: NpcLoadFailure;
  constructor(reason: NpcLoadFailure, message: string = reason) {
    super(message);
    this.reason = reason;
  }
}

export interface NpcPlaceholderStyle {
  color: number;
  width: number;
  height: number;
  depth: number;
}

/** A child-sized, warm, clearly-not-final block: visible against sand, grass and stone. */
export const DEFAULT_PLACEHOLDER: NpcPlaceholderStyle = {
  color: 0xf2a65a,
  width: 0.5,
  height: 1.2,
  depth: 0.35,
};

export interface NpcRuntimeOptions {
  parent: Object3D;
  loadModel: NpcModelLoader;
  reducedMotion: () => boolean;
  /** The behaviour engine; the built-in stationary controller when absent. */
  behaviorFactory?: BehaviorControllerFactory;
  isBlocked?: (x: number, z: number) => boolean;
  placeholder?: Partial<NpcPlaceholderStyle>;
  /** A load still pending after this long fails as `timeout` (the placeholder stays). */
  loadTimeoutMs?: number;
  /** Beyond this distance from the player, animation and behaviour update at a lower rate. */
  farDistance?: number;
}

/** `NpcRuntime` plus the host-facing input helpers. */
export interface NpcSceneRuntime extends NpcRuntime {
  /** The child asked to talk (tap, click, Enter/Space, touch). Ignored for hidden or unknown. */
  requestInteract(placementKey: string, via: InputMethod): boolean;
  /** The placement an object from a raycast hit belongs to, or null. */
  pick(object: Object3D | null): string | null;
  /** Roots to raycast against (visible NPCs only). */
  interactionTargets(): Object3D[];
  /** True between `npc.approached` and `npc.left`. */
  isNear(placementKey: string): boolean;
  /** The root group of a placement, for hosts that attach UI anchors. */
  rootOf(placementKey: string): Object3D | null;
}

export const PLACEMENT_KEY = 'npcPlacementKey';
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_FAR_DISTANCE = 30;
const FAR_UPDATE_SECONDS = 0.1;

interface Entry {
  spawn: NpcSpawn;
  key: string;
  npcId: string;
  variant: RuntimeVariant | null;
  root: Group;
  placeholder: Mesh | null;
  model: Object3D | null;
  animator: NpcAnimator;
  behavior: BehaviorController;
  abort: AbortController;
  timer: ReturnType<typeof setTimeout> | null;
  near: boolean;
  visible: boolean;
  interrupted: boolean;
  face: 'player' | { yaw: number } | null;
  yaw: number;
  pendingDelta: number;
  disposed: boolean;
}

export function hysteresisFor(radius: number): number {
  return Math.max(0.5, radius * 0.2);
}

export function createNpcRuntime(options: NpcRuntimeOptions): NpcSceneRuntime {
  const style = { ...DEFAULT_PLACEHOLDER, ...options.placeholder };
  const timeoutMs = options.loadTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const farDistance = options.farDistance ?? DEFAULT_FAR_DISTANCE;
  const listeners = new Set<(event: NpcEngineEvent) => void>();
  const entries = new Map<string, Entry>();
  let disposed = false;
  // Owned by this runtime and shared by every placeholder; disposed with the runtime.
  let placeholderGeometry: BoxGeometry | null = null;
  let placeholderMaterial: MeshStandardMaterial | null = null;

  function emit(event: NpcEngineEvent): void {
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch (error) {
        console.warn(`npc runtime listener failed for ${event.type}`, error);
      }
    }
  }

  function placeholderMesh(key: string): Mesh {
    placeholderGeometry ??= new BoxGeometry(style.width, style.height, style.depth);
    placeholderMaterial ??= new MeshStandardMaterial({ color: style.color });
    const mesh = new Mesh(placeholderGeometry, placeholderMaterial);
    mesh.name = `npc-placeholder:${key}`;
    mesh.position.y = style.height / 2;
    return mesh;
  }

  function variantOf(spawn: NpcSpawn): RuntimeVariant | null {
    const { character, placement } = spawn;
    return (
      character.variants.find((v) => v.variantKey === placement.variant) ??
      character.variants.find((v) => v.variantKey === character.defaultVariant) ??
      character.variants[0] ??
      null
    );
  }

  function applyYaw(entry: Entry): void {
    entry.root.rotation.y = entry.yaw + (entry.variant?.rotationOffsetY ?? 0);
  }

  function newAnimator(
    placementKey: string,
    variant: RuntimeVariant | null,
    root: Object3D,
    clips: readonly AnimationClip[],
  ): NpcAnimator {
    return createNpcAnimator({
      root,
      clips,
      animationMap: variant?.animationMap ?? {},
      reducedMotion: options.reducedMotion,
      onFinished: (state: AnimationState) =>
        emit({ type: 'npc.animation_finished', placementKey, state }),
    });
  }

  function createEntry(spawn: NpcSpawn): Entry {
    const { placement, character } = spawn;
    const variant = variantOf(spawn);
    const root = new Group();
    root.name = `npc:${placement.placementKey}`;
    root.userData[PLACEMENT_KEY] = placement.placementKey;
    root.position.set(
      placement.position.x,
      placement.position.y + (variant?.positionOffsetY ?? 0),
      placement.position.z,
    );
    root.scale.setScalar(placement.scale * (variant?.scale ?? 1));
    const placeholder = placeholderMesh(placement.placementKey);
    root.add(placeholder);
    const home = { x: placement.position.x, z: placement.position.z, yaw: placement.rotationY };
    const args = {
      placementKey: placement.placementKey,
      spec: placement.behavior,
      home,
      isBlocked: options.isBlocked,
      reducedMotion: options.reducedMotion(),
    };
    let behavior: BehaviorController;
    try {
      behavior = options.behaviorFactory?.(args) ?? createStationaryBehavior(args);
    } catch (error) {
      console.warn(`npc behaviour for ${placement.placementKey} failed; standing still`, error);
      behavior = createStationaryBehavior(args);
    }
    const entry: Entry = {
      spawn,
      key: placement.placementKey,
      npcId: character.npcId,
      variant,
      root,
      placeholder,
      model: null,
      animator: newAnimator(placement.placementKey, variant, placeholder, []),
      behavior,
      abort: new AbortController(),
      timer: null,
      near: false,
      visible: true,
      interrupted: false,
      face: null,
      yaw: placement.rotationY,
      pendingDelta: 0,
      disposed: false,
    };
    applyYaw(entry);
    return entry;
  }

  function failLoad(entry: Entry, reason: NpcLoadFailure): void {
    if (entry.disposed || disposed || entry.model) return;
    clearTimer(entry);
    entry.abort.abort();
    emit({ type: 'npc.load_failed', placementKey: entry.key, npcId: entry.npcId, reason });
    emit({ type: 'npc.loaded', placementKey: entry.key, npcId: entry.npcId, placeholder: true });
  }

  function clearTimer(entry: Entry): void {
    if (entry.timer !== null) clearTimeout(entry.timer);
    entry.timer = null;
  }

  function showModel(entry: Entry, loaded: LoadedNpcModel): void {
    if (entry.disposed || disposed || entry.abort.signal.aborted) return;
    clearTimer(entry);
    const previous = entry.animator.snapshot();
    entry.animator.dispose();
    if (entry.placeholder) entry.root.remove(entry.placeholder);
    entry.placeholder = null;
    entry.model = loaded.scene;
    entry.root.add(loaded.scene);
    entry.animator = newAnimator(entry.key, entry.variant, loaded.scene, loaded.animations);
    entry.animator.setBase(previous.base);
    if (previous.overlay?.mode === 'loop') {
      entry.animator.play(previous.overlay.state, previous.overlay);
    }
    emit({ type: 'npc.loaded', placementKey: entry.key, npcId: entry.npcId, placeholder: false });
  }

  function load(entry: Entry): void {
    const variant = entry.variant;
    if (!variant) {
      queueMicrotask(() => failLoad(entry, 'invalid_model'));
      return;
    }
    if (timeoutMs > 0 && Number.isFinite(timeoutMs)) {
      entry.timer = setTimeout(() => failLoad(entry, 'timeout'), timeoutMs);
    }
    let pending: Promise<LoadedNpcModel>;
    try {
      pending = options.loadModel(variant.model, entry.abort.signal);
    } catch (error) {
      pending = Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    pending.then(
      (loaded) => {
        if (!loaded || !isObject3D(loaded.scene)) {
          failLoad(entry, 'invalid_model');
          return;
        }
        showModel(entry, loaded);
      },
      (error: unknown) => {
        if (entry.abort.signal.aborted) return; // replaced, disposed or timed out
        failLoad(entry, error instanceof NpcModelLoadError ? error.reason : 'model_unavailable');
      },
    );
  }

  function disposeEntry(entry: Entry): void {
    if (entry.disposed) return;
    entry.disposed = true;
    clearTimer(entry);
    entry.abort.abort();
    entry.animator.dispose();
    entry.behavior.dispose();
    entry.root.removeFromParent();
    // The model clone shares the asset cache's geometry, materials and textures: never
    // disposed here. The placeholder's geometry and material belong to the runtime.
    entry.model = null;
    entry.placeholder = null;
  }

  function leave(entry: Entry): void {
    if (!entry.near) return;
    entry.near = false;
    emit({ type: 'npc.left', placementKey: entry.key, npcId: entry.npcId });
  }

  function updateProximity(entry: Entry, player: PlayerPose | null): void {
    if (!player || !entry.visible) {
      leave(entry);
      return;
    }
    const radius = entry.spawn.placement.interactionRadius;
    const distance = Math.hypot(player.x - entry.root.position.x, player.z - entry.root.position.z);
    if (!entry.near && distance <= radius) {
      entry.near = true;
      emit({ type: 'npc.approached', placementKey: entry.key, npcId: entry.npcId });
    } else if (entry.near && distance > radius + hysteresisFor(radius)) {
      leave(entry);
    }
  }

  function updateFacing(entry: Entry, frameYaw: number, dt: number, player: PlayerPose | null) {
    const face = entry.face;
    if (!face) {
      entry.yaw = frameYaw;
      return;
    }
    let target = entry.yaw;
    if (face === 'player') {
      if (player) {
        target = yawToward(entry.root.position.x, entry.root.position.z, player.x, player.z);
      }
    } else {
      target = face.yaw;
    }
    entry.yaw = options.reducedMotion() ? target : turnToward(entry.yaw, target, TURN_SPEED * dt);
  }

  function updateEntry(entry: Entry, deltaSeconds: number, player: PlayerPose | null): void {
    updateProximity(entry, player);
    const far =
      player !== null &&
      Math.hypot(player.x - entry.root.position.x, player.z - entry.root.position.z) > farDistance;
    entry.pendingDelta += deltaSeconds;
    if (far && entry.pendingDelta < FAR_UPDATE_SECONDS) return;
    const dt = entry.pendingDelta;
    entry.pendingDelta = 0;
    let frame;
    try {
      frame = entry.behavior.update(dt, player);
    } catch (error) {
      console.warn(`npc behaviour for ${entry.key} failed; standing still`, error);
      entry.behavior = createStationaryBehavior({
        placementKey: entry.key,
        spec: null,
        home: { x: entry.root.position.x, z: entry.root.position.z, yaw: entry.yaw },
      });
      frame = entry.behavior.update(0, player);
    }
    entry.root.position.x = frame.x;
    entry.root.position.z = frame.z;
    updateFacing(entry, frame.yaw, dt, player);
    applyYaw(entry);
    entry.animator.setBase(frame.locomotion);
    entry.animator.update(dt);
    for (const event of frame.events) emit(event);
  }

  function targets(placementKey?: string): Entry[] {
    if (placementKey === undefined) return [...entries.values()];
    const entry = entries.get(placementKey);
    return entry ? [entry] : [];
  }

  function send(command: NpcCommand): void {
    if (disposed) return;
    if (command.type === 'react') {
      for (const entry of targets(command.placementKey)) {
        const state = entry.behavior.react(command.event);
        if (state) entry.animator.play(state, { priority: ANIMATION_PRIORITY.reaction });
      }
      return;
    }
    const entry = entries.get(command.placementKey);
    if (!entry) return;
    switch (command.type) {
      case 'animate':
        entry.animator.play(command.state, { mode: command.mode, priority: command.priority });
        return;
      case 'stop_animation':
        entry.animator.stop(command.priority);
        return;
      case 'face':
        entry.face = command.target;
        return;
      case 'interrupt_behavior':
        if (entry.interrupted) return;
        entry.interrupted = true;
        entry.behavior.interrupt(command.reason);
        return;
      case 'resume_behavior':
        entry.face = null;
        if (!entry.interrupted) return;
        entry.interrupted = false;
        entry.behavior.resume();
        return;
      case 'set_visible':
        if (entry.visible === command.visible) return;
        entry.visible = command.visible;
        entry.root.visible = command.visible;
        if (!command.visible) leave(entry);
        return;
    }
  }

  return {
    mount(spawns) {
      if (disposed) return;
      for (const entry of entries.values()) {
        leave(entry);
        disposeEntry(entry);
      }
      entries.clear();
      const fresh: Entry[] = [];
      for (const spawn of spawns) {
        const key = spawn.placement.placementKey;
        if (entries.has(key)) {
          console.warn(`duplicate npc placement ${key} ignored`);
          continue;
        }
        const entry = createEntry(spawn);
        entries.set(key, entry);
        options.parent.add(entry.root);
        fresh.push(entry);
      }
      for (const entry of fresh) load(entry);
    },

    update(deltaSeconds, player) {
      if (disposed) return;
      const dt = Number.isFinite(deltaSeconds) ? Math.max(0, Math.min(deltaSeconds, 0.25)) : 0;
      for (const entry of [...entries.values()]) {
        if (!entry.disposed) updateEntry(entry, dt, player);
      }
    },

    send,

    subscribe(listener) {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    placements: () => [...entries.keys()],

    requestInteract(placementKey, via) {
      if (disposed) return false;
      const entry = entries.get(placementKey);
      if (!entry || !entry.visible) return false;
      emit({ type: 'npc.interact_requested', placementKey, npcId: entry.npcId, via });
      return true;
    },

    pick(object) {
      for (let node: Object3D | null = object; node; node = node.parent) {
        const key: unknown = node.userData[PLACEMENT_KEY];
        if (typeof key === 'string' && entries.get(key)?.root === node) return key;
      }
      return null;
    },

    interactionTargets: () =>
      [...entries.values()].filter((entry) => entry.visible).map((entry) => entry.root),

    isNear: (placementKey) => entries.get(placementKey)?.near ?? false,

    rootOf: (placementKey) => entries.get(placementKey)?.root ?? null,

    dispose() {
      if (disposed) return;
      for (const entry of entries.values()) disposeEntry(entry);
      entries.clear();
      disposed = true;
      listeners.clear();
      placeholderGeometry?.dispose();
      placeholderMaterial?.dispose();
      placeholderGeometry = null;
      placeholderMaterial = null;
    },
  };
}

function isObject3D(value: unknown): value is Object3D {
  return typeof value === 'object' && value !== null && (value as Object3D).isObject3D === true;
}
