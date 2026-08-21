import { describe, expect, it } from 'vitest';
import {
  EMPTY_INVENTORY,
  addItems,
  findUnknownItemIds,
  hasItem,
  itemsInCategory,
  newItemsAmong,
  parseInventory,
  resolveInventory,
} from './inventory';
import * as inventoryModule from './inventory';
import type { ItemDefinition } from './types';

const items: ItemDefinition[] = [
  {
    id: 'shell',
    displayName: 'Shell',
    description: 'A shell.',
    category: 'COLLECTIBLE',
    rarity: 'COMMON',
  },
  {
    id: 'hat',
    displayName: 'Hat',
    description: 'A hat.',
    category: 'COSMETIC',
    rarity: 'UNCOMMON',
    cosmeticSlot: 'HAT',
  },
];

describe('addItems', () => {
  it('adds new items', () => {
    expect(addItems([], ['shell', 'hat'])).toEqual(['shell', 'hat']);
  });

  it('never creates a duplicate, so re-granting cannot stack', () => {
    expect(addItems(['shell'], ['shell'])).toEqual(['shell']);
    expect(addItems(['shell'], ['shell', 'hat'])).toEqual(['shell', 'hat']);
  });

  it('returns the same reference when nothing is new', () => {
    const before = ['shell'];
    expect(addItems(before, ['shell'])).toBe(before);
    expect(addItems(before, [])).toBe(before);
  });

  it('does not mutate the input', () => {
    const before = ['shell'];
    addItems(before, ['hat']);
    expect(before).toEqual(['shell']);
  });
});

describe('newItemsAmong', () => {
  it('reports only the unowned IDs', () => {
    expect(newItemsAmong(['shell'], ['shell', 'hat'])).toEqual(['hat']);
    expect(newItemsAmong(['shell', 'hat'], ['shell'])).toEqual([]);
  });
});

describe('hasItem', () => {
  it('reads ownership', () => {
    expect(hasItem(['shell'], 'shell')).toBe(true);
    expect(hasItem(['shell'], 'hat')).toBe(false);
    expect(hasItem(EMPTY_INVENTORY, 'shell')).toBe(false);
  });
});

describe('resolveInventory', () => {
  it('resolves owned IDs to definitions', () => {
    expect(resolveInventory(['hat'], items).map((item) => item.displayName)).toEqual(['Hat']);
  });

  it('drops an ID whose item no longer exists rather than crashing a backpack', () => {
    expect(resolveInventory(['shell', 'removed-item'], items).map((item) => item.id)).toEqual([
      'shell',
    ]);
  });
});

describe('findUnknownItemIds', () => {
  it('surfaces owned IDs with no definition', () => {
    expect(findUnknownItemIds(['shell', 'removed-item'], items)).toEqual(['removed-item']);
    expect(findUnknownItemIds(['shell'], items)).toEqual([]);
  });
});

describe('itemsInCategory', () => {
  it('groups by category', () => {
    expect(itemsInCategory(items, 'COSMETIC').map((item) => item.id)).toEqual(['hat']);
    expect(itemsInCategory(items, 'QUEST_ITEM')).toEqual([]);
  });
});

describe('parseInventory', () => {
  it('accepts a string array', () => {
    expect(parseInventory(['shell', 'hat'])).toEqual(['shell', 'hat']);
  });

  it('drops non-string entries and de-duplicates', () => {
    expect(parseInventory(['shell', 3, null, 'shell'])).toEqual(['shell']);
  });

  it('degrades a malformed column to an empty backpack', () => {
    expect(parseInventory(null)).toEqual(EMPTY_INVENTORY);
    expect(parseInventory(undefined)).toEqual(EMPTY_INVENTORY);
    expect(parseInventory('shell')).toEqual(EMPTY_INVENTORY);
    expect(parseInventory({ shell: true })).toEqual(EMPTY_INVENTORY);
  });
});

describe('the module surface', () => {
  it('offers no way for gameplay to take an item away', () => {
    // Property 3 in types.ts: nothing is consumed, spent, or lost. Inspects
    // the real module exports, so adding a remove/spend helper here fails
    // this test and forces the change to be justified against the
    // calm-engagement pillar rather than slipping in unnoticed.
    const exportNames = Object.keys(inventoryModule);
    expect(exportNames.length).toBeGreaterThan(0);
    expect(exportNames.filter((name) => /remove|spend|consume|delete|take/i.test(name))).toEqual(
      [],
    );
  });
});
