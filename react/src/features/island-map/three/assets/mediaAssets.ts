import { Texture, TextureLoader, SRGBColorSpace } from 'three';
import type { AssetResolver, ResolvedMedia } from './assetResolver';

/**
 * Textures and sounds by stable asset id (AM-13). The same seam as models:
 * an id goes to an `AssetResolver`, never to a bucket URL. A missing,
 * retired or wrong-family asset answers `null` so a scene keeps its own
 * fallback (a flat colour, silence) instead of failing.
 *
 * Cache entries are keyed on the resolver's `cacheKey` (`asset@versionId`),
 * so publishing a new default version loads the new file on the next request
 * and disposes the texture it replaces. A URL that merely expired does not
 * reload anything: the resolver re-issues it when it is next asked.
 */

export type TextureFetcher = (url: string) => Promise<Texture>;

export interface ResolvedSound {
  id: string;
  url: string;
  format: string;
  cacheKey: string;
  media: ResolvedMedia | undefined;
}

export interface MediaAssetLoader {
  /** The published image as a texture, or `null` when it is not available. Shared per version. */
  loadTexture(id: string): Promise<Texture | null>;
  /** A playable URL and metadata for a published sound, or `null` when it is not available. */
  resolveSound(id: string): Promise<ResolvedSound | null>;
  /** Frees every texture this loader created. Call when the scene is torn down. */
  dispose(): void;
}

function defaultFetchTexture(url: string): Promise<Texture> {
  const absolute =
    typeof window !== 'undefined' && window.location ? new URL(url, window.location.href).href : url;
  return new Promise((resolve, reject) => {
    new TextureLoader().load(absolute, resolve, undefined, (error) =>
      reject(error instanceof Error ? error : new Error('texture failed to load')),
    );
  });
}

export function createMediaAssetLoader(
  resolver: AssetResolver,
  fetchTexture: TextureFetcher = defaultFetchTexture,
): MediaAssetLoader {
  const textures = new Map<string, { key: string; promise: Promise<Texture | null> }>();
  let disposed = false;

  function release(entry: { promise: Promise<Texture | null> }): void {
    void entry.promise.then((texture) => texture?.dispose());
  }

  async function loadTexture(id: string): Promise<Texture | null> {
    if (disposed) return null;
    let resolved;
    try {
      resolved = await resolver.resolve(id, 'image');
    } catch {
      return null;
    }
    const key = resolved.cacheKey ?? `${id}@${resolved.url}`;
    const current = textures.get(id);
    if (current?.key === key) return current.promise;
    if (current) release(current); // a new version replaced it
    const promise = fetchTexture(resolved.url).then(
      (texture) => {
        texture.colorSpace = SRGBColorSpace;
        if (disposed || textures.get(id)?.promise !== promise) texture.dispose();
        return texture;
      },
      () => {
        if (textures.get(id)?.promise === promise) textures.delete(id); // retry next time
        return null;
      },
    );
    textures.set(id, { key, promise });
    return promise;
  }

  async function resolveSound(id: string): Promise<ResolvedSound | null> {
    try {
      const resolved = await resolver.resolve(id, 'audio');
      if (resolved.family !== 'audio') return null;
      return {
        id,
        url: resolved.url,
        format: resolved.format ?? '',
        cacheKey: resolved.cacheKey ?? `${id}@${resolved.url}`,
        media: resolved.media,
      };
    } catch {
      return null;
    }
  }

  function dispose(): void {
    disposed = true;
    for (const entry of textures.values()) release(entry);
    textures.clear();
  }

  return { loadTexture, resolveSound, dispose };
}
