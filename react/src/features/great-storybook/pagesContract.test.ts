import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GREAT_STORYBOOK_QUEST_IDS } from '../quests/content/islandQuests';
import { STORYBOOK_PAGES } from './pages';

/**
 * The server derives the Great Storybook from `lai/apps/regions/great_storybook_pages.json`
 * (SC-R04-02), and this client from `STORYBOOK_PAGES`. They must be the same pages, with
 * the same sources, bands and words, and the same quests: otherwise the book the server reports is
 * not the book the child sees. This is the drift guard the JSON's own comment promises.
 */
const server = JSON.parse(
  readFileSync(resolve(process.cwd(), '../lai/apps/regions/great_storybook_pages.json'), 'utf8'),
) as { quests: Record<string, string>; pages: unknown };

describe('the pages the server derives', () => {
  it('are exactly the client registry, field for field', () => {
    expect(server.pages).toEqual(JSON.parse(JSON.stringify(STORYBOOK_PAGES)));
  });

  it('name the same quest for every band', () => {
    expect(server.quests).toEqual(GREAT_STORYBOOK_QUEST_IDS);
  });
});
