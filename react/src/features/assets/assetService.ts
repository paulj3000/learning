import { getUrl } from 'aws-amplify/storage';
import { client } from '../../lib/data-client';
import { resolveBundledAsset, type AssetResolver } from '../island-map/three/assets/assetResolver';
import type { Asset, AssetVersion } from './types';

/**
 * The one place that turns an asset reference into something Three.js can
 * load (docs/android/ASSET_MANAGEMENT.md sections 21-22). Scene code should
 * never know S3 key layout, bucket names, or which version is current.
 *
 * Every function here resolves to `null` (or, for `resolveModelUrl`, the
 * bundled file) rather than throwing on a missing record or an
 * authorization failure. Asset records are Admins-only today
 * (amplify/data/resource.ts), so from a parent's session every lookup is
 * refused, and a refused lookup has to degrade to "use what ships with the
 * app", never to a broken scene.
 *
 * `PUBLISHED_ASSET_RESOLVER` is this file's `AssetResolver`
 * (`src/features/island-map/three/assets/assetResolver.ts`, engine Phase
 * 10), so the 3D runtime can take it without knowing any of the above. What
 * is deliberately not done yet is handing it to the child's scene: until
 * Phase 5 gives parents a published-only read path, it would add a
 * guaranteed-to-fail network call to every child's scene load, so
 * `assetLoader.ts` stays on the bundled resolver.
 */

/** Signed S3 URLs stay valid this long; long enough for a slow GLB download to finish. */
const SIGNED_URL_SECONDS = 60 * 60;

/** Every model asset, following pagination (an unpaginated `list()` silently stops at its page size). */
export async function listModelAssets(): Promise<Asset[]> {
  const assets: Asset[] = [];
  let nextToken: string | null | undefined;
  do {
    const {
      data,
      errors,
      nextToken: next,
    } = await client.models.Asset.list({
      filter: { assetType: { eq: 'MODEL_3D' } },
      nextToken,
    });
    if (errors?.length) {
      throw new Error('Could not load the model list.');
    }
    assets.push(...data);
    nextToken = next;
  } while (nextToken);
  return assets;
}

export async function getAsset(id: string): Promise<Asset | null> {
  try {
    const { data } = await client.models.Asset.get({ id });
    return data ?? null;
  } catch {
    return null;
  }
}

/** An asset only if it is published: the child-facing game must never see drafts (section 36). */
export async function getPublishedAsset(id: string): Promise<Asset | null> {
  const asset = await getAsset(id);
  return asset?.status === 'PUBLISHED' ? asset : null;
}

export async function getCurrentVersion(asset: Asset): Promise<AssetVersion | null> {
  try {
    const { data } = await client.models.AssetVersion.get({ id: asset.currentVersionId });
    return data ?? null;
  } catch {
    return null;
  }
}

/** A short-lived signed URL for the asset's current version, or null if it cannot be resolved. */
export async function getAssetUrl(asset: Pick<Asset, 's3Key'>): Promise<string | null> {
  try {
    const { url } = await getUrl({ path: asset.s3Key, options: { expiresIn: SIGNED_URL_SECONDS } });
    return url.toString();
  } catch {
    return null;
  }
}

async function findPublishedAssetBySlug(slug: string): Promise<Asset | null> {
  try {
    const { data } = await client.models.Asset.list({
      filter: { slug: { eq: slug }, status: { eq: 'PUBLISHED' } },
    });
    return data[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolves a model the game knows by its bundled manifest id.
 *
 * A published asset whose `slug` equals the manifest id wins, so a new
 * model can replace a bundled one without editing scene code. Anything
 * else (no such asset, not published, not authorized, S3 unreachable)
 * falls back to the file that ships in `public/models/`, which keeps every
 * region playable offline. Rejects only for an id the manifest does not
 * know, which is an authoring error, exactly as `getAssetManifestEntry` does.
 */
export const PUBLISHED_ASSET_RESOLVER: AssetResolver = {
  async resolve(id) {
    const bundled = resolveBundledAsset(id);
    const published = await findPublishedAssetBySlug(id);
    if (published) {
      const url = await getAssetUrl(published);
      if (url) return { id, url, source: 'PUBLISHED' };
    }
    return bundled;
  },
};

/** The runtime URL for a model the game knows by its bundled manifest id. */
export async function resolveModelUrl(manifestId: string): Promise<string> {
  const resolved = await PUBLISHED_ASSET_RESOLVER.resolve(manifestId);
  return resolved.url;
}
