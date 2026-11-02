import { AudioError, type SoundDefinition } from './AudioTypes';

/**
 * Turns an asset id into a url. This is deliberately the same shape as the
 * 3D `AssetResolver` (`features/island-map/three/assets/assetResolver.ts`), so
 * the Django asset resolver can be passed straight in once audio assets are
 * published there (a later phase). The Sound Manager never knows a bucket,
 * a storage key or a CDN host.
 */
export interface SoundAssetResolver {
  resolve(assetId: string): Promise<{ id: string; url: string }>;
}

/**
 * The url a definition should load from.
 *
 * - With an `assetId` and a resolver, the resolver wins (the published version).
 * - If that fails, or there is no resolver, a literal `url` is the fallback.
 * - With neither, the sound has no source: `missing-asset`.
 */
export async function resolveSoundUrl(
  definition: SoundDefinition,
  resolver: SoundAssetResolver | undefined,
): Promise<string> {
  if (definition.assetId && resolver) {
    try {
      const resolved = await resolver.resolve(definition.assetId);
      if (resolved.url) return resolved.url;
    } catch (cause) {
      if (!definition.url) {
        throw new AudioError('missing-asset', `asset "${definition.assetId}" did not resolve`, {
          cause,
        });
      }
    }
  }
  if (definition.url) return definition.url;
  throw new AudioError('missing-asset', `sound "${definition.id}" has no asset id or url`);
}
