import { beforeEach, describe, expect, it, vi } from 'vitest';
import source from './assetService.ts?raw';
import type { AssetResolver } from '../island-map/three/assets/assetResolver';

const { djangoAssetResolverFor } = vi.hoisted(() => ({ djangoAssetResolverFor: vi.fn() }));
vi.mock('../../api/assets/djangoAssetResolver', () => ({ djangoAssetResolverFor }));

import { publishedAssetResolverFor, resolveAssetUrl } from './assetService';

const DJANGO = { enabled: true, baseUrl: '' } as const;

function resolverAnswering(url: string): AssetResolver {
  return {
    resolve: vi.fn(async (id: string) => ({ id, url, source: 'PUBLISHED' as const })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('assetService (AMP-04: Django only)', () => {
  it('never imports Amplify Storage, Amplify Data or an AWS SDK', () => {
    expect(source).not.toMatch(/aws-amplify/);
    expect(source).not.toMatch(/data-client/);
    expect(source).not.toMatch(/@aws-sdk/);
  });

  it('resolves through the Django asset resolver for the child', () => {
    const resolver = resolverAnswering('https://cdn.example/m.glb');
    djangoAssetResolverFor.mockReturnValue(resolver);

    expect(publishedAssetResolverFor('child-1', DJANGO)).toBe(resolver);
    expect(djangoAssetResolverFor).toHaveBeenCalledWith('child-1', DJANGO);
  });

  it('returns the URL Django published for an id and family', async () => {
    const resolver = resolverAnswering('https://cdn.example/rock.glb');
    djangoAssetResolverFor.mockReturnValue(resolver);

    await expect(resolveAssetUrl('child-1', 'rock', 'model', DJANGO)).resolves.toBe(
      'https://cdn.example/rock.glb',
    );
    expect(resolver.resolve).toHaveBeenCalledWith('rock', 'model');
  });

  it('passes a build without the Django API to the same selector (it answers with bundled files)', async () => {
    const bundled = resolverAnswering('/models/kenney-rock-small.glb');
    djangoAssetResolverFor.mockReturnValue(bundled);

    await expect(resolveAssetUrl('child-1', 'rock', 'model', { enabled: false })).resolves.toBe(
      '/models/kenney-rock-small.glb',
    );
    expect(djangoAssetResolverFor).toHaveBeenCalledWith('child-1', { enabled: false });
  });
});
