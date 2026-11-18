import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PAINTED_WORD_BANK } from '../../../../adventures/content/paintedWordsBank';
import { STORYBOOK_PAGES } from '../../../../great-storybook/pages';
import { CASTLE_ROOM_IDS } from '../../castleLayout';
import {
  CASTLE_CUE_SOUNDS,
  CASTLE_MUSIC,
  CASTLE_OWNED_CUES,
  CASTLE_SOUND,
  CUE_FALLBACK,
  POSITIONAL_CUES,
  ROOM_AMBIENCE,
  ROOM_PRIORITY,
  SPROUT_SILENT_MOMENTS,
  ambienceForRoom,
} from './castleSounds';
import { pageLineId, pageNarration, wordLineId } from './castleSpeechLines';

const readJson = (path: string): unknown =>
  JSON.parse(readFileSync(resolve(process.cwd(), '..', path), 'utf8'));

const SHARED = new Set([
  'sfx.learning.correct',
  'sfx.learning.retry',
  'sfx.quest.complete',
  'sfx.treasure.reveal',
  'sfx.reward.collect',
]);

describe('castle sound table (SC-R06-01)', () => {
  it('gives every castle room a bed and a priority', () => {
    for (const room of CASTLE_ROOM_IDS) {
      expect(ROOM_AMBIENCE[room]).toMatch(/^ambient\.castle\./);
      expect(ROOM_PRIORITY[room]).toBeGreaterThan(0);
      expect(ambienceForRoom(room)).toBe(ROOM_AMBIENCE[room]);
    }
    expect(Object.keys(ROOM_AMBIENCE).sort()).toEqual([...CASTLE_ROOM_IDS].sort());
    expect(ambienceForRoom('not-a-room')).toBeNull();
  });

  it('only plays cues that the castle owns or that are shared, never a castle copy of a shared one', () => {
    const owned = new Set(CASTLE_OWNED_CUES);
    const played = [
      ...Object.values(ROOM_AMBIENCE),
      ...Object.values(CASTLE_MUSIC),
      ...Object.values(CASTLE_CUE_SOUNDS).flat(),
      ...Object.values(CUE_FALLBACK),
    ];
    for (const cue of played) expect(owned.has(cue) || SHARED.has(cue)).toBe(true);
    for (const cue of CASTLE_OWNED_CUES) expect(cue).toMatch(/^(ambient|music|sfx|ui)\.castle\./);
    expect(new Set(CASTLE_OWNED_CUES).size).toBe(CASTLE_OWNED_CUES.length);
  });

  it('places only the NPC greeting and the artifact; feedback stays flat', () => {
    expect([...POSITIONAL_CUES].sort()).toEqual(
      [CASTLE_SOUND.npcGreet, CASTLE_SOUND.artifactFound].sort(),
    );
  });

  it('silences only the try-again sound for Sprouts', () => {
    expect([...SPROUT_SILENT_MOMENTS]).toEqual(['answerRetry']);
  });
});

describe('castle narration lines (SC-R06-03)', () => {
  it('the server word list is exactly the Painted Words bank', () => {
    const { words } = readJson('lai/apps/speech/castle_speech_words.json') as { words: string[] };
    expect(words).toEqual(Object.keys(PAINTED_WORD_BANK));
  });

  it('a word line says the word and nothing else', () => {
    for (const word of Object.keys(PAINTED_WORD_BANK)) {
      expect(wordLineId(word)).toBe(`castle-word-${word}`);
      expect(wordLineId(word)).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it('a page line reads the same text the server seeds, from the same pages', () => {
    const { pages } = readJson('lai/apps/regions/great_storybook_pages.json') as {
      pages: { id: string; title: string; restoredText: string }[];
    };
    expect(pages.map((page) => page.id)).toEqual(STORYBOOK_PAGES.map((page) => page.id));
    for (const page of STORYBOOK_PAGES) {
      const server = pages.find((candidate) => candidate.id === page.id)!;
      expect(pageNarration(page)).toBe(`${server.title}. ${server.restoredText}`);
      expect(pageLineId(page.id)).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(pageLineId(page.id).length).toBeLessThanOrEqual(80);
      expect(pageNarration(page)).not.toContain('—');
    }
  });
});
