import * as amplify from './amplify/catalog';
import { selectApi } from './select';
import type { CatalogSnapshot } from '../features/catalog/availability';

/**
 * The admin catalog's availability flags (ADR-031), as the child app reads
 * them. Django has no equivalent read: its catalog routes
 * (`/children/{id}/regions/`, `.../adventures/`) filter availability on the
 * server and cover published regions only, which is a different contract.
 * So on Django this is `catalog_unavailable` (LAI-0503).
 */
export interface CatalogApi {
  loadCatalogSnapshot(): Promise<CatalogSnapshot>;
}

export const catalogApi: CatalogApi = selectApi<CatalogApi>('catalog', {
  amplify: { loadCatalogSnapshot: amplify.loadCatalogSnapshot },
});
