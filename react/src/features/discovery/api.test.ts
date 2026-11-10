import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/errors';
import { fakeDjangoClient, type FakeDjangoClient } from '../../test/fakeDjangoClient';

const {
  holder,
  listAllWorldChanges,
  getInventory,
  listQuestStates,
  startQuest,
  syncQuestProgress,
} = vi.hoisted(() => ({
  holder: { client: null as FakeDjangoClient | null },
  listAllWorldChanges: vi.fn(),
  getInventory: vi.fn(),
  listQuestStates: vi.fn(),
  startQuest: vi.fn(),
  syncQuestProgress: vi.fn(),
}));

vi.mock('../../api/djangoClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/djangoClient')>()),
  djangoClient: () => holder.client,
}));
vi.mock('../adventures/api', () => ({ listAllWorldChanges }));
vi.mock('../rewards/api', () => ({ getInventory }));
vi.mock('../quests/api', () => ({ listQuestStates, startQuest, syncQuestProgress }));

import {
  buildDiscoveryContext,
  clearWorldState,
  getDiscoveryDefinition,
  getWorldState,
  recordCharacterMet,
  recordDiscovery,
  saveCheckpoint,
} from './api';
import type { DiscoveryContext, DiscoveryDefinition } from './types';

const WORLD_STATE = 'children/child-1/world-state/';
const DISCOVERIES = 'children/child-1/discoveries/';

const openSecret: DiscoveryDefinition = {
  id: 'harbor-tide-pool',
  locationSlug: 'welcome-harbor',
  kind: 'HIDDEN_OBJECT',
  title: 'A tide pool',
  revealMessage: 'A shell rests at the bottom.',
  lockedMessage: 'Water glints between the rocks.',
  requirements: [{ type: 'ALWAYS' }],
  worldChange: { locationSlug: 'welcome-harbor', changeType: 'CREATE', changeKey: 'TIDE' },
  startsQuestId: 'the-quiet-places',
};

const lockedSecret: DiscoveryDefinition = {
  id: 'harbor-keepers-door',
  locationSlug: 'welcome-harbor',
  kind: 'LOCKED_DOOR',
  title: 'A locked door',
  revealMessage: 'The key turns.',
  lockedMessage: 'The keyhole is shaped like driftwood.',
  requirements: [{ type: 'ITEM_OWNED', itemId: 'driftwood-key' }],
};

function context(overrides: Partial<DiscoveryContext> = {}): DiscoveryContext {
  return { worldChangeKeys: [], ownedItemIds: [], discoveredIds: [], ...overrides };
}

let api: FakeDjangoClient;
beforeEach(() => {
  vi.clearAllMocks();
  api = fakeDjangoClient();
  holder.client = api;
  listAllWorldChanges.mockResolvedValue([]);
  getInventory.mockResolvedValue({ ownedItemIds: [], grantedRuleIds: [] });
  listQuestStates.mockResolvedValue([]);
  startQuest.mockResolvedValue({ questId: 'the-quiet-places' });
  syncQuestProgress.mockResolvedValue([]);
});

describe('getWorldState (AMP-03)', () => {
  it('reads the server record and drops ids the authored content does not define', async () => {
    api.on('GET', WORLD_STATE, {
      discoveredIds: ['harbor-tide-pool', 'something-a-bug-wrote'],
      metCharacterIds: ['pirate-pip', 'not-an-npc'],
      lastCheckpointId: 'welcome-harbor:dock',
    });
    await expect(getWorldState('child-1')).resolves.toEqual({
      discoveredIds: ['harbor-tide-pool'],
      metCharacterIds: ['pirate-pip'],
      lastCheckpointId: 'welcome-harbor:dock',
    });
  });

  it('joins world changes, backpack and discoveries into one context', async () => {
    api.on('GET', WORLD_STATE, { discoveredIds: [], metCharacterIds: [], lastCheckpointId: null });
    listAllWorldChanges.mockResolvedValue([{ changeKey: 'BRIDGE' }]);
    getInventory.mockResolvedValue({ ownedItemIds: ['shell'], grantedRuleIds: [] });
    await expect(buildDiscoveryContext('child-1')).resolves.toEqual({
      worldChangeKeys: ['BRIDGE'],
      ownedItemIds: ['shell'],
      discoveredIds: [],
    });
  });
});

describe('recordDiscovery: the server decides', () => {
  it('asks nothing for a secret that is plainly locked, and says the locked line', async () => {
    const result = await recordDiscovery('child-1', lockedSecret, context());
    expect(result.outcome).toMatchObject({
      status: 'LOCKED',
      message: 'The keyhole is shaped like driftwood.',
    });
    expect(api.calls).toEqual([]);
  });

  it('asks nothing for a secret already found', async () => {
    const result = await recordDiscovery(
      'child-1',
      openSecret,
      context({ discoveredIds: ['harbor-tide-pool'] }),
    );
    expect(result.outcome.status).toBe('ALREADY_FOUND');
    expect(api.calls).toEqual([]);
  });

  it('records a find on the server and shows what the server granted', async () => {
    api.on('POST', DISCOVERIES, {
      discoveryId: 'harbor-tide-pool',
      status: 'FOUND_NOW',
      rewardMessages: ['A moon shell was waiting.'],
      newItemIds: ['moon-shell'],
    });
    const result = await recordDiscovery('child-1', openSecret, context());
    expect(api.calls).toEqual([
      { method: 'POST', path: DISCOVERIES, body: { discoveryId: 'harbor-tide-pool' } },
    ]);
    expect(result.outcome.status).toBe('FOUND_NOW');
    expect(result.rewardMessages).toEqual(['A moon shell was waiting.']);
    expect(result.newItemIds).toEqual(['moon-shell']);
    expect(result.startedQuestId).toBe('the-quiet-places');
    expect(syncQuestProgress).toHaveBeenCalledWith('child-1');
  });

  it('keeps a secret shut when the server says it does not open', async () => {
    api.on('POST', DISCOVERIES, {
      discoveryId: 'harbor-tide-pool',
      status: 'LOCKED',
      message: 'Not yet.',
    });
    const result = await recordDiscovery('child-1', openSecret, context());
    expect(result.outcome).toMatchObject({ status: 'LOCKED', message: 'Not yet.' });
    expect(startQuest).not.toHaveBeenCalled();
  });

  it('grants nothing again when the server already holds the find', async () => {
    api.on('POST', DISCOVERIES, { discoveryId: 'harbor-tide-pool', status: 'ALREADY_FOUND' });
    const result = await recordDiscovery('child-1', openSecret, context());
    expect(result.outcome.status).toBe('ALREADY_FOUND');
    expect(result.newItemIds).toEqual([]);
  });

  it('does not re-announce a quest the child is already on', async () => {
    api.on('POST', DISCOVERIES, { discoveryId: 'harbor-tide-pool', status: 'FOUND_NOW' });
    listQuestStates.mockResolvedValue([{ questId: 'the-quiet-places' }]);
    const result = await recordDiscovery('child-1', openSecret, context());
    expect(result.startedQuestId).toBeUndefined();
  });

  it('keeps the find when the quest step fails', async () => {
    api.on('POST', DISCOVERIES, { discoveryId: 'harbor-tide-pool', status: 'FOUND_NOW' });
    syncQuestProgress.mockRejectedValue(new ApiError('network'));
    const result = await recordDiscovery('child-1', openSecret, context());
    expect(result.outcome.status).toBe('FOUND_NOW');
  });
});

describe('characters met, checkpoints and clearing', () => {
  it('sends only authored ids', async () => {
    api.on('PATCH', WORLD_STATE, {});
    await recordCharacterMet('child-1', 'pirate-pip');
    await recordCharacterMet('child-1', 'not-an-npc');
    await saveCheckpoint('child-1', 'welcome-harbor:dock');
    await saveCheckpoint('child-1', 'x:1,2,3');
    expect(api.calls).toEqual([
      { method: 'PATCH', path: WORLD_STATE, body: { metCharacterId: 'pirate-pip' } },
      { method: 'PATCH', path: WORLD_STATE, body: { lastCheckpointId: 'welcome-harbor:dock' } },
    ]);
  });

  it('a parent clears the record with one DELETE', async () => {
    api.on('DELETE', WORLD_STATE, null);
    await clearWorldState('child-1');
    expect(api.calls).toEqual([{ method: 'DELETE', path: WORLD_STATE }]);
  });

  it('resolves the id a DISCOVER world action names', () => {
    expect(getDiscoveryDefinition('no-such-discovery')).toBeUndefined();
  });
});
