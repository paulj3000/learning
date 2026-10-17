/**
 * Deterministic reward resolution (docs/ROADMAP.md Phase 24, "reward tables
 * and a safe economy with no manipulative monetization patterns").
 *
 * This module is the structural guarantee behind CLAUDE.md pillar 7's "no
 * loot-box mechanics": there is no randomness anywhere in it. `resolveRewards`
 * is a pure function of (trigger, table), so the same action always produces
 * the same items for every child, every time. There is no drop chance to
 * tune, no pity timer, no weighted roll, and nothing to buy that would
 * improve an outcome.
 *
 * Rarity is never consulted here — an item's rarity describes how hidden it
 * is in the authored world, not how likely it is to appear. That is asserted
 * directly in `rewardTable.test.ts` so a future edit cannot quietly turn
 * rarity into a drop weight.
 */
import type { RewardGrant, RewardTable, RewardTrigger } from './types';

/** Structural equality over the closed `RewardTrigger` union. */
export function triggersMatch(a: RewardTrigger, b: RewardTrigger): boolean {
  if (a.type !== b.type) return false;
  switch (a.type) {
    case 'ADVENTURE_COMPLETED':
      return a.templateSlug === (b as typeof a).templateSlug;
    case 'STORY_COMPLETED':
      return a.storySlug === (b as typeof a).storySlug;
    case 'QUEST_COMPLETED':
      return a.questId === (b as typeof a).questId;
    case 'WORLD_CHANGE':
      return a.changeKey === (b as typeof a).changeKey;
    case 'NPC_RELATIONSHIP':
      return a.npcId === (b as typeof a).npcId && a.level === (b as typeof a).level;
    case 'DISCOVERY':
      return a.discoveryKey === (b as typeof a).discoveryKey;
  }
}

/**
 * Every rule matching `trigger`, in authored order. Multiple rules may match
 * and all of them grant — there is deliberately no "pick one of these",
 * because picking implies a roll.
 */
export function resolveRewards(table: RewardTable, trigger: RewardTrigger): RewardGrant[] {
  return table
    .filter((rule) => triggersMatch(rule.trigger, trigger))
    .map((rule) => ({ ruleId: rule.id, itemIds: rule.itemIds, message: rule.message }));
}

/** Flattened, de-duplicated item IDs a trigger grants. */
export function rewardedItemIds(table: RewardTable, trigger: RewardTrigger): string[] {
  return Array.from(new Set(resolveRewards(table, trigger).flatMap((grant) => grant.itemIds)));
}

/** Rules naming an item that has no authored definition. Must be empty; asserted in tests. */
export function findUnknownRewardItemIds(
  table: RewardTable,
  knownItemIds: readonly string[],
): { ruleId: string; itemId: string }[] {
  const known = new Set(knownItemIds);
  return table.flatMap((rule) =>
    rule.itemIds
      .filter((itemId) => !known.has(itemId))
      .map((itemId) => ({ ruleId: rule.id, itemId })),
  );
}
