import type { StorybookPage } from '../../../../great-storybook/pages';

/**
 * The castle's authored narration (SC-R06-03), as `SpeechLine` ids in Django. Staff-written lines
 * only: no AI-made utterance is spoken by this task. `manage.py seed_castle_speech_lines` creates
 * the rows from the same sources these ids are built from, and Vitest and pytest hold the text in
 * step (`castleSpeechLines.test.ts`, `lai/apps/speech/tests/test_castle_speech_lines.py`):
 *
 * - a Painted Words pronunciation is `castle-word-<word>`, whose text is the bank word exactly
 *   (`paintedWordsBank.ts`, mirrored for the server in `lai/apps/speech/castle_speech_words.json`);
 * - a Great Storybook page is `castle-page-<page id>`, whose text is `pageNarration(page)`
 *   (from `lai/apps/regions/great_storybook_pages.json`, the server's copy of `pages.ts`).
 *
 * The text the game passes as the fallback is the same text, so a failed or switched-off voice
 * leaves exactly those words on screen as the caption.
 */
export const wordLineId = (word: string): string => `castle-word-${word}`;

export const pageLineId = (pageId: string): string => `castle-page-${pageId}`;

/** What is read aloud when a page comes back: its title, then what it says. */
export function pageNarration(page: Pick<StorybookPage, 'title' | 'restoredText'>): string {
  return `${page.title}. ${page.restoredText}`;
}
