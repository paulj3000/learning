import { describe, expect, it } from 'vitest';
import type { AgeBandValue } from '../child-profile/constants';
import { PAINTED_WORDS_ADVENTURES, getAdventureTemplate } from '../adventures/content';
import type { AdventureDefinition } from '../adventures/engine/types';
import { findIslandDiscovery } from '../discovery/content';
import { CASTLE_ROOM_IDS } from '../island-map/three/castleLayout';
import {
  isSecretDoorStoryForBand,
  taleAdventureForBand,
} from '../island-map/three/extensions/castleTale/castleTaleClaims';
import { THE_CASTLES_SECRET_DOOR } from '../story/content/theCastlesSecretDoor';
import {
  STORYBOOK_PAGES,
  isPageRestored,
  newlyRestored,
  pagesForBand,
  restoredIds,
  storybookProgress,
  visibleEntries,
  withRestored,
  type StorybookState,
} from './pages';

const BANDS: readonly AgeBandValue[] = ['SPROUT', 'PATHFINDER', 'EXPLORER'];
const NOTHING: StorybookState = { worldChangeKeys: [], discoveryIds: [] };

/** The world changes an adventure's WORLD_CHANGE steps write, as `locationSlug/changeKey`. */
function writtenBy(adventure: AdventureDefinition): string[] {
  return adventure.steps.flatMap((step) => {
    const payload = (
      step.presentation as { payload?: { changeKey?: string; locationSlug?: string } }
    ).payload;
    return step.type === 'WORLD_CHANGE' && payload?.changeKey
      ? [`${payload.locationSlug}/${payload.changeKey}`]
      : [];
  });
}

/** Everything a band's castle content can write, read from the content itself and nothing else. */
function worldChangesForBand(band: AgeBandValue): Set<string> {
  const written = new Set<string>();
  const tale = taleAdventureForBand(band);
  if (tale) writtenBy(tale).forEach((key) => written.add(key));
  if (band === 'PATHFINDER') {
    for (const mission of PAINTED_WORDS_ADVENTURES) writtenBy(mission).forEach((key) => written.add(key));
  }
  if (isSecretDoorStoryForBand(band)) {
    for (const chapter of THE_CASTLES_SECRET_DOOR.chapters) {
      for (const scene of chapter.scenes) {
        if (scene.kind !== 'ADVENTURE') continue;
        const adventure = getAdventureTemplate(scene.templateSlug);
        if (adventure) writtenBy(adventure).forEach((key) => written.add(key));
      }
    }
    const completion = THE_CASTLES_SECRET_DOOR.completionWorldChange;
    if (completion) written.add(`${completion.locationSlug}/${completion.changeKey}`);
  }
  return written;
}

describe('the Great Storybook page registry', () => {
  it('has unique, stable-looking ids and child-facing words on every page', () => {
    const ids = STORYBOOK_PAGES.map((page) => page.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const page of STORYBOOK_PAGES) {
      expect(page.id).toMatch(/^page-[a-z]+(-[a-z]+)*$/);
      for (const line of [page.title, page.hint, page.restoredText]) {
        expect(line.length).toBeGreaterThan(0);
        expect(line, line).not.toMatch(/—|–/);
      }
    }
  });

  it('gives every band at least one required page, and never a page it cannot reach', () => {
    for (const band of BANDS) {
      const pages = pagesForBand(band);
      expect(pages.filter((page) => page.required).length, band).toBeGreaterThan(0);
    }
  });

  it('shows a band only its own pages: a Sprout never sees an Explorer slot', () => {
    const sproutIds = pagesForBand('SPROUT').map((page) => page.id);
    for (const explorerOnly of ['page-three-clues', 'page-pattern-lock', 'page-what-was-waiting']) {
      expect(sproutIds).not.toContain(explorerOnly);
    }
    expect(pagesForBand('EXPLORER').map((page) => page.id)).not.toContain('page-first-story');
  });

  it('makes the hidden nook page a bonus in every band, never required', () => {
    const hidden = STORYBOOK_PAGES.find((page) => page.source.kind === 'DISCOVERY')!;
    expect(hidden.required).toBe(false);
    expect([...hidden.bands].sort()).toEqual([...BANDS].sort());
    // Its words must not give the secret away.
    expect(`${hidden.hint} ${hidden.title}`.toLowerCase()).not.toMatch(
      /tapestry|nook|stair|corner|cushion/,
    );
  });

  it('names a castle room, a discovery and world changes that all really exist', () => {
    for (const page of STORYBOOK_PAGES) {
      expect(CASTLE_ROOM_IDS as readonly string[], page.id).toContain(page.roomId);
      if (page.source.kind === 'DISCOVERY') {
        expect(findIslandDiscovery(page.source.discoveryId), page.id).not.toBeNull();
      }
    }
  });

  it("only names a world change that the band's own castle content writes, so no page is unreachable", () => {
    for (const page of STORYBOOK_PAGES) {
      if (page.source.kind !== 'WORLD_CHANGE') continue;
      for (const band of page.bands) {
        const key = `${page.source.locationSlug}/${page.source.changeKey}`;
        expect(worldChangesForBand(band).has(key), `${page.id} for ${band} needs ${key}`).toBe(
          true,
        );
      }
    }
  });
});

describe('storybookProgress', () => {
  it('is an empty book for a child who has done nothing, and never complete', () => {
    for (const band of BANDS) {
      const progress = storybookProgress(NOTHING, band);
      expect(progress.restoredRequired).toBe(0);
      expect(progress.restoredBonus).toBe(0);
      expect(progress.complete).toBe(false);
      expect(progress.entries.every((entry) => !entry.restored)).toBe(true);
    }
  });

  it('restores a page from exactly the record it names, and no other', () => {
    for (const page of STORYBOOK_PAGES) {
      const only: StorybookState =
        page.source.kind === 'WORLD_CHANGE'
          ? { worldChangeKeys: [page.source.changeKey], discoveryIds: [] }
          : { worldChangeKeys: [], discoveryIds: [page.source.discoveryId] };
      for (const other of STORYBOOK_PAGES) {
        expect(isPageRestored(other, only), `${other.id} from ${page.id}'s record`).toBe(
          other.id === page.id,
        );
      }
    }
  });

  it('counts the required pages and the bonus separately, and is whole on the required ones alone', () => {
    const explorer = storybookProgress(
      {
        worldChangeKeys: [
          'SECRET_DOOR_CLUES_COLLECTED',
          'CASTLE_SECRET_DOOR_OPENED',
          'THE_CASTLES_SECRET_DOOR_COMPLETE',
        ],
        discoveryIds: [],
      },
      'EXPLORER',
    );
    expect(explorer).toMatchObject({
      restoredRequired: 3,
      totalRequired: 3,
      restoredBonus: 0,
      complete: true,
    });
    const withBonus = storybookProgress(
      {
        worldChangeKeys: ['FIRST_STORY_TOLD', 'STUDIO_PAGE_MENDED'],
        discoveryIds: ['castle-tapestry-stair'],
      },
      'PATHFINDER',
    );
    expect(withBonus).toMatchObject({
      restoredRequired: 2,
      totalRequired: 2,
      restoredBonus: 1,
      complete: true,
    });
  });

  it('is not whole on the bonus page alone', () => {
    for (const band of BANDS) {
      const progress = storybookProgress(
        { worldChangeKeys: [], discoveryIds: ['castle-tapestry-stair'] },
        band,
      );
      expect(progress.restoredBonus).toBe(1);
      expect(progress.complete).toBe(false);
    }
  });

  it("ignores records belonging to another band's pages", () => {
    const progress = storybookProgress(
      { worldChangeKeys: ['SECRET_DOOR_CLUES_COLLECTED'], discoveryIds: [] },
      'SPROUT',
    );
    expect(progress.restoredRequired).toBe(0);
    expect(progress.entries.map((entry) => entry.page.id)).not.toContain('page-three-clues');
  });

  it('is pure: the same state gives the same book, and the input is never changed', () => {
    const state = Object.freeze({
      worldChangeKeys: Object.freeze(['FIRST_STORY_TOLD']),
      discoveryIds: Object.freeze([]),
    }) as StorybookState;
    expect(storybookProgress(state, 'PATHFINDER')).toEqual(storybookProgress(state, 'PATHFINDER'));
  });
});

describe('what a child is shown, and merging the server', () => {
  const found = { worldChangeKeys: [], discoveryIds: ['castle-tapestry-stair'] };

  it('shows the required pages always, and the hidden bonus page only once it is found', () => {
    for (const band of BANDS) {
      const before = visibleEntries(storybookProgress(NOTHING, band)).map((e) => e.page.id);
      expect(before).not.toContain('page-tapestry');
      expect(before.length).toBe(pagesForBand(band).filter((p) => p.required).length);
      const after = visibleEntries(storybookProgress(found, band)).map((e) => e.page.id);
      expect(after).toContain('page-tapestry');
    }
  });

  it('counts a page the server holds as back, without losing one only the client holds', () => {
    const local = storybookProgress(
      { worldChangeKeys: ['FIRST_STORY_TOLD'], discoveryIds: [] },
      'PATHFINDER',
    );
    const merged = withRestored(local, new Set(['page-tapestry']));
    expect(merged.entries.map((e) => [e.page.id, e.restored])).toEqual([
      ['page-first-story', true],
      ['page-painted-words', false],
      ['page-tapestry', true],
    ]);
    expect(merged.complete).toBe(false);
    expect(withRestored(merged, new Set(['page-painted-words'])).complete).toBe(true);
    const serverOnly = withRestored(
      storybookProgress(NOTHING, 'PATHFINDER'),
      new Set(['page-first-story', 'page-painted-words']),
    );
    expect(serverOnly.complete).toBe(true);
  });

  it('ignores a server page id it does not know, and never mutates what it was given', () => {
    const local = storybookProgress(NOTHING, 'SPROUT');
    const merged = withRestored(local, new Set(['a-page-from-a-newer-version']));
    expect(merged.restoredRequired).toBe(0);
    expect(local.entries.every((entry) => !entry.restored)).toBe(true);
  });

  it('reports exactly the pages that came back since a moment ago, once', () => {
    const before = restoredIds(storybookProgress(NOTHING, 'PATHFINDER'));
    const after = storybookProgress(
      { worldChangeKeys: ['FIRST_STORY_TOLD'], discoveryIds: [] },
      'PATHFINDER',
    );
    expect(newlyRestored(before, after).map((p) => p.id)).toEqual(['page-first-story']);
    const mended = storybookProgress(
      { worldChangeKeys: ['FIRST_STORY_TOLD', 'STUDIO_PAGE_MENDED'], discoveryIds: [] },
      'PATHFINDER',
    );
    expect(newlyRestored(restoredIds(after), mended).map((p) => p.id)).toEqual([
      'page-painted-words',
    ]);
    expect(newlyRestored(restoredIds(after), after)).toEqual([]);
  });
});

describe('editions and the derived state', () => {
  const state = (keys: string[], discoveries: string[] = []) => ({
    worldChangeKeys: keys,
    discoveryIds: discoveries,
  });
  const standing = (keys: string[], band: AgeBandValue = 'PATHFINDER') =>
    storybookProgress(state(keys), band);

  it('stamps each page with the edition that introduced it: only the Painted Words is edition 2', () => {
    for (const page of STORYBOOK_PAGES) {
      expect(page.since, page.id).toBe(page.id === 'page-painted-words' ? 2 : 1);
    }
    expect(standing([]).edition).toBe(2);
  });

  it.each([
    ['nothing done', [], 'IN_PROGRESS', false],
    ['only the first story', ['FIRST_STORY_TOLD'], 'IN_PROGRESS', false],
    [
      'restored in edition 1, new page not yet found',
      ['FIRST_STORY_TOLD', 'GREAT_STORYBOOK_RESTORED'],
      'RESTORED_MORE_PAGES',
      false,
    ],
    [
      'edition 1 marker alone still counts as restored',
      ['GREAT_STORYBOOK_RESTORED'],
      'RESTORED_MORE_PAGES',
      false,
    ],
    [
      'every required page back',
      ['FIRST_STORY_TOLD', 'STUDIO_PAGE_MENDED'],
      'RESTORED',
      true,
    ],
    [
      'every page back with both markers',
      [
        'FIRST_STORY_TOLD',
        'STUDIO_PAGE_MENDED',
        'GREAT_STORYBOOK_RESTORED',
        'GREAT_STORYBOOK_RESTORED_V2',
      ],
      'RESTORED',
      true,
    ],
  ] as const)('a Pathfinder with %s is %s (complete %s)', (_label, keys, expected, complete) => {
    const book = standing([...keys]);
    expect(book.state).toBe(expected);
    expect(book.complete).toBe(complete);
  });

  it('keeps complete strict: a restored-in-edition-1 Pathfinder is not complete', () => {
    const book = standing(['FIRST_STORY_TOLD', 'GREAT_STORYBOOK_RESTORED']);
    expect(book.complete).toBe(false);
    expect(book.edition1Restored).toBe(true);
  });

  it('leaves Sprouts and Explorers unchanged', () => {
    expect(standing(['FIRST_STORY_TOLD'], 'SPROUT').state).toBe('RESTORED');
    expect(standing([], 'SPROUT').state).toBe('IN_PROGRESS');
    const explorerKeys = [
      'SECRET_DOOR_CLUES_COLLECTED',
      'CASTLE_SECRET_DOOR_OPENED',
      'THE_CASTLES_SECRET_DOOR_COMPLETE',
    ];
    expect(standing(explorerKeys, 'EXPLORER').state).toBe('RESTORED');
    expect(standing(explorerKeys.slice(0, 2), 'EXPLORER').state).toBe('IN_PROGRESS');
  });

  it('counts the server saying edition 1 is restored, and never lowers it', () => {
    const local = standing([]);
    expect(withRestored(local, new Set(), true).state).toBe('RESTORED_MORE_PAGES');
    const kept = withRestored(
      standing(['GREAT_STORYBOOK_RESTORED']),
      new Set(),
      false,
    );
    expect(kept.state).toBe('RESTORED_MORE_PAGES');
  });
});
