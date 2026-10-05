import type { AnimationClip, AnimationMixer, Box3, Camera, Object3D, Scene } from 'three';
import type { WorldEngineEventBus } from '../worldEngineEvents';
import type { WorldInteractionContext } from '../../worldObjects';
import type { JsonValue, ThreeLocationManifest } from './locationManifest';

/**
 * The escape hatch for bespoke mechanics (`docs/engine/01_TARGET_ARCHITECTURE.md`
 * "Escape Hatch", ADR-025). A manifest declares `{ extensionId, config }`;
 * the generic runtime looks the id up and mounts it. The runtime never
 * branches on a location slug and never imports an extension: they are
 * registered in `../extensions/index.ts`, then found by id.
 *
 * An extension can have two halves under one id: this scene half, mounted
 * by `createLocationEngine`, and a React half (`viewExtensionRegistry.ts`)
 * mounted by `ThreeLocationWorldView`. The scene half hands the React half
 * whatever it needs through `api` (Pirate Builder Bay's tide trial: water
 * and deck controls for its panel).
 */

/** A shared, cached model; clone `scene` before placing it. */
export interface LoadedModel {
  scene: Object3D;
  animations: readonly AnimationClip[];
}

/** What a mounted extension may touch. Deliberately small; widen it only when a real extension needs more. */
export interface WorldExtensionContext {
  scene: Scene;
  camera: Camera;
  bus: WorldEngineEventBus;
  manifest: ThreeLocationManifest;
  /** This binding's own `config` from the manifest. Only the extension interprets it. */
  config: { readonly [key: string]: JsonValue };
  /** Adds a solid collider the player cannot walk through. */
  addCollider(box: Box3): void;
  /** Removes a manifest collider by its `rect.id` (a bridge once it is mended). True if one was removed. */
  removeCollider(id: string): boolean;
  /** The root object of a scenery item by its manifest id, or `undefined` if its requirements left it out. */
  sceneryRoot(id: string): Object3D | undefined;
  /**
   * The root object of an NPC, prop or collectible by its entity id, or
   * `undefined` if its requirements left it out. An entity the manifest
   * declares with no `assetId` has an empty root waiting for exactly this:
   * the extension puts its geometry inside, and the runtime keeps owning
   * focus, labels, interaction and pickup.
   */
  entityRoot(entityId: string): Object3D | undefined;
  /** The child's world state, for a mechanic that is built differently once something has changed. */
  worldState: WorldInteractionContext;
  /** Plays an NPC clip `repetitions` times, then returns the NPC to its idle clip. */
  playNpcGesture(entityId: string, clip: string, repetitions: number): void;
  /**
   * An NPC's own animation state, for a mechanic that needs more than
   * "play it a few times": a clip that plays once and *holds* at its end,
   * because the gesture is wayfinding the child needs still there when they
   * look up from the HUD.
   */
  npcAnimator(entityId: string): NpcAnimation | undefined;
  /**
   * Takes over what interacting with an entity does. The handler is called
   * with the focused entity id before the runtime emits anything; returning
   * true means the extension handled it and no `ObjectInteracted` follows.
   *
   * This is for moves *inside* a physical puzzle - picking a plate up, or
   * seating it - which are not "tell the domain something happened" and only
   * become an event once the arrangement is complete.
   */
  interceptInteract(handler: (entityId: string) => boolean): () => void;
  /**
   * Takes one of its entities out of the reticle's reach, or puts it back.
   * A thing in the child's hands rides in front of the camera, so leaving it
   * focusable would make it the nearest hit every frame and the child could
   * never aim at anywhere to put it down.
   */
  setFocusable(entityId: string, focusable: boolean): void;
  /** Loads a model through the runtime's asset pipeline. */
  loadModel(assetId: string): Promise<LoadedModel>;
  /** Runs `callback` once per frame with the frame's delta in seconds. Returns an unsubscribe. */
  onFrame(callback: (deltaSeconds: number) => void): () => void;
  /** The runtime's monotonic clock, in milliseconds. */
  now(): number;
}

/** One NPC's mixer and the clips its asset authors. */
export interface NpcAnimation {
  mixer: AnimationMixer;
  clips: readonly AnimationClip[];
  idle?: AnimationClip;
}

export interface WorldExtensionMount {
  /** Releases everything the extension created. Called once, on engine dispose. */
  dispose?(): void;
  /** Handed to the extension's React half via `LocationEngine.extensionApi`. */
  api?: unknown;
}

export interface WorldExtension {
  id: string;
  mount(context: WorldExtensionContext): WorldExtensionMount | void;
}

export interface Registry<T extends { id: string }> {
  get(id: string): T | undefined;
  ids(): readonly string[];
}

/** Builds an id-keyed registry, refusing two entries with the same id. */
export function createRegistry<T extends { id: string }>(
  entries: readonly T[],
  what: string,
): Registry<T> {
  const byId = new Map<string, T>();
  for (const entry of entries) {
    if (byId.has(entry.id)) {
      throw new Error(`Two ${what} claim id "${entry.id}"`);
    }
    byId.set(entry.id, entry);
  }
  return {
    get: (id) => byId.get(id),
    ids: () => [...byId.keys()],
  };
}

export type WorldExtensionRegistry = Registry<WorldExtension>;

export function createWorldExtensionRegistry(
  extensions: readonly WorldExtension[],
): WorldExtensionRegistry {
  return createRegistry(extensions, 'world extensions');
}
