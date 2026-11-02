import { Texture } from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { AssetResolver, ResolvedAsset } from './assetResolver';
import { createMediaAssetLoader } from './mediaAssets';

function resolverFor(answer: () => ResolvedAsset | Error): AssetResolver {
  return {
    resolve: vi.fn(async () => {
      const result = answer();
      if (result instanceof Error) throw result;
      return result;
    }),
  };
}

const image = (cacheKey: string, url = `/f/${cacheKey}.png`): ResolvedAsset => ({
  id: 'sand',
  url,
  source: 'PUBLISHED',
  family: 'image',
  format: 'png',
  cacheKey,
});

describe('createMediaAssetLoader', () => {
  it('loads a texture once per published version and shares it', async () => {
    const fetchTexture = vi.fn(async () => new Texture());
    const loader = createMediaAssetLoader(resolverFor(() => image('sand@v1')), fetchTexture);
    const [a, b] = await Promise.all([loader.loadTexture('sand'), loader.loadTexture('sand')]);
    expect(a).toBe(b);
    expect(fetchTexture).toHaveBeenCalledTimes(1);
  });

  it('does not reload when only the URL changed (expiry refresh)', async () => {
    let n = 0;
    const fetchTexture = vi.fn(async () => new Texture());
    const loader = createMediaAssetLoader(
      resolverFor(() => image('sand@v1', `/f/${n++}.png`)),
      fetchTexture,
    );
    await loader.loadTexture('sand');
    await loader.loadTexture('sand');
    expect(fetchTexture).toHaveBeenCalledTimes(1);
  });

  it('loads the new file and disposes the old texture when the default version changes', async () => {
    let key = 'sand@v1';
    const first = new Texture();
    const second = new Texture();
    const dispose1 = vi.spyOn(first, 'dispose');
    const textures = [first, second];
    const loader = createMediaAssetLoader(
      resolverFor(() => image(key)),
      async () => textures.shift() as Texture,
    );
    expect(await loader.loadTexture('sand')).toBe(first);
    key = 'sand@v2';
    expect(await loader.loadTexture('sand')).toBe(second);
    await Promise.resolve();
    expect(dispose1).toHaveBeenCalled();
  });

  it('disposes every texture on dispose() and returns null afterwards', async () => {
    const texture = new Texture();
    const dispose = vi.spyOn(texture, 'dispose');
    const loader = createMediaAssetLoader(resolverFor(() => image('sand@v1')), async () => texture);
    await loader.loadTexture('sand');
    loader.dispose();
    await Promise.resolve();
    await Promise.resolve();
    expect(dispose).toHaveBeenCalled();
    await expect(loader.loadTexture('sand')).resolves.toBeNull();
  });

  it('answers null for a missing asset and for a failed download, and retries later', async () => {
    const missing = createMediaAssetLoader(resolverFor(() => new Error('unknown')));
    await expect(missing.loadTexture('nope')).resolves.toBeNull();
    await expect(missing.resolveSound('nope')).resolves.toBeNull();

    let fail = true;
    const loader = createMediaAssetLoader(resolverFor(() => image('sand@v1')), async () => {
      if (fail) throw new Error('404');
      return new Texture();
    });
    await expect(loader.loadTexture('sand')).resolves.toBeNull();
    fail = false;
    await expect(loader.loadTexture('sand')).resolves.toBeInstanceOf(Texture);
  });

  it('resolves a sound to a URL, format and metadata', async () => {
    const loader = createMediaAssetLoader(
      resolverFor(() => ({
        id: 'wave',
        url: '/a.ogg',
        source: 'PUBLISHED',
        family: 'audio',
        format: 'ogg',
        cacheKey: 'wave@v1',
        media: { durationSeconds: 2 },
      })),
    );
    await expect(loader.resolveSound('wave')).resolves.toMatchObject({
      url: '/a.ogg',
      format: 'ogg',
      cacheKey: 'wave@v1',
      media: { durationSeconds: 2 },
    });
  });
});
