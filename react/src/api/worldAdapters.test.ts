import { describe, expect, it, vi } from 'vitest';

const amplifyQuests = vi.hoisted(() => ({
  listQuestStates: vi.fn(),
  buildQuestContext: vi.fn(),
  startQuest: vi.fn(),
  syncQuestProgress: vi.fn(),
  clearQuestStates: vi.fn(),
}));
const amplifyNpc = vi.hoisted(() => ({
  getNpcState: vi.fn(),
  listNpcStates: vi.fn(),
  recordDialogueNode: vi.fn(),
  setNpcMemoryFlagsForQuest: vi.fn(),
  clearNpcState: vi.fn(),
}));
const amplifyDiscovery = vi.hoisted(() => ({
  getWorldState: vi.fn(),
  buildDiscoveryContext: vi.fn(),
  recordDiscovery: vi.fn(),
  recordCharacterMet: vi.fn(),
  saveCheckpoint: vi.fn(),
  clearWorldState: vi.fn(),
}));
vi.mock('./amplify/quests', () => amplifyQuests);
vi.mock('./amplify/npc', () => amplifyNpc);
vi.mock('./amplify/discovery', () => amplifyDiscovery);
vi.mock('../lib/data-client', () => ({ client: { models: {}, mutations: {} } }));

import { createDjangoDiscovery, discoveryApi, type DiscoveryApi } from './discovery';
import { createDjangoNpc, npcApi, type NpcApi } from './npc';
import { createDjangoQuests, type QuestsApi } from './quests';
import { selectApi } from './select';
import { djangoTestClient } from '../test/apiFixtures';
import { CHILD_A, errorJson, jsonResponse } from '../test/playFixtures';
import type { QuestDefinition } from '../features/quests/types';
import type { DiscoveryDefinition } from '../features/discovery/types';

const DJANGO = { backend: 'django', baseUrl: 'https://lai.example' } as const;
const NO_REWARDS = { grants: [], newItems: [] };

function questEntry(overrides: Record<string, unknown> = {}) {
  return {
    questId: 'repair',
    title: 'Repair',
    summary: 'Fix it',
    giverNpcId: 'pip',
    status: 'ACTIVE',
    currentStageId: 'build',
    startedAt: '2026-10-26T10:00:00+00:00',
    completedStageIds: [],
    completedObjectiveIds: ['met'],
    completedAt: null,
    stages: [],
    available: true,
    lockedReason: null,
    prerequisites: [],
    ...overrides,
  };
}

function turnJson(overrides: Record<string, unknown> = {}) {
  return {
    npcId: 'pip',
    node: { id: 'hello', text: 'Ahoy!', choices: [{ id: 'hi', label: 'Hi' }] },
    relationship: { level: 'ACQUAINTANCE', met: true, lastInteractedAt: null, levelIncreased: true },
    questUpdates: [
      {
        questId: 'chat',
        status: 'COMPLETED',
        currentStageId: 'talk',
        justCompleted: true,
        newlyCompletedObjectiveIds: ['met-pip'],
      },
    ],
    rewards: NO_REWARDS,
    ...overrides,
  };
}

describe('Django quests (LAI-0605)', () => {
  it('lists the quests the child has started, as quest state', async () => {
    const { client, call } = djangoTestClient(
      jsonResponse(200, {
        quests: [
          questEntry(),
          questEntry({ questId: 'later', status: 'LOCKED', currentStageId: null, startedAt: null }),
          questEntry({
            questId: 'done',
            status: 'COMPLETED',
            completedAt: '2026-10-26T11:00:00+00:00',
          }),
        ],
      }),
    );
    const states = await (createDjangoQuests(client) as Required<QuestsApi>).listQuestStates(CHILD_A);
    expect(call().url).toBe(`https://lai.example/api/v1/children/${CHILD_A}/quests/`);
    expect(states.map((s) => s.questId)).toEqual(['repair', 'done']);
    expect(states[0]).toEqual({
      questId: 'repair',
      status: 'ACTIVE',
      currentStageId: 'build',
      completedStageIds: [],
      completedObjectiveIds: ['met'],
      startedAt: '2026-10-26T10:00:00+00:00',
    });
    expect(states[1]?.completedAt).toBe('2026-10-26T11:00:00+00:00');
  });

  it('accepts through the server, which checks prerequisites', async () => {
    const { client, call } = djangoTestClient(
      jsonResponse(201, questEntry({ currentStageId: 'talk', completedObjectiveIds: [] })),
      jsonResponse(409, errorJson('quest_unavailable')),
    );
    const api = createDjangoQuests(client) as Required<QuestsApi>;
    const definition = { id: 'repair' } as QuestDefinition;
    await expect(api.startQuest(CHILD_A, definition)).resolves.toMatchObject({ status: 'ACTIVE' });
    expect(call()).toMatchObject({
      url: `https://lai.example/api/v1/children/${CHILD_A}/quests/repair/accept/`,
      method: 'POST',
      body: {},
    });
    await expect(api.startQuest(CHILD_A, { id: 'later' } as QuestDefinition)).rejects.toMatchObject({
      kind: 'conflict',
      code: 'quest_unavailable',
    });
  });

  it('never computes or syncs quest progress from a Django client', async () => {
    const api = selectApi<QuestsApi>(
      'quests',
      { amplify: amplifyQuests, django: (client) => createDjangoQuests(client) },
      DJANGO,
    );
    await expect(api.syncQuestProgress(CHILD_A)).rejects.toMatchObject({ code: 'quests_unavailable' });
    await expect(api.buildQuestContext(CHILD_A)).rejects.toMatchObject({ kind: 'unsupported' });
    expect(amplifyQuests.syncQuestProgress).not.toHaveBeenCalled();
  });
});

describe('Django NPC conversations (LAI-0605)', () => {
  it('talks: the server picks the node; the client sends no node', async () => {
    const { client, call } = djangoTestClient(jsonResponse(200, turnJson()));
    const turn = await (createDjangoNpc(client) as Required<NpcApi>).talkToNpc(CHILD_A, 'pip');
    expect(call()).toMatchObject({
      url: `https://lai.example/api/v1/children/${CHILD_A}/npcs/pip/talk/`,
      method: 'POST',
      body: {},
    });
    expect(turn.node?.choices).toEqual([{ id: 'hi', label: 'Hi' }]);
    expect(turn.relationship).toEqual({ level: 'ACQUAINTANCE', levelIncreased: true });
    expect(turn.questUpdates[0]?.justCompleted).toBe(true);
  });

  it('chooses: only the node it came from and the choice id', async () => {
    const { client, call } = djangoTestClient(
      jsonResponse(200, turnJson({ node: null })),
      jsonResponse(409, errorJson('dialogue_choice_unavailable')),
    );
    const api = createDjangoNpc(client) as Required<NpcApi>;
    await expect(api.chooseNpcDialogue(CHILD_A, 'pip', 'offer', 'later')).resolves.toMatchObject({
      node: null,
    });
    expect(call().body).toEqual({ fromNodeId: 'offer', choiceId: 'later' });
    await expect(api.chooseNpcDialogue(CHILD_A, 'pip', 'secret', 'x')).rejects.toMatchObject({
      kind: 'conflict',
      code: 'dialogue_choice_unavailable',
    });
  });

  it('lists NPCs with the child’s relationship', async () => {
    const { client } = djangoTestClient(
      jsonResponse(200, {
        npcs: [
          {
            npcId: 'pip',
            displayName: 'Pip',
            role: 'Pirate',
            homeLocationSlug: 'bay',
            interactionId: 'talk-pip',
            relationship: { level: 'STRANGER', met: false, lastInteractedAt: null },
          },
        ],
      }),
    );
    const [pip] = await (createDjangoNpc(client) as Required<NpcApi>).listNpcs(CHILD_A);
    expect(pip?.relationship).toEqual({ level: 'STRANGER', met: false, lastInteractedAt: null });
  });

  it('never lets a Django client choose its own node, and keeps Amplify recording', async () => {
    const django = selectApi<NpcApi>(
      'npc',
      { amplify: npcApi, django: (client) => createDjangoNpc(client) },
      DJANGO,
    );
    await expect(
      django.recordDialogueNode(CHILD_A, 'pip', { id: 'x', conditions: [], text: '', choices: [] }),
    ).rejects.toMatchObject({ code: 'npc_unavailable' });
    expect(amplifyNpc.recordDialogueNode).not.toHaveBeenCalled();
    // The talk contract is Django's: on Amplify it says so instead of pretending.
    await expect(npcApi.talkToNpc(CHILD_A, 'pip')).rejects.toMatchObject({ kind: 'unsupported' });
  });
});

describe('Django discoveries (LAI-0605)', () => {
  const POOL = { id: 'harbor-tide-pool' } as DiscoveryDefinition;

  it('records a discovery through the server and keeps the existing result shape', async () => {
    const { client, call } = djangoTestClient(
      jsonResponse(200, {
        discoveryId: 'harbor-tide-pool',
        title: 'A tide pool',
        status: 'FOUND_NOW',
        message: 'A shell rests in the pool.',
        worldChangeKey: null,
        startedQuestId: 'the-quiet-places',
        questUpdates: [],
        rewards: {
          grants: [
            {
              grantId: 'g1',
              ruleId: 'reward-harbor-tide-pool',
              source: 'DISCOVERY',
              message: 'A moon shell!',
              newlyGranted: true,
              grantedAt: '2026-10-26T10:00:00+00:00',
              items: [],
            },
          ],
          newItems: [
            { itemId: 'moon-shell', displayName: 'Moon Shell', description: '', category: 'COLLECTIBLE', assetId: '' },
          ],
        },
      }),
    );
    const result = await (createDjangoDiscovery(client) as Required<DiscoveryApi>).recordDiscovery(
      CHILD_A,
      POOL,
    );
    expect(call()).toMatchObject({
      url: `https://lai.example/api/v1/children/${CHILD_A}/discoveries/harbor-tide-pool/`,
      method: 'POST',
      body: {},
    });
    expect(result).toEqual({
      outcome: {
        discoveryId: 'harbor-tide-pool',
        title: 'A tide pool',
        status: 'FOUND_NOW',
        message: 'A shell rests in the pool.',
      },
      rewardMessages: ['A moon shell!'],
      newItemIds: ['moon-shell'],
      startedQuestId: 'the-quiet-places',
    });
  });

  it('reports a network failure and an unknown discovery, typed', async () => {
    const { client } = djangoTestClient(
      new TypeError('Failed to fetch'),
      jsonResponse(404, errorJson('not_found')),
    );
    const api = createDjangoDiscovery(client) as Required<DiscoveryApi>;
    await expect(api.recordDiscovery(CHILD_A, POOL)).rejects.toMatchObject({ kind: 'network' });
    await expect(api.listDiscoveries(CHILD_A)).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('has no Django route for characters met or checkpoints, and never falls back', async () => {
    const api = selectApi<DiscoveryApi>(
      'discovery',
      { amplify: discoveryApi, django: (client) => createDjangoDiscovery(client) },
      DJANGO,
    );
    await expect(api.saveCheckpoint(CHILD_A, 'c1')).rejects.toMatchObject({ code: 'discovery_unavailable' });
    await expect(api.recordCharacterMet(CHILD_A, 'pip')).rejects.toMatchObject({ kind: 'unsupported' });
    await expect(api.getWorldState(CHILD_A)).rejects.toMatchObject({ kind: 'unsupported' });
    expect(amplifyDiscovery.saveCheckpoint).not.toHaveBeenCalled();
  });

  it('lists found discoveries on Amplify from the world state and bundled content', async () => {
    amplifyDiscovery.getWorldState.mockResolvedValue({
      discoveredIds: ['harbor-tide-pool', 'not-authored'],
      metCharacterIds: [],
      lastCheckpointId: null,
    });
    const [pool, ...rest] = await discoveryApi.listDiscoveries(CHILD_A);
    expect(rest).toEqual([]);
    expect(pool).toMatchObject({ discoveryId: 'harbor-tide-pool', locationSlug: 'welcome-harbor' });
  });
});

describe('quest updates on step answers (LAI-0605)', () => {
  it('reads the quests an answer moved', async () => {
    const { createDjangoAdventures } = await import('./adventures');
    const { client } = djangoTestClient(
      jsonResponse(200, {
        correctness: 'not_applicable',
        supportLevel: 0,
        action: 'ADVANCE',
        nextStepId: 'done',
        session: {},
        rewards: NO_REWARDS,
        questUpdates: [
          {
            questId: 'repair',
            status: 'COMPLETED',
            currentStageId: 'solve',
            justCompleted: true,
            newlyCompletedObjectiveIds: ['fixed', 'solved'],
          },
        ],
      }),
    );
    const result = await createDjangoAdventures(client).submitAdventureAnswer?.(
      'session-1',
      { kind: 'world-change' },
      0,
      { childProfileId: CHILD_A, stepId: 'fix' },
    );
    expect(result?.questUpdates).toEqual([
      {
        questId: 'repair',
        status: 'COMPLETED',
        currentStageId: 'solve',
        justCompleted: true,
        newlyCompletedObjectiveIds: ['fixed', 'solved'],
      },
    ]);
  });
});
