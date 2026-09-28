import type { Adventure } from '../catalogApi';

export type StatusFilter = 'all' | 'active' | 'inactive';

export interface AdventureFilters {
  search: string;
  /** An island id, or '' for every island. */
  islandId: string;
  status: StatusFilter;
}

/** The `/admin/adventures` search and filters (section 13), kept pure for testing. */
export function filterAdventures<
  T extends Pick<Adventure, 'name' | 'slug' | 'islandId' | 'active'>,
>(adventures: readonly T[], { search, islandId, status }: AdventureFilters): T[] {
  const needle = search.trim().toLowerCase();
  return adventures.filter(
    (adventure) =>
      (!needle ||
        adventure.name.toLowerCase().includes(needle) ||
        adventure.slug.includes(needle)) &&
      (!islandId || adventure.islandId === islandId) &&
      (status === 'all' || adventure.active === (status === 'active')),
  );
}
