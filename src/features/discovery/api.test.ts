import { describe, expect, it, vi, beforeEach } from 'vitest';

const {
  worldStateList,
  worldStateCreate,
  worldStateUpdate,
  worldStateDelete,
  listAllWorldChanges,
  recordWorldChangeOnce,
  getInventory,
  grantRewards,
  listQuestStates,
  startQuest,
  syncQuestProgress,
} = vi.hoisted(() => ({
  worldStateList: vi.fn(),
  worldStateCreate: vi.fn(),
  worldStateUpdate: vi.fn(),
  worldStateDelete: vi.fn(),
  listAllWorldChanges: vi.fn(),
  recordWorldChangeOnce: vi.fn(),
  getInventory: vi.fn(),
  grantRewards: vi.fn(),
  listQuestStates: vi.fn(),
  startQuest: vi.fn(),
  syncQuestProgress: vi.fn(),
}));

vi.mock('../../lib/data-client', () => ({
  client: {
    models: {
      ChildWorldState: {
        list: worldStateList,
        create: worldStateCreate,
        update: worldStateUpdate,
        delete: worldStateDelete,
      },
    },
  },
}));

vi.mock('../adventures/api', () => ({ listAllWorldChanges, recordWorldChangeOnce }));
vi.mock('../rewards/api', () => ({ getInventory, grantRewards }));
vi.mock('../quests/api', () => ({ listQuestStates, startQuest, syncQuestProgress }));

import {
  buildDiscoveryContext,
  clearWorldState,
  getDiscoveryDefinition,
  getWorldState,
  recordCharacterMet,
  recordDiscovery,
} from './api';
import type { DiscoveryContext, DiscoveryDefinition } from './types';

const openSecret: DiscoveryDefinition = {
  id: 'harbor-tide-pool',
  locationSlug: 'welcome-harbor',
  kind: 'HIDDEN_OBJECT',
  title: 'A tide pool',
  revealMessage: 'A shell rests at the bottom.',
  lockedMessage: 'Water glints between the rocks.',
  requirements: [{ type: 'ALWAYS' }],
  worldChange: {
    locationSlug: 'welcome-harbor',
    changeType: 'CREATE',
    changeKey: 'TIDE_POOL_FOUND',
  },
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
  startQuest.mockResolvedValue({ questId: 'the-quiet-places' });
  syncQuestProgress.mockResolvedValue([]);
});

describe('getWorldState', () => {
  it('returns an empty record for a child who has never explored', async () => {
    await expect(getWorldState('child-1')).resolves.toEqual({
      discoveredIds: [],
      metCharacterIds: [],
    });
  });

  it('reads only this child own row', async () => {
    worldStateList.mockResolvedValue({
      data: [
        { id: 'a', childProfileId: 'child-2', discoveredObjects: ['bay-tide-tunnel'] },
        { id: 'b', childProfileId: 'child-1', discoveredObjects: ['harbor-tide-pool'] },
      ],
    });

    await expect(getWorldState('child-1')).resolves.toEqual({
      discoveredIds: ['harbor-tide-pool'],
      metCharacterIds: [],
    });
  });

  /**
   * A stored column is external data at read time (CLAUDE.md section 13).
   * An id this build does not define is dropped rather than surfaced.
   */
  it('drops stored ids the authored content does not define', async () => {
    worldStateList.mockResolvedValue({
      data: [
        {
          id: 'b',
          childProfileId: 'child-1',
          discoveredObjects: ['harbor-tide-pool', 'something-a-bug-wrote'],
          discoveredCharacters: ['pirate-pip', 'not-an-npc'],
        },
      ],
    });

    await expect(getWorldState('child-1')).resolves.toEqual({
      discoveredIds: ['harbor-tide-pool'],
      metCharacterIds: ['pirate-pip'],
    });
  });
});

describe('buildDiscoveryContext', () => {
  it('joins world changes, backpack, and discoveries into one snapshot', async () => {
    listAllWorldChanges.mockResolvedValue([{ changeKey: 'BRIDGE_REPAIRED' }]);
    getInventory.mockResolvedValue({ ownedItemIds: ['driftwood-key'], grantedRuleIds: [] });
    worldStateList.mockResolvedValue({
      data: [{ id: 'b', childProfileId: 'child-1', discoveredObjects: ['bay-tide-tunnel'] }],
    });

    await expect(buildDiscoveryContext('child-1')).resolves.toEqual({
      worldChangeKeys: ['BRIDGE_REPAIRED'],
      ownedItemIds: ['driftwood-key'],
      discoveredIds: ['bay-tide-tunnel'],
    });
  });
});

describe('recordDiscovery', () => {
  it('writes nothing for a secret the child cannot open yet, and says the locked line', async () => {
    const result = await recordDiscovery('child-1', lockedSecret, context());

    expect(result.outcome.status).toBe('LOCKED');
    expect(result.outcome.message).toBe('The keyhole is shaped like driftwood.');
    expect(worldStateCreate).not.toHaveBeenCalled();
    expect(worldStateUpdate).not.toHaveBeenCalled();
    expect(grantRewards).not.toHaveBeenCalled();
  });

  it('records the find, the world change, the reward, and the quest it gives out', async () => {
    grantRewards.mockResolvedValue({
      newItemIds: ['moon-shell'],
      messages: ['A moon shell was waiting.'],
      state: {},
    });

    const result = await recordDiscovery('child-1', openSecret, context());

    expect(result.outcome.status).toBe('FOUND_NOW');
    expect(worldStateCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        childProfileId: 'child-1',
        discoveredObjects: ['harbor-tide-pool'],
        discoveredCharacters: [],
      }),
    );
    expect(recordWorldChangeOnce).toHaveBeenCalledWith(
      'child-1',
      'welcome-harbor',
      'CREATE',
      'TIDE_POOL_FOUND',
      'discovery:harbor-tide-pool',
    );
    expect(grantRewards).toHaveBeenCalledWith(
      'child-1',
      { type: 'DISCOVERY', discoveryKey: 'harbor-tide-pool' },
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
    expect(result.rewardMessages).toEqual(['A moon shell was waiting.']);
    expect(result.newItemIds).toEqual(['moon-shell']);
    expect(result.startedQuestId).toBe('the-quiet-places');
    // A discovery can complete an objective in an already-running quest, so
    // the projection runs whether or not a quest was started.
    expect(syncQuestProgress).toHaveBeenCalledWith('child-1');
  });

  /**
   * Safe to call on every visit: the scene fires this each time the child
   * walks into the zone, so a repeat must be free and must not re-celebrate.
   */
  it('is idempotent: a secret already found writes and grants nothing again', async () => {
    const result = await recordDiscovery(
      'child-1',
      openSecret,
      context({ discoveredIds: ['harbor-tide-pool'] }),
    );

    expect(result.outcome.status).toBe('ALREADY_FOUND');
    expect(result.outcome.message).toBe('A shell rests at the bottom.');
    expect(worldStateCreate).not.toHaveBeenCalled();
    expect(worldStateUpdate).not.toHaveBeenCalled();
    expect(grantRewards).not.toHaveBeenCalled();
    expect(startQuest).not.toHaveBeenCalled();
  });

  it('appends to an existing row without losing what is already there', async () => {
    worldStateList.mockResolvedValue({
      data: [
        {
          id: 'row-9',
          childProfileId: 'child-1',
          discoveredObjects: ['bay-tide-tunnel'],
          discoveredCharacters: ['pirate-pip'],
        },
      ],
    });

    await recordDiscovery('child-1', openSecret, context());

    expect(worldStateUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'row-9',
        discoveredObjects: ['bay-tide-tunnel', 'harbor-tide-pool'],
        discoveredCharacters: ['pirate-pip'],
      }),
    );
  });

  it('does not re-announce a quest the child is already on', async () => {
    listQuestStates.mockResolvedValue([{ questId: 'the-quiet-places', status: 'ACTIVE' }]);

    const result = await recordDiscovery('child-1', openSecret, context());

    expect(result.startedQuestId).toBeUndefined();
  });

  /**
   * A secret that was found stays found. The alternative is a child watching
   * a place they found go back to being hidden because a reward write
   * failed, and `grantRewards` is idempotent per rule so the missed grant is
   * picked up next time anything calls it.
   */
  it('keeps the find when a reward or world-change write fails', async () => {
    grantRewards.mockRejectedValue(new Error('offline'));
    recordWorldChangeOnce.mockRejectedValue(new Error('offline'));

    const result = await recordDiscovery('child-1', openSecret, context());

    expect(result.outcome.status).toBe('FOUND_NOW');
    expect(result.rewardMessages).toEqual([]);
    expect(worldStateCreate).toHaveBeenCalled();
  });

  it('builds its own context when the caller does not supply one', async () => {
    getInventory.mockResolvedValue({ ownedItemIds: ['driftwood-key'], grantedRuleIds: [] });

    const result = await recordDiscovery('child-1', lockedSecret);

    expect(result.outcome.status).toBe('FOUND_NOW');
  });
});

describe('recordCharacterMet', () => {
  it('records an authored NPC once', async () => {
    await recordCharacterMet('child-1', 'pirate-pip');

    expect(worldStateCreate).toHaveBeenCalledWith(
      expect.objectContaining({ discoveredCharacters: ['pirate-pip'] }),
    );
  });

  it('writes nothing for a character already met', async () => {
    worldStateList.mockResolvedValue({
      data: [{ id: 'r', childProfileId: 'child-1', discoveredCharacters: ['pirate-pip'] }],
    });

    await recordCharacterMet('child-1', 'pirate-pip');

    expect(worldStateUpdate).not.toHaveBeenCalled();
  });

  /**
   * Chatty is a companion, not an `NpcDefinition`, and tapping the companion
   * is the most common `NPC`-type interaction on the island. An unknown id
   * must be dropped without a write rather than stored.
   */
  it('writes nothing for an id that is not an authored NPC', async () => {
    await recordCharacterMet('child-1', 'chatty');

    expect(worldStateList).not.toHaveBeenCalled();
    expect(worldStateCreate).not.toHaveBeenCalled();
  });
});

describe('getDiscoveryDefinition', () => {
  it('resolves the id a DISCOVER world action names', () => {
    expect(getDiscoveryDefinition('harbor-tide-pool')?.locationSlug).toBe('welcome-harbor');
    expect(getDiscoveryDefinition('nope')).toBeUndefined();
  });
});

describe('clearWorldState', () => {
  it('deletes this child rows and nobody else own', async () => {
    worldStateList.mockResolvedValue({
      data: [
        { id: 'a', childProfileId: 'child-1' },
        { id: 'b', childProfileId: 'child-2' },
      ],
    });

    await clearWorldState('child-1');

    expect(worldStateDelete).toHaveBeenCalledWith({ id: 'a' });
    expect(worldStateDelete).not.toHaveBeenCalledWith({ id: 'b' });
  });
});
