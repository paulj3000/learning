import { describe, expect, it } from 'vitest';
import { PAINTED_WORD_BANK } from '../../../../adventures/content/paintedWordsBank';
import { STORYBOOK_PAGES } from '../../../../great-storybook/pages';
import { pageLineId, pageNarration, wordLineId } from './castleSpeechLines';

/**
 * SC-R11 section 4, the audio-independent path: every line the castle narrates by itself has
 * its text on screen. A spoken line is only ever a reading of text the game already holds (the
 * fallback caption), so these hold that the text is real for every page and word.
 */
describe('every narrated castle line has visible text', () => {
  it('gives every Great Storybook page a non-empty title and restored text, read as one caption', () => {
    expect(STORYBOOK_PAGES.length).toBeGreaterThan(0);
    for (const page of STORYBOOK_PAGES) {
      expect(page.title.trim(), page.id).not.toBe('');
      expect(page.restoredText.trim(), page.id).not.toBe('');
      const caption = pageNarration(page);
      expect(caption).toContain(page.title);
      expect(caption).toContain(page.restoredText);
      expect(pageLineId(page.id)).toBe(`castle-page-${page.id}`);
    }
  });

  it('gives every Painted Words bank word a visible, non-empty caption', () => {
    const words = Object.values(PAINTED_WORD_BANK);
    expect(words.length).toBeGreaterThan(0);
    for (const entry of words) {
      expect(entry.word.trim(), entry.word).not.toBe('');
      expect(wordLineId(entry.word)).toBe(`castle-word-${entry.word}`);
    }
  });
});
