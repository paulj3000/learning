import { describe, expect, it } from 'vitest';
import { npcContextFromQuestContext, offerableQuests, questContextWithNpcState } from './offers';
import { EMPTY_QUEST_CONTEXT, type QuestDefinition, type QuestState } from './types';
import type { NpcDefinition } from '../npc/types';

const NPC: NpcDefinition = {
  id: 'pirate-pip',
  displayName: 'Pirate Pip',
  role: 'Shipyard foreman',
  homeLocationSlug: 'pirate-builder-bay',
  interactionId: 'meet-pirate-pip',
  schedule: [{ timeOfDay: 'MORNING', locationSlug: 'pirate-builder-bay' }],
  dialogue: [],
  questOffers: [
    {
      questId: 'repair-the-bridge',
      summary: 'Help Pip repair the bridge.',
      conditions: [{ type: 'MEMORY_FLAG', flag: 'heardAboutBridge', equals: true }],
    },
  ],
};

const QUEST: QuestDefinition = {
  id: 'repair-the-bridge',
  title: 'The Moonlight Bridge',
  summary: 'Help Pip repair the bridge.',
  giverNpcId: 'pirate-pip',
  ageBands: ['PATHFINDER'],
  prerequisites: [{ type: 'ALWAYS' }],
  entryStageId: 'only',
  stages: [{ id: 'only', title: 'Only stage', objectives: [] }],
  completion: { journalNote: 'Done.' },
};

const STARTED: QuestState = {
  questId: 'repair-the-bridge',
  status: 'ACTIVE',
  currentStageId: 'only',
  completedStageIds: [],
  completedObjectiveIds: [],
  startedAt: '2026-08-21T00:00:00.000Z',
};

const HEARD = {
  ...EMPTY_QUEST_CONTEXT,
  npcMemoryFlags: { 'pirate-pip': { heardAboutBridge: true } },
};

describe('npcContextFromQuestContext', () => {
  it('reads one NPC out of the quest snapshot', () => {
    const context = npcContextFromQuestContext(
      'pirate-pip',
      {
        ...EMPTY_QUEST_CONTEXT,
        npcMemoryFlags: { 'pirate-pip': { metPip: true }, bolt: { metBolt: true } },
        relationshipLevels: { 'pirate-pip': 'FRIEND' },
        worldChangeKeys: ['BRIDGE_REPAIRED'],
        completedQuestIds: ['tell-a-story-together'],
      },
      'EVENING',
    );

    expect(context).toEqual({
      npcId: 'pirate-pip',
      timeOfDay: 'EVENING',
      relationshipLevel: 'FRIEND',
      memoryFlags: { metPip: true },
      worldChangeKeys: ['BRIDGE_REPAIRED'],
      completedQuestIds: ['tell-a-story-together'],
    });
  });

  it('treats an NPC the child has never met as a stranger with no flags', () => {
    const context = npcContextFromQuestContext('bolt', EMPTY_QUEST_CONTEXT, 'MORNING');
    expect(context.relationshipLevel).toBe('STRANGER');
    expect(context.memoryFlags).toEqual({});
  });
});

describe('questContextWithNpcState', () => {
  it('folds a recorded dialogue node back in without touching other NPCs', () => {
    const before = {
      ...EMPTY_QUEST_CONTEXT,
      npcMemoryFlags: { bolt: { metBolt: true } },
      relationshipLevels: { bolt: 'FRIEND' as const },
    };

    const after = questContextWithNpcState(before, 'pirate-pip', { metPip: true }, 6);

    expect(after.npcMemoryFlags['pirate-pip']).toEqual({ metPip: true });
    expect(after.npcMemoryFlags.bolt).toEqual({ metBolt: true });
    // Derived from points by the same function the NPC engine uses, so the
    // two can never disagree about how well the child is known.
    expect(after.relationshipLevels['pirate-pip']).toBe('FRIEND');
    expect(after.relationshipLevels.bolt).toBe('FRIEND');
  });
});

describe('offerableQuests', () => {
  it('offers a quest only when the NPC asks and the quest is startable', () => {
    const npcContext = npcContextFromQuestContext('pirate-pip', HEARD, 'MORNING');
    const offers = offerableQuests(NPC, npcContext, [QUEST], [], HEARD);

    expect(offers).toHaveLength(1);
    expect(offers[0].definition.id).toBe('repair-the-bridge');
  });

  it('stays quiet while the NPC own conditions are unmet', () => {
    const npcContext = npcContextFromQuestContext('pirate-pip', EMPTY_QUEST_CONTEXT, 'MORNING');
    expect(offerableQuests(NPC, npcContext, [QUEST], [], EMPTY_QUEST_CONTEXT)).toEqual([]);
  });

  it('does not re-offer a quest the child has already started', () => {
    const npcContext = npcContextFromQuestContext('pirate-pip', HEARD, 'MORNING');
    expect(offerableQuests(NPC, npcContext, [QUEST], [STARTED], HEARD)).toEqual([]);
  });

  it('does not offer a quest whose prerequisites are unmet', () => {
    const gated: QuestDefinition = {
      ...QUEST,
      prerequisites: [{ type: 'QUEST_COMPLETED', questId: 'something-else' }],
    };
    const npcContext = npcContextFromQuestContext('pirate-pip', HEARD, 'MORNING');
    expect(offerableQuests(NPC, npcContext, [gated], [], HEARD)).toEqual([]);
  });

  it('drops an offer naming a quest that does not exist rather than showing it broken', () => {
    const npcContext = npcContextFromQuestContext('pirate-pip', HEARD, 'MORNING');
    expect(offerableQuests(NPC, npcContext, [], [], HEARD)).toEqual([]);
  });
});
