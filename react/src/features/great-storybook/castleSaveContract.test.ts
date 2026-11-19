import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { STORYKEEPER_CASTLE_CHECKPOINTS } from '../discovery/checkpoints';
import { CASTLE_ROOM_IDS, SECRET_PASSAGE_DISCOVERY_ID } from '../island-map/three/castleLayout';
import { CASTLE_KEEPSAKE_IDS } from '../rewards/content/islandItems';
import {
  CASTLE_FRAGMENT_IDS,
  CASTLE_HIDDEN_FIND_IDS,
  castleCompletionSources,
  castleRoomChangeKey,
} from './castleRecords';
import {
  GREAT_STORYBOOK_RESTORED_KEY,
  GREAT_STORYBOOK_RESTORED_V2_KEY,
  STORYBOOK_PAGES,
} from './pages';

/**
 * Storykeeper Castle save compatibility (SC-JMP-20; migration to the Game Engine Core).
 *
 * Every identifier below is **persisted** for real children: in `WorldState` (checkpoint,
 * discoveries), in `WorldChange` keys, in inventory, or in Django content. Moving the castle onto
 * the shared engine, a Realm SDK or a new scoring ledger must keep each one exactly, or a child
 * loses a page, a room, a keepsake or their place. The lists are written out literally on purpose:
 * a rename, removal or reorder anywhere fails here first. Ids may only ever be appended, with a
 * decision recorded in `docs/regions/storykeeper_castle_engine_integration.md` section 6.
 */

const DJANGO_CASTLE_ROOMS = resolve(process.cwd(), '../lai/apps/regions/castle_rooms.json');

describe('castle save contract: persisted ids a migration must keep', () => {
  it('checkpoint ids (WorldState.last_checkpoint_id)', () => {
    expect(STORYKEEPER_CASTLE_CHECKPOINTS.map((checkpoint) => checkpoint.id)).toEqual([
      'storykeeper-castle:entrance',
      'storykeeper-castle:story-hall',
      'storykeeper-castle:gallery',
      'storykeeper-castle:tower',
      'storykeeper-castle:library',
    ]);
  });

  it('room discovery keys (WorldChange ROOM_DISCOVERED), in step with Django', () => {
    expect(CASTLE_ROOM_IDS).toEqual([
      'entry-hall',
      'story-hall',
      'character-gallery',
      'costume-room',
      'east-corridor',
      'setting-tower',
      'illustration-studio',
      'great-library',
      'trophy-room',
      'secret-chamber',
    ]);
    expect(castleRoomChangeKey('great-library')).toBe('castle-room:great-library');
    const django = JSON.parse(readFileSync(DJANGO_CASTLE_ROOMS, 'utf8')) as { rooms: string[] };
    expect(django.rooms).toEqual([...CASTLE_ROOM_IDS]);
  });

  it('Storybook page ids and the records that restore them', () => {
    expect(CASTLE_FRAGMENT_IDS).toEqual([
      'page-first-story',
      'page-painted-words',
      'page-three-clues',
      'page-pattern-lock',
      'page-what-was-waiting',
      'page-tapestry',
    ]);
    expect(
      STORYBOOK_PAGES.map((page) =>
        page.source.kind === 'WORLD_CHANGE'
          ? `${page.source.locationSlug}/${page.source.changeKey}`
          : `discovery/${page.source.discoveryId}`,
      ),
    ).toEqual([
      'storykeeper-castle/FIRST_STORY_TOLD',
      'storykeeper-castle/STUDIO_PAGE_MENDED',
      'castle-secret-passage/SECRET_DOOR_CLUES_COLLECTED',
      'castle-secret-passage/CASTLE_SECRET_DOOR_OPENED',
      'castle-secret-passage/THE_CASTLES_SECRET_DOOR_COMPLETE',
      'discovery/castle-tapestry-stair',
    ]);
  });

  it('Storybook completion keys for both editions', () => {
    expect([GREAT_STORYBOOK_RESTORED_KEY, GREAT_STORYBOOK_RESTORED_V2_KEY]).toEqual([
      'GREAT_STORYBOOK_RESTORED',
      'GREAT_STORYBOOK_RESTORED_V2',
    ]);
  });

  it('adventure and story completion records', () => {
    expect(castleCompletionSources().map((source) => `${source.id}:${source.changeKey}`)).toEqual([
      'the-storykeepers-tale:FIRST_STORY_TOLD',
      'quills-picture-story:FIRST_STORY_TOLD',
      'the-painted-words:STUDIO_PAGE_MENDED',
      'the-painted-words-again:STUDIO_PAGE_MENDED',
      'secret-door-chapter-1-three-clues:SECRET_DOOR_CLUES_COLLECTED',
      'secret-door-chapter-2-pattern-lock:CASTLE_SECRET_DOOR_OPENED',
      'the-castles-secret-door:THE_CASTLES_SECRET_DOOR_COMPLETE',
    ]);
  });

  it('discovery ids (WorldState.discovered_objects)', () => {
    expect(SECRET_PASSAGE_DISCOVERY_ID).toBe('castle-tapestry-stair');
    expect([...CASTLE_HIDDEN_FIND_IDS]).toEqual([
      'castle-tapestry-stair',
      'castle-chamber-star',
      'castle-chamber-mouse-door',
    ]);
  });

  it('keepsake item ids (inventory)', () => {
    expect([...CASTLE_KEEPSAKE_IDS]).toEqual([
      'storykeepers-quill',
      'blank-page-storybook',
      'great-storybook-seal',
      'painted-words-brush',
      'three-clues-lens',
      'secret-door-key',
    ]);
  });
});
