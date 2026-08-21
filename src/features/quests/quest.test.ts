import { describe, expect, it } from 'vitest';
import { advanceQuest, isQuestAvailable, nextStageId, startQuest } from './quest';
import {
  EMPTY_QUEST_CONTEXT,
  type QuestContext,
  type QuestDefinition,
  type QuestState,
} from './types';

function context(overrides: Partial<QuestContext> = {}): QuestContext {
  return { ...EMPTY_QUEST_CONTEXT, ...overrides };
}

/** Three stages: talk, then solve (with one optional side errand), then look. */
const QUEST: QuestDefinition = {
  id: 'test-quest',
  title: 'Test Quest',
  summary: 'A quest for tests.',
  ageBands: ['PATHFINDER'],
  prerequisites: [{ type: 'ALWAYS' }],
  entryStageId: 'stage-1',
  stages: [
    {
      id: 'stage-1',
      title: 'Talk',
      objectives: [
        { id: 'talk', kind: 'TALK_TO', npcId: 'npc-1', memoryFlag: 'met', label: 'Talk' },
      ],
      nextStageId: 'stage-2',
    },
    {
      id: 'stage-2',
      title: 'Solve',
      objectives: [
        { id: 'solve', kind: 'SOLVE', adventureSlug: 'adventure-1', label: 'Solve' },
        { id: 'side', kind: 'FIND', itemId: 'shell', label: 'Side', optional: true },
      ],
      worldChanges: [{ locationSlug: 'bay', changeType: 'REPAIR', changeKey: 'FIXED' }],
      nextStageId: 'stage-3',
    },
    {
      id: 'stage-3',
      title: 'Look',
      objectives: [{ id: 'look', kind: 'BUILD', changeKey: 'FIXED', label: 'Look' }],
    },
  ],
  completion: {
    journalNote: 'Done.',
    worldChanges: [{ locationSlug: 'bay', changeType: 'CREATE', changeKey: 'CELEBRATED' }],
  },
};

const FRESH: QuestState = startQuest(QUEST, '2026-01-01T00:00:00.000Z');

describe('isQuestAvailable', () => {
  it('is available when prerequisites pass and it has not been started', () => {
    expect(isQuestAvailable(QUEST, context())).toBe(true);
  });

  it('is not available once the child has a state for it', () => {
    expect(isQuestAvailable(QUEST, context(), FRESH)).toBe(false);
  });

  it('is not available while a prerequisite is unmet', () => {
    const gated: QuestDefinition = {
      ...QUEST,
      prerequisites: [{ type: 'QUEST_COMPLETED', questId: 'other' }],
    };

    expect(isQuestAvailable(gated, context())).toBe(false);
    expect(isQuestAvailable(gated, context({ completedQuestIds: ['other'] }))).toBe(true);
  });
});

describe('advanceQuest', () => {
  it('stays put and reports no change when nothing has been done', () => {
    const result = advanceQuest(QUEST, FRESH, context());

    expect(result.changed).toBe(false);
    expect(result.state.currentStageId).toBe('stage-1');
    expect(result.justCompleted).toBe(false);
    expect(result.worldChanges).toEqual([]);
  });

  it('advances one stage when that stage is satisfied', () => {
    const result = advanceQuest(
      QUEST,
      FRESH,
      context({ npcMemoryFlags: { 'npc-1': { met: true } } }),
    );

    expect(result.changed).toBe(true);
    expect(result.state.currentStageId).toBe('stage-2');
    expect(result.newlyCompletedStageIds).toEqual(['stage-1']);
    expect(result.state.status).toBe('ACTIVE');
  });

  /**
   * The case that motivates the loop: a child can satisfy several stages
   * before their journal is next read, and advancing one stage per call
   * would leave the journal permanently behind the world.
   */
  it('walks through every stage already satisfied, in one call', () => {
    const result = advanceQuest(
      QUEST,
      FRESH,
      context({
        npcMemoryFlags: { 'npc-1': { met: true } },
        completedAdventureSlugs: ['adventure-1'],
        worldChangeKeys: ['FIXED'],
      }),
    );

    expect(result.justCompleted).toBe(true);
    expect(result.state.status).toBe('COMPLETED');
    expect(result.newlyCompletedStageIds).toEqual(['stage-1', 'stage-2', 'stage-3']);
  });

  it('collects the world changes owed by each stage it passes, plus the quest completion', () => {
    const result = advanceQuest(
      QUEST,
      FRESH,
      context({
        npcMemoryFlags: { 'npc-1': { met: true } },
        completedAdventureSlugs: ['adventure-1'],
        worldChangeKeys: ['FIXED'],
      }),
    );

    expect(result.worldChanges.map((change) => change.changeKey)).toEqual(['FIXED', 'CELEBRATED']);
  });

  it('records optional objectives without requiring them', () => {
    const result = advanceQuest(
      QUEST,
      { ...FRESH, currentStageId: 'stage-2' },
      context({ completedAdventureSlugs: ['adventure-1'], ownedItemIds: ['shell'] }),
    );

    expect(result.state.completedObjectiveIds).toContain('side');
    expect(result.state.currentStageId).toBe('stage-3');
  });

  it('does not re-award a stage that was already completed', () => {
    const partway: QuestState = {
      ...FRESH,
      currentStageId: 'stage-2',
      completedStageIds: ['stage-1', 'stage-2'],
    };
    const result = advanceQuest(
      QUEST,
      partway,
      context({ completedAdventureSlugs: ['adventure-1'], worldChangeKeys: ['FIXED'] }),
    );

    expect(result.newlyCompletedStageIds).toEqual(['stage-3']);
    expect(result.worldChanges.map((change) => change.changeKey)).toEqual(['CELEBRATED']);
  });

  it('leaves a completed quest untouched', () => {
    const done: QuestState = { ...FRESH, status: 'COMPLETED', currentStageId: 'stage-3' };
    const result = advanceQuest(QUEST, done, context({ worldChangeKeys: ['FIXED'] }));

    expect(result.changed).toBe(false);
    expect(result.worldChanges).toEqual([]);
  });

  it('never stamps completedAt itself, leaving the clock to the caller', () => {
    const result = advanceQuest(
      QUEST,
      FRESH,
      context({
        npcMemoryFlags: { 'npc-1': { met: true } },
        completedAdventureSlugs: ['adventure-1'],
        worldChangeKeys: ['FIXED'],
      }),
    );

    expect(result.justCompleted).toBe(true);
    expect(result.state.completedAt).toBeUndefined();
  });

  it('terminates on an authored branch cycle instead of spinning forever', () => {
    const looping: QuestDefinition = {
      ...QUEST,
      entryStageId: 'a',
      stages: [
        { id: 'a', title: 'A', objectives: [], nextStageId: 'b' },
        { id: 'b', title: 'B', objectives: [], nextStageId: 'a' },
      ],
    };

    const result = advanceQuest(looping, startQuest(looping, 'now'), context());

    expect(result.state.completedStageIds).toEqual(['a', 'b']);
    expect(result.justCompleted).toBe(false);
  });

  it('does not crash on a stage id that does not resolve', () => {
    const broken: QuestDefinition = {
      ...QUEST,
      stages: [{ id: 'only', title: 'Only', objectives: [], nextStageId: 'missing' }],
      entryStageId: 'only',
    };

    const result = advanceQuest(broken, startQuest(broken, 'now'), context());

    expect(result.state.currentStageId).toBe('missing');
    expect(result.justCompleted).toBe(false);
  });
});

describe('nextStageId', () => {
  const branching = {
    id: 'branch-stage',
    title: 'Branch',
    objectives: [],
    branches: [
      {
        conditions: [{ type: 'WORLD_CHANGE' as const, changeKey: 'SHORTCUT' }],
        nextStageId: 'shortcut-stage',
      },
    ],
    nextStageId: 'ordinary-stage',
  };

  it('takes the first branch whose conditions pass', () => {
    expect(nextStageId(branching, context({ worldChangeKeys: ['SHORTCUT'] }), FRESH)).toBe(
      'shortcut-stage',
    );
  });

  it('falls through to the authored default when no branch matches', () => {
    expect(nextStageId(branching, context(), FRESH)).toBe('ordinary-stage');
  });

  it('returns undefined for a terminal stage, which is what completes a quest', () => {
    expect(
      nextStageId({ id: 'end', title: 'End', objectives: [] }, context(), FRESH),
    ).toBeUndefined();
  });

  it('branches on an optional objective the child chose to do', () => {
    const stage = {
      id: 's',
      title: 'S',
      objectives: [],
      branches: [
        {
          conditions: [{ type: 'OBJECTIVE_COMPLETED' as const, objectiveId: 'side' }],
          nextStageId: 'bonus',
        },
      ],
      nextStageId: 'plain',
    };

    expect(nextStageId(stage, context(), { ...FRESH, completedObjectiveIds: ['side'] })).toBe(
      'bonus',
    );
    expect(nextStageId(stage, context(), FRESH)).toBe('plain');
  });
});
