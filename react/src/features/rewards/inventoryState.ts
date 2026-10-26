import { EMPTY_INVENTORY } from './inventory';
import type { Inventory } from './types';

/** A child's backpack as the reward engine sees it (docs/ROADMAP.md Phase 24). */
export interface ChildInventoryState {
  ownedItemIds: Inventory;
  /** Reward rules already fired for this child; the engine's idempotency key. */
  grantedRuleIds: readonly string[];
}

export const EMPTY_INVENTORY_STATE: ChildInventoryState = {
  ownedItemIds: EMPTY_INVENTORY,
  grantedRuleIds: [],
};

export interface GrantResult {
  /** Items newly added by this call. Empty when the trigger had already fired. */
  newItemIds: readonly string[];
  /** Authored lines to celebrate with, one per rule that fired. */
  messages: readonly string[];
  state: ChildInventoryState;
}

export const NO_GRANT: GrantResult = {
  newItemIds: [],
  messages: [],
  state: EMPTY_INVENTORY_STATE,
};
