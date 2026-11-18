import type { AgeBandValue } from '../child-profile/constants';

/**
 * Ambient return-visit events for Storykeeper Castle (SC-R08-01, contract:
 * docs/regions/prep/ai_director_prep.md).
 *
 * **An event is atmosphere, never progress.** It carries words and an ambient cue the engine
 * plays; it grants nothing: no reward, no quest step, no world change. The only record it
 * leaves is a display counter, so the same moment is not shown on every visit.
 *
 * **Repetition is counted in visits, never in time.** No clock, no streak, no "come back
 * tomorrow", no countdown: `currentVisitIndex` is the server's count of this child's castle
 * visits, so waiting never changes what is eligible and being away is never penalised.
 *
 * Pure and deterministic: the same catalog and state always give the same answer. The server
 * (`lai/apps/regions/castle_events.py`) ports `eligibleEvents` and `defaultEvent`; the shared
 * golden vectors (`tests/golden/castle-events.json`) hold the two together, and
 * `castleEvents.json` mirrors `CASTLE_EVENTS` (a Vitest test fails if they differ).
 */

export type CastleEventStatus = 'DRAFT' | 'PUBLISHED' | 'RETIRED';

/** A closed list of ambient cues the engine may play. Never a reward. */
export type CastleAmbientCue =
  | 'dust-motes'
  | 'candle-flicker'
  | 'page-rustle'
  | 'ember-flyby'
  | 'lantern-glow'
  | 'quill-scratch'
  | 'paint-shimmer';

/** The subset of the NPC Manager's condition language events may use (`apps.npcs.conditions`). */
export type CastleEventCondition =
  | { type: 'ALWAYS' }
  | { type: 'WORLD_CHANGE'; key: string; present?: boolean; place?: string }
  | {
      type: 'QUEST_STATUS';
      quest: string;
      status: 'NOT_STARTED' | 'ACTIVE' | 'COMPLETED';
    }
  | {
      type: 'RELATIONSHIP_AT_LEAST';
      level: 'STRANGER' | 'ACQUAINTANCE' | 'FRIEND' | 'TRUSTED_FRIEND';
    };

export type CastleEventNpcId = 'keeper-quill' | 'ember-dragon';

export interface CastleEvent {
  /** Stable kebab id. Never renamed. */
  id: string;
  status: CastleEventStatus;
  version: number;
  /** A castle room id, or `ANY`. */
  room: string;
  bands: readonly AgeBandValue[];
  requires: readonly CastleEventCondition[];
  /** Visit-based repetition: `maxShows` null is unlimited; `minVisitGap` is in visits. */
  repeat: { maxShows: number | null; minVisitGap: number };
  /** Deterministic ordering only (1 to 5), never randomness. */
  weight: number;
  npcId: CastleEventNpcId | null;
  /** Authored lines per band, at most `MAX_SPOKEN_LENGTH_BY_AGE_BAND`. Readable aloud. */
  lines: Record<AgeBandValue, readonly string[]>;
  visual: { kind: CastleAmbientCue };
  /** Exactly one quiet event per room has this set. */
  fallback: boolean;
  /** Hidden from "Things to do" lists. Ambient events are always secret. */
  secret: boolean;
}

/** What `eligibleEvents` may look at. No identifiers, no text. */
export interface CastleEventConditions {
  worldChanges: readonly { place: string; key: string }[];
  questStatuses: Readonly<Record<string, string>>;
  /** NPC id -> relationship level, for the NPCs the child has met. */
  relationshipLevels: Readonly<Record<string, string>>;
}

export interface CastleEventState {
  ageBand: AgeBandValue;
  roomId: string;
  conditions: CastleEventConditions;
  shownCounts: Readonly<Record<string, number>>;
  lastShownVisit: Readonly<Record<string, number>>;
  currentVisitIndex: number;
}

const LEVELS = ['STRANGER', 'ACQUAINTANCE', 'FRIEND', 'TRUSTED_FRIEND'];

function conditionHolds(
  condition: CastleEventCondition,
  event: CastleEvent,
  conditions: CastleEventConditions,
): boolean {
  switch (condition.type) {
    case 'ALWAYS':
      return true;
    case 'WORLD_CHANGE': {
      const present = conditions.worldChanges.some(
        (change) =>
          change.key === condition.key &&
          (condition.place === undefined || change.place === condition.place),
      );
      return present === (condition.present ?? true);
    }
    case 'QUEST_STATUS':
      return (conditions.questStatuses[condition.quest] ?? 'NOT_STARTED') === condition.status;
    case 'RELATIONSHIP_AT_LEAST': {
      const level = event.npcId ? conditions.relationshipLevels[event.npcId] : undefined;
      if (level === undefined || !LEVELS.includes(level)) return false;
      return LEVELS.indexOf(level) >= LEVELS.indexOf(condition.level);
    }
    default:
      // An unknown condition type never holds (fail closed).
      return false;
  }
}

/** Heavier first, then id ascending: stable and independent of the catalog's order. */
function byWeightThenId(a: CastleEvent, b: CastleEvent): number {
  if (a.weight !== b.weight) return b.weight - a.weight;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The events that may be shown now, best first. Filter order (contract section 2): published,
 * band, room (or ANY), every condition, `maxShows`, `minVisitGap`.
 */
export function eligibleEvents(
  catalog: readonly CastleEvent[],
  state: CastleEventState,
): CastleEvent[] {
  return catalog
    .filter((event) => {
      if (event.status !== 'PUBLISHED') return false;
      if (!event.bands.includes(state.ageBand)) return false;
      if (event.room !== 'ANY' && event.room !== state.roomId) return false;
      if (!event.requires.every((c) => conditionHolds(c, event, state.conditions))) return false;
      const shown = state.shownCounts[event.id] ?? 0;
      if (event.repeat.maxShows !== null && shown >= event.repeat.maxShows) return false;
      const last = state.lastShownVisit[event.id];
      if (last !== undefined && state.currentVisitIndex - last < event.repeat.minVisitGap) {
        return false;
      }
      return true;
    })
    .sort(byWeightThenId);
}

/**
 * The deterministic choice: the best eligible event, else the room's quiet fallback event. The
 * fallback is looked up without the repeat rules, so the answer is never empty for a room and
 * band the catalog covers (a content test proves every room and band is covered).
 */
export function defaultEvent(
  catalog: readonly CastleEvent[],
  state: CastleEventState,
): CastleEvent | null {
  const eligible = eligibleEvents(catalog, state);
  if (eligible.length > 0) return eligible[0] ?? null;
  return (
    catalog
      .filter(
        (event) =>
          event.fallback &&
          event.status === 'PUBLISHED' &&
          event.room === state.roomId &&
          event.bands.includes(state.ageBand),
      )
      .sort(byWeightThenId)[0] ?? null
  );
}

/** The authored lines for a band. The Sprout line list is voice first and kept short. */
export function linesFor(event: CastleEvent, band: AgeBandValue): readonly string[] {
  return event.lines[band];
}

// ---------------------------------------------------------------------------------------------
// The starting catalog. Rooms are `CASTLE_ROOM_IDS`; NPC ids are the castle's keeper-quill and
// ember-dragon; conditions use only world changes the castle's content already writes. No
// event uses an NPC memory flag, so none can name one `reachableMemoryFlags` would not reach.

const ALL_BANDS: readonly AgeBandValue[] = ['SPROUT', 'PATHFINDER', 'EXPLORER'];

function quiet(
  room: string,
  cue: CastleAmbientCue,
  lines: Record<AgeBandValue, string>,
): CastleEvent {
  return {
    id: `quiet-${room}`,
    status: 'PUBLISHED',
    version: 1,
    room,
    bands: ALL_BANDS,
    requires: [],
    repeat: { maxShows: null, minVisitGap: 0 },
    weight: 1,
    npcId: null,
    lines: {
      SPROUT: [lines.SPROUT],
      PATHFINDER: [lines.PATHFINDER],
      EXPLORER: [lines.EXPLORER],
    },
    visual: { kind: cue },
    fallback: true,
    secret: true,
  };
}

export const CASTLE_EVENTS: readonly CastleEvent[] = [
  quiet('entry-hall', 'candle-flicker', {
    SPROUT: 'The torches glow softly.',
    PATHFINDER: 'The torches glow softly in the Entry Hall.',
    EXPLORER: 'The torches glow softly in the Entry Hall, and the old stones feel calm.',
  }),
  quiet('story-hall', 'candle-flicker', {
    SPROUT: 'The hearth crackles.',
    PATHFINDER: 'The hearth crackles quietly in the Story Hall.',
    EXPLORER: 'The hearth crackles quietly in the Story Hall, and the shelves smell of old paper.',
  }),
  quiet('character-gallery', 'dust-motes', {
    SPROUT: 'The portraits look friendly.',
    PATHFINDER: 'The portraits look down kindly from the walls.',
    EXPLORER: 'The portraits look down kindly from the walls, each one holding a story of its own.',
  }),
  quiet('costume-room', 'dust-motes', {
    SPROUT: 'The costumes sway a little.',
    PATHFINDER: 'The costumes sway a little on their hooks.',
    EXPLORER: 'The costumes sway a little on their hooks, as if they remember every play.',
  }),
  quiet('east-corridor', 'candle-flicker', {
    SPROUT: 'The corridor is quiet.',
    PATHFINDER: 'The corridor is quiet, and the candles burn steadily.',
    EXPLORER: 'The corridor is quiet, and the candles burn steadily along the stone walls.',
  }),
  quiet('setting-tower', 'dust-motes', {
    SPROUT: 'The windows show the sky.',
    PATHFINDER: 'The tall windows show a wide, calm sky.',
    EXPLORER: 'The tall windows show a wide, calm sky, and the clouds drift past like slow ships.',
  }),
  quiet('illustration-studio', 'paint-shimmer', {
    SPROUT: 'The paints sparkle.',
    PATHFINDER: 'The paints sparkle in their little pots.',
    EXPLORER: 'The paints sparkle in their little pots, ready for any picture you can imagine.',
  }),
  quiet('great-library', 'page-rustle', {
    SPROUT: 'The books rest on the shelves.',
    PATHFINDER: 'The books rest quietly on their shelves.',
    EXPLORER: 'The books rest quietly on their shelves, and a page turns by itself, just once.',
  }),
  quiet('trophy-room', 'lantern-glow', {
    SPROUT: 'The pedestals shine.',
    PATHFINDER: 'The pedestals shine in the soft lantern light.',
    EXPLORER: 'The pedestals shine in the soft lantern light, each one keeping a treasure safe.',
  }),
  quiet('secret-chamber', 'lantern-glow', {
    SPROUT: 'The lantern glows.',
    PATHFINDER: 'The little lantern glows in the quiet room.',
    EXPLORER: 'The little lantern glows in the quiet room, and the mural seems to listen.',
  }),
  /*
    SC-R08-03: the Secret Chamber's return-visit lines. Observation only: the crystals and the
    mural are noticed, and the two quiet finds (SC-R08-02) are remembered by the world changes they
    record. Nothing here asks a question, grades or grants; the chamber itself is only reachable once
    the tapestry nook is found, so no event needs to say so.
  */
  {
    id: 'chamber-crystals-hum',
    status: 'PUBLISHED',
    version: 1,
    room: 'secret-chamber',
    bands: ALL_BANDS,
    requires: [],
    repeat: { maxShows: 3, minVisitGap: 2 },
    weight: 2,
    npcId: null,
    lines: {
      SPROUT: ['The crystals hum softly.'],
      PATHFINDER: ['The three crystals hum together, one low, one higher, and one softest of all.'],
      EXPLORER: [
        'The three crystals hum together, one low, one higher, and one softest of all, and the sound settles like a lullaby.',
      ],
    },
    visual: { kind: 'lantern-glow' },
    fallback: false,
    secret: true,
  },
  {
    id: 'chamber-mural-listens',
    status: 'PUBLISHED',
    version: 1,
    room: 'secret-chamber',
    bands: ALL_BANDS,
    requires: [],
    repeat: { maxShows: 2, minVisitGap: 3 },
    weight: 2,
    npcId: null,
    lines: {
      SPROUT: ['The mural is quiet.'],
      PATHFINDER: ['The old mural is quiet, and its painted colors glow a little in the lantern light.'],
      EXPLORER: [
        'The old mural is quiet, and its painted colors glow a little in the lantern light, as if every picture is listening.',
      ],
    },
    visual: { kind: 'dust-motes' },
    fallback: false,
    secret: true,
  },
  {
    id: 'chamber-star-twinkles',
    status: 'PUBLISHED',
    version: 1,
    room: 'secret-chamber',
    bands: ALL_BANDS,
    requires: [{ type: 'WORLD_CHANGE', key: 'CASTLE_CHAMBER_STAR_FOUND', place: 'storykeeper-castle' }],
    repeat: { maxShows: 3, minVisitGap: 2 },
    weight: 3,
    npcId: null,
    lines: {
      SPROUT: ['The little star twinkles.'],
      PATHFINDER: ['The little painted star twinkles, as if it remembers you.'],
      EXPLORER: [
        'The little painted star twinkles on the mural, as if it remembers the day you noticed it.',
      ],
    },
    visual: { kind: 'lantern-glow' },
    fallback: false,
    secret: true,
  },
  {
    id: 'chamber-mouse-door-glows',
    status: 'PUBLISHED',
    version: 1,
    room: 'secret-chamber',
    bands: ALL_BANDS,
    requires: [
      { type: 'WORLD_CHANGE', key: 'CASTLE_CHAMBER_MOUSE_DOOR_FOUND', place: 'storykeeper-castle' },
    ],
    repeat: { maxShows: 3, minVisitGap: 2 },
    weight: 3,
    npcId: null,
    lines: {
      SPROUT: ['The tiny door glows.'],
      PATHFINDER: ['The tiny door glows warmly, and somebody small is humming inside.'],
      EXPLORER: [
        'The tiny door glows warmly, and somebody small is humming a cheerful tune inside, just out of sight.',
      ],
    },
    visual: { kind: 'candle-flicker' },
    fallback: false,
    secret: true,
  },
  {
    id: 'chamber-finds-remembered',
    status: 'PUBLISHED',
    version: 1,
    room: 'secret-chamber',
    bands: ALL_BANDS,
    requires: [
      { type: 'WORLD_CHANGE', key: 'CASTLE_CHAMBER_STAR_FOUND', place: 'storykeeper-castle' },
      { type: 'WORLD_CHANGE', key: 'CASTLE_CHAMBER_MOUSE_DOOR_FOUND', place: 'storykeeper-castle' },
    ],
    repeat: { maxShows: 2, minVisitGap: 3 },
    weight: 4,
    npcId: null,
    lines: {
      SPROUT: ['The star and the tiny door say hello.'],
      PATHFINDER: ['The little star and the tiny door seem glad you found them both.'],
      EXPLORER: [
        'The little star and the tiny door seem glad you found them both, and the whole chamber feels warm and friendly.',
      ],
    },
    visual: { kind: 'lantern-glow' },
    fallback: false,
    secret: true,
  },
  {
    id: 'quill-hums-in-hall',
    status: 'PUBLISHED',
    version: 1,
    room: 'story-hall',
    bands: ALL_BANDS,
    requires: [],
    repeat: { maxShows: 3, minVisitGap: 1 },
    weight: 2,
    npcId: 'keeper-quill',
    lines: {
      SPROUT: ['Keeper Quill hums a tune.'],
      PATHFINDER: ['Keeper Quill hums a happy tune while tidying the story shelves.'],
      EXPLORER: [
        'Keeper Quill hums a happy tune while tidying the story shelves, and a few loose pages settle into place.',
      ],
    },
    visual: { kind: 'quill-scratch' },
    fallback: false,
    secret: true,
  },
  {
    id: 'quill-admires-first-story',
    status: 'PUBLISHED',
    version: 1,
    room: 'story-hall',
    bands: ALL_BANDS,
    requires: [{ type: 'WORLD_CHANGE', key: 'FIRST_STORY_TOLD', place: 'storykeeper-castle' }],
    repeat: { maxShows: 2, minVisitGap: 2 },
    weight: 3,
    npcId: 'keeper-quill',
    lines: {
      SPROUT: ['Keeper Quill smiles at the book.'],
      PATHFINDER: ['Keeper Quill smiles at the book and says the first story still feels warm.'],
      EXPLORER: [
        'Keeper Quill smiles at the Great Storybook and says the first story you told still feels warm on the page.',
      ],
    },
    visual: { kind: 'page-rustle' },
    fallback: false,
    secret: true,
  },
  {
    id: 'ember-warms-the-hearth',
    status: 'PUBLISHED',
    version: 1,
    room: 'story-hall',
    bands: ALL_BANDS,
    requires: [
      { type: 'WORLD_CHANGE', key: 'DRAGON_OF_EMBER_MOUNTAIN_COMPLETE' },
      { type: 'WORLD_CHANGE', key: 'GREAT_STORYBOOK_RESTORED' },
    ],
    repeat: { maxShows: 3, minVisitGap: 2 },
    weight: 4,
    npcId: 'ember-dragon',
    lines: {
      SPROUT: ['Ember warms the hearth.'],
      PATHFINDER: ['Ember curls up by the hearth and makes the whole hall cosy and warm.'],
      EXPLORER: [
        'Ember curls up by the hearth and makes the whole hall cosy and warm, and the shadows on the shelves dance.',
      ],
    },
    visual: { kind: 'candle-flicker' },
    fallback: false,
    secret: true,
  },
  {
    id: 'ember-flies-past-tower',
    status: 'PUBLISHED',
    version: 1,
    room: 'setting-tower',
    bands: ALL_BANDS,
    requires: [
      { type: 'WORLD_CHANGE', key: 'DRAGON_OF_EMBER_MOUNTAIN_COMPLETE' },
      { type: 'WORLD_CHANGE', key: 'GREAT_STORYBOOK_RESTORED' },
    ],
    repeat: { maxShows: 3, minVisitGap: 2 },
    weight: 4,
    npcId: 'ember-dragon',
    lines: {
      SPROUT: ['Look! Ember flies by.'],
      PATHFINDER: ['Look out the window! Ember sails past the tower with a happy swoop.'],
      EXPLORER: [
        'Look out the window! Ember sails past the tower with a happy swoop, trailing a ribbon of warm light.',
      ],
    },
    visual: { kind: 'ember-flyby' },
    fallback: false,
    secret: true,
  },
  {
    id: 'library-pages-rustle',
    status: 'PUBLISHED',
    version: 1,
    room: 'great-library',
    bands: ALL_BANDS,
    requires: [],
    repeat: { maxShows: null, minVisitGap: 2 },
    weight: 2,
    npcId: null,
    lines: {
      SPROUT: ['The pages rustle.'],
      PATHFINDER: ['The pages rustle softly, as if the books are whispering to each other.'],
      EXPLORER: [
        'The pages rustle softly, as if the books are whispering to each other about the stories they hold.',
      ],
    },
    visual: { kind: 'page-rustle' },
    fallback: false,
    secret: true,
  },
  {
    id: 'studio-paint-shimmers',
    status: 'PUBLISHED',
    version: 1,
    room: 'illustration-studio',
    bands: ALL_BANDS,
    requires: [{ type: 'WORLD_CHANGE', key: 'STUDIO_PAGE_MENDED' }],
    repeat: { maxShows: 3, minVisitGap: 1 },
    weight: 3,
    npcId: null,
    lines: {
      SPROUT: ['The painted words shimmer.'],
      PATHFINDER: ['The painted words shimmer on the wall, happy to be home.'],
      EXPLORER: [
        'The painted words shimmer on the wall, happy to be home, and the colours seem a little brighter today.',
      ],
    },
    visual: { kind: 'paint-shimmer' },
    fallback: false,
    secret: true,
  },
  {
    id: 'lanterns-glow-brighter',
    status: 'PUBLISHED',
    version: 1,
    room: 'ANY',
    bands: ALL_BANDS,
    requires: [],
    repeat: { maxShows: null, minVisitGap: 3 },
    weight: 2,
    npcId: null,
    lines: {
      SPROUT: ['The lanterns twinkle.'],
      PATHFINDER: ['The lanterns twinkle gently as you pass.'],
      EXPLORER: ['The lanterns twinkle gently as you pass, lighting the way through the castle.'],
    },
    visual: { kind: 'lantern-glow' },
    fallback: false,
    secret: true,
  },
];

/** Every line the catalog can show a child, for tests that check copy rules. */
export function allCastleEventLines(catalog: readonly CastleEvent[] = CASTLE_EVENTS): string[] {
  return catalog.flatMap((event) => ALL_BANDS.flatMap((band) => [...event.lines[band]]));
}
