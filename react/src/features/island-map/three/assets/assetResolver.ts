import { getAssetManifestEntry } from './manifest';

/**
 * The one step between an asset id and the bytes a loader fetches
 * (`docs/engine/06_ASSET_SYSTEM.md`, engine Phase 10):
 *
 * ```text
 * manifest asset id -> AssetResolver -> url -> assetLoader (GLTFLoader)
 * ```
 *
 * A location manifest, an extension and a legacy scene all name assets by
 * id. Only a resolver knows where an id's file lives, so no caller ever
 * holds a storage key, a bucket name or a `public/models/` path.
 *
 * `BUNDLED_ASSET_RESOLVER` (here) reads the shipped `ASSET_MANIFEST` and is
 * what source-controlled regions use. The Django asset library's resolver
 * (`src/api/assets/djangoAssetResolver.ts`, LAI-2200) answers with the
 * published version of an id and falls back to this one; regions served by
 * the play API (Treasure Cove) load through it (TR-10,
 * `features/region-play/regionAssets.ts`). There is no Amplify resolver any
 * more (AMP-04): `src/features/assets/assetService.ts` wraps the Django one.
 */

export type ResolvedAssetSource = 'BUNDLED' | 'PUBLISHED';

/** What a file is: a glTF model, a raster image or texture, or a sound (AM-13). */
export type AssetFamily = 'model' | 'image' | 'audio';

export const FAMILY_FORMATS: Readonly<Record<AssetFamily, readonly string[]>> = {
  model: ['glb', 'gltf'],
  image: ['png', 'jpeg', 'webp'],
  audio: ['mp3', 'wav', 'ogg'],
};

/** The definition kinds Django allows for each family. */
export const FAMILY_KINDS: Readonly<Record<AssetFamily, readonly string[]>> = {
  model: ['character', 'prop', 'collectible', 'kit-piece'],
  image: ['texture', 'image', 'sprite'],
  audio: ['audio'],
};

export interface ResolvedMedia {
  width?: number;
  height?: number;
  durationSeconds?: number;
  sampleRate?: number;
  channels?: number;
}

export interface ResolvedAsset {
  id: string;
  url: string;
  source: ResolvedAssetSource;
  /** Present for published assets; a bundled asset is always a model. */
  family?: AssetFamily;
  format?: string;
  /** Changes whenever the published version changes (`asset@versionId`); a cache must key on it. */
  cacheKey?: string;
  media?: ResolvedMedia;
}

export interface AssetResolver {
  /**
   * Rejects only for an id no catalogue knows, which is an authoring error. `family` is what the
   * caller needs (default `model`): an asset of another family counts as not available.
   */
  resolve(id: string, family?: AssetFamily): Promise<ResolvedAsset>;
}

/** The file that ships with the app in `public/models/`. Throws for an unknown id. */
export function resolveBundledAsset(id: string): ResolvedAsset {
  return { id, url: getAssetManifestEntry(id).url, source: 'BUNDLED' };
}

export const BUNDLED_ASSET_RESOLVER: AssetResolver = {
  resolve: (id, family = 'model') =>
    Promise.resolve().then(() => {
      // Nothing but models ships with the app.
      if (family !== 'model') throw new Error(`no bundled ${family} asset "${id}"`);
      return resolveBundledAsset(id);
    }),
};
