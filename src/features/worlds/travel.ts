/**
 * The travel system (docs/ROADMAP.md Phase 29, "world/region registry and a
 * travel system").
 *
 * Pure and deterministic, like every other engine's non-`api` half: worlds
 * plus the child's own world changes and age band go in, an ordered travel
 * deck comes out. Nothing here reads the network, and nothing here decides
 * what a child has learned.
 *
 * Two design choices are worth stating, because both are product rules
 * rather than implementation details:
 *
 * - **A closed route is still shown.** `isLocationUnlocked` hides a secret
 *   location entirely, because a secret that announces itself is not a
 *   secret. A world is the opposite: the boat is visibly there at the end of
 *   the dock, so hiding the destination would make the island feel smaller
 *   than it is. A locked destination therefore renders with its authored
 *   `lockedHint`, which describes what would open it - the same rule
 *   `DiscoveryDefinition.lockedMessage` follows.
 * - **Age band is a hard filter, not a hint.** A world with no adventure a
 *   child's band can play is not offered at all. Offering it and then having
 *   every location say "not available for your age yet" is the failure
 *   CLAUDE.md section 3 rules out.
 */
import type { AgeBandValue } from '../child-profile/constants';
import { WORLD_DEFINITIONS, getHomeWorld } from './worlds';
import type { TravelDestination, WorldDefinition } from './types';

/** Whether this world's route has opened for a child with these world changes. */
export function isWorldUnlocked(
  world: Pick<WorldDefinition, 'travelRequirement'>,
  worldChangeKeys: readonly string[],
): boolean {
  const requirement = world.travelRequirement;
  if (!requirement) return true;
  return requirement.anyOfChangeKeys.some((key) => worldChangeKeys.includes(key));
}

/** Whether this world is authored for this child's band at all. */
export function isWorldForAgeBand(
  world: Pick<WorldDefinition, 'supportedAgeBands'>,
  ageBand: AgeBandValue,
): boolean {
  return world.supportedAgeBands.includes(ageBand);
}

export interface TravelDeckInput {
  /** The world the child is looking out from. Defaults to the home world. */
  fromWorldSlug?: string;
  worldChangeKeys: readonly string[];
  ageBand: AgeBandValue;
}

/**
 * Every destination this child could see, home first and then in authored
 * order, so the deck does not reorder itself as a child unlocks things.
 */
export function listTravelDestinations({
  fromWorldSlug,
  worldChangeKeys,
  ageBand,
}: TravelDeckInput): TravelDestination[] {
  const currentSlug = fromWorldSlug ?? getHomeWorld().slug;
  return WORLD_DEFINITIONS.filter((world) => isWorldForAgeBand(world, ageBand)).map((world) => {
    const isUnlocked = isWorldUnlocked(world, worldChangeKeys);
    return {
      world,
      isUnlocked,
      lockedHint: isUnlocked ? undefined : world.travelRequirement?.lockedHint,
      isCurrent: world.slug === currentSlug,
    };
  });
}

/** The worlds a child can actually be in right now. */
export function reachableWorldSlugs(
  worldChangeKeys: readonly string[],
  ageBand: AgeBandValue,
): string[] {
  return WORLD_DEFINITIONS.filter(
    (world) => isWorldForAgeBand(world, ageBand) && isWorldUnlocked(world, worldChangeKeys),
  ).map((world) => world.slug);
}

/** Whether this child may currently be in this world. */
export function canTravelTo(
  worldSlug: string,
  worldChangeKeys: readonly string[],
  ageBand: AgeBandValue,
): boolean {
  return reachableWorldSlugs(worldChangeKeys, ageBand).includes(worldSlug);
}

/**
 * Keeps a list of anything located somewhere to the worlds a child can
 * reach.
 *
 * Written generically because the same rule has to hold in more than one
 * place and must not be re-derived each time: the Adaptive Adventure
 * Director (Phase 28) must not suggest an adventure on an island the child
 * cannot sail to, since a suggestion nobody can act on is a dead end dressed
 * up as guidance. Callers pass the location-to-world lookup rather than this
 * module importing the location registry, so travel stays free of content
 * imports.
 */
export function filterToReachableWorlds<T>(
  items: readonly T[],
  locationSlugOf: (item: T) => string,
  worldSlugOfLocation: (locationSlug: string) => string | undefined,
  reachable: readonly string[],
): T[] {
  return items.filter((item) => {
    const worldSlug = worldSlugOfLocation(locationSlugOf(item));
    // Content at a story-only pseudo-location belongs to no world's map and
    // is reached through a story rather than by sailing, so it is never
    // filtered out here.
    if (!worldSlug) return true;
    return reachable.includes(worldSlug);
  });
}
