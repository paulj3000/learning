/**
 * Inventory persistence and reward granting (docs/ROADMAP.md Phase 24).
 *
 * The only impure module in `src/features/rewards/`. Every decision about
 * *what* to grant is made by the pure modules first, so the anti-loot-box
 * guarantee (`rewardTable.ts`: no randomness anywhere) is unit-testable
 * without a backend.
 *
 * Authorization is the model's own `allow.owner()`: a parent reaches only
 * their own children's backpacks, and Admins read only.
 */
import { client } from '../../lib/data-client';
import type { Schema } from '../../../amplify/data/resource';
import { addItems, EMPTY_INVENTORY, newItemsAmong, parseInventory } from './inventory';
import { pendingSetCompletionItems } from './sets';
import { resolveRewards } from './rewardTable';
import type {
  CollectibleSet,
  Inventory,
  ItemDefinition,
  RewardTable,
  RewardTrigger,
} from './types';

export type ChildInventoryRow = Schema['ChildInventory']['type'];

export interface ChildInventoryState {
  ownedItemIds: Inventory;
  /** Reward rules already fired for this child; the engine's idempotency key. */
  grantedRuleIds: readonly string[];
}

export const EMPTY_INVENTORY_STATE: ChildInventoryState = {
  ownedItemIds: EMPTY_INVENTORY,
  grantedRuleIds: [],
};

function toState(row: ChildInventoryRow): ChildInventoryState {
  return {
    ownedItemIds: parseInventory(row.ownedItemIds),
    grantedRuleIds: (row.grantedRuleIds ?? []).filter((id): id is string => typeof id === 'string'),
  };
}

async function findRow(childProfileId: string): Promise<ChildInventoryRow | undefined> {
  const { data } = await client.models.ChildInventory.list();
  return data.find((row: ChildInventoryRow) => row.childProfileId === childProfileId);
}

/** This child's backpack, or an empty one if they have never been granted anything. */
export async function getInventory(childProfileId: string): Promise<ChildInventoryState> {
  const row = await findRow(childProfileId);
  return row ? toState(row) : EMPTY_INVENTORY_STATE;
}

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

/**
 * Resolves `trigger` against `table` and grants whatever it names.
 *
 * Idempotent by rule: a rule that already fired for this child is skipped,
 * so replaying an adventure grants nothing a second time and shows no second
 * celebration. That is what makes it safe to call this on every completion
 * without tracking elsewhere whether it is a repeat.
 *
 * Set-completion cosmetics are granted in the same write, so finishing a set
 * needs no separate call and cannot be missed.
 *
 * Read-modify-write rather than an atomic append, the same tradeoff
 * `upsertSkillProgress` and `recordDialogueNode` already make — one child on
 * one device at a time, and the co-op path that genuinely needed atomicity
 * uses a Lambda.
 */
export async function grantRewards(
  childProfileId: string,
  trigger: RewardTrigger,
  table: RewardTable,
  sets: readonly CollectibleSet[],
  items: readonly ItemDefinition[],
): Promise<GrantResult> {
  const row = await findRow(childProfileId);
  const current = row ? toState(row) : EMPTY_INVENTORY_STATE;

  const firing = resolveRewards(table, trigger).filter(
    (grant) => !current.grantedRuleIds.includes(grant.ruleId),
  );
  if (firing.length === 0) return { newItemIds: [], messages: [], state: current };

  const grantedItemIds = firing.flatMap((grant) => grant.itemIds);
  const directlyNew = newItemsAmong(current.ownedItemIds, grantedItemIds);
  const withDirect = addItems(current.ownedItemIds, grantedItemIds);

  // A newly finished set's cosmetic rides along in the same write.
  const setItemIds = pendingSetCompletionItems(sets, withDirect, items);
  const ownedItemIds = addItems(withDirect, setItemIds);
  const grantedRuleIds = [...current.grantedRuleIds, ...firing.map((grant) => grant.ruleId)];
  const now = new Date().toISOString();

  if (row) {
    await client.models.ChildInventory.update({
      id: row.id,
      ownedItemIds: [...ownedItemIds],
      grantedRuleIds,
      updatedAt: now,
    });
  } else {
    await client.models.ChildInventory.create({
      childProfileId,
      ownedItemIds: [...ownedItemIds],
      grantedRuleIds,
      updatedAt: now,
    });
  }

  return {
    newItemIds: [...directlyNew, ...setItemIds],
    messages: firing.map((grant) => grant.message),
    state: { ownedItemIds, grantedRuleIds },
  };
}

/**
 * Deletes a child's backpack. A parent-facing retention action
 * (docs/AI_AND_CHILD_SAFETY.md), never reachable from gameplay: treasure is
 * not taken away as a mechanic.
 */
export async function clearInventory(childProfileId: string): Promise<void> {
  const { data } = await client.models.ChildInventory.list();
  const rows = data.filter((row: ChildInventoryRow) => row.childProfileId === childProfileId);
  await Promise.all(
    rows.map((row: ChildInventoryRow) => client.models.ChildInventory.delete({ id: row.id })),
  );
}
