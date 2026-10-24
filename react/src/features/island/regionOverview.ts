import { ISLAND_LOCATIONS, isLocationUnlocked } from './locations';
import { getWorld } from '../worlds/worlds';

export interface RegionOverviewEntry {
  slug: string;
  title: string;
  tagline: string;
  worldSlug: string;
  worldTitle: string;
  /** False for a secret place this child has not opened yet (`unlockRequirement`). */
  unlocked: boolean;
}

/**
 * Every authored region on every world, in authored order, annotated with
 * whether this child has opened it yet.
 *
 * Unlike the child-facing map (`WelcomeHarbor`, `WorldHubPage`), this does not
 * filter locked places out: the parent dashboard lists all of them, showing
 * the locked ones as not yet discovered. That is a parent-only view, so it
 * spoils nothing for the child, and it answers the question a parent actually
 * has, which is how much of the island is still ahead.
 */
export function listAllRegions(worldChangeKeys: readonly string[]): RegionOverviewEntry[] {
  return ISLAND_LOCATIONS.map((location) => ({
    slug: location.slug,
    title: location.title,
    tagline: location.tagline,
    worldSlug: location.worldSlug,
    worldTitle: getWorld(location.worldSlug)?.title ?? location.worldSlug,
    unlocked: isLocationUnlocked(location, worldChangeKeys),
  }));
}
