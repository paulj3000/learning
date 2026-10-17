import { describe, expect, it } from 'vitest';
import { availableQuestOffers, hasQuestToOffer, questGiversWithOffers } from './questGiver';
import type { NpcContext, NpcDefinition } from './types';

const pip: NpcDefinition = {
  id: 'pirate-pip',
  displayName: 'Pirate Pip',
  role: 'test',
  homeLocationSlug: 'pirate-builder-bay',
  interactionId: 'meet-pirate-pip',
  schedule: [],
  dialogue: [],
  questOffers: [
    {
      questId: 'repair-the-bridge',
      summary: 'Repair the bridge.',
      conditions: [{ type: 'MEMORY_FLAG', flag: 'bridgeQuestCompleted', equals: false }],
    },
    {
      questId: 'sail-onward',
      summary: 'Sail to the next island.',
      conditions: [{ type: 'QUEST_COMPLETED', questId: 'repair-the-bridge' }],
    },
  ],
};

const quiet: NpcDefinition = { ...pip, id: 'quiet-npc', questOffers: [] };

function context(overrides: Partial<NpcContext> = {}): NpcContext {
  return {
    npcId: 'pirate-pip',
    timeOfDay: 'MORNING',
    relationshipLevel: 'STRANGER',
    memoryFlags: {},
    worldChangeKeys: [],
    completedQuestIds: [],
    ...overrides,
  };
}

describe('availableQuestOffers', () => {
  it('offers an unfinished quest', () => {
    expect(availableQuestOffers(pip, context()).map((offer) => offer.questId)).toEqual([
      'repair-the-bridge',
    ]);
  });

  it('withdraws the offer once the memory flag records completion', () => {
    const ctx = context({ memoryFlags: { bridgeQuestCompleted: true } });
    expect(availableQuestOffers(pip, ctx).map((offer) => offer.questId)).toEqual([]);
  });

  it('keeps a QUEST_COMPLETED-gated offer dormant until Phase 25 supplies quest IDs', () => {
    // Documents the known limitation in questGiver.ts: with no Quest Engine,
    // `completedQuestIds` is always empty, so this offer never appears.
    expect(availableQuestOffers(pip, context()).map((o) => o.questId)).not.toContain('sail-onward');
  });

  it('surfaces the follow-up offer once a quest ID is supplied', () => {
    const ctx = context({
      memoryFlags: { bridgeQuestCompleted: true },
      completedQuestIds: ['repair-the-bridge'],
    });
    expect(availableQuestOffers(pip, ctx).map((offer) => offer.questId)).toEqual(['sail-onward']);
  });
});

describe('hasQuestToOffer', () => {
  it('is true only when an offer qualifies', () => {
    expect(hasQuestToOffer(pip, context())).toBe(true);
    expect(hasQuestToOffer(quiet, context())).toBe(false);
  });
});

describe('questGiversWithOffers', () => {
  it('lists only NPCs with something to ask', () => {
    const result = questGiversWithOffers([pip, quiet], (npcId) => context({ npcId }));
    expect(result).toHaveLength(1);
    expect(result[0].npc.id).toBe('pirate-pip');
    expect(result[0].offers.map((offer) => offer.questId)).toEqual(['repair-the-bridge']);
  });

  it('builds a separate context per NPC', () => {
    const seen: string[] = [];
    questGiversWithOffers([pip, quiet], (npcId) => {
      seen.push(npcId);
      return context({ npcId });
    });
    expect(seen).toEqual(['pirate-pip', 'quiet-npc']);
  });
});
