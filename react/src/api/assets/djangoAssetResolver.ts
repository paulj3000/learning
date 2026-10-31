import {
  BUNDLED_ASSET_RESOLVER,
  type AssetResolver,
  type ResolvedAsset,
} from '../../features/island-map/three/assets/assetResolver';
import { apiCredentials } from '../apiAuth';
import { ApiError } from '../errors';
import { createApiClient, type ApiClient } from '../client';
import { DJANGO_API_CONFIG, type DjangoApiConfig } from '../config';

/**
 * An `AssetResolver` backed by the Django asset manager (LAI-2200 AM-7,
 * docs/ASSET_MANAGER.md section 10). It plugs into the existing LAI-2106
 * loader unchanged: `createAssetLoader(djangoAssetResolverFor(childId))`.
 *
 * - Ids a scene asks for in the same tick go out as one request
 *   (`GET children/<child>/assets/?ids=...`), in chunks of 100.
 * - A published answer is cached until its URL is within 60 s of expiry,
 *   then resolved again. The loader caches parsed models by id, so a
 *   running scene never refetches what it already loaded.
 * - `unavailable`, `retired`, an unusable answer, or any API failure falls
 *   back to the bundled resolver, so content keeps its ids and offline or
 *   unpublished assets still load from `public/models/`. When the bundled
 *   resolver does not know the id either it rejects, which is the loader's
 *   existing failure path and draws TR-7a's placeholder.
 * - The two are reported differently (`onIssue`, TR-10): "not published" is
 *   an expected migration state, while a failed request (signed out, wrong
 *   family, Django down) is a fault that must not pass for "not published".
 * - Only `https:` URLs, or same-origin paths, are ever handed to the loader.
 *
 * Lives outside the engine folder: the engine still imports no backend client.
 */

export const MAX_IDS_PER_REQUEST = 100;

/**
 * Why an id was answered by the fallback instead of Django.
 *
 * - `not-published`: Django answered, but has no usable published version
 *   (`unavailable`, `retired`, or an answer this client refuses to load).
 * - `request-failed`: the request itself failed. `error` says how; an
 *   `ApiError` carries the kind (`unauthenticated`, `forbidden`, `not_found`,
 *   `network`, ...) and status. Never cached, so the next load asks again.
 */
export type AssetResolutionIssue =
  | { kind: 'not-published'; id: string; status: string }
  | { kind: 'request-failed'; ids: readonly string[]; error: unknown };
export const REFRESH_BEFORE_EXPIRY_MS = 60_000;

interface PublishedAsset {
  url: string;
  expiresAtMs: number;
}

export interface DjangoAssetResolverOptions {
  client: ApiClient;
  childId: string;
  /** Origin to prefix to same-origin delivery paths (the API base); '' for same origin. */
  baseUrl?: string;
  fallback?: AssetResolver;
  now?: () => number;
  /** Told whenever an id falls back. Defaults to `reportAssetResolutionIssue` (the console). */
  onIssue?: (issue: AssetResolutionIssue) => void;
}

/**
 * The default `onIssue`. Both are console warnings (the app's only log
 * channel in the browser), worded apart: a failed request names the error's
 * kind and status only (never a token or URL), while a missing publication
 * says it is expected, since unpublished ids are normal while assets migrate.
 */
export function reportAssetResolutionIssue(issue: AssetResolutionIssue): void {
  if (issue.kind === 'request-failed') {
    const detail =
      issue.error instanceof ApiError
        ? `${issue.error.kind}${issue.error.status ? ` ${issue.error.status}` : ''}`
        : 'unexpected error';
    console.warn(
      `[assets] the asset manager request failed (${detail}); using bundled models for: ${issue.ids.join(', ')}`,
    );
    return;
  }
  console.warn(
    `[assets] "${issue.id}" is ${issue.status} in the asset manager (expected until it is published); using the bundled model`,
  );
}

export function createDjangoAssetResolver(options: DjangoAssetResolverOptions): AssetResolver {
  const fallback = options.fallback ?? BUNDLED_ASSET_RESOLVER;
  const now = options.now ?? Date.now;
  const onIssue = options.onIssue ?? reportAssetResolutionIssue;
  const report = (issue: AssetResolutionIssue) => {
    try {
      onIssue(issue);
    } catch {
      // Reporting never breaks a scene.
    }
  };
  const baseUrl = options.baseUrl ?? '';
  const childPath = `children/${encodeURIComponent(options.childId)}/assets/`;
  const cache = new Map<string, PublishedAsset | null>();
  let queue: { id: string; settle: (asset: PublishedAsset | null) => void }[] = [];

  function fresh(asset: PublishedAsset | null | undefined): asset is PublishedAsset {
    return !!asset && asset.expiresAtMs - now() > REFRESH_BEFORE_EXPIRY_MS;
  }

  async function fetchChunk(ids: string[]): Promise<Map<string, PublishedAsset | null>> {
    const found = new Map<string, PublishedAsset | null>();
    try {
      const response = await options.client.request(
        'GET',
        `${childPath}?ids=${ids.map(encodeURIComponent).join(',')}`,
      );
      for (const entry of readEntries(response.data)) {
        if (!ids.includes(entry.ref)) continue;
        const published = toPublished(entry, baseUrl);
        found.set(entry.ref, published);
        if (!published) {
          const status = entry.status === 'resolved' ? 'unusable' : entry.status;
          report({ kind: 'not-published', id: entry.ref, status });
        }
      }
    } catch (error) {
      // Any failure: every id in the chunk uses the bundled fallback this time, and says why.
      report({ kind: 'request-failed', ids, error });
    }
    return found;
  }

  async function flush(): Promise<void> {
    const batch = queue;
    queue = [];
    const ids = [...new Set(batch.map((item) => item.id))];
    const results = new Map<string, PublishedAsset | null>();
    for (let start = 0; start < ids.length; start += MAX_IDS_PER_REQUEST) {
      const chunk = await fetchChunk(ids.slice(start, start + MAX_IDS_PER_REQUEST));
      for (const [id, asset] of chunk) results.set(id, asset);
    }
    for (const { id, settle } of batch) {
      const asset = results.get(id) ?? null;
      if (results.has(id)) cache.set(id, asset); // failures are not cached: retry next time
      settle(asset);
    }
  }

  function lookUp(id: string): Promise<PublishedAsset | null> {
    const cached = cache.get(id);
    if (fresh(cached)) return Promise.resolve(cached);
    if (cache.has(id) && cached === null) return Promise.resolve(null);
    return new Promise((settle) => {
      if (queue.length === 0) queueMicrotask(() => void flush());
      queue.push({ id, settle });
    });
  }

  return {
    async resolve(id: string): Promise<ResolvedAsset> {
      const published = await lookUp(id);
      if (published) return { id, url: published.url, source: 'PUBLISHED' };
      return fallback.resolve(id);
    },
  };
}

interface Entry {
  ref: string;
  status: string;
  url?: unknown;
  urlExpiresAt?: unknown;
}

function readEntries(data: unknown): Entry[] {
  if (typeof data !== 'object' || data === null) return [];
  const assets = (data as { assets?: unknown }).assets;
  if (!Array.isArray(assets)) return [];
  return assets.filter(
    (entry): entry is Entry =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as Entry).ref === 'string' &&
      typeof (entry as Entry).status === 'string',
  );
}

function toPublished(entry: Entry, baseUrl: string): PublishedAsset | null {
  if (entry.status !== 'resolved') return null;
  if (typeof entry.url !== 'string' || typeof entry.urlExpiresAt !== 'string') return null;
  const expiresAtMs = Date.parse(entry.urlExpiresAt);
  if (!Number.isFinite(expiresAtMs)) return null;
  const url = safeUrl(entry.url, baseUrl);
  return url ? { url, expiresAtMs } : null;
}

/** Only an https URL or a same-origin absolute path (never `//host`, `javascript:` or `http:`). */
function safeUrl(url: string, baseUrl: string): string | null {
  if (url.startsWith('/') && !url.startsWith('//')) return `${baseUrl}${url}`;
  try {
    return new URL(url).protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/** The resolver a child's scene would use; the bundled one when this build has no Django API. */
export function djangoAssetResolverFor(
  childId: string,
  config: DjangoApiConfig = DJANGO_API_CONFIG,
): AssetResolver {
  if (!config.enabled) return BUNDLED_ASSET_RESOLVER;
  return createDjangoAssetResolver({
    client: createApiClient({ baseUrl: config.baseUrl, ...apiCredentials() }),
    childId,
    baseUrl: config.baseUrl,
  });
}
