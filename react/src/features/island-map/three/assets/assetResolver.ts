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
 * what source-controlled regions use. The Django asset manager's resolver
 * (`src/api/assets/djangoAssetResolver.ts`, LAI-2200) answers with the
 * published version of an id and falls back to this one; regions served by
 * the play API (Treasure Cove) load through it (TR-10,
 * `features/region-play/regionAssets.ts`). The Amplify one
 * (`src/features/assets/assetService.ts`) is admin tooling only and is not
 * wired into the child runtime.
 */

export type ResolvedAssetSource = 'BUNDLED' | 'PUBLISHED';

export interface ResolvedAsset {
  id: string;
  url: string;
  source: ResolvedAssetSource;
}

export interface AssetResolver {
  /** Rejects only for an id no catalogue knows, which is an authoring error. */
  resolve(id: string): Promise<ResolvedAsset>;
}

/** The file that ships with the app in `public/models/`. Throws for an unknown id. */
export function resolveBundledAsset(id: string): ResolvedAsset {
  return { id, url: getAssetManifestEntry(id).url, source: 'BUNDLED' };
}

export const BUNDLED_ASSET_RESOLVER: AssetResolver = {
  resolve: (id) => Promise.resolve().then(() => resolveBundledAsset(id)),
};
