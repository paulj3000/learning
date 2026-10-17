import { describe, expect, it } from 'vitest';
import {
  areRequiredObjectivesComplete,
  evaluateQuestCondition,
  isObjectiveComplete,
} from './objectives';
import {
  EMPTY_QUEST_CONTEXT,
  type QuestContext,
  type QuestObjective,
  type QuestState,
} from './types';

function context(overrides: Partial<QuestContext> = {}): QuestContext {
  return { ...EMPTY_QUEST_CONTEXT, ...overrides };
}

describe('isObjectiveComplete', () => {
  it('completes TALK_TO when the NPC remembers the authored flag', () => {
    const objective: QuestObjective = {
      id: 'o1',
      kind: 'TALK_TO',
      npcId: 'pirate-pip',
      memoryFlag: 'heardAboutBridge',
      label: 'Talk to Pip',
    };

    expect(isObjectiveComplete(objective, context())).toBe(false);
    expect(
      isObjectiveComplete(
        objective,
        context({ npcMemoryFlags: { 'pirate-pip': { heardAboutBridge: true } } }),
      ),
    ).toBe(true);
  });

  it('does not credit TALK_TO from a different NPC remembering the same flag', () => {
    const objective: QuestObjective = {
      id: 'o1',
      kind: 'TALK_TO',
      npcId: 'pirate-pip',
      memoryFlag: 'metPip',
      label: 'Talk to Pip',
    };

    expect(
      isObjectiveComplete(objective, context({ npcMemoryFlags: { bolt: { metPip: true } } })),
    ).toBe(false);
  });

  it('requires both halves of a DELIVER: holding the item and the NPC remembering it', () => {
    const objective: QuestObjective = {
      id: 'o1',
      kind: 'DELIVER',
      itemId: 'spiral-shell',
      npcId: 'bolt',
      memoryFlag: 'gotTheShell',
      label: 'Give Bolt the shell',
    };

    expect(isObjectiveComplete(objective, context({ ownedItemIds: ['spiral-shell'] }))).toBe(false);
    expect(
      isObjectiveComplete(objective, context({ npcMemoryFlags: { bolt: { gotTheShell: true } } })),
    ).toBe(false);
    expect(
      isObjectiveComplete(
        objective,
        context({
          ownedItemIds: ['spiral-shell'],
          npcMemoryFlags: { bolt: { gotTheShell: true } },
        }),
      ),
    ).toBe(true);
  });

  it('completes COLLECT on all named items, or on requiredCount when authored', () => {
    const all: QuestObjective = {
      id: 'o1',
      kind: 'COLLECT',
      itemIds: ['a', 'b', 'c'],
      label: 'Collect three shells',
    };
    const anyTwo: QuestObjective = { ...all, id: 'o2', requiredCount: 2 };

    expect(isObjectiveComplete(all, context({ ownedItemIds: ['a', 'b'] }))).toBe(false);
    expect(isObjectiveComplete(all, context({ ownedItemIds: ['a', 'b', 'c'] }))).toBe(true);
    expect(isObjectiveComplete(anyTwo, context({ ownedItemIds: ['a', 'c'] }))).toBe(true);
    // Owning something else entirely never counts toward the named items.
    expect(isObjectiveComplete(anyTwo, context({ ownedItemIds: ['a', 'z'] }))).toBe(false);
  });

  it('completes SOLVE, BUILD, and EXPLORE from existing world state', () => {
    expect(
      isObjectiveComplete(
        { id: 'o1', kind: 'SOLVE', adventureSlug: 'repair-the-moonlight-bridge', label: 'x' },
        context({ completedAdventureSlugs: ['repair-the-moonlight-bridge'] }),
      ),
    ).toBe(true);
    expect(
      isObjectiveComplete(
        { id: 'o2', kind: 'BUILD', changeKey: 'BRIDGE_REPAIRED', label: 'x' },
        context({ worldChangeKeys: ['BRIDGE_REPAIRED'] }),
      ),
    ).toBe(true);
    expect(
      isObjectiveComplete(
        { id: 'o3', kind: 'EXPLORE', locationSlug: 'wonderwild-forest', label: 'x' },
        context({ visitedLocationSlugs: ['wonderwild-forest'] }),
      ),
    ).toBe(true);
  });

  it('completes LEARN at or above the authored status, never below it', () => {
    const objective: QuestObjective = {
      id: 'o1',
      kind: 'LEARN',
      learningObjectiveCode: 'MATH.COUNT.10',
      atLeast: 'PROFICIENT',
      label: 'Count to ten on your own',
    };

    expect(
      isObjectiveComplete(objective, context({ skillStatuses: { 'MATH.COUNT.10': 'DEVELOPING' } })),
    ).toBe(false);
    expect(
      isObjectiveComplete(objective, context({ skillStatuses: { 'MATH.COUNT.10': 'PROFICIENT' } })),
    ).toBe(true);
    expect(
      isObjectiveComplete(objective, context({ skillStatuses: { 'MATH.COUNT.10': 'MASTERED' } })),
    ).toBe(true);
    // A skill with no evidence at all is not silently treated as learned.
    expect(isObjectiveComplete(objective, context())).toBe(false);
  });

  it('leaves DISCOVER dormant until Phase 26 supplies discovery keys', () => {
    const objective: QuestObjective = {
      id: 'o1',
      kind: 'DISCOVER',
      discoveryKey: 'hidden-cave',
      label: 'Find the cave',
    };

    expect(isObjectiveComplete(objective, context())).toBe(false);
    // The primitive itself works; only the source of keys is missing.
    expect(isObjectiveComplete(objective, context({ discoveryKeys: ['hidden-cave'] }))).toBe(true);
  });
});

describe('areRequiredObjectivesComplete', () => {
  const required: QuestObjective = {
    id: 'req',
    kind: 'BUILD',
    changeKey: 'BRIDGE_REPAIRED',
    label: 'x',
  };
  const optional: QuestObjective = {
    id: 'opt',
    kind: 'FIND',
    itemId: 'spiral-shell',
    label: 'x',
    optional: true,
  };

  it('ignores optional objectives when deciding whether a stage is done', () => {
    expect(
      areRequiredObjectivesComplete(
        [required, optional],
        context({ worldChangeKeys: ['BRIDGE_REPAIRED'] }),
      ),
    ).toBe(true);
  });

  it('still blocks on an unfinished required objective', () => {
    expect(
      areRequiredObjectivesComplete(
        [required, optional],
        context({ ownedItemIds: ['spiral-shell'] }),
      ),
    ).toBe(false);
  });

  it('treats a stage with only optional objectives as complete', () => {
    expect(areRequiredObjectivesComplete([optional], context())).toBe(true);
  });
});

describe('evaluateQuestCondition', () => {
  const state: QuestState = {
    questId: 'q',
    status: 'ACTIVE',
    currentStageId: 's1',
    completedStageIds: [],
    completedObjectiveIds: ['opt'],
    startedAt: '2026-01-01T00:00:00.000Z',
  };

  it('compares relationship level against the ladder, defaulting to STRANGER', () => {
    const condition = {
      type: 'RELATIONSHIP_AT_LEAST' as const,
      npcId: 'pirate-pip',
      level: 'FRIEND' as const,
    };

    expect(evaluateQuestCondition(condition, context())).toBe(false);
    expect(
      evaluateQuestCondition(
        condition,
        context({ relationshipLevels: { 'pirate-pip': 'ACQUAINTANCE' } }),
      ),
    ).toBe(false);
    expect(
      evaluateQuestCondition(
        condition,
        context({ relationshipLevels: { 'pirate-pip': 'TRUSTED_FRIEND' } }),
      ),
    ).toBe(true);
  });

  it('reads OBJECTIVE_COMPLETED from quest state, and false when the quest has not started', () => {
    const condition = { type: 'OBJECTIVE_COMPLETED' as const, objectiveId: 'opt' };

    expect(evaluateQuestCondition(condition, context(), state)).toBe(true);
    expect(evaluateQuestCondition(condition, context())).toBe(false);
  });

  it('reads QUEST_COMPLETED, WORLD_CHANGE, and ITEM_OWNED from the context', () => {
    expect(
      evaluateQuestCondition(
        { type: 'QUEST_COMPLETED', questId: 'repair-the-bridge' },
        context({ completedQuestIds: ['repair-the-bridge'] }),
      ),
    ).toBe(true);
    expect(
      evaluateQuestCondition(
        { type: 'WORLD_CHANGE', changeKey: 'FIRST_STORY_TOLD' },
        context({ worldChangeKeys: ['FIRST_STORY_TOLD'] }),
      ),
    ).toBe(true);
    expect(evaluateQuestCondition({ type: 'ITEM_OWNED', itemId: 'moon-shell' }, context())).toBe(
      false,
    );
  });
});
