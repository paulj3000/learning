import { childPath, djangoClient } from '../../api/djangoClient';
import { read } from '../../api/parse';
import { EMPTY_CATALOG, type CatalogSnapshot } from './availability';

/**
 * The child app's read of which places and adventures are in play (ADR-031), from Django's
 * catalog: `GET children/<id>/availability/` (AMP-03). Release flags only, no content.
 *
 * Django's catalog has Island > Place > Adventure (ADR-041); this app's availability rule calls
 * a Place an "island" (`availability.ts`), so each Place becomes a `CatalogIslandFlags` keyed by
 * its slug, already combined with its Island's flag on the server.
 *
 * Fails open to `EMPTY_CATALOG` (everything available). The catalog is a release control over
 * curated, already-safe content, not a safety boundary, and a network blip must not lock a child
 * out of the whole island. Starting an adventure is checked again on the server
 * (`resumeOrStartSession`), so failing open here never lets a child play something out of play.
 */
export async function loadCatalogSnapshot(childProfileId: string): Promise<CatalogSnapshot> {
  try {
    const response = await djangoClient().request(
      'GET',
      childPath(childProfileId, 'availability/'),
    );
    return read(response.data, (r) => ({
      islands: r.field('places').array((p) => {
        const slug = p.field('slug').string();
        return { id: slug, slug, active: p.field('active').boolean() };
      }),
      adventures: r.field('adventures').array((a) => ({
        slug: a.field('slug').string(),
        islandId: a.field('placeSlug').string(),
        active: a.field('active').boolean(),
      })),
    }));
  } catch {
    return EMPTY_CATALOG;
  }
}

/** Thrown when a child tries to start or resume an adventure that was taken out of play. */
export class AdventureUnavailableError extends Error {
  constructor() {
    super('This adventure is resting right now. Let us pick a different one.');
    this.name = 'AdventureUnavailableError';
  }
}

/** The child-facing message for a failed start: calm for a deactivated adventure, generic otherwise. */
export function adventureStartErrorMessage(error: unknown): string {
  return error instanceof AdventureUnavailableError
    ? error.message
    : 'Something went wrong starting the adventure. Please try again.';
}
