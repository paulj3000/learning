import { describe, expect, it, vi } from 'vitest';

const { loadCatalogSnapshot: load } = vi.hoisted(() => ({ loadCatalogSnapshot: vi.fn() }));
vi.mock('../../api/catalog', () => ({ catalogApi: { loadCatalogSnapshot: load } }));

import { ApiError } from '../../api/errors';
import { unsupported } from '../../api/select';
import { EMPTY_CATALOG } from './availability';
import { loadCatalogSnapshot } from './availabilityApi';

describe('loadCatalogSnapshot', () => {
  it('returns the backend snapshot', async () => {
    const snapshot = { islands: [], adventures: [{ slug: 'a', islandId: 'i', active: false }] };
    load.mockResolvedValueOnce(snapshot);
    await expect(loadCatalogSnapshot()).resolves.toBe(snapshot);
  });

  it('fails open on a transient failure, as before', async () => {
    load.mockRejectedValueOnce(new ApiError('network'));
    await expect(loadCatalogSnapshot()).resolves.toBe(EMPTY_CATALOG);
    load.mockRejectedValueOnce(new Error('GraphQL blew up'));
    await expect(loadCatalogSnapshot()).resolves.toBe(EMPTY_CATALOG);
  });

  it('does not fail open when the backend has no catalog contract', async () => {
    load.mockRejectedValueOnce(unsupported('catalog'));
    await expect(loadCatalogSnapshot()).rejects.toMatchObject({ code: 'catalog_unavailable' });
    load.mockRejectedValueOnce(new ApiError('disabled'));
    await expect(loadCatalogSnapshot()).rejects.toMatchObject({ kind: 'disabled' });
  });
});
