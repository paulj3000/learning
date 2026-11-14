import { djangoAssetResolverFor } from '../../api/assets/djangoAssetResolver';
import { DJANGO_API_CONFIG, type DjangoApiConfig } from '../../api/config';
import type { AssetFamily, AssetResolver } from '../island-map/three/assets/assetResolver';

/**
 * The one place outside the engine that turns an asset id into a URL a
 * loader can fetch (docs/ASSET_LIBRARY.md section 10). Scene code never
 * knows an S3 key, a bucket name, or which version is current.
 *
 * Django is the only source of published assets (AMP-04). The Amplify
 * Storage and Amplify Data path (`Asset` / `AssetVersion` records and
 * signed `assets/*` URLs from the Amplify bucket) is gone: those objects are
 * imported into the Django asset library with
 * `manage.py migrate_amplify_asset_objects`
 * (docs/platform/AMPLIFY_STORAGE_CUTOVER.md), and Django publishes them.
 *
 * - A build with the Django API (`VITE_BACKEND=django`) resolves through
 *   `djangoAssetResolverFor`: the child's published version, falling back to
 *   the bundled file when nothing usable is published.
 * - A build without it uses the bundled `public/models/` files only.
 *
 * The admin catalog's Amplify `Asset` reads live with that admin code
 * (`features/admin/catalogApi.ts`, retired with AMP-03), not here.
 */

/** The resolver for one child's scene: Django's published assets, else the bundled files. */
export function publishedAssetResolverFor(
  childId: string,
  config: DjangoApiConfig = DJANGO_API_CONFIG,
): AssetResolver {
  return djangoAssetResolverFor(childId, config);
}

/**
 * The runtime URL for an asset the game knows by its manifest id. Rejects only
 * for an id neither Django nor the bundled manifest knows (an authoring error).
 */
export async function resolveAssetUrl(
  childId: string,
  assetId: string,
  family: AssetFamily = 'model',
  config: DjangoApiConfig = DJANGO_API_CONFIG,
): Promise<string> {
  const resolved = await publishedAssetResolverFor(childId, config).resolve(assetId, family);
  return resolved.url;
}
