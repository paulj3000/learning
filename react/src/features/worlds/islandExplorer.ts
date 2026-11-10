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
import type { IslandsView } from '../../api/play/islandsApi';
import type { IslandLocation } from '../island/locations';
import { ISLAND_LOCATIONS, isLocationUnlocked } from '../island/locations';
import { locationWorldPath } from '../island-map/three/runtime/locationWorldPath';
import type { TravelDestination } from './types';

export type ExplorerIslandStatus = 'HERE' | 'OPEN' | 'LOCKED';

export interface ExplorerPlace {
  slug: string;
  title: string;
  tagline: string;
  href: string;
  /** AP-03 (server view only): the child has started something here. */
  explored?: boolean;
  /** AP-03: the Place's published 3D Area, such as Treasure Cove, when it has its own page too. */
  area?: { title: string; href: string };
}

/** AP-03: "2 of 5 places explored". Places, never points or a score. */
export interface ExplorerProgress {
  explored: number;
  total: number;
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
  /** AP-03 discovery details, from the server. Absent in a build without the Django API. */
  subjects?: string[];
  ageBands?: string[];
  progress?: ExplorerProgress;
}

export interface IslandExplorerInput {
  childId: string;
  destinations: readonly TravelDestination[];
  /** Places on the island the child is on. Other islands' places are reached by sailing. */
  currentIslandLocations: readonly IslandLocation[];
  worldChangeKeys: readonly string[];
  /** Place slugs an admin has deactivated (ADR-031). */
  hiddenLocationSlugs: readonly string[];
  /**
   * Places on the island the child is on that exist only in Django (ADR-047), such as Firepeak
   * Volcano, already filtered by the server for this child. Listed after the source Places, with
   * the link the caller built (straight to their 3D Area).
   */
  servedPlaces?: readonly ExplorerPlace[];
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
  servedPlaces = [],
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
      const sourceSlugs = new Set(places.map((place) => place.slug));
      places.push(...servedPlaces.filter((place) => !sourceSlugs.has(place.slug)));
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

  return byStatus(islands);
}

/** Stable: islands of the same status keep their authored order. */
function byStatus(islands: ExplorerIsland[]): ExplorerIsland[] {
  return islands
    .map((island, index) => ({ island, index }))
    .sort(
      (a, b) => STATUS_ORDER[a.island.status] - STATUS_ORDER[b.island.status] || a.index - b.index,
    )
    .map(({ island }) => island);
}

/**
 * AP-03: the Island Explorer from Django's published catalog
 * (`GET /children/<id>/islands/`, ADR-041), so the homepage lists what an administrator has
 * published rather than a second, hard-coded list. The server has already applied every rule:
 * active Islands and Places, this child's age band, secret Places still hidden, and whether each
 * Island is open. This only shapes the answer into links.
 *
 * - The home Island is HERE, with its Places. A Place with a source page links to it, and its
 *   published 3D Area (Treasure Cove) is offered beside it; a Place that exists only in Django
 *   (Firepeak Volcano) links straight to its 3D Area. A Place with neither is left out.
 * - Another open Island links to its hub; a closed one shows its authored hint.
 */
export function buildIslandExplorerFromServer(
  childId: string,
  view: IslandsView,
): ExplorerIsland[] {
  const sourcePages = new Set(ISLAND_LOCATIONS.map((location) => location.slug));
  const islands = view.islands.map((island): ExplorerIsland => {
    const details = {
      slug: island.islandId,
      title: island.title,
      tagline: island.tagline,
      subjects: island.subjects,
      ageBands: island.ageBands,
      ...(island.progress
        ? {
            progress: {
              explored: island.progress.placesExplored,
              total: island.progress.placesTotal,
            },
          }
        : {}),
    };
    if (island.isHome) {
      const places = island.places.flatMap((place): ExplorerPlace[] => {
        const area =
          place.area?.available === true
            ? { title: place.area.title, href: locationWorldPath(childId, place.area.regionId) }
            : undefined;
        const common = {
          slug: place.placeId,
          title: place.title,
          tagline: place.tagline,
          explored: place.explored,
        };
        if (sourcePages.has(place.placeId)) {
          return [{ ...common, href: `/island/${childId}/locations/${place.placeId}`, area }];
        }
        return area ? [{ ...common, href: area.href }] : [];
      });
      return { ...details, status: 'HERE', places };
    }
    if (!island.unlocked) {
      return {
        ...details,
        status: 'LOCKED',
        lockedHint: island.lockedHint ?? DEFAULT_LOCKED_HINT,
        places: [],
      };
    }
    return {
      ...details,
      status: 'OPEN',
      href: `/island/${childId}/worlds/${island.islandId}`,
      places: [],
    };
  });
  return byStatus(islands);
}
