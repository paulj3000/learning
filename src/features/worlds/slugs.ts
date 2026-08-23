/**
 * World slugs, in a module that imports nothing.
 *
 * `src/features/island/locations.ts` has to name the world each location
 * belongs to, and `worlds.ts` has to check that every location it claims
 * exists. Putting the two identifiers here keeps that mutual reference from
 * becoming an import cycle, and keeps the strings themselves typo-proof.
 */

/** The island the product is named after: where every child starts. */
export const HOME_WORLD_SLUG = 'learning-adventure-island';

/** The first neighbouring world, added at Phase 29 to prove travel works. */
export const CREATURE_CARE_COVE_SLUG = 'creature-care-cove';
