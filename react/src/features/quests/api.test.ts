import { describe, expect, it, vi, beforeEach } from 'vitest';

const {
  questList,
  questCreate,
  questUpdate,
  questDelete,
  listSessions,
  listAllWorldChanges,
  recordWorldChangeOnce,
  listNpcStates,
  setNpcMemoryFlagsForQuest,
  listSkillProgress,
  getInventory,
  grantRewards,
  getWorldState,
} = vi.hoisted(() => ({
  questList: vi.fn(),
  questCreate: vi.fn(),
  questUpdate: vi.fn(),
  questDelete: vi.fn(),
  listSessions: vi.fn(),
  listAllWorldChanges: vi.fn(),
  recordWorldChangeOnce: vi.fn(),
  listNpcStates: vi.fn(),
  setNpcMemoryFlagsForQuest: vi.fn(),
  listSkillProgress: vi.fn(),
  getInventory: vi.fn(),
  grantRewards: vi.fn(),
  getWorldState: vi.fn(),
}));

vi.mock('../../lib/data-client', () => ({
  client: {
    models: {
      ChildQuestState: {
        list: questList,
        create: questCreate,
        update: questUpdate,
        delete: questDelete,
      },
    },
  },
}));
vi.mock('../adventures/api', () => ({ listSessions, listAllWorldChanges, recordWorldChangeOnce }));
vi.mock('../npc/api', () => ({ listNpcStates, setNpcMemoryFlagsForQuest }));
vi.mock('../mastery/api', () => ({ listSkillProgress }));
vi.mock('../rewards/api', () => ({ getInventory, grantRewards }));
vi.mock('../discovery/api', () => ({ getWorldState }));

import {
  buildQuestContext,
  clearQuestStates,
  listQuestStates,
  startQuest,
  syncQuestProgress,
} from './api';
import type { QuestDefinition } from './types';

const QUEST: QuestDefinition = {
  id: 'q1',
  title: 'Test Quest',
  summary: 'Summary.',
  giverNpcId: 'pirate-pip',
  ageBands: ['PATHFINDER'],
  prerequisites: [{ type: 'ALWAYS' }],
  entryStageId: 'stage-1',
  stages: [
    {
      id: 'stage-1',
      title: 'Solve it',
      objectives: [{ id: 'solve', kind: 'SOLVE', adventureSlug: 'bridge', label: 'Solve' }],
      worldChanges: [{ locationSlug: 'bay', changeType: 'REPAIR', changeKey: 'STAGE_DONE' }],
    },
  ],
  completion: {
    journalNote: 'Done.',
    worldChanges: [{ locationSlug: 'bay', changeType: 'CREATE', changeKey: 'QUEST_DONE' }],
    setsNpcMemoryFlags: [{ npcId: 'pirate-pip', flags: ['bridgeQuestCompleted'] }],
  },
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'row-1',
    childProfileId: 'child-1',
    questId: 'q1',
    status: 'ACTIVE',
    currentStageId: 'stage-1',
    completedStageIds: [],
    completedObjectiveIds: [],
    startedAt: '2026-01-01T00:00:00.000Z',
    lastUpdatedAt: '2026-01-01T00:00:00.000Z',
    completedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  questList.mockResolvedValue({ data: [] });
  questCreate.mockImplementation(async (input: Record<string, unknown>) => ({
    data: { id: 'row-new', completedAt: null, ...input },
    errors: undefined,
  }));
  questUpdate.mockResolvedValue({ data: row(), errors: undefined });
  listSessions.mockResolvedValue([]);
  listAllWorldChanges.mockResolvedValue([]);
  recordWorldChangeOnce.mockResolvedValue(undefined);
  listNpcStates.mockResolvedValue([]);
  setNpcMemoryFlagsForQuest.mockResolvedValue(undefined);
  listSkillProgress.mockResolvedValue([]);
  getInventory.mockResolvedValue({ ownedItemIds: [], grantedRuleIds: [] });
  grantRewards.mockResolvedValue({ newItemIds: [], messages: [], state: {} });
  getWorldState.mockResolvedValue({ discoveredIds: [], metCharacterIds: [] });
});

describe('buildQuestContext', () => {
  it('derives the snapshot from the engines that already own each fact', async () => {
    listSessions.mockResolvedValue([
      { templateSlug: 'bridge', status: 'COMPLETED' },
      { templateSlug: 'unfinished', status: 'ACTIVE' },
    ]);
    listAllWorldChanges.mockResolvedValue([
      { changeKey: 'BRIDGE_REPAIRED', locationSlug: 'pirate-builder-bay' },
      { changeKey: 'FIRST_STORY_TOLD', locationSlug: 'storykeeper-castle' },
    ]);
    listNpcStates.mockResolvedValue([
      {
        npcId: 'pirate-pip',
        relationshipPoints: 12,
        memoryFlags: { metPip: true },
        seenNodeIds: [],
      },
    ]);
    listSkillProgress.mockResolvedValue([
      { learningObjectiveCode: 'MATH.COUNT.10', recentLevel: 'PROFICIENT' },
      { learningObjectiveCode: 'MATH.ADD.5', recentLevel: null },
    ]);
    getInventory.mockResolvedValue({ ownedItemIds: ['spiral-shell'], grantedRuleIds: [] });
    questList.mockResolvedValue({ data: [row({ status: 'COMPLETED' })] });

    const context = await buildQuestContext('child-1');

    expect(context.completedAdventureSlugs).toEqual(['bridge']);
    expect(context.worldChangeKeys).toEqual(['BRIDGE_REPAIRED', 'FIRST_STORY_TOLD']);
    expect(context.visitedLocationSlugs).toEqual(['pirate-builder-bay', 'storykeeper-castle']);
    expect(context.ownedItemIds).toEqual(['spiral-shell']);
    expect(context.npcMemoryFlags['pirate-pip']).toEqual({ metPip: true });
    expect(context.skillStatuses).toEqual({ 'MATH.COUNT.10': 'PROFICIENT' });
    expect(context.completedQuestIds).toEqual(['q1']);
  });

  it('derives relationship level from points rather than trusting a stored column', async () => {
    listNpcStates.mockResolvedValue([
      { npcId: 'bolt', relationshipPoints: 0, memoryFlags: {}, seenNodeIds: [] },
    ]);

    const context = await buildQuestContext('child-1');

    expect(context.relationshipLevels.bolt).toBe('STRANGER');
  });

  /**
   * Phase 26 filled the field Phase 25 hard-coded empty. `DISCOVER` was
   * authorable but dormant precisely because nothing could put anything
   * here; this asserts the seam is now connected to the Discovery Engine
   * rather than to a literal.
   */
  it('reads discovery keys from the Discovery Engine', async () => {
    getWorldState.mockResolvedValue({
      discoveredIds: ['harbor-tide-pool', 'bay-tide-tunnel'],
      metCharacterIds: ['pirate-pip'],
    });

    expect((await buildQuestContext('child-1')).discoveryKeys).toEqual([
      'harbor-tide-pool',
      'bay-tide-tunnel',
    ]);
  });

  it('leaves discovery keys empty for a child who has explored nothing', async () => {
    expect((await buildQuestContext('child-1')).discoveryKeys).toEqual([]);
  });
});

describe('startQuest', () => {
  it('creates a row at the entry stage', async () => {
    const state = await startQuest('child-1', QUEST);

    expect(questCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        childProfileId: 'child-1',
        questId: 'q1',
        status: 'ACTIVE',
        currentStageId: 'stage-1',
      }),
    );
    expect(state.currentStageId).toBe('stage-1');
  });

  it('is idempotent: accepting a quest twice does not restart it', async () => {
    questList.mockResolvedValue({
      data: [row({ currentStageId: 'stage-1', completedStageIds: ['x'] })],
    });

    const state = await startQuest('child-1', QUEST);

    expect(questCreate).not.toHaveBeenCalled();
    expect(state.completedStageIds).toEqual(['x']);
  });
});

describe('syncQuestProgress', () => {
  it('does nothing when the child has no active quests', async () => {
    expect(await syncQuestProgress('child-1', [QUEST])).toEqual([]);
    expect(questUpdate).not.toHaveBeenCalled();
  });

  it('writes nothing when an active quest has not moved', async () => {
    questList.mockResolvedValue({ data: [row()] });

    expect(await syncQuestProgress('child-1', [QUEST])).toEqual([]);
    expect(questUpdate).not.toHaveBeenCalled();
    expect(recordWorldChangeOnce).not.toHaveBeenCalled();
  });

  it('completes a quest whose objective the world already satisfies', async () => {
    questList.mockResolvedValue({ data: [row()] });
    listSessions.mockResolvedValue([{ templateSlug: 'bridge', status: 'COMPLETED' }]);

    const results = await syncQuestProgress('child-1', [QUEST]);

    expect(results).toHaveLength(1);
    expect(results[0]?.justCompleted).toBe(true);
    expect(questUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'row-1', status: 'COMPLETED' }),
    );
    expect(questUpdate.mock.calls[0]?.[0]?.completedAt).toEqual(expect.any(String));
  });

  it('records the stage and completion world changes, attributed to the quest', async () => {
    questList.mockResolvedValue({ data: [row()] });
    listSessions.mockResolvedValue([{ templateSlug: 'bridge', status: 'COMPLETED' }]);

    await syncQuestProgress('child-1', [QUEST]);

    expect(recordWorldChangeOnce).toHaveBeenCalledWith(
      'child-1',
      'bay',
      'REPAIR',
      'STAGE_DONE',
      'quest:q1',
    );
    expect(recordWorldChangeOnce).toHaveBeenCalledWith(
      'child-1',
      'bay',
      'CREATE',
      'QUEST_DONE',
      'quest:q1',
    );
  });

  it('sets the NPC memory flags a finished quest owes', async () => {
    questList.mockResolvedValue({ data: [row()] });
    listSessions.mockResolvedValue([{ templateSlug: 'bridge', status: 'COMPLETED' }]);

    await syncQuestProgress('child-1', [QUEST]);

    expect(setNpcMemoryFlagsForQuest).toHaveBeenCalledWith('child-1', 'pirate-pip', [
      'bridgeQuestCompleted',
    ]);
  });

  it('keeps the quest completed even when a side effect fails', async () => {
    questList.mockResolvedValue({ data: [row()] });
    listSessions.mockResolvedValue([{ templateSlug: 'bridge', status: 'COMPLETED' }]);
    recordWorldChangeOnce.mockRejectedValue(new Error('offline'));
    setNpcMemoryFlagsForQuest.mockRejectedValue(new Error('offline'));

    const results = await syncQuestProgress('child-1', [QUEST]);

    expect(results[0]?.justCompleted).toBe(true);
    expect(questUpdate).toHaveBeenCalled();
  });

  it('ignores a stored quest whose definition no longer exists', async () => {
    questList.mockResolvedValue({ data: [row({ questId: 'retired-quest' })] });

    expect(await syncQuestProgress('child-1', [QUEST])).toEqual([]);
    expect(questUpdate).not.toHaveBeenCalled();
  });

  it('skips quests that are already completed', async () => {
    questList.mockResolvedValue({ data: [row({ status: 'COMPLETED' })] });
    listSessions.mockResolvedValue([{ templateSlug: 'bridge', status: 'COMPLETED' }]);

    expect(await syncQuestProgress('child-1', [QUEST])).toEqual([]);
    expect(questUpdate).not.toHaveBeenCalled();
  });
});

describe('listQuestStates and clearQuestStates', () => {
  it('returns only this child rows, tolerating null array columns', async () => {
    questList.mockResolvedValue({
      data: [
        row({ completedStageIds: null, completedObjectiveIds: null }),
        row({ id: 'row-2', childProfileId: 'child-2' }),
      ],
    });

    const states = await listQuestStates('child-1');

    expect(states).toHaveLength(1);
    expect(states[0]?.completedStageIds).toEqual([]);
    expect(states[0]?.completedObjectiveIds).toEqual([]);
  });

  it('deletes every quest row for one child', async () => {
    questList.mockResolvedValue({ data: [row(), row({ id: 'row-2', questId: 'q2' })] });

    await clearQuestStates('child-1');

    expect(questDelete).toHaveBeenCalledWith({ id: 'row-1' });
    expect(questDelete).toHaveBeenCalledWith({ id: 'row-2' });
  });
});
