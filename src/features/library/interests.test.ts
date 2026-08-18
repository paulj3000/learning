import { describe, expect, it } from 'vitest';
import {
  ADVENTURE_INTERESTS,
  PROFILE_INTEREST_TO_ADVENTURE_INTERESTS,
  toAdventureInterests,
} from './interests';
import { INTEREST_OPTIONS } from '../child-profile/constants';

describe('adventure interests', () => {
  it('matches the roadmap section 4 vocabulary exactly', () => {
    expect([...ADVENTURE_INTERESTS]).toEqual([
      'DRAGONS',
      'DINOSAURS',
      'PIRATES',
      'SPACE',
      'ROBOTS',
      'MAGIC',
      'ANIMALS',
      'FAIRIES',
      'MERMAIDS',
      'CASTLES',
      'BUILDING',
      'MYSTERIES',
      'SCIENCE',
      'ART',
      'MUSIC',
    ]);
  });

  it('maps every parent-facing profile interest, so none is silently unhandled', () => {
    for (const option of INTEREST_OPTIONS) {
      expect(PROFILE_INTEREST_TO_ADVENTURE_INTERESTS[option]).toBeDefined();
    }
  });

  it('only ever maps onto known library tags', () => {
    for (const tags of Object.values(PROFILE_INTEREST_TO_ADVENTURE_INTERESTS)) {
      for (const tag of tags) {
        expect(ADVENTURE_INTERESTS).toContain(tag);
      }
    }
  });

  it('widens one profile interest into several library tags', () => {
    expect(toAdventureInterests(['Fantasy'])).toEqual(['DRAGONS', 'MAGIC', 'FAIRIES', 'CASTLES']);
  });

  it('de-duplicates tags shared by two profile interests', () => {
    expect(toAdventureInterests(['Space', 'Dinosaurs'])).toEqual(['DINOSAURS', 'SPACE', 'SCIENCE']);
  });

  it('returns tags in the canonical order regardless of the profile order', () => {
    expect(toAdventureInterests(['Robots', 'Animals'])).toEqual(['ROBOTS', 'ANIMALS', 'BUILDING']);
  });

  it('ignores unknown, null, and missing interests rather than throwing', () => {
    expect(toAdventureInterests(['Quidditch'])).toEqual([]);
    expect(toAdventureInterests([null, 'Art'])).toEqual(['ART']);
    expect(toAdventureInterests(null)).toEqual([]);
    expect(toAdventureInterests(undefined)).toEqual([]);
  });

  it('gives no tags for an interest with no authored arc yet', () => {
    expect(toAdventureInterests(['Cooking', 'Sports'])).toEqual([]);
  });
});
