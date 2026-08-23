import { describe, expect, it } from 'vitest';
import { describeTravelPack, summarizeTravelPack } from './travelPack';
import type { ItemDefinition } from '../rewards/types';
import type { WorldContentPack, WorldDefinition } from './types';

const items: ItemDefinition[] = [
  {
    id: 'home-a',
    displayName: 'Home A',
    description: 'x',
    category: 'COLLECTIBLE',
    rarity: 'COMMON',
  },
  { id: 'home-b', displayName: 'Home B', description: 'x', category: 'KEEPSAKE', rarity: 'COMMON' },
  {
    id: 'cove-a',
    displayName: 'Cove A',
    description: 'x',
    category: 'COLLECTIBLE',
    rarity: 'COMMON',
  },
  { id: 'orphan', displayName: 'Orphan', description: 'x', category: 'KEEPSAKE', rarity: 'COMMON' },
];

const emptyPack = {
  version: 1,
  locationSlugs: [],
  adventureSlugs: [],
  questIds: [],
  collectibleSetIds: [],
  npcIds: [],
  discoveryIds: [],
  storySlugs: [],
};

const packs: WorldContentPack[] = [
  { ...emptyPack, worldSlug: 'home', itemIds: ['home-a', 'home-b'] },
  { ...emptyPack, worldSlug: 'cove', itemIds: ['cove-a'] },
];

const worlds = [
  { slug: 'home', title: 'Home Island' },
  { slug: 'cove', title: 'The Cove' },
] as WorldDefinition[];

describe('summarizeTravelPack', () => {
  /**
   * The Phase 29 deliverable in one assertion: one child, one backpack,
   * whatever island each thing came from. There is no per-world inventory to
   * merge, because there is no per-world inventory.
   */
  it('keeps treasure from every world in one pack, grouped by where it came from', () => {
    const summary = summarizeTravelPack(['home-a', 'cove-a'], items, packs, worlds);

    expect(summary.totalItems).toBe(2);
    expect(summary.worldsRepresented).toBe(2);
    expect(summary.groups.map((group) => group.worldSlug)).toEqual(['home', 'cove']);
    expect(summary.groups[1]?.worldTitle).toBe('The Cove');
    expect(summary.groups[1]?.items.map((item) => item.id)).toEqual(['cove-a']);
  });

  it('leaves out a world the child owns nothing from, rather than showing an empty shelf', () => {
    const summary = summarizeTravelPack(['home-a'], items, packs, worlds);

    expect(summary.groups.map((group) => group.worldSlug)).toEqual(['home']);
    expect(summary.worldsRepresented).toBe(1);
  });

  /**
   * Hiding a child's own treasure to keep a grouping tidy is the wrong
   * trade, so an unclaimed item surfaces instead of vanishing.
   */
  it('surfaces an owned item no pack claims instead of dropping it', () => {
    const summary = summarizeTravelPack(['orphan'], items, packs, worlds);

    expect(summary.unclaimed.map((item) => item.id)).toEqual(['orphan']);
    expect(summary.totalItems).toBe(1);
  });

  it('ignores an owned id with no authored item behind it', () => {
    const summary = summarizeTravelPack(['ghost'], items, packs, worlds);

    expect(summary.totalItems).toBe(0);
    expect(summary.groups).toEqual([]);
  });
});

describe('describeTravelPack', () => {
  it('says something calm for an empty backpack, with no count and no target', () => {
    const line = describeTravelPack(summarizeTravelPack([], items, packs, worlds));

    expect(line).toBe('Your backpack comes with you wherever you sail.');
    expect(line).not.toMatch(/\d/);
  });

  it('names more than one island only once the child has been to more than one', () => {
    expect(describeTravelPack(summarizeTravelPack(['home-a'], items, packs, worlds))).toContain(
      'came with you on the boat',
    );
    expect(
      describeTravelPack(summarizeTravelPack(['home-a', 'cove-a'], items, packs, worlds)),
    ).toContain('every island');
  });
});
