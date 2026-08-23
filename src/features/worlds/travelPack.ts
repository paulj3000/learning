/**
 * Shared player identity and inventory across worlds (docs/ROADMAP.md
 * Phase 29).
 *
 * There is nothing to synchronise here, and that is the deliverable. A
 * `ChildProfile` and a `ChildInventory` are child-scoped rows
 * (docs/DATA_MODEL.md), so one child has exactly one identity and exactly
 * one backpack no matter which island they are standing on. Phase 29 added
 * no per-world profile, no per-world inventory table, and no merge step,
 * because a design with those would have had to answer "which of my two
 * selves earned this?" and there is no good answer for a five year old.
 *
 * What this module adds is the *view*: which world each thing came from, so
 * a child can see that the shell they found at home is still in the same bag
 * as the pebble they found at the cove. That mapping is read from the world
 * content packs, never stored on the item, so an item's definition stays
 * about what it is rather than where it was picked up.
 */
import type { ItemDefinition } from '../rewards/types';
import type { WorldContentPack, WorldDefinition } from './types';

export interface TravelPackGroup {
  worldSlug: string;
  /** Present when the world is registered; absent for a pack with no world. */
  worldTitle?: string;
  items: ItemDefinition[];
}

export interface TravelPackSummary {
  /** Every owned item, grouped by the world that authored it, packs in order. */
  groups: TravelPackGroup[];
  /** Owned items no pack claims. Should always be empty; surfaced, never hidden. */
  unclaimed: ItemDefinition[];
  totalItems: number;
  /** How many worlds this child is carrying something from. */
  worldsRepresented: number;
}

/**
 * Groups one child's backpack by the world each item came from.
 *
 * Deliberately total: an owned item that no pack claims is reported in
 * `unclaimed` rather than dropped, because silently hiding a child's own
 * treasure to keep a grouping tidy is the wrong trade. `packs.test.ts` makes
 * `unclaimed` impossible for authored content, so it is a floor under a
 * content mistake, not an expected state.
 */
export function summarizeTravelPack(
  ownedItemIds: readonly string[],
  items: readonly ItemDefinition[],
  packs: readonly WorldContentPack[],
  worlds: readonly WorldDefinition[],
): TravelPackSummary {
  const owned = new Set(ownedItemIds);
  const definitionsById = new Map(items.map((item) => [item.id, item]));
  const titleBySlug = new Map(worlds.map((world) => [world.slug, world.title]));

  const groups: TravelPackGroup[] = [];
  const grouped = new Set<string>();

  for (const pack of packs) {
    const packItems = pack.itemIds
      .filter((id) => owned.has(id))
      .map((id) => definitionsById.get(id))
      .filter((item): item is ItemDefinition => Boolean(item));
    for (const item of packItems) grouped.add(item.id);
    if (packItems.length > 0) {
      groups.push({
        worldSlug: pack.worldSlug,
        worldTitle: titleBySlug.get(pack.worldSlug),
        items: packItems,
      });
    }
  }

  const unclaimed = [...owned]
    .filter((id) => !grouped.has(id))
    .map((id) => definitionsById.get(id))
    .filter((item): item is ItemDefinition => Boolean(item));

  return {
    groups,
    unclaimed,
    totalItems: grouped.size + unclaimed.length,
    worldsRepresented: groups.length,
  };
}

/**
 * One calm child-facing line about the backpack travelling with them.
 *
 * Phrased without a count comparison, a target, or a "still to find": the
 * point is reassurance that nothing was left on the boat, not a checklist
 * (CLAUDE.md pillar 7).
 */
export function describeTravelPack(summary: TravelPackSummary): string {
  if (summary.totalItems === 0) {
    return 'Your backpack comes with you wherever you sail.';
  }
  if (summary.worldsRepresented <= 1) {
    return 'Everything in your backpack came with you on the boat.';
  }
  return 'Your backpack holds treasures from every island you have visited, all in one place.';
}
