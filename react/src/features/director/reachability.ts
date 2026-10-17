/**
 * Every adventure this child could actually start today, filtered to
 * worlds already reached (docs/ROADMAP.md Phase 29).
 *
 * Pure: takes the raw `WorldChange.changeKey` values a caller already
 * fetched, rather than fetching them itself, so the web client (formerly
 * via `listAllWorldChanges`) and `get-next-learning-activity`'s Lambda
 * (via a raw DynamoDB `Scan`, `amplify/functions/get-next-learning-activity/handler.ts`)
 * — two very different fetch mechanisms — can share this one filtering
 * rule instead of each reimplementing it (docs/DECISIONS.md ADR-16).
 *
 * Filtering happens here, ahead of ranking, rather than inside
 * `select.ts`, which states plainly that it "ranks, it does not gate".
 * That boundary is worth keeping: an adventure on an island the child has
 * not opened the route to yet is not badly ranked, it is not a candidate
 * at all, and a suggestion nobody can act on would be a dead end dressed
 * up as guidance. Adventures at story-only pseudo-locations belong to no
 * world's map and are never filtered out.
 */
import { ADVENTURE_TEMPLATES } from '../adventures/content';
import type { AdventureDefinition } from '../adventures/engine/types';
import type { AgeBandValue } from '../child-profile/constants';
import { getWorldSlugForLocation } from '../island/locations';
import { filterToReachableWorlds, reachableWorldSlugs } from '../worlds/travel';

export function reachableAdventures(
  worldChangeKeys: readonly string[],
  ageBand: AgeBandValue,
): AdventureDefinition[] {
  const reachable = reachableWorldSlugs(worldChangeKeys, ageBand);
  return filterToReachableWorlds(
    ADVENTURE_TEMPLATES,
    (template) => template.locationSlug,
    getWorldSlugForLocation,
    reachable,
  );
}
