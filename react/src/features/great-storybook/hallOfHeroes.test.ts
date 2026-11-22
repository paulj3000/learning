import { describe, expect, it } from 'vitest';
import { CASTLE_KEEPSAKE_IDS } from '../rewards/content/islandItems';
import { STORY_DEFINITIONS } from '../story/content';
import { CASTLE_RANKS } from './castleRanks';
import { CASTLE_STORY_RECORDS, hallOfHeroes } from './hallOfHeroes';
import { storybookProgress } from './pages';
import source from './hallOfHeroes.ts?raw';

const EXPLORER_KEYS = [
  'SECRET_DOOR_CLUES_COLLECTED',
  'CASTLE_SECRET_DOOR_OPENED',
  'THE_CASTLES_SECRET_DOOR_COMPLETE',
];

describe('hallOfHeroes (SC-R07-03)', () => {
  it('is ready and empty for a child with no records, with no rank while ranks are off', () => {
    const hall = hallOfHeroes({
      progress: storybookProgress({ worldChangeKeys: [], discoveryIds: [] }, 'SPROUT'),
      ownedItemIds: [],
      worldChangeKeys: [],
    });
    expect(hall).toEqual({ stories: [], pages: [], artifacts: [], rank: null, isEmpty: true });
  });

  it('copes with nothing loaded yet: no progress, an empty inventory', () => {
    const hall = hallOfHeroes({ ownedItemIds: [], worldChangeKeys: [] });
    expect(hall.isEmpty).toBe(true);
    expect(hall.rank).toBeNull();
  });

  it("lists an Explorer's finished story, restored pages and owned keepsakes, in authored order", () => {
    const worldChangeKeys = EXPLORER_KEYS;
    const hall = hallOfHeroes({
      progress: storybookProgress({ worldChangeKeys, discoveryIds: [] }, 'EXPLORER'),
      ownedItemIds: ['secret-door-key', 'three-clues-lens', 'ember-scale'],
      worldChangeKeys,
    });
    expect(hall.stories.map((story) => story.id)).toEqual(['the-castles-secret-door']);
    expect(hall.pages.map((page) => page.id)).toEqual([
      'page-three-clues',
      'page-pattern-lock',
      'page-what-was-waiting',
    ]);
    // Keepsakes only (not the Ember scale), in Trophy Room order.
    expect(hall.artifacts.map((item) => item.itemId)).toEqual([
      'three-clues-lens',
      'secret-door-key',
    ]);
    expect(hall.isEmpty).toBe(false);
  });

  it('shows the bonus page once found and counts only what the records say', () => {
    const hall = hallOfHeroes({
      progress: storybookProgress(
        { worldChangeKeys: [], discoveryIds: ['castle-tapestry-stair'] },
        'PATHFINDER',
      ),
      ownedItemIds: ['blank-page-storybook'],
      worldChangeKeys: [],
    });
    expect(hall.pages.map((page) => page.id)).toEqual(['page-tapestry']);
    expect(hall.stories).toEqual([]);
  });

  it('shows the derived rank only when ranks are switched on', () => {
    const progress = storybookProgress(
      { worldChangeKeys: ['FIRST_STORY_TOLD'], discoveryIds: [] },
      'PATHFINDER',
    );
    const inputs = { progress, ownedItemIds: [], worldChangeKeys: ['FIRST_STORY_TOLD'] };
    expect(hallOfHeroes(inputs).rank).toBeNull();
    expect(hallOfHeroes({ ...inputs, ranks: { ...CASTLE_RANKS, enabled: true } }).rank?.id).toBe(
      'page-keeper',
    );
  });

  it('names stories by keys their own endings write, with readable titles', () => {
    const secretDoor = STORY_DEFINITIONS.find((story) => story.slug === 'the-castles-secret-door')!;
    expect(CASTLE_STORY_RECORDS.map((story) => story.changeKey)).toContain(
      secretDoor.completionWorldChange.changeKey,
    );
    for (const story of CASTLE_STORY_RECORDS) expect(story.title).not.toMatch(/—|–/);
    expect(CASTLE_KEEPSAKE_IDS).toHaveLength(6);
  });

  it('is read-only: no request, no write, no time, no chat text', () => {
    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(code).not.toMatch(/fetch\(|Api\b|apiClient|Date|now\(|localStorage|message|transcript/);
  });
});
