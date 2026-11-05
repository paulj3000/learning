import { djangoAssetResolverFor } from '../../../api/assets/djangoAssetResolver';
import {
  BUNDLED_ASSET_RESOLVER,
  type AssetResolver,
} from '../../island-map/three/assets/assetResolver';
import { DJANGO_API_CONFIG, type DjangoApiConfig } from '../../../api/config';
import { createAssetLoader, type AssetLoader } from '../../island-map/three/assets/assetLoader';
import { cloneAssetScene } from '../../island-map/three/assets/cloneAsset';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { assetRefKey } from '../contracts/types';
import { createNpcModelCache, ownedSkeletons, type NpcModelCache } from '../engine/npcModelCache';
import {
  NpcModelLoadError,
  type LoadedNpcModel,
  type NpcModelLoader,
} from '../engine/createNpcRuntime';

/**
 * The NPC runtime's model loader (LAI-NPC-008, -037), kept outside the engine because it reaches
 * the asset library. Sources go through a shared, reference-counted `NpcModelCache`
 * (`../engine/npcModelCache.ts`): one load per asset key for every NPC and remount, and each
 * placement gets its own `cloneAssetScene` copy (skeleton-safe, sharing geometry, materials and
 * textures with the cached source, which the runtime never disposes).
 *
 * Each model comes with `release()`: it disposes what the clone owns (its cloned skeletons,
 * exactly once) and returns the lease, so the cache may later evict the source.
 *
 * A release freezes `{assetId, version}`; the resolver is asked for `assetId@version`, or
 * `assetId` for a bundled-only reference (version null), exactly as the contract says
 * (docs/NPC_MANAGER_CONTRACTS.md section 2). A shared load cannot be cancelled, so an aborted
 * request only stops waiting (and returns its lease); the shared load still fills the cache.
 */
export interface NpcModelLoaderOptions {
  /** Default: a cache private to this loader, which never disposes the loader's sources. */
  cache?: NpcModelCache<GLTF>;
  /** Prefix that keeps cache keys of different children or servers apart. */
  scope?: string;
}

export function npcModelLoaderFrom(
  loader: Pick<AssetLoader, 'loadAsset'>,
  options: NpcModelLoaderOptions = {},
): NpcModelLoader {
  const cache = options.cache ?? createNpcModelCache<GLTF>();
  const prefix = options.scope ? `${options.scope}\u0000` : '';
  return async (ref, signal): Promise<LoadedNpcModel> => {
    if (signal.aborted) throw new NpcModelLoadError('aborted');
    const id = assetRefKey(ref);
    const lease = cache.acquire(prefix + id, () => loader.loadAsset(id));
    let gltf: GLTF;
    try {
      gltf = await raceAbort(lease.promise, signal);
    } catch (error) {
      lease.release();
      if (error instanceof NpcModelLoadError) throw error;
      throw new NpcModelLoadError('model_unavailable', `npc model ${ref.assetId} unavailable`);
    }
    if (!gltf?.scene) {
      lease.release();
      throw new NpcModelLoadError('invalid_model');
    }
    const scene = cloneAssetScene(gltf.scene);
    const skeletons = ownedSkeletons(scene, gltf.scene);
    let released = false;
    return {
      scene,
      animations: gltf.animations ?? [],
      release() {
        if (released) return;
        released = true;
        for (const skeleton of skeletons) skeleton.dispose();
        lease.release();
      },
    };
  };
}

/**
 * A resolver that, when `primary` cannot resolve a pinned reference (`assetId@n`), retries the
 * bare `assetId` through the bundled catalogue. The asset library's own fallback is the bundled
 * resolver, which knows ids but not `@n` refs, so without this an offline or disabled Django
 * would turn every pinned NPC model into a placeholder even when the model ships with the app.
 */
export function withBundledIdFallback(
  primary: AssetResolver,
  bundled: AssetResolver = BUNDLED_ASSET_RESOLVER,
): AssetResolver {
  return {
    async resolve(id, family) {
      try {
        return await primary.resolve(id, family);
      } catch (error) {
        const at = id.lastIndexOf('@');
        if (at <= 0) throw error;
        return bundled.resolve(id.slice(0, at), family);
      }
    },
  };
}

/**
 * The app-wide NPC model cache: shared by every visit, so walking back into a scene reuses the
 * parsed models. It owns its sources (each miss loads through a single-use asset loader), so an
 * evicted idle source is disposed.
 */
export const SHARED_NPC_MODEL_CACHE: NpcModelCache<GLTF> = createNpcModelCache<GLTF>({
  capacity: 12,
  ownsSources: true,
});

/** A loader for this child, resolved through the Django asset library, on the shared cache. */
export function npcModelLoaderFor(
  childId: string,
  config: DjangoApiConfig = DJANGO_API_CONFIG,
  cache: NpcModelCache<GLTF> = SHARED_NPC_MODEL_CACHE,
): NpcModelLoader {
  const resolver = withBundledIdFallback(djangoAssetResolverFor(childId, config));
  // Single use per miss: the cache is the only holder of the parsed source.
  const loadAsset = (id: string) => createAssetLoader(resolver).loadAsset(id);
  const scope = config.enabled ? `${config.baseUrl}|${childId}` : 'bundled';
  return npcModelLoaderFrom({ loadAsset }, { cache, scope });
}

function raceAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new NpcModelLoadError('aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
