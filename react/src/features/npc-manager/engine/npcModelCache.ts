import type { AnimationClip, Material, Object3D, Skeleton, Texture } from 'three';

/**
 * Shared NPC model cache (LAI-NPC-037, docs/NPC_MANAGER_PERFORMANCE.md).
 *
 * One load per asset key (`assetId@version`, scoped by the caller) for every NPC and every
 * remount that uses it. Each `acquire` takes a lease; the source stays cached while any lease is
 * held. Released sources stay warm in a bounded least-recently-used set (`capacity`), so a scene
 * revisited soon after does not load again; beyond that the oldest idle source is evicted. A
 * cache that owns its sources (`ownsSources`, i.e. nothing else holds the parsed glTF) disposes
 * an evicted source's geometries, materials, textures and skeletons, each exactly once. A source
 * in use is never evicted or disposed, and runtimes never dispose shared sources themselves.
 *
 * A failed load is forgotten at once, so the next `acquire` retries it. Engine-safe: Three.js
 * types only, no network (the caller supplies `load`).
 */

export interface NpcModelSource {
  scene: Object3D;
  animations?: readonly AnimationClip[];
}

export interface NpcModelLease<S extends NpcModelSource = NpcModelSource> {
  promise: Promise<S>;
  /** Idempotent. Call once the clone made from this source is gone (or the wait was abandoned). */
  release(): void;
}

export interface NpcModelCacheStats {
  /** `load` calls made (network loads, for a loader without its own cache). */
  loads: number;
  /** Acquisitions served by an entry already present (loading or loaded). */
  hits: number;
  evictions: number;
  /** Entries present (in use, idle, or loading). */
  entries: number;
  /** Entries with at least one lease. */
  inUse: number;
}

export interface NpcModelCache<S extends NpcModelSource = NpcModelSource> {
  acquire(key: string, load: () => Promise<S>): NpcModelLease<S>;
  stats(): NpcModelCacheStats;
  /** Evicts every idle entry (disposing owned sources). Entries in use stay. */
  trimIdle(): void;
}

export interface NpcModelCacheOptions {
  /** Idle (released, loaded) sources kept warm. Default 8. */
  capacity?: number;
  /** True when this cache is the only holder of the sources, so eviction disposes them. */
  ownsSources?: boolean;
}

export const DEFAULT_MODEL_CACHE_CAPACITY = 8;

interface CacheEntry<S> {
  promise: Promise<S>;
  source: S | null;
  refs: number;
}

export function createNpcModelCache<S extends NpcModelSource = NpcModelSource>(
  options: NpcModelCacheOptions = {},
): NpcModelCache<S> {
  const capacity = Math.max(0, options.capacity ?? DEFAULT_MODEL_CACHE_CAPACITY);
  const owns = options.ownsSources === true;
  // Insertion order is recency order: a used entry is re-inserted at the end.
  const entries = new Map<string, CacheEntry<S>>();
  let loads = 0;
  let hits = 0;
  let evictions = 0;

  function evict(key: string, entry: CacheEntry<S>): void {
    entries.delete(key);
    evictions += 1;
    if (owns && entry.source) disposeObjectResources(entry.source.scene);
  }

  function trim(limit: number): void {
    let idle = 0;
    for (const entry of entries.values()) if (entry.refs === 0 && entry.source) idle += 1;
    if (idle <= limit) return;
    for (const [key, entry] of entries) {
      if (idle <= limit) break;
      if (entry.refs === 0 && entry.source) {
        evict(key, entry);
        idle -= 1;
      }
    }
  }

  function start(key: string, load: () => Promise<S>): CacheEntry<S> {
    loads += 1;
    // The callbacks run asynchronously, after `entry` exists.
    const promise = Promise.resolve()
      .then(load)
      .then(
        (source) => {
          if (entries.get(key) === entry) {
            entry.source = source;
            if (entry.refs === 0) trim(capacity);
          }
          return source;
        },
        (error: unknown) => {
          if (entries.get(key) === entry) entries.delete(key);
          throw error instanceof Error ? error : new Error(String(error));
        },
      );
    const entry: CacheEntry<S> = { promise, source: null, refs: 0 };
    entries.set(key, entry);
    return entry;
  }

  return {
    acquire(key, load) {
      let entry = entries.get(key);
      if (entry) {
        hits += 1;
        entries.delete(key);
        entries.set(key, entry);
      } else {
        entry = start(key, load);
      }
      const held = entry;
      held.refs += 1;
      let released = false;
      return {
        promise: held.promise,
        release() {
          if (released) return;
          released = true;
          held.refs = Math.max(0, held.refs - 1);
          if (held.refs === 0 && entries.get(key) === held && held.source) trim(capacity);
        },
      };
    },

    stats() {
      let inUse = 0;
      for (const entry of entries.values()) if (entry.refs > 0) inUse += 1;
      return { loads, hits, evictions, entries: entries.size, inUse };
    },

    trimIdle() {
      trim(0);
    },
  };
}

/**
 * Disposes every geometry, material, texture and skeleton under `root`, each exactly once
 * (shared between meshes or not). Only for objects nothing else uses: an evicted owned cache
 * source. One traversal, at eviction time, never per frame.
 */
export function disposeObjectResources(root: Object3D): void {
  const disposables = new Set<{ dispose(): void }>();
  root.traverse((node) => {
    const mesh = node as Partial<{
      geometry: { dispose(): void };
      material: Material | Material[];
      skeleton: Skeleton;
    }>;
    if (mesh.geometry) disposables.add(mesh.geometry);
    if (mesh.skeleton) disposables.add(mesh.skeleton);
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : [];
    for (const material of materials) {
      disposables.add(material);
      for (const value of Object.values(material)) {
        if ((value as Partial<Texture> | null)?.isTexture) disposables.add(value as Texture);
      }
    }
  });
  for (const item of disposables) item.dispose();
}

/**
 * Skeletons under `clone` that `source` does not use (a `SkeletonUtils.clone` copy's own).
 * Collected once when the clone is made; the clone's owner disposes them once on release.
 */
export function ownedSkeletons(clone: Object3D, source: Object3D): Skeleton[] {
  const shared = new Set<Skeleton>();
  source.traverse((node) => {
    const skeleton = (node as { skeleton?: Skeleton }).skeleton;
    if (skeleton) shared.add(skeleton);
  });
  const owned = new Set<Skeleton>();
  clone.traverse((node) => {
    const skeleton = (node as { skeleton?: Skeleton }).skeleton;
    if (skeleton && !shared.has(skeleton)) owned.add(skeleton);
  });
  return [...owned];
}
