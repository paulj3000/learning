import { describe, expect, it } from 'vitest';
import { ADVENTURE_TEMPLATES } from '../adventures/content';
import { bandsWithoutProducer, producersOf, reachableWithoutAnswering } from './adventureMapping';
import { STORYBOOK_PAGES, isPageRestored, storybookProgress, type StorybookPage } from './pages';

const EXPECTED: Record<string, { kind: string; id: string; stepId?: string }[]> = {
  'page-first-story': [
    { kind: 'ADVENTURE', id: 'the-storykeepers-tale', stepId: 'story-written' },
    { kind: 'ADVENTURE', id: 'quills-picture-story', stepId: 'picture-story-made' },
  ],
  'page-three-clues': [
    { kind: 'ADVENTURE', id: 'secret-door-chapter-1-three-clues', stepId: 'clues-collected' },
  ],
  'page-pattern-lock': [
    { kind: 'ADVENTURE', id: 'secret-door-chapter-2-pattern-lock', stepId: 'door-opened' },
  ],
  'page-what-was-waiting': [{ kind: 'STORY', id: 'the-castles-secret-door' }],
  'page-tapestry': [{ kind: 'DISCOVERY', id: 'castle-tapestry-stair' }],
};

describe('adventure to page mapping', () => {
  it('is exactly the documented one, derived from the authored content', () => {
    for (const page of STORYBOOK_PAGES) {
      expect(producersOf(page), page.id).toEqual(EXPECTED[page.id]);
    }
    expect(Object.keys(EXPECTED).sort()).toEqual(STORYBOOK_PAGES.map((p) => p.id).sort());
  });

  it('gives every band of every page a real producer', () => {
    for (const page of STORYBOOK_PAGES) expect(bandsWithoutProducer(page), page.id).toEqual([]);
  });

  it('is deterministic', () => {
    expect(STORYBOOK_PAGES.map((p) => producersOf(p))).toEqual(
      STORYBOOK_PAGES.map((p) => producersOf(p)),
    );
  });

  it('flags an incorrect or missing reference', () => {
    const wrongKey: StorybookPage = {
      ...STORYBOOK_PAGES[0],
      source: {
        kind: 'WORLD_CHANGE',
        changeKey: 'NO_SUCH_KEY',
        locationSlug: 'storykeeper-castle',
      },
    };
    const wrongPlace: StorybookPage = {
      ...STORYBOOK_PAGES[0],
      source: { kind: 'WORLD_CHANGE', changeKey: 'FIRST_STORY_TOLD', locationSlug: 'elsewhere' },
    };
    expect(producersOf(wrongKey)).toEqual([]);
    expect(producersOf(wrongPlace)).toEqual([]);
    expect(bandsWithoutProducer(wrongKey)).toEqual(['SPROUT', 'PATHFINDER']);
  });

  it('does not count content for a band the page is not for', () => {
    // The Explorer-only secret-door chapter does not produce the Sprout/Pathfinder first-story page.
    const onlyDoor = ADVENTURE_TEMPLATES.filter((a) => a.slug.startsWith('secret-door-chapter'));
    expect(producersOf(STORYBOOK_PAGES[0], onlyDoor)).toEqual([]);
    const sproutOnlyTale = { ...STORYBOOK_PAGES[0], bands: ['EXPLORER'] as StorybookPage['bands'] };
    expect(producersOf(sproutOnlyTale)).toEqual([]);
  });

  it('is not satisfied by an unrelated adventure completing', () => {
    const state = { worldChangeKeys: ['REPAIR_BRIDGE', 'SOMETHING_ELSE'], discoveryIds: [] };
    for (const page of STORYBOOK_PAGES) expect(isPageRestored(page, state), page.id).toBe(false);
  });
});

describe('a page is never awarded for merely opening an adventure', () => {
  it('writes each page record only after a step the child must answer', () => {
    for (const page of STORYBOOK_PAGES) {
      for (const producer of producersOf(page)) {
        if (producer.kind !== 'ADVENTURE' || !producer.stepId) continue;
        const adventure = ADVENTURE_TEMPLATES.find((a) => a.slug === producer.id)!;
        expect(reachableWithoutAnswering(adventure, producer.stepId), `${producer.id}`).toBe(false);
      }
    }
  });

  it('detects a record that would be reachable by passive steps alone', () => {
    const tale = ADVENTURE_TEMPLATES.find((a) => a.slug === 'the-storykeepers-tale')!;
    const passive = {
      ...tale,
      steps: tale.steps.map((s) => ({ ...s, type: 'NARRATIVE' as const })),
    };
    expect(reachableWithoutAnswering(passive, 'story-written')).toBe(true);
  });
});

describe('historical and partial progress', () => {
  it('counts a finished chapter from before the Storybook existed, with no replay', () => {
    const old = { worldChangeKeys: ['SECRET_DOOR_CLUES_COLLECTED'], discoveryIds: [] };
    const progress = storybookProgress(old, 'EXPLORER');
    expect(progress.restoredRequired).toBe(1);
    expect(progress.complete).toBe(false);
  });

  it('handles partial history: the second chapter alone restores only its own page', () => {
    const progress = storybookProgress(
      { worldChangeKeys: ['CASTLE_SECRET_DOOR_OPENED'], discoveryIds: [] },
      'EXPLORER',
    );
    expect(progress.entries.filter((e) => e.restored).map((e) => e.page.id)).toEqual([
      'page-pattern-lock',
    ]);
  });

  it('is unchanged by repeated or duplicated records, and ignores obsolete keys', () => {
    const once = {
      worldChangeKeys: ['FIRST_STORY_TOLD', 'OBSOLETE_KEY_FROM_V0'],
      discoveryIds: [],
    };
    const many = {
      worldChangeKeys: [...once.worldChangeKeys, ...once.worldChangeKeys],
      discoveryIds: ['gone-id'],
    };
    expect(storybookProgress(many, 'PATHFINDER')).toEqual(storybookProgress(once, 'PATHFINDER'));
    expect(storybookProgress(once, 'PATHFINDER').complete).toBe(true);
  });

  it('gives a Sprout and a Pathfinder the same page from either authored adventure', () => {
    const state = { worldChangeKeys: ['FIRST_STORY_TOLD'], discoveryIds: [] };
    expect(storybookProgress(state, 'SPROUT').complete).toBe(true);
    expect(storybookProgress(state, 'PATHFINDER').complete).toBe(true);
    expect(storybookProgress(state, 'EXPLORER').complete).toBe(false);
  });
});
