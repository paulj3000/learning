import type { Box3, Camera, Scene } from 'three';
import type { WorldEngineEventBus } from '../worldEngineEvents';
import type { JsonValue, ThreeLocationManifest } from './locationManifest';

/**
 * The escape hatch for bespoke mechanics (`docs/engine/01_TARGET_ARCHITECTURE.md`
 * "Escape Hatch", ADR-025). A manifest declares `{ extensionId, config }`;
 * the generic runtime looks the id up here and mounts it. The runtime never
 * branches on a location slug, and no extension is imported by the runtime
 * itself: they are registered, then found by id.
 */

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
  /** Runs `callback` once per frame with the frame's delta in seconds. Returns an unsubscribe. */
  onFrame(callback: (deltaSeconds: number) => void): () => void;
}

export type WorldExtensionCleanup = () => void;

export interface WorldExtension {
  id: string;
  mount(context: WorldExtensionContext): WorldExtensionCleanup | void;
}

export interface WorldExtensionRegistry {
  get(id: string): WorldExtension | undefined;
  ids(): readonly string[];
}

/** Builds a registry, refusing two extensions with the same id. */
export function createWorldExtensionRegistry(
  extensions: readonly WorldExtension[],
): WorldExtensionRegistry {
  const byId = new Map<string, WorldExtension>();
  for (const extension of extensions) {
    if (byId.has(extension.id)) {
      throw new Error(`Two world extensions claim id "${extension.id}"`);
    }
    byId.set(extension.id, extension);
  }
  return {
    get: (id) => byId.get(id),
    ids: () => [...byId.keys()],
  };
}

/**
 * The extensions the app ships. Empty until the first bespoke mechanic
 * (Pirate Builder Bay's tide trial is the planned first) moves behind it in
 * Phase 7.
 */
export const SOURCE_WORLD_EXTENSIONS: WorldExtensionRegistry = createWorldExtensionRegistry([]);
