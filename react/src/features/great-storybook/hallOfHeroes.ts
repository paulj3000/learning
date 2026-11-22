import { PAINTED_WORDS_CHANGE_KEY } from '../adventures/content/thePaintedWords';
import { CASTLE_KEEPSAKE_IDS, ISLAND_ITEMS } from '../rewards/content/islandItems';
import { THE_CASTLES_SECRET_DOOR } from '../story/content/theCastlesSecretDoor';
import { shownRank, type CastleRanksConfig, type RankTitle } from './castleRanks';
import type { StorybookProgress } from './pages';

/**
 * The Hall of Heroes (SC-R07-03): a derived, read-only record of what a child
 * has done in Storykeeper Castle. It is composed on the client from records the
 * castle already reads (the Great Storybook's progress, the backpack, the world
 * changes), so there is **no new endpoint, no new model and nothing stored**
 * (ADR-033). Nothing here grants, records or compares anything; there is no
 * chat text and no time anywhere in it.
 *
 * The castle guide lists it as text, the accessible equivalent of the gallery's
 * story plates.
 */

/** A castle story a child can finish, named by the world change its ending records. */
export interface CastleStoryRecord {
  id: string;
  /** Child-facing. */
  title: string;
  changeKey: string;
}

/**
 * The castle's finishable stories. Each key is the record the story's own
 * ending writes (the Tale and the Picture Story both write the first story's).
 */
export const CASTLE_STORY_RECORDS: readonly CastleStoryRecord[] = [
  { id: 'first-story', title: 'A story told with Keeper Quill', changeKey: 'FIRST_STORY_TOLD' },
  { id: 'the-painted-words', title: 'The Painted Words', changeKey: PAINTED_WORDS_CHANGE_KEY },
  {
    id: THE_CASTLES_SECRET_DOOR.slug,
    title: THE_CASTLES_SECRET_DOOR.title,
    changeKey: THE_CASTLES_SECRET_DOOR.completionWorldChange.changeKey,
  },
];

export interface HallOfHeroes {
  stories: readonly { id: string; title: string }[];
  pages: readonly { id: string; title: string; text: string }[];
  artifacts: readonly { itemId: string; name: string; description: string }[];
  /** The child's castle title, or `null` while ranks are off (the default). */
  rank: RankTitle | null;
  /** Nothing to show yet: the hall is ready, never "empty" as a fault. */
  isEmpty: boolean;
}

export interface HallInputs {
  /** The child's Storybook, or `undefined` before it is computed (no pages are listed then). */
  progress?: StorybookProgress;
  ownedItemIds: readonly string[];
  worldChangeKeys: readonly string[];
  ranks?: CastleRanksConfig;
}

/** Pure: the same records always give the same hall, and missing records give an empty one. */
export function hallOfHeroes({
  progress,
  ownedItemIds,
  worldChangeKeys,
  ranks,
}: HallInputs): HallOfHeroes {
  const keys = new Set(worldChangeKeys);
  const owned = new Set(ownedItemIds);
  const stories = CASTLE_STORY_RECORDS.filter((story) => keys.has(story.changeKey)).map(
    ({ id, title }) => ({ id, title }),
  );
  const pages = (progress?.entries ?? [])
    .filter((entry) => entry.restored)
    .map(({ page }) => ({ id: page.id, title: page.title, text: page.restoredText }));
  const artifacts = CASTLE_KEEPSAKE_IDS.filter((id) => owned.has(id)).flatMap((id) => {
    const item = ISLAND_ITEMS.find((candidate) => candidate.id === id);
    return item ? [{ itemId: id, name: item.displayName, description: item.description }] : [];
  });
  const rank = progress
    ? shownRank(progress.restoredRequired, progress.totalRequired, ranks)
    : null;
  return {
    stories,
    pages,
    artifacts,
    rank,
    isEmpty: stories.length === 0 && pages.length === 0 && artifacts.length === 0,
  };
}
