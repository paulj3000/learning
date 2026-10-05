import { beforeEach, describe, expect, it, vi } from 'vitest';

const { assetList, assetGet, versionGet, getUrl } = vi.hoisted(() => ({
  assetList: vi.fn(),
  assetGet: vi.fn(),
  versionGet: vi.fn(),
  getUrl: vi.fn(),
}));

vi.mock('aws-amplify/storage', () => ({ getUrl }));
vi.mock('../../lib/data-client', () => ({
  client: {
    models: {
      Asset: { list: assetList, get: assetGet },
      AssetVersion: { get: versionGet },
    },
  },
}));

import {
  getAsset,
  getAssetUrl,
  getCurrentVersion,
  getPublishedAsset,
  listModelAssets,
  PUBLISHED_ASSET_RESOLVER,
  resolveModelUrl,
} from './assetService';
import type { Asset } from './types';

function asset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: 'asset-1',
    name: 'Rock',
    slug: 'rock',
    status: 'PUBLISHED',
    currentVersionId: 'version-1',
    s3Key: 'assets/models/props/asset-1/v1/model.glb',
    ...overrides,
  } as Asset;
}

beforeEach(() => {
  vi.clearAllMocks();
  getUrl.mockResolvedValue({ url: new URL('https://bucket.example/signed') });
});

describe('listModelAssets', () => {
  it('filters to models and follows every page', async () => {
    assetList
      .mockResolvedValueOnce({ data: [asset({ id: 'a' })], nextToken: 't1' })
      .mockResolvedValueOnce({ data: [asset({ id: 'b' })], nextToken: null });

    const result = await listModelAssets();

    expect(result.map((a) => a.id)).toEqual(['a', 'b']);
    expect(assetList).toHaveBeenNthCalledWith(1, {
      filter: { assetType: { eq: 'MODEL_3D' } },
      nextToken: undefined,
    });
    expect(assetList).toHaveBeenNthCalledWith(2, {
      filter: { assetType: { eq: 'MODEL_3D' } },
      nextToken: 't1',
    });
  });

  it('throws a readable error when the backend refuses', async () => {
    assetList.mockResolvedValue({ data: [], errors: [{ message: 'Unauthorized' }] });
    await expect(listModelAssets()).rejects.toThrow('Could not load the model list.');
  });
});

describe('getAsset / getPublishedAsset', () => {
  it('returns null rather than throwing when the lookup fails', async () => {
    assetGet.mockRejectedValue(new Error('Unauthorized'));
    await expect(getAsset('x')).resolves.toBeNull();
  });

  it.each(['DRAFT', 'PROCESSING', 'READY', 'ARCHIVED', 'ERROR'] as const)(
    'hides a %s asset from the game',
    async (status) => {
      assetGet.mockResolvedValue({ data: asset({ status }) });
      await expect(getPublishedAsset('asset-1')).resolves.toBeNull();
    },
  );

  it('returns a published asset', async () => {
    assetGet.mockResolvedValue({ data: asset() });
    await expect(getPublishedAsset('asset-1')).resolves.toMatchObject({ id: 'asset-1' });
  });
});

describe('getCurrentVersion', () => {
  it('reads the version the asset points at', async () => {
    versionGet.mockResolvedValue({ data: { id: 'version-1', version: 1 } });
    await expect(getCurrentVersion(asset())).resolves.toMatchObject({ version: 1 });
    expect(versionGet).toHaveBeenCalledWith({ id: 'version-1' });
  });
});

describe('getAssetUrl', () => {
  it('signs the asset key', async () => {
    await expect(getAssetUrl(asset())).resolves.toBe('https://bucket.example/signed');
    expect(getUrl).toHaveBeenCalledWith({
      path: 'assets/models/props/asset-1/v1/model.glb',
      options: { expiresIn: 3600 },
    });
  });

  it('returns null when S3 is unreachable', async () => {
    getUrl.mockRejectedValue(new Error('offline'));
    await expect(getAssetUrl(asset())).resolves.toBeNull();
  });
});

describe('resolveModelUrl', () => {
  it('uses a published asset whose slug matches the bundled id', async () => {
    assetList.mockResolvedValue({ data: [asset()] });

    await expect(resolveModelUrl('rock')).resolves.toBe('https://bucket.example/signed');
    expect(assetList).toHaveBeenCalledWith({
      filter: { slug: { eq: 'rock' }, status: { eq: 'PUBLISHED' } },
    });
  });

  it('falls back to the bundled file when the lookup is not authorized (a parent session)', async () => {
    assetList.mockRejectedValue(new Error('Unauthorized'));
    await expect(resolveModelUrl('rock')).resolves.toBe('/models/kenney-rock-small.glb');
  });

  it('falls back to the bundled file when nothing is published under that slug', async () => {
    assetList.mockResolvedValue({ data: [] });
    await expect(resolveModelUrl('rock')).resolves.toBe('/models/kenney-rock-small.glb');
  });

  it('falls back to the bundled file when the S3 url cannot be signed', async () => {
    assetList.mockResolvedValue({ data: [asset()] });
    getUrl.mockRejectedValue(new Error('offline'));
    await expect(resolveModelUrl('rock')).resolves.toBe('/models/kenney-rock-small.glb');
  });

  it('still throws for an id the bundled manifest does not know', async () => {
    await expect(resolveModelUrl('no-such-asset')).rejects.toThrow();
    expect(assetList).not.toHaveBeenCalled();
  });
});

describe('PUBLISHED_ASSET_RESOLVER', () => {
  it('says which source won, so a caller can tell a stand-in from the bundled file', async () => {
    assetList.mockResolvedValue({ data: [asset()] });
    await expect(PUBLISHED_ASSET_RESOLVER.resolve('rock')).resolves.toEqual({
      id: 'rock',
      url: 'https://bucket.example/signed',
      source: 'PUBLISHED',
    });

    assetList.mockRejectedValue(new Error('Unauthorized'));
    await expect(PUBLISHED_ASSET_RESOLVER.resolve('rock')).resolves.toEqual({
      id: 'rock',
      url: '/models/kenney-rock-small.glb',
      source: 'BUNDLED',
    });
  });
});
