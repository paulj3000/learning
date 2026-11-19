import { ADVENTURE_TEMPLATES } from '../adventures/content';
import { isGuidedCompletion } from '../adventures/engine/hints';
import type { SubmissionDecision } from '../adventures/engine/submission';
import type { AdventureDefinition } from '../adventures/engine/types';
import type { AgeBandValue } from '../child-profile/constants';
import { CASTLE_ROOM_IDS, SECRET_PASSAGE_DISCOVERY_ID } from '../island-map/three/castleLayout';
import { CASTLE_KEEPSAKE_IDS } from '../rewards/content/islandItems';
import { STORY_DEFINITIONS } from '../story/content';
import {
  GREAT_STORYBOOK_RESTORED_KEY,
  GREAT_STORYBOOK_RESTORED_V2_KEY,
  STORYBOOK_PAGES,
  pagesForBand,
  type StorybookPage,
} from './pages';

/**
 * Storykeeper Castle's scoring sources (GE-100 coordination; SC-JMP-08 prep).
 *
 * This is **not a points system** and adds none. The castle's achievements are already records:
 * world changes, discoveries, inventory items and the Adventure Engine's skill evidence, each
 * written once per child by the server. This module only **names** those records as typed
 * events, so the unified Game Engine Core scoring service (GE-100, core/ge-scoring) can consume
 * them through one adapter instead of reading castle internals. It carries no values, no
 * multipliers, no levels and no thresholds: whatever a policy awards for an event is the GE
 * ledger's decision, made server-side and approved by the owner.
 *
 * Rules every event keeps (docs/adventures/scoring-standard.md):
 * - **Derived from records that exist**, so replaying, reloading or projecting twice yields the
 *   same set (idempotency key = the record's own identity).
 * - **Server records are authoritative.** The one client-signal kind (a movement view reached)
 *   is marked so; a policy must never grant from it without a server record.
 * - **No penalty**: nothing here is produced by a wrong answer, a hint, a missed jump or time.
 * - **No child data**: ids are content ids only (no names, free text or child identifiers).
 */

export const CASTLE_REALM_ID = 'storykeeper-castle';

/** The castle's location slugs whose records belong to the castle. */
export const CASTLE_LOCATION_SLUGS = ['storykeeper-castle', 'castle-secret-passage'] as const;

export type CastleScoringKind =
  /** An adventure or story chapter finished (its completion world change exists). */
  | 'STORY_COMPLETED'
  /** An answered learning step, with its honest support level. Evidence, not a reward. */
  | 'LEARNING_STEP_COMPLETED'
  /** The Great Storybook is whole for an edition. */
  | 'READING_MILESTONE'
  /** A Storybook page is back (the castle's "story fragments"). */
  | 'STORY_FRAGMENT_RECOVERED'
  /** A castle room entered for the first time (`castle-room:<id>`). */
  | 'PLACE_EXPLORED'
  /** A hidden find (the tapestry nook, the chamber's star and mouse door). */
  | 'HIDDEN_FIND'
  /** An optional movement view reached (the Secret Chamber ledge). Client signal only. */
  | 'MOVEMENT_EXPLORATION'
  /** A castle keepsake owned (granted once by its server reward rule). */
  | 'ACHIEVEMENT_EARNED';

export type CastleScoringRecord =
  'WORLD_CHANGE' | 'DISCOVERY' | 'INVENTORY_ITEM' | 'SKILL_EVIDENCE' | 'ENGINE_EVENT';

export type CastleSupport = 'INDEPENDENT' | 'SUPPORTED' | 'GUIDED';

export interface CastleScoringEvent {
  readonly realmId: typeof CASTLE_REALM_ID;
  readonly kind: CastleScoringKind;
  /** The content id the event is about: a page id, adventure slug, room id, item id. */
  readonly sourceId: string;
  /** Which existing record proves it. */
  readonly record: CastleScoringRecord;
  /** `server`: a persisted record exists. `client-signal`: an engine event a policy must not grant from alone. */
  readonly authority: 'server' | 'client-signal';
  /** Stable across replays and reloads: a ledger that keys on this awards at most once. */
  readonly idempotencyKey: string;
  /** Learning events only: how much help the child had. */
  readonly support?: CastleSupport;
  /** Learning events only: the objectives the step practises. */
  readonly objectiveIds?: readonly string[];
}

/** What the projection reads: a subset of a child's world state, whichever store it came from. */
export interface CastleRecords {
  readonly worldChangeKeys: readonly string[];
  readonly discoveryIds: readonly string[];
  readonly ownedItemIds: readonly string[];
}

/** The chamber's hidden finds (`castleChamber.ts`; server keys in `game_sessions`). */
export const CASTLE_HIDDEN_FIND_IDS = [
  SECRET_PASSAGE_DISCOVERY_ID,
  'castle-chamber-star',
  'castle-chamber-mouse-door',
] as const;

/** The optional movement views (`castlePlatforms.ts` CASTLE_VIEW_ZONES). Never a server record. */
export const CASTLE_MOVEMENT_VIEW_IDS = ['view:chamber:ledge'] as const;

export const castleRoomChangeKey = (roomId: string) => `castle-room:${roomId}`;

const key = (kind: CastleScoringKind, sourceId: string) => `${CASTLE_REALM_ID}:${kind}:${sourceId}`;

function event(
  kind: CastleScoringKind,
  sourceId: string,
  record: CastleScoringRecord,
  extra: Partial<Pick<CastleScoringEvent, 'support' | 'objectiveIds' | 'authority'>> = {},
): CastleScoringEvent {
  return {
    realmId: CASTLE_REALM_ID,
    kind,
    sourceId,
    record,
    authority: extra.authority ?? 'server',
    idempotencyKey: key(kind, sourceId),
    ...(extra.support ? { support: extra.support } : {}),
    ...(extra.objectiveIds ? { objectiveIds: extra.objectiveIds } : {}),
  };
}

const isCastleLocation = (slug: string) =>
  (CASTLE_LOCATION_SLUGS as readonly string[]).includes(slug);

/** The castle's authored adventures (read from the content, never re-listed). */
export function castleAdventures(
  adventures: readonly AdventureDefinition[] = ADVENTURE_TEMPLATES,
): readonly AdventureDefinition[] {
  return adventures.filter((adventure) => isCastleLocation(adventure.locationSlug));
}

/** One completion source: the world change that says an adventure or story chapter is finished. */
export interface CastleCompletionSource {
  readonly kind: 'ADVENTURE' | 'STORY';
  readonly id: string;
  readonly changeKey: string;
  readonly ageBands: readonly AgeBandValue[];
}

/**
 * Each castle adventure's completion record is the world change its last world-change step writes;
 * each castle story chapter's is its `completionWorldChange`. Joined from content, not typed twice.
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

function pageRecorded(page: StorybookPage, records: CastleRecords): boolean {
  return page.source.kind === 'WORLD_CHANGE'
    ? records.worldChangeKeys.includes(page.source.changeKey)
    : records.discoveryIds.includes(page.source.discoveryId);
}

/**
 * Every scoring event a child's existing castle records prove, in a stable order. Pure and
 * idempotent: the same records always give the same events, duplicates in the input give one
 * event, and nothing is produced for a record the child does not have. `band` limits pages to the
 * child's Storybook (a page outside the band is still a world change, but not a page of theirs).
 */
export function castleScoringEventsFrom(
  records: CastleRecords,
  band: AgeBandValue,
  adventures: readonly AdventureDefinition[] = ADVENTURE_TEMPLATES,
): readonly CastleScoringEvent[] {
  const events: CastleScoringEvent[] = [];
  const changes = new Set(records.worldChangeKeys);
  const discoveries = new Set(records.discoveryIds);
  const owned = new Set(records.ownedItemIds);

  // One completion per record: a replay variant (`the-painted-words-again`) writes the same key as
  // its first play, and a band's own variant (`quills-picture-story`) the same key as the tale, so
  // the event is named after the band's first source of that key and keyed by the record.
  const completed = new Set<string>();
  for (const source of castleCompletionSources(adventures)) {
    if (!source.ageBands.includes(band) || !changes.has(source.changeKey)) continue;
    if (completed.has(source.changeKey)) continue;
    completed.add(source.changeKey);
    events.push(event('STORY_COMPLETED', source.id, 'WORLD_CHANGE'));
  }
  for (const page of pagesForBand(band)) {
    if (pageRecorded(page, records)) {
      events.push(
        event(
          'STORY_FRAGMENT_RECOVERED',
          page.id,
          page.source.kind === 'WORLD_CHANGE' ? 'WORLD_CHANGE' : 'DISCOVERY',
        ),
      );
    }
  }
  for (const milestone of [GREAT_STORYBOOK_RESTORED_KEY, GREAT_STORYBOOK_RESTORED_V2_KEY]) {
    if (changes.has(milestone)) events.push(event('READING_MILESTONE', milestone, 'WORLD_CHANGE'));
  }
  for (const roomId of CASTLE_ROOM_IDS) {
    if (changes.has(castleRoomChangeKey(roomId)))
      events.push(event('PLACE_EXPLORED', roomId, 'WORLD_CHANGE'));
  }
  for (const findId of CASTLE_HIDDEN_FIND_IDS) {
    if (discoveries.has(findId)) events.push(event('HIDDEN_FIND', findId, 'DISCOVERY'));
  }
  for (const itemId of CASTLE_KEEPSAKE_IDS) {
    if (owned.has(itemId)) events.push(event('ACHIEVEMENT_EARNED', itemId, 'INVENTORY_ITEM'));
  }
  return events;
}

/**
 * A learning event for one Adventure Engine decision on a castle step, or `null` when the decision
 * is not a completed step (a retry produces nothing: no event, no penalty). The support level is
 * the engine's own, mapped to the three kinds the scoring standard keeps apart. The key names the
 * step, so a replayed or resubmitted step keys the same; whether a replay counts again is the GE
 * policy's decision (the scoring standard: replay grants nothing permanent).
 */
export function castleLearningEvent(
  adventure: AdventureDefinition,
  stepId: string,
  decision: SubmissionDecision,
): CastleScoringEvent | null {
  if (!isCastleLocation(adventure.locationSlug)) return null;
  if (decision.action !== 'ADVANCE' || decision.correctness !== 'correct') return null;
  const step = adventure.steps.find((candidate) => candidate.id === stepId);
  if (!step || step.objectiveIds.length === 0) return null;
  const support: CastleSupport = isGuidedCompletion(decision.supportLevel)
    ? 'GUIDED'
    : decision.supportLevel > 0
      ? 'SUPPORTED'
      : 'INDEPENDENT';
  return event('LEARNING_STEP_COMPLETED', `${adventure.slug}/${stepId}`, 'SKILL_EVIDENCE', {
    support,
    objectiveIds: [...step.objectiveIds],
  });
}

/**
 * A client signal for an optional movement view, from the engine's `PlayerEnteredZone`. Never a
 * server record, so a policy must not grant from it alone; returns `null` for any other zone.
 */
export function castleMovementEvent(zoneId: string): CastleScoringEvent | null {
  if (!(CASTLE_MOVEMENT_VIEW_IDS as readonly string[]).includes(zoneId)) return null;
  return event('MOVEMENT_EXPLORATION', zoneId, 'ENGINE_EVENT', { authority: 'client-signal' });
}

/** Every page id, for the adapter's own contract test (pages are never renamed). */
export const CASTLE_FRAGMENT_IDS: readonly string[] = STORYBOOK_PAGES.map((page) => page.id);
