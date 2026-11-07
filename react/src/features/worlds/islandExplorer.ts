/**
 * The Island Explorer on the child's homepage (LAI-0808).
 *
 * One view of every island this child could see, built from the same pure
 * rules the Sailing Dock uses (`listTravelDestinations`) and the same place
 * rules the harbor map uses (`isLocationUnlocked`, catalog availability), so
 * the homepage can never disagree with the dock about what is open.
 *
 * Three rules, each asserted in `islandExplorer.test.ts`:
 *
 * 1. **The island you are on comes first, with its places.** Places are the
 *    only links on the home island; secret places stay hidden until opened,
 *    and places an admin has switched off (ADR-031) never appear.
 * 2. **An open island is one tap away.** It links to that island's hub.
 * 3. **A locked island is shown, never a link, and never a taunt.** It
 *    carries its authored hint (CLAUDE.md pillar 7). A world with no hint
 *    gets one calm fallback line authored here.
 *
 * Pure: no React, no network. The page passes in what it already loaded.
 */
import type { IslandLocation } from '../island/locations';
import { isLocationUnlocked } from '../island/locations';
import type { TravelDestination } from './types';

export type ExplorerIslandStatus = 'HERE' | 'OPEN' | 'LOCKED';

export interface ExplorerPlace {
  slug: string;
  title: string;
  tagline: string;
  href: string;
}

export interface ExplorerIsland {
  slug: string;
  title: string;
  tagline: string;
  status: ExplorerIslandStatus;
  /** Present only for an OPEN island. HERE uses its places; LOCKED has no link. */
  href?: string;
  /** Present only for a LOCKED island. */
  lockedHint?: string;
  /** Present only for the HERE island. */
  places: ExplorerPlace[];
}

export interface IslandExplorerInput {
  childId: string;
  destinations: readonly TravelDestination[];
  /** Places on the island the child is on. Other islands' places are reached by sailing. */
  currentIslandLocations: readonly IslandLocation[];
  worldChangeKeys: readonly string[];
  /** Place slugs an admin has deactivated (ADR-031). */
  hiddenLocationSlugs: readonly string[];
}

/** Shown when a locked world authored no hint. Readable aloud; names no skill or score. */
export const DEFAULT_LOCKED_HINT = 'This island opens later in your adventure.';

const STATUS_ORDER: Record<ExplorerIslandStatus, number> = { HERE: 0, OPEN: 1, LOCKED: 2 };

export function buildIslandExplorer({
  childId,
  destinations,
  currentIslandLocations,
  worldChangeKeys,
  hiddenLocationSlugs,
}: IslandExplorerInput): ExplorerIsland[] {
  const islands = destinations.map(({ world, isUnlocked, lockedHint, isCurrent }) => {
    const base = { slug: world.slug, title: world.title, tagline: world.tagline };
    if (isCurrent) {
      const places = currentIslandLocations
        .filter((location) => isLocationUnlocked(location, worldChangeKeys))
        .filter((location) => !hiddenLocationSlugs.includes(location.slug))
        .map((location) => ({
          slug: location.slug,
          title: location.title,
          tagline: location.tagline,
          href: `/island/${childId}/locations/${location.slug}`,
        }));
      return { ...base, status: 'HERE' as const, places };
    }
    if (!isUnlocked) {
      return {
        ...base,
        status: 'LOCKED' as const,
        lockedHint: lockedHint ?? DEFAULT_LOCKED_HINT,
        places: [],
      };
    }
    return {
      ...base,
      status: 'OPEN' as const,
      href: `/island/${childId}/worlds/${world.slug}`,
      places: [],
    };
  });

  // Stable: islands of the same status keep their authored order.
  return islands
    .map((island, index) => ({ island, index }))
    .sort(
      (a, b) => STATUS_ORDER[a.island.status] - STATUS_ORDER[b.island.status] || a.index - b.index,
    )
    .map(({ island }) => island);
}
