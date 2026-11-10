import { beforeEach, describe, expect, it, vi } from 'vitest';

const { assetList, assetGet, adventureModelList } = vi.hoisted(() => ({
  assetList: vi.fn(),
  assetGet: vi.fn(),
  adventureModelList: vi.fn(),
}));

vi.mock('../../lib/data-client', () => ({
  client: {
    models: {
      Asset: { list: assetList, get: assetGet },
      AdventureModel: { list: adventureModelList },
    },
  },
}));

import { listAssignableModels, listModelsByAdventure } from './catalogApi';

/**
 * The admin catalog's legacy Amplify `Asset` reads, moved here from `assetService.ts` when that
 * file became Django only (AMP-04). They go with the React admin pages (AMP-03).
 */
beforeEach(() => {
  vi.clearAllMocks();
});

describe('listAssignableModels', () => {
  it('filters to models, follows every page and sorts by name', async () => {
    assetList
      .mockResolvedValueOnce({ data: [{ id: 'b', name: 'Rock' }], nextToken: 't1' })
      .mockResolvedValueOnce({ data: [{ id: 'a', name: 'Anchor' }], nextToken: null });

    const result = await listAssignableModels();

    expect(result.map((asset) => asset.id)).toEqual(['a', 'b']);
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
    await expect(listAssignableModels()).rejects.toThrow(/Could not load the model list/);
  });
});

describe('listModelsByAdventure', () => {
  it('pairs each assignment with its asset, or null when the lookup fails', async () => {
    adventureModelList.mockResolvedValue({
      data: [
        { id: 'm1', assetId: 'asset-1', sortOrder: 0 },
        { id: 'm2', assetId: 'gone', sortOrder: 1 },
      ],
      nextToken: null,
    });
    assetGet.mockImplementation(async ({ id }: { id: string }) => {
      if (id === 'gone') throw new Error('Unauthorized');
      return { data: { id, name: 'Rock' } };
    });

    const entries = await listModelsByAdventure('adventure-1');

    expect(entries.map((entry) => entry.asset?.id ?? null)).toEqual(['asset-1', null]);
  });
});
