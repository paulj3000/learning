import type { SoundAssetResolver } from '../../audio/AudioTypes';
import type { ManifestScope, ManifestScopeType } from '../../audio/manifest/manifestTypes';
import type { AssetResolver } from '../../features/island-map/three/assets/assetResolver';
import { getAccessToken } from '../auth';
import { createApiClient, type ApiClient } from '../client';
import { DJANGO_API_CONFIG, type DjangoApiConfig } from '../config';
import { createDjangoAssetResolver } from '../assets/djangoAssetResolver';

/**
 * The Django side of the Sound Manager (SM-P2-07): where a child's audio manifest comes from and
 * how its `asset-id@version` references become signed urls. Uses the same Cognito-authenticated
 * client and the same asset resolver as the 3D models; there is no second HTTP stack.
 *
 * Read-only on purpose. Staff configure sound in Django Admin (ADR-045); nothing here writes.
 */

const SEGMENT: Record<ManifestScopeType, string> = {
  island: 'islands',
  place: 'places',
  region: 'regions',
};

export function manifestPath(childId: string, scope: ManifestScope): string {
  return (
    `children/${encodeURIComponent(childId)}/audio/manifests/` +
    `${SEGMENT[scope.type]}/${encodeURIComponent(scope.id)}/`
  );
}

export interface DjangoAudioSource {
  fetchManifest(scope: ManifestScope, signal: AbortSignal): Promise<unknown>;
  resolver: SoundAssetResolver;
}

export interface DjangoAudioSourceOptions {
  client: ApiClient;
  childId: string;
  baseUrl?: string;
  now?: () => number;
}

/** There is no bundled audio, so an unpublished sound is simply unavailable. */
const NO_BUNDLED_AUDIO: AssetResolver = {
  resolve: (id) => Promise.reject(new Error(`no bundled audio for ${id}`)),
};

export function createDjangoAudioSource(options: DjangoAudioSourceOptions): DjangoAudioSource {
  const make = () =>
    createDjangoAssetResolver({
      client: options.client,
      childId: options.childId,
      baseUrl: options.baseUrl,
      fallback: NO_BUNDLED_AUDIO,
      now: options.now,
      onIssue: () => undefined, // the Sound Manager records the failure as a diagnostic
    });
  let inner = make();

  return {
    async fetchManifest(scope, signal) {
      const response = await options.client.request('GET', manifestPath(options.childId, scope), {
        signal,
      });
      return response.data;
    },
    resolver: {
      async resolve(assetId, resolveOptions) {
        // The asset resolver remembers answers until their signed url is nearly expired. When the
        // Sound Manager says a url already failed, start from a clean answer instead.
        if (resolveOptions?.forceRefresh) inner = make();
        const resolved = await inner.resolve(assetId, 'audio');
        return { id: resolved.id, url: resolved.url, cacheKey: resolved.cacheKey };
      },
    },
  };
}

/** The source for a child, or `null` when this build has no Django API (no manifest, no sound). */
export function djangoAudioSourceFor(
  childId: string,
  config: DjangoApiConfig = DJANGO_API_CONFIG,
): DjangoAudioSource | null {
  if (!config.enabled) return null;
  return createDjangoAudioSource({
    client: createApiClient({ baseUrl: config.baseUrl, getAccessToken }),
    childId,
    baseUrl: config.baseUrl,
  });
}
