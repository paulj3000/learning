import { describe, expect, it } from 'vitest';
import {
  computeAllSetProgress,
  computeSetProgress,
  findUnknownSetItemIds,
  pendingSetCompletionItems,
} from './sets';
import type { CollectibleSet, ItemDefinition } from './types';

const items: ItemDefinition[] = [
  { id: 'a', displayName: 'A', description: '', category: 'COLLECTIBLE', rarity: 'COMMON' },
  { id: 'b', displayName: 'B', description: '', category: 'COLLECTIBLE', rarity: 'COMMON' },
  {
    id: 'secret',
    displayName: 'Secret',
    description: '',
    category: 'COLLECTIBLE',
    rarity: 'RARE',
    hidden: true,
  },
  {
    id: 'prize-hat',
    displayName: 'Prize Hat',
    description: '',
    category: 'COSMETIC',
    rarity: 'UNCOMMON',
    cosmeticSlot: 'HAT',
  },
];

const set: CollectibleSet = {
  id: 'test-set',
  displayName: 'Test Set',
  completionMessage: 'You found them all!',
  itemIds: ['a', 'b', 'secret'],
  completionItemId: 'prize-hat',
};

describe('computeSetProgress', () => {
  it('counts nothing found for an empty backpack', () => {
    const progress = computeSetProgress(set, [], items);
    expect(progress.found).toBe(0);
    expect(progress.isComplete).toBe(false);
  });

  it('excludes hidden items from the visible target', () => {
    // A child is never shown a slot they cannot know how to fill.
    const progress = computeSetProgress(set, [], items);
    expect(progress.total).toBe(3);
    expect(progress.visibleTotal).toBe(2);
  });

  it('counts a hidden item once it is found', () => {
    expect(computeSetProgress(set, ['secret'], items).found).toBe(1);
  });

  it('is not complete until the hidden item is found too', () => {
    expect(computeSetProgress(set, ['a', 'b'], items).isComplete).toBe(false);
    expect(computeSetProgress(set, ['a', 'b', 'secret'], items).isComplete).toBe(true);
  });

  it('carries the completion message only when complete', () => {
    expect(computeSetProgress(set, ['a'], items).completionMessage).toBeUndefined();
    expect(computeSetProgress(set, ['a', 'b', 'secret'], items).completionMessage).toBe(
      'You found them all!',
    );
  });

  it('ignores owned items that are not in the set', () => {
    expect(computeSetProgress(set, ['a', 'prize-hat'], items).found).toBe(1);
  });

  it('is never complete for an empty set', () => {
    const empty: CollectibleSet = { ...set, itemIds: [], completionItemId: undefined };
    expect(computeSetProgress(empty, [], items).isComplete).toBe(false);
  });
});

describe('computeAllSetProgress', () => {
  it('reports one entry per set', () => {
    expect(computeAllSetProgress([set], ['a'], items).map((p) => p.setId)).toEqual(['test-set']);
  });
});

describe('pendingSetCompletionItems', () => {
  it('is empty while the set is unfinished', () => {
    expect(pendingSetCompletionItems([set], ['a', 'b'], items)).toEqual([]);
  });

  it('reports the cosmetic once the set is complete', () => {
    expect(pendingSetCompletionItems([set], ['a', 'b', 'secret'], items)).toEqual(['prize-hat']);
  });

  it('stops reporting it once it is owned, so it cannot be granted twice', () => {
    expect(pendingSetCompletionItems([set], ['a', 'b', 'secret', 'prize-hat'], items)).toEqual([]);
  });

  it('ignores a completed set that offers no cosmetic', () => {
    const noPrize: CollectibleSet = { ...set, completionItemId: undefined };
    expect(pendingSetCompletionItems([noPrize], ['a', 'b', 'secret'], items)).toEqual([]);
  });
});

describe('findUnknownSetItemIds', () => {
  it('is empty for well-formed content', () => {
    expect(findUnknownSetItemIds([set], items)).toEqual([]);
  });

  it('reports a member or prize with no definition', () => {
    const broken: CollectibleSet = { ...set, itemIds: ['a', 'ghost'] };
    expect(findUnknownSetItemIds([broken], items)).toEqual([
      { setId: 'test-set', itemId: 'ghost' },
    ]);
  });
});
