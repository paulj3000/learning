import { client } from '../../lib/data-client';
import {
  EMPTY_CATALOG,
  type CatalogAdventureFlags,
  type CatalogIslandFlags,
  type CatalogSnapshot,
} from '../../features/catalog/availability';

/**
 * The child app's read of the admin catalog (ADR-031): only the fields the
 * availability rule needs, through an explicit selection set, so a parent's
 * session never asks for the Admins-only `createdBy`/`updatedBy` fields.
 *
 * A GraphQL error answer is `EMPTY_CATALOG`; a thrown failure propagates, and
 * `features/catalog/availabilityApi.ts` decides how to fail.
 */
export async function loadCatalogSnapshot(): Promise<CatalogSnapshot> {
  const islands: CatalogIslandFlags[] = [];
  let islandToken: string | null | undefined;
  do {
    const { data, errors, nextToken } = await client.models.Island.list({
      selectionSet: ['id', 'slug', 'active'],
      nextToken: islandToken,
    });
    if (errors?.length) return EMPTY_CATALOG;
    islands.push(...data);
    islandToken = nextToken;
  } while (islandToken);

  const adventures: CatalogAdventureFlags[] = [];
  let adventureToken: string | null | undefined;
  do {
    const { data, errors, nextToken } = await client.models.Adventure.list({
      selectionSet: ['slug', 'islandId', 'active'],
      nextToken: adventureToken,
    });
    if (errors?.length) return EMPTY_CATALOG;
    adventures.push(...data);
    adventureToken = nextToken;
  } while (adventureToken);

  return { islands, adventures };
}
