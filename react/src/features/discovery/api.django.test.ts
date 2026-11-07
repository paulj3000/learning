import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  worldStateList,
  worldStateCreate,
  worldStateUpdate,
  listAllWorldChanges,
  recordWorldChangeOnce,
  getInventory,
  grantRewards,
  listQuestStates,
  startQuest,
  syncQuestProgress,
  discoveriesApiFor,
} = vi.hoisted(() => ({
  worldStateList: vi.fn(),
  worldStateCreate: vi.fn(),
  worldStateUpdate: vi.fn(),
  listAllWorldChanges: vi.fn(),
  recordWorldChangeOnce: vi.fn(),
  getInventory: vi.fn(),
  grantRewards: vi.fn(),
  listQuestStates: vi.fn(),
  startQuest: vi.fn(),
  syncQuestProgress: vi.fn(),
  discoveriesApiFor: vi.fn(),
}));

vi.mock('../../lib/data-client', () => ({
  client: {
    models: {
      ChildWorldState: { list: worldStateList, create: worldStateCreate, update: worldStateUpdate },
    },
  },
}));
vi.mock('../adventures/api', () => ({ listAllWorldChanges, recordWorldChangeOnce }));
vi.mock('../rewards/api', () => ({ getInventory, grantRewards }));
vi.mock('../quests/api', () => ({ listQuestStates, startQuest, syncQuestProgress }));
vi.mock('../../api/play/discoveriesApi', () => ({ discoveriesApiFor }));

import { getWorldState, recordDiscovery } from './api';
import type { DiscoveryContext, DiscoveryDefinition } from './types';

/**
 * Django mode (SC-R04-00). In a build with the Django API the server is the authority for a
 * discovery: it decides whether a secret opens and holds the record. The Amplify path stays
 * the fallback, so a build without Django, or a server that is down, behaves exactly as before.
 */

const nook: DiscoveryDefinition = {
  id: 'castle-tapestry-stair',
  locationSlug: 'storykeeper-castle',
  kind: 'SECRET_PASSAGE',
  title: 'A stair behind the tapestry',
  revealMessage: 'Behind the tapestry a narrow stair spirals up.',
  lockedMessage: 'One of the tapestries is moving, just a little.',
  requirements: [{ type: 'ALWAYS' }],
  worldChange: {
    locationSlug: 'storykeeper-castle',
    changeType: 'CREATE',
    changeKey: 'CASTLE_READING_NOOK_FOUND',
  },
};

const ctx = (over: Partial<DiscoveryContext> = {}): DiscoveryContext => ({
  worldChangeKeys: [],
  ownedItemIds: [],
  discoveredIds: [],
  ...over,
});

const fakeServer = (record: ReturnType<typeof vi.fn>, list = vi.fn().mockResolvedValue([])) => ({
  list,
  record,
});
const found = { discoveryId: nook.id, status: 'FOUND_NOW', rewardMessages: [], newItemIds: [] };

beforeEach(() => {
  vi.clearAllMocks();
  worldStateList.mockResolvedValue({ data: [] });
  worldStateCreate.mockResolvedValue({ data: { id: 'row-1' } });
  worldStateUpdate.mockResolvedValue({ data: { id: 'row-1' } });
  listAllWorldChanges.mockResolvedValue([]);
  recordWorldChangeOnce.mockResolvedValue(undefined);
  getInventory.mockResolvedValue({ ownedItemIds: [], grantedRuleIds: [] });
  grantRewards.mockResolvedValue({ newItemIds: [], messages: [], state: {} });
  listQuestStates.mockResolvedValue([]);
  startQuest.mockResolvedValue({});
  syncQuestProgress.mockResolvedValue([]);
  discoveriesApiFor.mockReturnValue(undefined);
});

describe('recordDiscovery with the Django API on', () => {
  it('asks the server first, then carries on with the Amplify records', async () => {
    const record = vi.fn().mockResolvedValue(found);
    discoveriesApiFor.mockReturnValue(fakeServer(record));
    const result = await recordDiscovery('child-1', nook, ctx());
    expect(result.outcome.status).toBe('FOUND_NOW');
    expect(record).toHaveBeenCalledWith(nook.id);
    // The server was asked before anything was written to Amplify.
    expect(record.mock.invocationCallOrder[0]).toBeLessThan(
      worldStateCreate.mock.invocationCallOrder[0],
    );
    expect(recordWorldChangeOnce).toHaveBeenCalledTimes(1);
    expect(grantRewards).toHaveBeenCalledTimes(1);
  });

  it('keeps a secret shut when the server says it does not open, and writes nothing', async () => {
    const record = vi
      .fn()
      .mockResolvedValue({ ...found, status: 'LOCKED', message: 'Not for you yet.' });
    discoveriesApiFor.mockReturnValue(fakeServer(record));
    const result = await recordDiscovery('child-1', nook, ctx());
    expect(result.outcome.status).toBe('LOCKED');
    expect(result.outcome.message).toBe('Not for you yet.');
    expect(result.rewardMessages).toEqual([]);
    expect(worldStateCreate).not.toHaveBeenCalled();
    expect(worldStateUpdate).not.toHaveBeenCalled();
    expect(recordWorldChangeOnce).not.toHaveBeenCalled();
    expect(grantRewards).not.toHaveBeenCalled();
  });

  it('falls back to the authored locked line when the server gives none', async () => {
    discoveriesApiFor.mockReturnValue(
      fakeServer(vi.fn().mockResolvedValue({ ...found, status: 'LOCKED' })),
    );
    expect((await recordDiscovery('child-1', nook, ctx())).outcome.message).toBe(
      nook.lockedMessage,
    );
  });

  it('carries on when the server already has it but Amplify does not', async () => {
    const record = vi.fn().mockResolvedValue({ ...found, status: 'ALREADY_FOUND' });
    discoveriesApiFor.mockReturnValue(fakeServer(record));
    const result = await recordDiscovery('child-1', nook, ctx());
    expect(result.outcome.status).toBe('FOUND_NOW');
    expect(worldStateCreate).toHaveBeenCalledTimes(1);
  });

  it('carries on exactly as before when the server fails: a child is never blocked by it', async () => {
    discoveriesApiFor.mockReturnValue(fakeServer(vi.fn().mockRejectedValue(new Error('down'))));
    const result = await recordDiscovery('child-1', nook, ctx());
    expect(result.outcome.status).toBe('FOUND_NOW');
    expect(worldStateCreate).toHaveBeenCalledTimes(1);
    expect(recordWorldChangeOnce).toHaveBeenCalledTimes(1);
  });

  it('tells the server about a secret already found in Amplify, so it holds the record too', async () => {
    const record = vi.fn().mockResolvedValue(found);
    discoveriesApiFor.mockReturnValue(fakeServer(record));
    const result = await recordDiscovery('child-1', nook, ctx({ discoveredIds: [nook.id] }));
    expect(result.outcome.status).toBe('ALREADY_FOUND');
    expect(record).toHaveBeenCalledWith(nook.id);
    // Nothing is shown differently and nothing is written to Amplify a second time.
    expect(worldStateCreate).not.toHaveBeenCalled();
    expect(grantRewards).not.toHaveBeenCalled();
  });

  it('does not ask the server about a secret that is still locked on the client', async () => {
    const record = vi.fn().mockResolvedValue(found);
    discoveriesApiFor.mockReturnValue(fakeServer(record));
    const locked: DiscoveryDefinition = {
      ...nook,
      id: 'harbor-keepers-door',
      requirements: [{ type: 'ITEM_OWNED', itemId: 'driftwood-key' }],
    };
    expect((await recordDiscovery('child-1', locked, ctx())).outcome.status).toBe('LOCKED');
    expect(record).not.toHaveBeenCalled();
  });
});

describe('recordDiscovery in a build without the Django API', () => {
  it('never touches the server path: the Amplify records are written as they always were', async () => {
    const result = await recordDiscovery('child-1', nook, ctx());
    expect(result.outcome.status).toBe('FOUND_NOW');
    expect(discoveriesApiFor).toHaveBeenCalled();
    expect(worldStateCreate).toHaveBeenCalledTimes(1);
    expect(recordWorldChangeOnce).toHaveBeenCalledTimes(1);
  });
});

describe('getWorldState with the Django API on', () => {
  it('adds what the server holds to what Amplify holds, so a failed Amplify write loses nothing', async () => {
    discoveriesApiFor.mockReturnValue(fakeServer(vi.fn(), vi.fn().mockResolvedValue([nook.id])));
    expect((await getWorldState('child-1')).discoveredIds).toEqual([nook.id]);
  });

  it('keeps what Amplify holds when the server has nothing, and ignores ids it does not know', async () => {
    worldStateList.mockResolvedValue({
      data: [
        {
          childProfileId: 'child-1',
          discoveredObjects: ['harbor-tide-pool'],
          discoveredCharacters: [],
        },
      ],
    });
    discoveriesApiFor.mockReturnValue(
      fakeServer(vi.fn(), vi.fn().mockResolvedValue(['an-id-from-a-newer-version'])),
    );
    expect((await getWorldState('child-1')).discoveredIds).toEqual(['harbor-tide-pool']);
  });

  it('lists each id once, in the content order, when both hold it', async () => {
    worldStateList.mockResolvedValue({
      data: [{ childProfileId: 'child-1', discoveredObjects: [nook.id], discoveredCharacters: [] }],
    });
    discoveriesApiFor.mockReturnValue(
      fakeServer(vi.fn(), vi.fn().mockResolvedValue([nook.id, 'harbor-tide-pool'])),
    );
    const ids = (await getWorldState('child-1')).discoveredIds;
    expect(ids.filter((id) => id === nook.id)).toHaveLength(1);
    expect(ids).toEqual(expect.arrayContaining([nook.id, 'harbor-tide-pool']));
  });

  it('keeps the Amplify snapshot when the server read fails', async () => {
    worldStateList.mockResolvedValue({
      data: [{ childProfileId: 'child-1', discoveredObjects: [nook.id], discoveredCharacters: [] }],
    });
    discoveriesApiFor.mockReturnValue(
      fakeServer(vi.fn(), vi.fn().mockRejectedValue(new Error('offline'))),
    );
    expect((await getWorldState('child-1')).discoveredIds).toEqual([nook.id]);
  });

  it('is untouched in a build without the Django API', async () => {
    expect((await getWorldState('child-1')).discoveredIds).toEqual([]);
  });
});
