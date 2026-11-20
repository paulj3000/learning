import { STORYBOOK_PAGES, type StorybookPage } from '../../../../../great-storybook/pages';
import type { WorldRequirement } from '../../../../worldObjects';
import type {
  PlatformSpec,
  PlatformingSpec,
  PressurePlateSpec,
} from '../../../platforms/platformSpec';
import type { RectZone, ZoneSpec } from '../../locationManifest';

/**
 * Storykeeper Castle's platforms, as typed presets and one pure builder per room
 * (SC-JMP, owner rule: jumping is not a separate adventure category).
 *
 * Every platform here is an ordinary entry in the SHARED platforms runtime
 * (`platforms/platformSpec.ts`): a static, jumpable box the shared controller already knows.
 * There is no castle-specific physics and no new movement engine. Rules this module keeps by
 * construction, and `castlePlatforms.test.ts` asserts:
 *
 * - **Learning stays primary.** A platform is a second way to give an answer the HUD card and
 *   the walk-in route already accept. A missed jump lands on the flat floor and loses nothing.
 * - **Low and calm.** Tops are at most `CASTLE_MAX_PLATFORM_TOP` (0.5 m), so a 0.9 m jump from
 *   the top still leaves the eye under the 3.1 m ceiling slabs. No bounce, no vanish, no motion,
 *   no lift.
 * - **Platforms never grade or reward.** A pad has a ground-plane answer zone (`pad:*`); entering
 *   it is an ordinary `PlayerEnteredZone`. The adventure engine grades, the server rewards
 *   (`castlePlatformAnswers.ts`). Pathway pads only reflect records that already exist.
 * - **Sprouts get flat markers.** `CASTLE_PLATFORMING_SPROUT` replaces the solid pads with flat
 *   pressure-plate markers at the same places (no colliders), and the same zones still answer.
 *
 * Positions are layout (ADR-033, LAI-0805 open: the castle layout stays in TypeScript). They were
 * verified against the real room floors, walls, doorways, safe spots, zones and colliders by
 * `castlePlatforms.test.ts`; move one and that test says which rule broke.
 */

/** The highest top any castle platform may have: 0.9 m jump + 0.5 m + 1.6 m eye stays under 3.1 m. */
export const CASTLE_MAX_PLATFORM_TOP = 0.5;
/** The narrowest side of a castle platform, metres (the shared runtime's floor is also 0.8). */
export const CASTLE_MIN_FOOTPRINT = 0.8;

export type CastlePlatformKind =
  | 'STEPPING_PAD'
  | 'STORY_STONE'
  | 'STAR_STONE'
  | 'BOOK_STONE'
  | 'PATTERN_STONE'
  | 'MEASURE_STONE'
  | 'PAGE_PATHWAY';

export interface CastlePlatformPreset {
  kind: CastlePlatformKind;
  /** Side of the square top, metres. */
  size: number;
  /** Height of the top above the floor, metres. */
  height: number;
  /** Default colour (0xRRGGBB); a pad may override it. */
  color: number;
}

export const CASTLE_PLATFORM_PRESETS: Readonly<Record<CastlePlatformKind, CastlePlatformPreset>> = {
  STEPPING_PAD: { kind: 'STEPPING_PAD', size: 0.9, height: 0.3, color: 0xd9a066 },
  STORY_STONE: { kind: 'STORY_STONE', size: 0.9, height: 0.3, color: 0xb9a37f },
  STAR_STONE: { kind: 'STAR_STONE', size: 0.8, height: 0.3, color: 0xf2c94c },
  BOOK_STONE: { kind: 'BOOK_STONE', size: 0.8, height: 0.3, color: 0x8b5a2b },
  PATTERN_STONE: { kind: 'PATTERN_STONE', size: 0.8, height: 0.3, color: 0x7a86b8 },
  MEASURE_STONE: { kind: 'MEASURE_STONE', size: 0.8, height: 0.35, color: 0x9aa3ad },
  PAGE_PATHWAY: { kind: 'PAGE_PATHWAY', size: 0.8, height: 0.3, color: 0xf2d680 },
};

/** The ids a pad's answer zone and platform take, so every layer finds the same pad. */
export const padPlatformId = (groupId: string, key: string) => `castle-pad:${groupId}:${key}`;
export const padZoneId = (groupId: string, key: string) => `pad:${groupId}:${key}`;
export const isPadZoneId = (zoneId: string) => zoneId.startsWith('pad:');

/** The shared runtime's name for the signal a recorded world change raises (`world:<changeKey>`). */
export const worldSignalName = (changeKey: string) => `world:${changeKey}`;

export interface CastlePad {
  /** The key inside its group: unique per group. */
  key: string;
  x: number;
  z: number;
  /** Overrides the preset (a MEASURE_STONE's height says how long the rod is). */
  height?: number;
  color?: number;
  /** Child-facing, readable aloud: what the pad is. */
  label: string;
}

export interface CastlePlatformGroup {
  id: string;
  roomId: string;
  kind: CastlePlatformKind;
  /** What the group is for, in plain words (the inventory repeats it). */
  purpose: string;
  /** Whether stepping on a pad answers a step (through its zone) or is only enrichment. */
  answers: boolean;
  /**
   * A group that answers nothing normally has no Sprout marker. Set this for an optional group a
   * Sprout may still enjoy as flat markers on the floor (the Secret Chamber's stepping stones).
   */
  sproutMarkers?: boolean;
  pads: readonly CastlePad[];
}

// --- Illustration Studio: the Painted Words ------------------------------------------------

/**
 * Three painted pads, in the paint pots' colours, around the easel. Each is one of the current
 * Painted Words step's choices (the words come from `paintedWordsBank.ts` through
 * `castlePlatformAnswers.ts`, never from here). The wall zone (`castle-painted-wall`, x 8.7 to
 * 9.5) and the easel are kept clear.
 */
export const STUDIO_PAD_GROUP: CastlePlatformGroup = {
  id: 'studio',
  roomId: 'illustration-studio',
  kind: 'STEPPING_PAD',
  purpose: 'Painted Words: a pad for each choice; standing on one gives that answer.',
  answers: true,
  pads: [
    { key: 'red', x: 7.1, z: -0.1, color: 0xd64545, label: 'the red pad' },
    { key: 'blue', x: 8.1, z: -0.1, color: 0x3f7fd0, label: 'the blue pad' },
    { key: 'yellow', x: 7.5, z: 2.15, color: 0xf2c94c, label: 'the yellow pad' },
  ],
};

// --- Story Hall: story stones ---------------------------------------------------------------

/**
 * Story stones for beat 6 (the Tale) and its Sprouts picture story: the same three beats as the
 * binding lectern's plates, in the plates' own left to right order (not the story order, for the
 * same reason: neither route may start from the answer).
 */
export const STORY_HALL_STONE_GROUP: CastlePlatformGroup = {
  id: 'story-hall',
  roomId: 'story-hall',
  kind: 'STORY_STONE',
  purpose: 'Order the story: step on the stones in the order things happened.',
  answers: true,
  pads: [
    { key: 'choice', x: -6.4, z: -3.4, color: 0xe07a5f, label: 'the choice stone' },
    { key: 'ending', x: -4.5, z: -3.4, color: 0xf2cc8f, label: 'the ending stone' },
    { key: 'problem', x: -2.6, z: -3.4, color: 0x81b29a, label: 'the problem stone' },
  ],
};

// --- Great Library: enchanted books, pattern stones, measure stones, page pathway ------------

/** Beat 9's clues as three enchanted books: step on them in the order they were written. */
export const LIBRARY_BOOK_GROUP: CastlePlatformGroup = {
  id: 'library-books',
  roomId: 'great-library',
  kind: 'BOOK_STONE',
  purpose: 'Chapter 1 (Three Clues): step on the enchanted books in the order the clues were written.',
  answers: true,
  pads: [
    { key: 'note', x: 6.9, z: -8.0, color: 0x6d4c8c, label: 'the folded note book' },
    { key: 'diary', x: 8.0, z: -8.0, color: 0x8b2e2e, label: 'the diary book' },
    { key: 'map', x: 9.1, z: -8.0, color: 0x2e6b8b, label: 'the map book' },
  ],
};

/** Beat 10's pattern as three carved stones: the star, the sun and the moon. */
export const LIBRARY_PATTERN_GROUP: CastlePlatformGroup = {
  id: 'library-pattern',
  roomId: 'great-library',
  kind: 'PATTERN_STONE',
  purpose: 'Chapter 2 (The Pattern Lock): step on the carving the worn one must be.',
  answers: true,
  pads: [
    { key: 'star', x: 6.4, z: -3.4, color: 0xf2c94c, label: 'the star stone' },
    { key: 'sun', x: 7.4, z: -3.4, color: 0xf2994a, label: 'the sun stone' },
    { key: 'moon', x: 8.4, z: -3.4, color: 0xb8c4e0, label: 'the moon stone' },
  ],
};

/**
 * The three rods as steps of three heights: silver is the lowest, iron the middle one, brass the
 * highest. Step on them from the shortest rod to the longest.
 */
export const LIBRARY_MEASURE_GROUP: CastlePlatformGroup = {
  id: 'library-measure',
  roomId: 'great-library',
  kind: 'MEASURE_STONE',
  purpose: 'Chapter 2 (The Pattern Lock): step on the rod stones from shortest to longest.',
  answers: true,
  pads: [
    { key: 'iron', x: 8.4, z: -6.5, height: 0.35, color: 0x6b6b73, label: 'the iron rod stone' },
    { key: 'brass', x: 9.3, z: -6.5, height: 0.5, color: 0xb5a642, label: 'the brass rod stone' },
    { key: 'silver', x: 10.2, z: -6.5, height: 0.2, color: 0xc0c0c0, label: 'the silver rod stone' },
  ],
};

/**
 * The Great Storybook's pathway: six pads on the floor west of the dais, one per page, in the
 * registry's order (`great-storybook/pages.ts`). Each is hidden until its page is restored.
 * They answer nothing: they only reflect records that already exist.
 */
export const STORYBOOK_PATHWAY_GROUP: CastlePlatformGroup = {
  id: 'storybook-pathway',
  roomId: 'great-library',
  kind: 'PAGE_PATHWAY',
  purpose: 'A stepping stone appears for each page that flies back into the Great Storybook.',
  answers: false,
  // Serpentine, nearest the start first; the last two lie beside the dais.
  pads: [
    { key: 'p1', x: 9.4, z: -4.9, label: 'a page stone' },
    { key: 'p2', x: 9.4, z: -3.7, label: 'a page stone' },
    { key: 'p3', x: 10.3, z: -4.9, label: 'a page stone' },
    { key: 'p4', x: 10.3, z: -3.7, label: 'a page stone' },
    { key: 'p5', x: 11.2, z: -4.9, label: 'a page stone' },
    { key: 'p6', x: 11.2, z: -3.7, label: 'a page stone' },
  ],
};

// --- Setting Tower: the Observatory's star stones ------------------------------------------

/**
 * Two star stones. The tower is the most crowded room in the castle: the arrival zone, the three
 * window zones (each one is a `choose-setting` answer, so no stone may overlap one), the
 * telescope, the orrery and the checkpoint at its centre leave exactly two places a 0.8 m stone
 * fits (`castlePlatforms.test.ts` proves the clearances). The Observatory is flavour only by
 * design (`castleObservatory.ts`): nothing here grades, records or rewards, so these are just
 * stones to hop between while looking at the stars.
 */
export const OBSERVATORY_STAR_GROUP: CastlePlatformGroup = {
  id: 'observatory',
  roomId: 'setting-tower',
  kind: 'STAR_STONE',
  purpose: 'Flavour: hop onto the star stone while looking at the sky.',
  answers: false,
  pads: [
    // GE-072: the first stone (6.75, 7.45) was dropped. With the child's 0.37 m body (ADR-060) it
    // touched the tower checkpoint and the arrival through arch-tower, and no other spot in the
    // tower clears the window, chart and setting zones, the checkpoint and the door (scan in
    // docs/regions/storykeeper_castle_engine_integration.md section 8.3). Flavour only: nothing
    // depended on it.
    // SC-R05-03: 0.25 m west of where SC-JMP put it (8.95), so Professor Orion fits in the
    // corner behind it. Still clear of the cave window zone (ends x 8.2) by 0.1 m.
    { key: 's2', x: 8.7, z: 5.85, label: 'the second star stone' },
  ],
};

// --- Secret Chamber: the optional ledge -----------------------------------------------------

/** The ledge's key and the id of its view zone (the zone is a toast, never an interaction). */
export const CHAMBER_LEDGE_KEY = 'ledge';
export const CHAMBER_VIEW_ZONE_ID = 'view:chamber:ledge';
/** Read aloud when the child stands on the ledge. Observation only: nothing is granted or recorded. */
export const CHAMBER_VIEW_MESSAGE =
  'From up on the ledge, the whole chamber glows. What a lovely view!';

/**
 * WS-C: two low stepping stones to a ledge, for a child who likes to hop. Entirely optional
 * (nothing in the chamber needs it), it answers nothing, grants nothing and teaches nothing new.
 * The only reward is a view, a toast on the ledge. Sprouts see flat floor markers in the same
 * places. The ledge is the highest a castle pad may be (0.5 m).
 */
export const CHAMBER_LEDGE_GROUP: CastlePlatformGroup = {
  id: 'chamber',
  roomId: 'secret-chamber',
  kind: 'STEPPING_PAD',
  purpose: 'Optional: hop up two stones to a ledge with a view. Observation only; nothing is granted.',
  answers: false,
  sproutMarkers: true,
  pads: [
    { key: 's1', x: -13.5, z: -7.6, height: 0.2, color: 0x8f7bd9, label: 'the first chamber stone' },
    { key: 's2', x: -12.4, z: -7.3, height: 0.35, color: 0x6fd6c9, label: 'the second chamber stone' },
    { key: CHAMBER_LEDGE_KEY, x: -12.4, z: -6.0, height: 0.5, color: 0xb99cff, label: 'the ledge' },
  ],
};

/** Every group, in room order. */
export const CASTLE_PLATFORM_GROUPS: readonly CastlePlatformGroup[] = [
  STORY_HALL_STONE_GROUP,
  OBSERVATORY_STAR_GROUP,
  STUDIO_PAD_GROUP,
  LIBRARY_BOOK_GROUP,
  LIBRARY_PATTERN_GROUP,
  LIBRARY_MEASURE_GROUP,
  STORYBOOK_PATHWAY_GROUP,
  CHAMBER_LEDGE_GROUP,
];

// --- builders -------------------------------------------------------------------------------

const padTop = (group: CastlePlatformGroup, pad: CastlePad): number =>
  pad.height ?? CASTLE_PLATFORM_PRESETS[group.kind].height;

const padSize = (group: CastlePlatformGroup): number => CASTLE_PLATFORM_PRESETS[group.kind].size;

/** The footprint of a pad on the floor. */
export function padFootprint(group: CastlePlatformGroup, pad: CastlePad): RectZone {
  const half = padSize(group) / 2;
  return {
    id: padPlatformId(group.id, pad.key),
    minX: pad.x - half,
    maxX: pad.x + half,
    minZ: pad.z - half,
    maxZ: pad.z + half,
  };
}

/** The answer zone of a pad: exactly its footprint, so standing on the pad is standing in the zone. */
export function padZone(group: CastlePlatformGroup, pad: CastlePad): ZoneSpec {
  const footprint = padFootprint(group, pad);
  return { rect: { ...footprint, id: padZoneId(group.id, pad.key) } };
}

/** The requirement under which a storybook page's pathway pad is there. */
export function pageRequirement(page: StorybookPage): WorldRequirement {
  return page.source.kind === 'WORLD_CHANGE'
    ? { type: 'WORLD_CHANGE_PRESENT', changeKey: page.source.changeKey }
    : { type: 'DISCOVERY_PRESENT', discoveryId: page.source.discoveryId };
}

/** One solid, static, floor-standing pad for a group. */
export function buildPad(group: CastlePlatformGroup, pad: CastlePad): PlatformSpec {
  const preset = CASTLE_PLATFORM_PRESETS[group.kind];
  return {
    id: padPlatformId(group.id, pad.key),
    color: pad.color ?? preset.color,
    size: { width: preset.size, height: padTop(group, pad), depth: preset.size },
    position: { x: pad.x, y: 0, z: pad.z },
  };
}

/** The pathway pad for one page: hidden until the page's record exists, then there to stay. */
function buildPathwayPad(group: CastlePlatformGroup, pad: CastlePad, page: StorybookPage): PlatformSpec {
  const base = buildPad(group, pad);
  // A recorded world change raises `world:<changeKey>` on entry and live (the view does both), so
  // a page restored this visit gets its stone at once and one restored last week is there on
  // entry. The hidden bonus page is a discovery, which has no signal: it reads the world state.
  const activation: NonNullable<PlatformSpec['activation']> =
    page.source.kind === 'WORLD_CHANGE'
      ? { trigger: 'SIGNAL', source: worldSignalName(page.source.changeKey), hiddenUntilActive: true }
      : { trigger: 'WORLD_STATE', requirements: [pageRequirement(page)], hiddenUntilActive: true };
  return { ...base, activation };
}

/** The pages the pathway has a stone for, in order: one per registered page. */
export const PATHWAY_PAGES: readonly StorybookPage[] = STORYBOOK_PAGES;

/** The platforms of one group. The pathway builds one pad per page and never more than it has pages. */
export function buildGroupPlatforms(group: CastlePlatformGroup): PlatformSpec[] {
  if (group.id === STORYBOOK_PATHWAY_GROUP.id) {
    return group.pads.flatMap((pad, index) => {
      const page = PATHWAY_PAGES[index];
      return page ? [buildPathwayPad(group, pad, page)] : [];
    });
  }
  return group.pads.map((pad) => buildPad(group, pad));
}

/** The room's platforms: pure, so a test can rebuild them from modified groups. */
export function buildRoomPlatforms(
  roomId: string,
  groups: readonly CastlePlatformGroup[] = CASTLE_PLATFORM_GROUPS,
): PlatformSpec[] {
  return groups.filter((group) => group.roomId === roomId).flatMap(buildGroupPlatforms);
}

/** The whole castle's platforming for Pathfinders and Explorers: solid, jumpable pads. */
export function buildCastlePlatforming(
  groups: readonly CastlePlatformGroup[] = CASTLE_PLATFORM_GROUPS,
): PlatformingSpec {
  return { platforms: groups.flatMap(buildGroupPlatforms) };
}

/**
 * Sprouts (ages 3 to 4) get flat floor markers instead: pressure plates at the same places, with
 * no colliders (`platforms: []`). Only groups that answer a step have a marker; the same `pad:*`
 * zones still answer, so nothing needs the jump.
 */
export function buildSproutPlatforming(
  groups: readonly CastlePlatformGroup[] = CASTLE_PLATFORM_GROUPS,
): PlatformingSpec {
  const plates: PressurePlateSpec[] = groups
    .filter((group) => group.answers || group.sproutMarkers)
    .flatMap((group) =>
      group.pads.map((pad) => ({
        id: `castle-marker:${group.id}:${pad.key}`,
        position: { x: pad.x, z: pad.z },
        halfSize: padSize(group) / 2,
        color: pad.color ?? CASTLE_PLATFORM_PRESETS[group.kind].color,
      })),
    );
  return { platforms: [], pressurePlates: plates };
}

/** The answer zones of every group that answers a step. */
export function buildPadZones(
  groups: readonly CastlePlatformGroup[] = CASTLE_PLATFORM_GROUPS,
): ZoneSpec[] {
  return groups.filter((group) => group.answers).flatMap((group) => group.pads.map((pad) => padZone(group, pad)));
}

/** The ledge's view: a plain narration zone over the ledge, for every band (Sprouts walk into it on the floor). */
export const CASTLE_VIEW_ZONES: readonly ZoneSpec[] = [
  {
    rect: {
      ...padFootprint(
        CHAMBER_LEDGE_GROUP,
        CHAMBER_LEDGE_GROUP.pads.find((pad) => pad.key === CHAMBER_LEDGE_KEY)!,
      ),
      id: CHAMBER_VIEW_ZONE_ID,
    },
    enterMessage: CHAMBER_VIEW_MESSAGE,
  },
];

export const CASTLE_PLATFORMING: PlatformingSpec = buildCastlePlatforming();
export const CASTLE_PLATFORMING_SPROUT: PlatformingSpec = buildSproutPlatforming();
export const CASTLE_PAD_ZONES: readonly ZoneSpec[] = buildPadZones();

// --- registry: which adventure has which platform configuration -----------------------------

/**
 * Every primary castle adventure and the platform group that gives it jumping. A new castle
 * adventure with no entry here fails `castlePlatforms.test.ts`, unless the inventory document
 * lists it with an owner-approved exception.
 */
export interface CastlePlatformRegistration {
  adventureSlug: string;
  groupId: string;
  /** More than one group may serve an adventure (chapter 2 has the pattern and the rods). */
  alsoGroupIds?: readonly string[];
}

export const CASTLE_PLATFORM_REGISTRY: readonly CastlePlatformRegistration[] = [
  { adventureSlug: 'the-storykeepers-tale', groupId: STORY_HALL_STONE_GROUP.id },
  { adventureSlug: 'quills-picture-story', groupId: STORY_HALL_STONE_GROUP.id },
  { adventureSlug: 'the-painted-words', groupId: STUDIO_PAD_GROUP.id },
  { adventureSlug: 'the-painted-words-again', groupId: STUDIO_PAD_GROUP.id },
  { adventureSlug: 'secret-door-chapter-1-three-clues', groupId: LIBRARY_BOOK_GROUP.id },
  {
    adventureSlug: 'secret-door-chapter-2-pattern-lock',
    groupId: LIBRARY_PATTERN_GROUP.id,
    alsoGroupIds: [LIBRARY_MEASURE_GROUP.id],
  },
];

/** The platform group ids that serve this adventure, or an empty list when it has none. */
export function platformGroupsForAdventure(adventureSlug: string): readonly string[] {
  const entry = CASTLE_PLATFORM_REGISTRY.find((candidate) => candidate.adventureSlug === adventureSlug);
  return entry ? [entry.groupId, ...(entry.alsoGroupIds ?? [])] : [];
}
