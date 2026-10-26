import { catalogApi } from '../../api/catalog';
import { isBackendGap } from '../../api/select';
import type { AdventureDefinition } from '../adventures/engine/types';
import { EMPTY_CATALOG, isAdventureAvailable, type CatalogSnapshot } from './availability';
import { islandSlugForTemplate } from './islandForTemplate';

/**
 * The child app's read of the admin catalog (ADR-031), through
 * `react/src/api/catalog.ts`.
 *
 * Fails open to `EMPTY_CATALOG` (everything available). The catalog is a
 * release control over curated, already-safe content, not a safety
 * boundary, and a network blip or a backend deployed before these models
 * existed must not lock a child out of the whole island. A backend with no
 * catalog contract at all (Django, LAI-0501B), or a misconfigured build, is
 * not a blip: that error propagates rather than reading as "everything is
 * available".
 */
export async function loadCatalogSnapshot(): Promise<CatalogSnapshot> {
  try {
    return await catalogApi.loadCatalogSnapshot();
  } catch (error) {
    if (isBackendGap(error)) throw error;
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
