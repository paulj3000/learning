import { describe, expect, it } from 'vitest';
import {
  findUnknownRewardItemIds,
  resolveRewards,
  rewardedItemIds,
  triggersMatch,
} from './rewardTable';
import type { RewardTable, RewardTrigger } from './types';

const table: RewardTable = [
  {
    id: 'rule-a',
    trigger: { type: 'ADVENTURE_COMPLETED', templateSlug: 'repair-the-moonlight-bridge' },
    itemIds: ['hammer'],
    message: 'A hammer!',
  },
  {
    id: 'rule-b',
    trigger: { type: 'ADVENTURE_COMPLETED', templateSlug: 'repair-the-moonlight-bridge' },
    itemIds: ['hammer', 'backpack'],
    message: 'And a backpack!',
  },
  {
    id: 'rule-c',
    trigger: { type: 'STORY_COMPLETED', storySlug: 'dragon-of-ember-mountain' },
    itemIds: ['scale'],
    message: 'A shining scale.',
  },
];

const bridgeTrigger: RewardTrigger = {
  type: 'ADVENTURE_COMPLETED',
  templateSlug: 'repair-the-moonlight-bridge',
};

describe('resolveRewards', () => {
  it('returns every matching rule in authored order', () => {
    expect(resolveRewards(table, bridgeTrigger).map((grant) => grant.ruleId)).toEqual([
      'rule-a',
      'rule-b',
    ]);
  });

  it('returns nothing for a trigger no rule matches', () => {
    expect(
      resolveRewards(table, { type: 'ADVENTURE_COMPLETED', templateSlug: 'not-a-real-slug' }),
    ).toEqual([]);
  });

  it('does not match a different trigger type with a similar payload', () => {
    expect(
      resolveRewards(table, { type: 'QUEST_COMPLETED', questId: 'repair-the-moonlight-bridge' }),
    ).toEqual([]);
  });

  it('is deterministic: the same trigger always yields the identical result', () => {
    // The structural anti-loot-box guarantee. If any randomness were ever
    // introduced into grant resolution, this fails.
    const first = JSON.stringify(resolveRewards(table, bridgeTrigger));
    for (let attempt = 0; attempt < 50; attempt += 1) {
      expect(JSON.stringify(resolveRewards(table, bridgeTrigger))).toBe(first);
    }
  });

  it('grants every matching rule rather than choosing among them', () => {
    // "Pick one of these" would imply a roll. All matching rules must fire.
    const grants = resolveRewards(table, bridgeTrigger);
    expect(grants).toHaveLength(2);
    expect(grants.flatMap((grant) => grant.itemIds)).toEqual(['hammer', 'hammer', 'backpack']);
  });

  it('ignores rarity entirely: rarity is descriptive, never a drop weight', () => {
    // Rarity lives on ItemDefinition and is deliberately not reachable from
    // the reward table at all. Resolution depends only on the trigger, so
    // there is nowhere for a rarity-weighted roll to be added later without
    // this test noticing the signature change.
    const grants = resolveRewards(table, bridgeTrigger);
    expect(grants.every((grant) => !('rarity' in grant))).toBe(true);
    expect(resolveRewards.length).toBe(2);
  });
});

describe('rewardedItemIds', () => {
  it('flattens and de-duplicates across matching rules', () => {
    expect(rewardedItemIds(table, bridgeTrigger)).toEqual(['hammer', 'backpack']);
  });
});

describe('triggersMatch', () => {
  it('compares every field of a multi-field trigger', () => {
    const base: RewardTrigger = { type: 'NPC_RELATIONSHIP', npcId: 'pirate-pip', level: 'FRIEND' };
    expect(triggersMatch(base, { ...base })).toBe(true);
    expect(triggersMatch(base, { type: 'NPC_RELATIONSHIP', npcId: 'bolt', level: 'FRIEND' })).toBe(
      false,
    );
    expect(
      triggersMatch(base, {
        type: 'NPC_RELATIONSHIP',
        npcId: 'pirate-pip',
        level: 'TRUSTED_FRIEND',
      }),
    ).toBe(false);
  });

  it('matches world change and discovery triggers by key', () => {
    expect(
      triggersMatch(
        { type: 'WORLD_CHANGE', changeKey: 'bridge-repaired' },
        { type: 'WORLD_CHANGE', changeKey: 'bridge-repaired' },
      ),
    ).toBe(true);
    expect(
      triggersMatch(
        { type: 'DISCOVERY', discoveryKey: 'hidden-cove' },
        { type: 'DISCOVERY', discoveryKey: 'other-cove' },
      ),
    ).toBe(false);
  });
});

describe('findUnknownRewardItemIds', () => {
  it('is empty when every rewarded item is defined', () => {
    expect(findUnknownRewardItemIds(table, ['hammer', 'backpack', 'scale'])).toEqual([]);
  });

  it('reports a rule naming an undefined item', () => {
    expect(findUnknownRewardItemIds(table, ['hammer', 'scale'])).toEqual([
      { ruleId: 'rule-b', itemId: 'backpack' },
    ]);
  });
});
