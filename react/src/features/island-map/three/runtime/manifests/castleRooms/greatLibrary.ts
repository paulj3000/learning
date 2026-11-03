import { WALL_HEIGHT } from '../../../sceneKit';
import { box, solid, type RoomVisuals } from './castleVisualKit';

/**
 * The Great Library's look (SC-R02-02): dark wood, ashlar, candle dust. The
 * darkest room in the castle, and still readable at a glance.
 */

const DAIS_GOLD = 0xb08a45;
const BEAM_WOOD = 0x3b2614;
const CANDLE_WAX = 0xf3e6c3;

/**
 * Where the Great Storybook rests in the Great Library (`docs/regions/
 * STORYKEEPER_CASTLE_REBOOT_ROADMAP.md` section 2.1). SC-R02-02 built the
 * empty dais; SC-R04-03 puts the book on it. Chosen from the one stretch of
 * open floor the authored puzzle spots leave: clear of the east shelves, both
 * reading tables, the clue spots and the secret door's wall.
 *
 * One 0.24 m box, solid: the two tiers it replaced are merged to pay for the
 * book, because the library is at its scenery baseline (160 of 160).
 */
export const STORYBOOK_DAIS = {
  x: 12.9,
  z: -4.55,
  /** Half-extent of the dais. */
  half: 1,
  height: 0.24,
} as const;

/**
 * The Great Storybook's parts (SC-R04-03). All are built once, static, as ordinary
 * `BOX` decor; what the child's progress changes is their *state*, set live by the
 * castle-tale scene (`showStorybook`), the way the portraits and the secret door
 * already are. So the book costs six scenery items and no light, material or collider,
 * and the render code owns no rule: it only draws what the records say.
 */
export const STORYBOOK_PART_IDS = {
  cover: 'castle-storybook-cover',
  /** The open pages, shown once any page is back. */
  pages: 'castle-storybook-pages',
  /** Four flat leaves along the dais front: up to three required pages and the hidden bonus. */
  slots: [
    'castle-storybook-slot-1',
    'castle-storybook-slot-2',
    'castle-storybook-slot-3',
    'castle-storybook-slot-4',
  ],
} as const;

export const STORYBOOK_COLOURS = {
  coverTorn: 0x7a1f2f,
  coverWhole: 0xd8b45a,
  pages: 0xf3e6c3,
  slotMissing: 0x6b6358,
  slotBack: 0xf2d680,
} as const;

const SLOT_X_OFFSETS = [-0.6, -0.2, 0.2, 0.6] as const;
const SLOT_HALF_WIDTH = 0.14;

const BEAM_Z = -6;
const BEAM_HALF_WIDTH = 0.15;
const BEAM_BOTTOM = WALL_HEIGHT - 0.25;
/** Library reading tables are 0.8 m high (`READING_TABLE_HALF` in the manifest). */
const TABLE_TOP = 0.8;
const CANDLE_SPOTS = [
  { id: 'castle-candle-a', x: 7.55, z: -5.2 },
  { id: 'castle-candle-b', x: 11.0, z: -7.2 },
] as const;

const DAIS_TOP = STORYBOOK_DAIS.height;

export const GREAT_LIBRARY_VISUALS: RoomVisuals = {
  look: {
    roomId: 'great-library',
    floor: 'planks-library',
    walls: 'ashlar-library',
    ceiling: 'planks-library',
    trim: 'trim-dark-wood',
    mood: { color: 0xffd9a0, priority: 8 },
    motes: { color: 0xffe9a8, count: 40, minY: 0.4, maxY: 2.8, size: 0.045, seed: 7 },
  },
  materials: [
    {
      id: 'planks-library',
      pattern: 'PLANKS',
      baseColor: 0x5b3b25,
      accentColor: 0x3e2717,
      roughness: 0.8,
      metersPerRepeat: 1.6,
      seed: 21,
    },
    {
      id: 'ashlar-library',
      pattern: 'ASHLAR',
      baseColor: 0x8c7f6e,
      accentColor: 0x62574a,
      roughness: 0.9,
      metersPerRepeat: 2,
      seed: 22,
    },
  ],
  decor: [
    box(
      'castle-dais',
      DAIS_GOLD,
      STORYBOOK_DAIS.x - STORYBOOK_DAIS.half,
      STORYBOOK_DAIS.x + STORYBOOK_DAIS.half,
      STORYBOOK_DAIS.z - STORYBOOK_DAIS.half,
      STORYBOOK_DAIS.z + STORYBOOK_DAIS.half,
      0,
      STORYBOOK_DAIS.height,
    ),
    // The Great Storybook: a closed cover, the open pages (hidden until a page is back), and four
    // flat leaves along the front for the pages. Their colours and visibility are the scene's.
    box(
      STORYBOOK_PART_IDS.cover,
      STORYBOOK_COLOURS.coverTorn,
      STORYBOOK_DAIS.x - 0.5,
      STORYBOOK_DAIS.x + 0.5,
      STORYBOOK_DAIS.z - 0.3,
      STORYBOOK_DAIS.z + 0.35,
      DAIS_TOP,
      DAIS_TOP + 0.06,
    ),
    box(
      STORYBOOK_PART_IDS.pages,
      STORYBOOK_COLOURS.pages,
      STORYBOOK_DAIS.x - 0.44,
      STORYBOOK_DAIS.x + 0.44,
      STORYBOOK_DAIS.z - 0.24,
      STORYBOOK_DAIS.z + 0.29,
      DAIS_TOP + 0.06,
      DAIS_TOP + 0.1,
    ),
    ...STORYBOOK_PART_IDS.slots.map((id, index) =>
      box(
        id,
        STORYBOOK_COLOURS.slotMissing,
        STORYBOOK_DAIS.x + SLOT_X_OFFSETS[index] - SLOT_HALF_WIDTH,
        STORYBOOK_DAIS.x + SLOT_X_OFFSETS[index] + SLOT_HALF_WIDTH,
        STORYBOOK_DAIS.z + 0.55,
        STORYBOOK_DAIS.z + 0.83,
        DAIS_TOP,
        DAIS_TOP + 0.02,
      ),
    ),
    // One ceiling beam across the middle of the library, to break up the long dark ceiling.
    box(
      'castle-library-beam-1',
      BEAM_WOOD,
      5.3,
      14.7,
      BEAM_Z - BEAM_HALF_WIDTH,
      BEAM_Z + BEAM_HALF_WIDTH,
      BEAM_BOTTOM,
      WALL_HEIGHT,
    ),
    // A candle on each reading table, off to the side of anything the child picks up.
    ...CANDLE_SPOTS.map((spot) =>
      box(
        `${spot.id}-wax`,
        CANDLE_WAX,
        spot.x - 0.03,
        spot.x + 0.03,
        spot.z - 0.03,
        spot.z + 0.03,
        TABLE_TOP,
        TABLE_TOP + 0.17,
      ),
    ),
  ],
  // The Storybook's glow: the focal point of the darkest room. Violet-gold, so it reads as magic, not as a lamp.
  lights: [
    {
      id: 'light:storybook-dais',
      kind: 'POINT',
      position: { x: STORYBOOK_DAIS.x, y: 1.4, z: STORYBOOK_DAIS.z },
      color: 0xd9c6ff,
      intensity: 3,
      decay: 1.8,
      priority: 6,
    },
  ],
  // The dais is solid, so the child walks around it. A low step is still a wall to a first-person controller.
  colliders: [
    solid(
      'storybook-dais',
      STORYBOOK_DAIS.x - STORYBOOK_DAIS.half,
      STORYBOOK_DAIS.x + STORYBOOK_DAIS.half,
      STORYBOOK_DAIS.z - STORYBOOK_DAIS.half,
      STORYBOOK_DAIS.z + STORYBOOK_DAIS.half,
      STORYBOOK_DAIS.height,
    ),
  ],
};
