import { ADVENTURE_TEMPLATES } from '../adventures/content';
import type { AdventureDefinition } from '../adventures/engine/types';
import type { AgeBandValue } from '../child-profile/constants';
import { SECRET_PASSAGE_DISCOVERY_ID } from '../island-map/three/castleLayout';
import { STORY_DEFINITIONS } from '../story/content';
import { STORYBOOK_PAGES } from './pages';

/**
 * Storykeeper Castle's persisted records, read from the authored content (GE-072).
 *
 * This is a catalog of the server records a child's castle progress is made of, not a scoring
 * vocabulary: scoring reads the shared `lai.gameplay-event` v1 claims the castle emits
 * (`extensions/castleTale/castleGameplayClaims.ts`) and keys awards on these server rows. The
 * save-compatibility test pins every id here, so a migration cannot lose a child's progress.
 */

/** The castle's location slugs whose records belong to the castle. */
export const CASTLE_LOCATION_SLUGS = ['storykeeper-castle', 'castle-secret-passage'] as const;

const isCastleLocation = (slug: string) =>
  (CASTLE_LOCATION_SLUGS as readonly string[]).includes(slug);

/** The castle's hidden finds (`castleChamber.ts`; server keys in `game_sessions`). */
export const CASTLE_HIDDEN_FIND_IDS = [
  SECRET_PASSAGE_DISCOVERY_ID,
  'castle-chamber-star',
  'castle-chamber-mouse-door',
] as const;

/** The world change Django writes when a child first enters a castle room (SC-R03-06). */
export const castleRoomChangeKey = (roomId: string) => `castle-room:${roomId}`;

/** The castle's authored adventures (read from the content, never re-listed). */
export function castleAdventures(
  adventures: readonly AdventureDefinition[] = ADVENTURE_TEMPLATES,
): readonly AdventureDefinition[] {
  return adventures.filter((adventure) => isCastleLocation(adventure.locationSlug));
}

/** One completion record: the world change that says an adventure or story chapter is finished. */
export interface CastleCompletionSource {
  readonly kind: 'ADVENTURE' | 'STORY';
  readonly id: string;
  readonly changeKey: string;
  readonly ageBands: readonly AgeBandValue[];
}

/**
 * Each castle adventure's completion record is the world change its last world-change step
 * writes; each castle story chapter's is its `completionWorldChange`. Joined from content.
 */
export function castleCompletionSources(
  adventures: readonly AdventureDefinition[] = ADVENTURE_TEMPLATES,
): readonly CastleCompletionSource[] {
  const fromAdventures = castleAdventures(adventures).flatMap((adventure) => {
    const changes = adventure.steps.flatMap((step) =>
      step.presentation.kind === 'world-change' &&
      isCastleLocation(step.presentation.payload.locationSlug)
        ? [step.presentation.payload.changeKey]
        : [],
    );
    const last = changes[changes.length - 1];
    return last
      ? [
          {
            kind: 'ADVENTURE' as const,
            id: adventure.slug,
            changeKey: last,
            ageBands: adventure.ageBands,
          },
        ]
      : [];
  });
  const fromStories = STORY_DEFINITIONS.filter((story) =>
    isCastleLocation(story.completionWorldChange.locationSlug),
  ).map((story) => ({
    kind: 'STORY' as const,
    id: story.slug,
    changeKey: story.completionWorldChange.changeKey,
    ageBands: story.supportedAgeBands,
  }));
  return [...fromAdventures, ...fromStories];
}

/** Every Storybook page id (pages are never renamed). */
export const CASTLE_FRAGMENT_IDS: readonly string[] = STORYBOOK_PAGES.map((page) => page.id);
