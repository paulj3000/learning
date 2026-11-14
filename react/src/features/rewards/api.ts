/**
 * A child's backpack, read from Django (`children/<id>/rewards/`, AMP-03).
 *
 * The only impure module in `src/features/rewards/`. There is no client write: rewards are
 * granted on the server by the code that decided the child earned them (a chest, a pickup, a
 * discovery, a finished quest), each rule once per child (`apps/inventory/services.py`), with the
 * same deterministic tables the pure modules here describe (`rewardTable.ts`: no randomness).
 * Replaying anything grants nothing a second time.
 */
import { childPath, djangoClient } from '../../api/djangoClient';
import { read } from '../../api/parse';
import { EMPTY_INVENTORY, parseInventory } from './inventory';
import type { Inventory } from './types';

export interface ChildInventoryState {
  ownedItemIds: Inventory;
  /** Reward rules already fired for this child; the server's idempotency key. */
  grantedRuleIds: readonly string[];
}

export const EMPTY_INVENTORY_STATE: ChildInventoryState = {
  ownedItemIds: EMPTY_INVENTORY,
  grantedRuleIds: [],
};

/** This child's backpack, or an empty one if they have never been granted anything. */
export async function getInventory(childProfileId: string): Promise<ChildInventoryState> {
  const response = await djangoClient().request('GET', childPath(childProfileId, 'rewards/'));
  return read(response.data, (r) => ({
    ownedItemIds: parseInventory(r.field('ownedItemIds').value),
    grantedRuleIds: r.field('grantedRuleIds').array((id) => id.string()),
  }));
}

export interface GrantResult {
  /** Items newly added. Empty when the trigger had already fired. */
  newItemIds: readonly string[];
  /** Authored lines to celebrate with, one per rule that fired. */
  messages: readonly string[];
}

export const NO_GRANT: GrantResult = { newItemIds: [], messages: [] };

/**
 * Deletes a child's backpack. A parent-facing retention action
 * (docs/AI_AND_CHILD_SAFETY.md), never reachable from gameplay: treasure is
 * not taken away as a mechanic.
 */
export async function clearInventory(childProfileId: string): Promise<void> {
  await djangoClient().request('DELETE', childPath(childProfileId, 'rewards/'));
}
