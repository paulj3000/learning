import { djangoAssetResolverFor } from '../../../api/assets/djangoAssetResolver';
import {
  BUNDLED_ASSET_RESOLVER,
  type AssetResolver,
} from '../../island-map/three/assets/assetResolver';
import { DJANGO_API_CONFIG, type DjangoApiConfig } from '../../../api/config';
import { createAssetLoader, type AssetLoader } from '../../island-map/three/assets/assetLoader';
import { cloneAssetScene } from '../../island-map/three/assets/cloneAsset';
import { assetRefKey } from '../contracts/types';
import {
  NpcModelLoadError,
  type LoadedNpcModel,
  type NpcModelLoader,
} from '../engine/createNpcRuntime';

/**
 * The NPC runtime's model loader (LAI-NPC-008), kept outside the engine because it reaches the
 * asset library. It uses the existing cached loader (`assetLoader.ts`): a model is fetched and
 * parsed once per loader, and each placement gets its own `cloneAssetScene` copy (skeleton-safe,
 * sharing geometry, materials and textures with the cache, which the runtime never disposes).
 *
 * A release freezes `{assetId, version}`; the resolver is asked for `assetId@version`, or
 * `assetId` for a bundled-only reference (version null), exactly as the contract says
 * (docs/NPC_MANAGER_CONTRACTS.md section 2). The loader cannot cancel a shared fetch, so an
 * aborted request only stops waiting; the shared load still fills the cache.
 */
export function npcModelLoaderFrom(loader: Pick<AssetLoader, 'loadAsset'>): NpcModelLoader {
  return async (ref, signal): Promise<LoadedNpcModel> => {
    if (signal.aborted) throw new NpcModelLoadError('aborted');
    const gltf = await raceAbort(loader.loadAsset(assetRefKey(ref)), signal).catch(
      (error: unknown) => {
        if (error instanceof NpcModelLoadError) throw error;
        throw new NpcModelLoadError('model_unavailable', `npc model ${ref.assetId} unavailable`);
      },
    );
    if (!gltf?.scene) throw new NpcModelLoadError('invalid_model');
    return { scene: cloneAssetScene(gltf.scene), animations: gltf.animations ?? [] };
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

/** One loader per visit, resolved through the Django asset library for this child. */
export function npcModelLoaderFor(
  childId: string,
  config: DjangoApiConfig = DJANGO_API_CONFIG,
): NpcModelLoader {
  return npcModelLoaderFrom(
    createAssetLoader(withBundledIdFallback(djangoAssetResolverFor(childId, config))),
  );
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
