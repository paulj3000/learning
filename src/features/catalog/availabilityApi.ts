import { client } from '../../lib/data-client';
import type { AdventureDefinition } from '../adventures/engine/types';
import {
  EMPTY_CATALOG,
  isAdventureAvailable,
  type CatalogAdventureFlags,
  type CatalogIslandFlags,
  type CatalogSnapshot,
} from './availability';
import { islandSlugForTemplate } from './islandForTemplate';

/**
 * The child app's read of the admin catalog (ADR-024): only the fields the
 * availability rule needs, through an explicit selection set, so a parent's
 * session never asks for the Admins-only `createdBy`/`updatedBy` fields.
 *
 * Fails open to `EMPTY_CATALOG` (everything available). The catalog is a
 * release control over curated, already-safe content, not a safety
 * boundary, and a network blip or a backend deployed before these models
 * existed must not lock a child out of the whole island.
 */
export async function loadCatalogSnapshot(): Promise<CatalogSnapshot> {
  try {
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
  } catch {
    return EMPTY_CATALOG;
  }
}

/** Thrown when a child tries to start or resume an adventure an admin has taken out of play. */
export class AdventureUnavailableError extends Error {
  constructor() {
    super('This adventure is resting right now. Let us pick a different one.');
    this.name = 'AdventureUnavailableError';
  }
}

/** Throws `AdventureUnavailableError` unless the catalog allows this adventure to be played. */
export async function assertAdventureAvailable(
  definition: Pick<AdventureDefinition, 'slug' | 'locationSlug'>,
): Promise<void> {
  const catalog = await loadCatalogSnapshot();
  if (!isAdventureAvailable(catalog, definition.slug, islandSlugForTemplate(definition))) {
    throw new AdventureUnavailableError();
  }
}

/** The child-facing message for a failed start: calm for a deactivated adventure, generic otherwise. */
export function adventureStartErrorMessage(error: unknown): string {
  return error instanceof AdventureUnavailableError
    ? error.message
    : 'Something went wrong starting the adventure. Please try again.';
}
