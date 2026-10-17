/**
 * Pure inventory operations (docs/ROADMAP.md Phase 24).
 *
 * The backpack is a set of owned item IDs. Every function here is additive
 * or read-only: there is deliberately no `removeItem`, no `spendItem`, and
 * no `clearInventory` reachable from gameplay, because nothing a child owns
 * may ever be taken away as a mechanic (see `types.ts`, property 3). The one
 * deletion path is a parent-facing retention action in `api.ts`.
 */
import type { Inventory, ItemDefinition, ItemId } from './types';

export const EMPTY_INVENTORY: Inventory = Object.freeze([]);

export function hasItem(inventory: Inventory, itemId: ItemId): boolean {
  return inventory.includes(itemId);
}

/**
 * `inventory` plus `itemIds`, ignoring anything already owned. Returns a new
 * array; granting an item twice is a no-op rather than a duplicate, which is
 * what makes re-playing an adventure safe to reward without stacking.
 */
export function addItems(inventory: Inventory, itemIds: readonly ItemId[]): Inventory {
  const additions = itemIds.filter((itemId) => !inventory.includes(itemId));
  return additions.length === 0 ? inventory : [...inventory, ...additions];
}

/** Only the IDs in `itemIds` the child does not already own. */
export function newItemsAmong(inventory: Inventory, itemIds: readonly ItemId[]): ItemId[] {
  return itemIds.filter((itemId) => !inventory.includes(itemId));
}

/**
 * Resolves owned IDs to authored definitions, dropping any ID with no
 * definition. A stored ID whose item was later removed from content must not
 * crash a child's backpack, so this degrades rather than throwing;
 * `findUnknownItemIds` is the authoring-time check.
 */
export function resolveInventory(
  inventory: Inventory,
  items: readonly ItemDefinition[],
): ItemDefinition[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  return inventory
    .map((itemId) => byId.get(itemId))
    .filter((item): item is ItemDefinition => item !== undefined);
}

/** Owned IDs with no authored definition. Should be empty; surfaced for tests and admin reads. */
export function findUnknownItemIds(
  inventory: Inventory,
  items: readonly ItemDefinition[],
): ItemId[] {
  const known = new Set(items.map((item) => item.id));
  return inventory.filter((itemId) => !known.has(itemId));
}

/** Owned items in one category, for backpack grouping. */
export function itemsInCategory(
  items: readonly ItemDefinition[],
  category: ItemDefinition['category'],
): ItemDefinition[] {
  return items.filter((item) => item.category === category);
}

/**
 * Validates a stored inventory column. Stored JSON is external data at read
 * time (CLAUDE.md section 13), so a malformed value degrades to an empty
 * backpack rather than propagating into set-completion maths.
 */
export function parseInventory(raw: unknown): Inventory {
  if (!Array.isArray(raw)) return EMPTY_INVENTORY;
  const ids = raw.filter((entry): entry is string => typeof entry === 'string');
  return Array.from(new Set(ids));
}
