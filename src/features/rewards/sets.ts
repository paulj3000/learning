/**
 * Collectible set completion (docs/ROADMAP.md Phase 24).
 *
 * Progress is reported as "3 of 5 found," never as "2 missing" — the framing
 * is deliberate. A child who has found three shells has found three shells;
 * the calm-engagement pillar rules out copy that makes a partly-finished set
 * feel like a debt (CLAUDE.md pillar 7).
 *
 * Hidden collectibles are excluded from a set's *visible* target so a child
 * is never shown a slot they cannot know how to fill. They still count when
 * found, which is why `visibleTotal` and `total` are reported separately.
 */
import type { CollectibleSet, Inventory, ItemDefinition } from './types';

export interface SetProgress {
  setId: string;
  displayName: string;
  /** Items found so far, hidden ones included. */
  found: number;
  /** Every item in the set, hidden ones included. */
  total: number;
  /** Items a child can see they are looking for, hidden ones excluded. */
  visibleTotal: number;
  isComplete: boolean;
  /** Set only when complete, so a caller has the authored line to celebrate with. */
  completionMessage?: string;
}

export function computeSetProgress(
  set: CollectibleSet,
  inventory: Inventory,
  items: readonly ItemDefinition[],
): SetProgress {
  const byId = new Map(items.map((item) => [item.id, item]));
  const found = set.itemIds.filter((itemId) => inventory.includes(itemId)).length;
  const visibleTotal = set.itemIds.filter((itemId) => !byId.get(itemId)?.hidden).length;
  const isComplete = found === set.itemIds.length && set.itemIds.length > 0;
  return {
    setId: set.id,
    displayName: set.displayName,
    found,
    total: set.itemIds.length,
    visibleTotal,
    isComplete,
    ...(isComplete ? { completionMessage: set.completionMessage } : {}),
  };
}

export function computeAllSetProgress(
  sets: readonly CollectibleSet[],
  inventory: Inventory,
  items: readonly ItemDefinition[],
): SetProgress[] {
  return sets.map((set) => computeSetProgress(set, inventory, items));
}

/**
 * Completion cosmetics the child has earned but does not yet hold. The
 * caller grants these through the same additive inventory path as any other
 * reward, so finishing a set needs no special-case write.
 */
export function pendingSetCompletionItems(
  sets: readonly CollectibleSet[],
  inventory: Inventory,
  items: readonly ItemDefinition[],
): string[] {
  return sets
    .filter((set) => set.completionItemId && computeSetProgress(set, inventory, items).isComplete)
    .map((set) => set.completionItemId as string)
    .filter((itemId) => !inventory.includes(itemId));
}

/** Set members with no authored definition. Must be empty; asserted in tests. */
export function findUnknownSetItemIds(
  sets: readonly CollectibleSet[],
  items: readonly ItemDefinition[],
): { setId: string; itemId: string }[] {
  const known = new Set(items.map((item) => item.id));
  return sets.flatMap((set) =>
    [...set.itemIds, ...(set.completionItemId ? [set.completionItemId] : [])]
      .filter((itemId) => !known.has(itemId))
      .map((itemId) => ({ setId: set.id, itemId })),
  );
}
