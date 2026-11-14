import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ApiError } from '../../api/errors';
import { fakeDjangoClient, type FakeDjangoClient } from '../../test/fakeDjangoClient';

const {
  holder,
  listSessions,
  listAllWorldChanges,
  listNpcStates,
  listSkillProgress,
  getInventory,
  getWorldState,
} = vi.hoisted(() => ({
  holder: { client: null as FakeDjangoClient | null },
  listSessions: vi.fn(),
  listAllWorldChanges: vi.fn(),
  listNpcStates: vi.fn(),
  listSkillProgress: vi.fn(),
  getInventory: vi.fn(),
  getWorldState: vi.fn(),
}));

vi.mock('../../api/djangoClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/djangoClient')>()),
  djangoClient: () => holder.client,
}));
vi.mock('../adventures/api', () => ({ listSessions, listAllWorldChanges }));
vi.mock('../npc/api', () => ({ listNpcStates }));
vi.mock('../mastery/api', () => ({ listSkillProgress }));
vi.mock('../rewards/api', () => ({ getInventory }));
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

const QUESTS = 'children/child-1/quests/';

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'row-1',
    questId: 'q1',
    status: 'ACTIVE',
    currentStageId: 'stage-1',
    completedStageIds: [],
    completedObjectiveIds: [],
    startedAt: '2026-01-01T00:00:00+00:00',
    lastUpdatedAt: '2026-01-01T00:00:00+00:00',
    completedAt: null,
    ...overrides,
  };
}

let api: FakeDjangoClient;

beforeEach(() => {
  vi.clearAllMocks();
  api = fakeDjangoClient();
  holder.client = api;
  api.on('GET', QUESTS, { quests: [] });
  listSessions.mockResolvedValue([]);
  listAllWorldChanges.mockResolvedValue([]);
  listNpcStates.mockResolvedValue([]);
  listSkillProgress.mockResolvedValue([]);
  getInventory.mockResolvedValue({ ownedItemIds: [], grantedRuleIds: [] });
  getWorldState.mockResolvedValue({ discoveredIds: [], metCharacterIds: [] });
});

function writes() {
  return api.calls.filter((call) => call.method !== 'GET');
}

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
    getWorldState.mockResolvedValue({ discoveredIds: ['harbor-tide-pool'], metCharacterIds: [] });
    api.on('GET', QUESTS, { quests: [row({ status: 'COMPLETED' })] });

    const context = await buildQuestContext('child-1');

    expect(context.completedAdventureSlugs).toEqual(['bridge']);
    expect(context.worldChangeKeys).toEqual(['BRIDGE_REPAIRED', 'FIRST_STORY_TOLD']);
    expect(context.visitedLocationSlugs).toEqual(['pirate-builder-bay', 'storykeeper-castle']);
    expect(context.ownedItemIds).toEqual(['spiral-shell']);
    expect(context.npcMemoryFlags['pirate-pip']).toEqual({ metPip: true });
    expect(context.relationshipLevels['pirate-pip']).toBe('TRUSTED_FRIEND');
    expect(context.skillStatuses).toEqual({ 'MATH.COUNT.10': 'PROFICIENT' });
    expect(context.discoveryKeys).toEqual(['harbor-tide-pool']);
    expect(context.completedQuestIds).toEqual(['q1']);
  });
});

describe('startQuest (AMP-03)', () => {
  it('accepts the quest on the server, which checks band and prerequisites', async () => {
    api.on('POST', `${QUESTS}q1/accept/`, {});
    api.on('GET', QUESTS, { quests: [row()] });
    const state = await startQuest('child-1', QUEST);
    expect(writes()).toEqual([{ method: 'POST', path: `${QUESTS}q1/accept/`, body: {} }]);
    expect(state.currentStageId).toBe('stage-1');
  });

  it('lets a refusal through', async () => {
    api.on('POST', `${QUESTS}q1/accept/`, () => {
      throw new ApiError('conflict', { status: 409, code: 'quest_unavailable' });
    });
    await expect(startQuest('child-1', QUEST)).rejects.toMatchObject({ code: 'quest_unavailable' });
  });
});

describe('syncQuestProgress', () => {
  it('does nothing when the child has no active quests', async () => {
    expect(await syncQuestProgress('child-1', [QUEST])).toEqual([]);
    expect(writes()).toEqual([]);
  });

  it('writes nothing when an active quest has not moved', async () => {
    api.on('GET', QUESTS, { quests: [row()] });
    expect(await syncQuestProgress('child-1', [QUEST])).toEqual([]);
    expect(writes()).toEqual([]);
  });

  it('saves the projected state and nothing else: completion side effects are the server', async () => {
    api.on('GET', QUESTS, { quests: [row()] });
    listSessions.mockResolvedValue([{ templateSlug: 'bridge', status: 'COMPLETED' }]);
    api.on('PUT', `${QUESTS}q1/`, {
      quest: row({
        status: 'COMPLETED',
        completedStageIds: ['stage-1'],
        completedObjectiveIds: ['solve'],
        completedAt: '2026-01-02T00:00:00+00:00',
      }),
      rewardMessages: ['A shell for you.'],
      newItemIds: ['shell'],
    });

    const results = await syncQuestProgress('child-1', [QUEST]);

    expect(writes()).toEqual([
      {
        method: 'PUT',
        path: `${QUESTS}q1/`,
        body: {
          status: 'COMPLETED',
          currentStageId: 'stage-1',
          completedStageIds: ['stage-1'],
          completedObjectiveIds: ['solve'],
        },
      },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      questId: 'q1',
      justCompleted: true,
      rewardMessages: ['A shell for you.'],
      state: { status: 'COMPLETED', completedAt: '2026-01-02T00:00:00+00:00' },
    });
  });

  it('ignores a stored quest whose definition no longer exists, and finished quests', async () => {
    api.on('GET', QUESTS, {
      quests: [row({ questId: 'retired-quest' }), row({ id: 'r2', status: 'COMPLETED' })],
    });
    listSessions.mockResolvedValue([{ templateSlug: 'bridge', status: 'COMPLETED' }]);
    expect(await syncQuestProgress('child-1', [QUEST])).toEqual([]);
    expect(writes()).toEqual([]);
  });
});

describe('listQuestStates and clearQuestStates', () => {
  it('reads the server rows, omitting completedAt until there is one', async () => {
    api.on('GET', QUESTS, { quests: [row()] });
    const [state] = await listQuestStates('child-1');
    expect(state).toEqual({
      questId: 'q1',
      status: 'ACTIVE',
      currentStageId: 'stage-1',
      completedStageIds: [],
      completedObjectiveIds: [],
      startedAt: '2026-01-01T00:00:00+00:00',
    });
  });

  it('a parent clears every quest with one DELETE', async () => {
    api.on('DELETE', QUESTS, null);
    await clearQuestStates('child-1');
    expect(writes()).toEqual([{ method: 'DELETE', path: QUESTS }]);
  });
});
