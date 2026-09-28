import type { AdventureDefinition } from '../adventures/engine/types';
import type { IslandLocation } from '../island/locations';
import { islandSlugForTemplate } from './islandForTemplate';

/**
 * Which catalog rows to create so every source-controlled island and
 * adventure appears in the admin section (ADR-024). Additive only: an
 * existing row is never overwritten, so an admin's edits, flags, and sort
 * order survive re-running the import after new content ships.
 */

export interface PlannedIsland {
  slug: string;
  name: string;
  shortDescription: string;
  description: string;
  sortOrder: number;
}

export interface PlannedAdventure {
  slug: string;
  name: string;
  islandSlug: string;
  sortOrder: number;
}

export interface CatalogImportPlan {
  islands: PlannedIsland[];
  adventures: PlannedAdventure[];
  /** Template slugs with no island to file them under; reported, never guessed. */
  skipped: string[];
}

const SORT_STEP = 10;

export function planCatalogImport(
  existing: { islandSlugs: readonly string[]; adventureSlugs: readonly string[] },
  locations: readonly IslandLocation[],
  templates: readonly Pick<AdventureDefinition, 'slug' | 'title' | 'locationSlug'>[],
): CatalogImportPlan {
  const islands = locations
    .map((location, index) => ({ location, sortOrder: (index + 1) * SORT_STEP }))
    .filter(({ location }) => !existing.islandSlugs.includes(location.slug))
    .map(({ location, sortOrder }) => ({
      slug: location.slug,
      name: location.title,
      shortDescription: location.tagline,
      description: location.description,
      sortOrder,
    }));

  const adventures: PlannedAdventure[] = [];
  const skipped: string[] = [];
  const seen = new Set(existing.adventureSlugs);
  templates.forEach((template, index) => {
    if (seen.has(template.slug)) return;
    seen.add(template.slug);
    const islandSlug = islandSlugForTemplate(template);
    if (!islandSlug) {
      skipped.push(template.slug);
      return;
    }
    adventures.push({
      slug: template.slug,
      name: template.title,
      islandSlug,
      sortOrder: (index + 1) * SORT_STEP,
    });
  });

  return { islands, adventures, skipped };
}
