import { InstancedMesh, LOD, Mesh, Object3D, type Material } from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { getAssetManifestEntry } from './manifest';
import { BUNDLED_ASSET_RESOLVER, type AssetResolver } from './assetResolver';
import { cloneAssetScene } from './cloneAsset';

/**
 * The runtime half of `docs/ROADMAP.md` Phase 34: loads assets through the
 * real `GLTFLoader.load()` (fetch-based) path - unlike
 * `placeholderNpcGltf.ts`'s retired `.parse()`-on-an-inline-string
 * approach, this fetches real files, cached by id so placing the same
 * asset many times (kit pieces, foliage) only parses it once. `sceneKit.ts`
 * is the only caller that should reach directly into scene construction;
 * everything else goes through `loadAsset`/`instantiateAsset` here.
 *
 * Where an id's file lives is the `AssetResolver`'s business, never this
 * file's (engine Phase 10, `assetResolver.ts`). The module-level functions
 * below are one loader bound to the bundled resolver, which is what every
 * scene uses today; `createAssetLoader` builds another over a different
 * resolver without touching a single caller.
 */

/**
 * Download progress for one fetch. `totalBytes` is `null` when the server
 * sent no usable length, which is common for compressed or chunked responses.
 */
export type ByteProgressCallback = (loadedBytes: number, totalBytes: number | null) => void;

/**
 * Fetches and parses one glTF document. Injected so a test can count fetches.
 * `onBytes` is optional to call: a fetcher that never reports progress still
 * works, and its loads simply emit no `progress` events.
 */
export type GltfFetcher = (url: string, onBytes?: ByteProgressCallback) => Promise<GLTF>;

/**
 * What one `loadAsset` request reports to its `onEvent` observer (LAI-2106).
 * Engine-level and UI-free, so a future loading screen can aggregate them.
 *
 * - `progress`: bytes downloaded so far for the shared fetch. `fraction` is
 *   in [0, 1] when the total is known, and `null` when it is not, never
 *   `NaN` or `Infinity`. Requests that share one in-flight load all see the
 *   progress events emitted after they joined.
 * - `complete`: exactly once per request that succeeded. `fromCache` is true
 *   when the asset had already finished loading before this request.
 * - `error`: exactly once per request that failed, with the same error the
 *   returned promise rejects with.
 */
export type AssetLoadEvent =
  | {
      type: 'progress';
      assetId: string;
      loadedBytes: number;
      totalBytes: number | null;
      fraction: number | null;
    }
  | { type: 'complete'; assetId: string; fromCache: boolean }
  | { type: 'error'; assetId: string; error: Error };

export type AssetLoadObserver = (event: AssetLoadEvent) => void;

export interface LoadAssetOptions {
  /** Observes this request's progress, completion and failure. Optional. */
  onEvent?: AssetLoadObserver;
}

/** Resolves a url to an absolute URL when a `window.location` is available (browser and jsdom tests alike), so `GLTFLoader.load()` never depends on an implicit relative-URL base. */
function resolveUrl(url: string): string {
  if (typeof window !== 'undefined' && window.location) {
    return new URL(url, window.location.href).href;
  }
  return url;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function createGltfFetcher(): GltfFetcher {
  const loader = new GLTFLoader();
  return (url, onBytes) =>
    new Promise<GLTF>((resolve, reject) => {
      loader.load(
        resolveUrl(url),
        resolve,
        onBytes
          ? (event: ProgressEvent) =>
              onBytes(event.loaded, event.lengthComputable ? event.total : null)
          : undefined,
        (error: unknown) => reject(toError(error)),
      );
    });
}

/** Never lets a throwing observer break a load or the other observers. */
function notify(observer: AssetLoadObserver, event: AssetLoadEvent): void {
  try {
    observer(event);
  } catch (error) {
    console.warn(`asset load observer failed for "${event.assetId}"`, error);
  }
}

function progressEvent(
  assetId: string,
  loadedBytes: number,
  totalBytes: number | null,
): AssetLoadEvent {
  const known = totalBytes !== null && Number.isFinite(totalBytes) && totalBytes > 0;
  return {
    type: 'progress',
    assetId,
    loadedBytes,
    totalBytes: known ? totalBytes : null,
    // Clamped: a compressed response's Content-Length counts compressed bytes
    // while the stream counts decoded ones, so loaded can pass total.
    fraction: known ? Math.min(1, Math.max(0, loadedBytes / totalBytes)) : null,
  };
}

function findFirstMesh(root: Object3D): Mesh | undefined {
  let found: Mesh | undefined;
  root.traverse((child) => {
    if (!found && (child as Mesh).isMesh) {
      found = child as Mesh;
    }
  });
  return found;
}

export interface InstancePlacement {
  position: { x: number; y: number; z: number };
  rotationY?: number;
  /** Non-uniform scale, e.g. stretching one `wall` kit piece to match different buildings' widths/heights. Defaults to 1 on every axis. */
  scale?: { x?: number; y?: number; z?: number };
}

export interface AssetLoader {
  /**
   * Loads (and caches) the raw parsed `GLTF` result for an asset id.
   * Concurrent requests share one load; a failed load is evicted so the next
   * request retries it.
   */
  loadAsset(id: string, options?: LoadAssetOptions): Promise<GLTF>;
  /** A fresh, independently placeable clone of an asset's scene graph, skeleton-safe for rigged models. */
  instantiateAsset(id: string, options?: LoadAssetOptions): Promise<Object3D>;
  createInstancedMeshFromAsset(
    id: string,
    placements: readonly InstancePlacement[],
  ): Promise<InstancedMesh>;
  instantiateWithLod(id: string): Promise<Object3D>;
}

export function createAssetLoader(
  resolver: AssetResolver,
  fetchGltf: GltfFetcher = createGltfFetcher(),
): AssetLoader {
  /**
   * One load per id (LAI-2106). A successful load stays cached for the
   * loader's lifetime. A failed one is removed before any caller sees the
   * rejection, so a caller that retries from its `catch` starts a fresh load.
   * Removal only happens while the map still holds *this* entry, so a stale
   * failure can never evict a newer entry for the same id, and no failure
   * touches another id's entry.
   */
  interface CacheEntry {
    promise: Promise<GLTF>;
    loaded: boolean;
    /** Observers of requests still waiting on this load; cleared when it settles. */
    observers: Set<AssetLoadObserver>;
  }
  const entriesById = new Map<string, CacheEntry>();

  function startLoad(id: string): CacheEntry {
    const observers = new Set<AssetLoadObserver>();
    const onBytes: ByteProgressCallback = (loadedBytes, totalBytes) => {
      const event = progressEvent(id, loadedBytes, totalBytes);
      for (const observer of observers) notify(observer, event);
    };
    // The callbacks below run asynchronously, after `entry` exists.
    const promise = Promise.resolve()
      .then(() => resolver.resolve(id))
      .then((resolved) => fetchGltf(resolved.url, onBytes))
      .then(
        (gltf) => {
          entry.loaded = true;
          observers.clear();
          return gltf;
        },
        (error: unknown) => {
          observers.clear();
          if (entriesById.get(id) === entry) entriesById.delete(id);
          throw toError(error);
        },
      );
    const entry: CacheEntry = { promise, loaded: false, observers };
    entriesById.set(id, entry);
    return entry;
  }

  function loadAsset(id: string, options?: LoadAssetOptions): Promise<GLTF> {
    const cached = entriesById.get(id);
    const entry = cached ?? startLoad(id);
    const observer = options?.onEvent;
    if (!observer) return entry.promise;

    const fromCache = cached?.loaded === true;
    if (!entry.loaded) entry.observers.add(observer);
    return entry.promise.then(
      (gltf) => {
        notify(observer, { type: 'complete', assetId: id, fromCache });
        return gltf;
      },
      (error: unknown) => {
        const failure = toError(error);
        notify(observer, { type: 'error', assetId: id, error: failure });
        throw failure;
      },
    );
  }

  async function instantiateAsset(id: string, options?: LoadAssetOptions): Promise<Object3D> {
    const gltf = await loadAsset(id, options);
    return cloneAssetScene(gltf.scene);
  }

  /**
   * Builds one `InstancedMesh` from a single-mesh kit piece placed at many
   * positions (roadmap: "instancing for repeated props") - one draw call
   * instead of one per placement, the same win the crate cluster already
   * proved with an inline `BoxGeometry` (`welcomeHarborScene.ts`), now
   * sourced from a loaded asset instead.
   *
   * Bakes the source mesh's authored node transform into the geometry
   * (`geometry.applyMatrix4(mesh.matrixWorld)`) before instancing: an
   * `InstancedMesh` consumes raw vertex data, so a non-identity transform on
   * the glTF node would otherwise be silently dropped.
   */
  async function createInstancedMeshFromAsset(
    id: string,
    placements: readonly InstancePlacement[],
  ): Promise<InstancedMesh> {
    const gltf = await loadAsset(id);
    const sourceMesh = findFirstMesh(gltf.scene);
    if (!sourceMesh) {
      throw new Error(`asset "${id}" has no mesh to instance`);
    }
    sourceMesh.updateMatrixWorld(true);
    const geometry = sourceMesh.geometry.clone();
    geometry.applyMatrix4(sourceMesh.matrixWorld);
    const material = (
      Array.isArray(sourceMesh.material) ? sourceMesh.material[0] : sourceMesh.material
    ) as Material;

    const instanced = new InstancedMesh(geometry, material, placements.length);
    const transform = new Object3D();
    placements.forEach((placement, index) => {
      transform.position.set(placement.position.x, placement.position.y, placement.position.z);
      transform.rotation.set(0, placement.rotationY ?? 0, 0);
      transform.scale.set(
        placement.scale?.x ?? 1,
        placement.scale?.y ?? 1,
        placement.scale?.z ?? 1,
      );
      transform.updateMatrix();
      instanced.setMatrixAt(index, transform.matrix);
    });
    instanced.instanceMatrix.needsUpdate = true;
    return instanced;
  }

  /**
   * Builds a `THREE.LOD` from a manifest entry's `lod` declaration (roadmap:
   * "LOD variants"), falling back to a plain instantiated asset when the
   * entry declares no lower-detail variant. Only `foliage-tree` declares one
   * in the first pack - proving the mechanism on one real case rather than
   * inventing detail levels for assets too small to benefit.
   */
  async function instantiateWithLod(id: string): Promise<Object3D> {
    const entry = getAssetManifestEntry(id);
    if (!entry.lod) {
      return instantiateAsset(id);
    }
    const [highDetail, lowDetail] = await Promise.all([
      instantiateAsset(id),
      instantiateAsset(entry.lod.lowDetailId),
    ]);
    const lod = new LOD();
    lod.addLevel(highDetail, 0);
    lod.addLevel(lowDetail, entry.lod.distanceMeters);
    return lod;
  }

  return { loadAsset, instantiateAsset, createInstancedMeshFromAsset, instantiateWithLod };
}

const bundledLoader = createAssetLoader(BUNDLED_ASSET_RESOLVER);

export const loadAsset = bundledLoader.loadAsset;
export const instantiateAsset = bundledLoader.instantiateAsset;
export const createInstancedMeshFromAsset = bundledLoader.createInstancedMeshFromAsset;
export const instantiateWithLod = bundledLoader.instantiateWithLod;
