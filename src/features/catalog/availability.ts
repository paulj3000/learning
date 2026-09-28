/**
 * Whether children may play an island or adventure, given the admin catalog
 * (docs/ISLAND_ADVENTURE_MANAGEMENT.md section 17, ADR-024).
 *
 * The catalog is an overlay on source-controlled content, so a missing row
 * means "not managed yet", which is available. Only an explicit
 * `active: false` takes something out of play. An island's flag never
 * overwrites its adventures' own flags; it is combined with them here, so
 * reactivating an island restores exactly the adventures that were active.
 */

export interface CatalogIslandFlags {
  id: string;
  slug: string;
  active: boolean;
}

export interface CatalogAdventureFlags {
  slug: string;
  islandId: string;
  active: boolean;
}

export interface CatalogSnapshot {
  islands: readonly CatalogIslandFlags[];
  adventures: readonly CatalogAdventureFlags[];
}

/** What the child app assumes when the catalog is empty or cannot be read. */
export const EMPTY_CATALOG: CatalogSnapshot = { islands: [], adventures: [] };

/** The section 17 rule for two catalog records that both exist. */
export function isAdventurePlayable(
  island: { active: boolean },
  adventure: { active: boolean },
): boolean {
  return island.active && adventure.active;
}

/** Whether the island with this slug is available to children. */
export function isIslandAvailable(catalog: CatalogSnapshot, islandSlug: string): boolean {
  return catalog.islands.find((island) => island.slug === islandSlug)?.active ?? true;
}

/**
 * Whether the adventure with this template slug is available to children.
 * `codeIslandSlug` is the island the template is filed under in code
 * (`islandSlugForTemplate`), used when the adventure itself has no catalog
 * row yet but its island does.
 */
export function isAdventureAvailable(
  catalog: CatalogSnapshot,
  templateSlug: string,
  codeIslandSlug: string | undefined,
): boolean {
  const adventure = catalog.adventures.find((entry) => entry.slug === templateSlug);
  if (adventure) {
    const island = catalog.islands.find((entry) => entry.id === adventure.islandId);
    return isAdventurePlayable(island ?? { active: true }, adventure);
  }
  return codeIslandSlug === undefined ? true : isIslandAvailable(catalog, codeIslandSlug);
}
