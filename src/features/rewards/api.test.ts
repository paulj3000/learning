import { describe, expect, it, vi, beforeEach } from 'vitest';

const { list, create, update, remove } = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('../../lib/data-client', () => ({
  client: {
    models: {
      ChildInventory: { list, create, update, delete: remove },
    },
  },
}));

import { clearInventory, getInventory, grantRewards } from './api';
import type { CollectibleSet, ItemDefinition, RewardTable, RewardTrigger } from './types';

const items: ItemDefinition[] = [
  { id: 'a', displayName: 'A', description: '', category: 'COLLECTIBLE', rarity: 'COMMON' },
  { id: 'b', displayName: 'B', description: '', category: 'COLLECTIBLE', rarity: 'COMMON' },
  {
    id: 'prize-hat',
    displayName: 'Prize Hat',
    description: '',
    category: 'COSMETIC',
    rarity: 'UNCOMMON',
    cosmeticSlot: 'HAT',
  },
];

const sets: CollectibleSet[] = [
  {
    id: 'test-set',
    displayName: 'Test Set',
    completionMessage: 'All found!',
    itemIds: ['a', 'b'],
    completionItemId: 'prize-hat',
  },
];

const table: RewardTable = [
  {
    id: 'rule-a',
    trigger: { type: 'ADVENTURE_COMPLETED', templateSlug: 'bridge' },
    itemIds: ['a'],
    message: 'You got A!',
  },
  {
    id: 'rule-b',
    trigger: { type: 'ADVENTURE_COMPLETED', templateSlug: 'forest' },
    itemIds: ['b'],
    message: 'You got B!',
  },
];

const bridge: RewardTrigger = { type: 'ADVENTURE_COMPLETED', templateSlug: 'bridge' };
const forest: RewardTrigger = { type: 'ADVENTURE_COMPLETED', templateSlug: 'forest' };

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'row-1',
    childProfileId: 'child-1',
    ownedItemIds: [],
    grantedRuleIds: [],
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  list.mockResolvedValue({ data: [] });
  create.mockResolvedValue({ data: row() });
  update.mockResolvedValue({ data: row() });
  remove.mockResolvedValue({ data: row() });
});

describe('getInventory', () => {
  it('returns an empty backpack for a child with no row', async () => {
    expect(await getInventory('child-1')).toEqual({ ownedItemIds: [], grantedRuleIds: [] });
  });

  it('validates stored item IDs on read', async () => {
    list.mockResolvedValue({
      data: [row({ ownedItemIds: ['a', 7, null, 'a'], grantedRuleIds: ['rule-a'] })],
    });
    const state = await getInventory('child-1');
    expect(state.ownedItemIds).toEqual(['a']);
    expect(state.grantedRuleIds).toEqual(['rule-a']);
  });

  it('does not read another child’s backpack', async () => {
    list.mockResolvedValue({ data: [row({ childProfileId: 'child-2', ownedItemIds: ['a'] })] });
    expect((await getInventory('child-1')).ownedItemIds).toEqual([]);
  });
});

describe('grantRewards', () => {
  it('creates a row and grants the item on a first completion', async () => {
    const result = await grantRewards('child-1', bridge, table, sets, items);

    expect(create).toHaveBeenCalledTimes(1);
    const written = create.mock.calls[0][0];
    expect(written.childProfileId).toBe('child-1');
    expect(written.ownedItemIds).toEqual(['a']);
    expect(written.grantedRuleIds).toEqual(['rule-a']);

    expect(result.newItemIds).toEqual(['a']);
    expect(result.messages).toEqual(['You got A!']);
  });

  it('grants nothing the second time the same trigger fires', async () => {
    list.mockResolvedValue({ data: [row({ ownedItemIds: ['a'], grantedRuleIds: ['rule-a'] })] });
    const result = await grantRewards('child-1', bridge, table, sets, items);

    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(result.newItemIds).toEqual([]);
    expect(result.messages).toEqual([]);
  });

  it('writes nothing at all for a trigger no rule matches', async () => {
    await grantRewards(
      'child-1',
      { type: 'ADVENTURE_COMPLETED', templateSlug: 'nothing' },
      table,
      sets,
      items,
    );
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('updates an existing row rather than creating a second one', async () => {
    list.mockResolvedValue({ data: [row({ ownedItemIds: ['a'], grantedRuleIds: ['rule-a'] })] });
    await grantRewards('child-1', forest, table, sets, items);

    expect(create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].id).toBe('row-1');
  });

  it('grants the set completion cosmetic in the same write', async () => {
    list.mockResolvedValue({ data: [row({ ownedItemIds: ['a'], grantedRuleIds: ['rule-a'] })] });
    const result = await grantRewards('child-1', forest, table, sets, items);

    expect(update.mock.calls[0][0].ownedItemIds).toEqual(['a', 'b', 'prize-hat']);
    expect(result.newItemIds).toEqual(['b', 'prize-hat']);
  });

  it('does not re-grant a completion cosmetic already owned', async () => {
    list.mockResolvedValue({
      data: [row({ ownedItemIds: ['a', 'prize-hat'], grantedRuleIds: ['rule-a'] })],
    });
    const result = await grantRewards('child-1', forest, table, sets, items);
    expect(result.newItemIds).toEqual(['b']);
    expect(update.mock.calls[0][0].ownedItemIds).toEqual(['a', 'prize-hat', 'b']);
  });

  it('never removes an item a child already owns', async () => {
    list.mockResolvedValue({
      data: [row({ ownedItemIds: ['a', 'unrelated-treasure'], grantedRuleIds: ['rule-a'] })],
    });
    await grantRewards('child-1', forest, table, sets, items);
    expect(update.mock.calls[0][0].ownedItemIds).toContain('unrelated-treasure');
  });

  it('is deterministic: repeating the same first grant always writes the same items', async () => {
    const writes: unknown[] = [];
    for (let attempt = 0; attempt < 20; attempt += 1) {
      vi.clearAllMocks();
      list.mockResolvedValue({ data: [] });
      await grantRewards('child-1', bridge, table, sets, items);
      writes.push(create.mock.calls[0][0].ownedItemIds);
    }
    expect(new Set(writes.map((write) => JSON.stringify(write))).size).toBe(1);
  });
});

describe('clearInventory', () => {
  it('deletes only this child’s row', async () => {
    list.mockResolvedValue({
      data: [row(), row({ id: 'row-2', childProfileId: 'child-2' })],
    });
    await clearInventory('child-1');
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove.mock.calls[0][0].id).toBe('row-1');
  });
});
