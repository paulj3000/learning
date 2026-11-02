import { AudioError, type SoundAssetResolver, type SoundDefinition } from './AudioTypes';

export type { SoundAssetResolver };

/** Where to load a sound from, and the stable key its decoded audio is cached under. */
export interface SoundSource {
  url: string;
  cacheKey?: string;
}

/**
 * The source a definition should load from.
 *
 * - With an `assetId` and a resolver, the resolver wins (the published version).
 * - If that fails, or there is no resolver, a literal `url` is the fallback.
 * - With neither, the sound has no source: `missing-asset`.
 *
 * `forceRefresh` asks the resolver for a new answer instead of a remembered one (used when a
 * signed url turned out to have expired).
 */
export async function resolveSoundSource(
  definition: SoundDefinition,
  resolver: SoundAssetResolver | undefined,
  options: { forceRefresh?: boolean } = {},
): Promise<SoundSource> {
  if (definition.assetId && resolver) {
    try {
      const resolved = await resolver.resolve(definition.assetId, options);
      if (resolved.url) return { url: resolved.url, cacheKey: resolved.cacheKey };
    } catch (cause) {
      if (!definition.url) {
        throw new AudioError('missing-asset', `asset "${definition.assetId}" did not resolve`, {
          cause,
        });
      }
    }
  }
  if (definition.url) return { url: definition.url };
  throw new AudioError('missing-asset', `sound "${definition.id}" has no asset id or url`);
}

/** The url only; kept for callers that do not care about the cache key. */
export async function resolveSoundUrl(
  definition: SoundDefinition,
  resolver: SoundAssetResolver | undefined,
): Promise<string> {
  return (await resolveSoundSource(definition, resolver)).url;
}
