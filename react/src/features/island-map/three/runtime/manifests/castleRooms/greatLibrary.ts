import { WALL_HEIGHT } from '../../../sceneKit';
import { box, solid, type RoomVisuals } from './castleVisualKit';

/**
 * The Great Library's look (SC-R02-02): dark wood, ashlar, candle dust. The
 * darkest room in the castle, and still readable at a glance.
 */

const DAIS_GOLD = 0xb08a45;
const DAIS_GOLD_BRIGHT = 0xd8b45a;
const BEAM_WOOD = 0x3b2614;
const CANDLE_WAX = 0xf3e6c3;
const CANDLE_FLAME = 0xffc45a;

/**
 * Where the Great Storybook rests in the Great Library (`docs/regions/
 * STORYKEEPER_CASTLE_REBOOT_ROADMAP.md` section 2.1). SC-R02-02 builds the
 * empty dais; SC-R04 puts the book and its pages on it. Chosen from the one
 * stretch of open floor the authored puzzle spots leave: clear of the east
 * shelves, both reading tables, the clue spots and the secret door's wall.
 */
export const STORYBOOK_DAIS = {
  x: 12.9,
  z: -4.55,
  /** Half-extent of the lower tier; the upper tier is 0.7 of it. */
  half: 1,
  tierHeight: 0.12,
} as const;

const UPPER_HALF = STORYBOOK_DAIS.half * 0.7;
const BEAM_Z = [-3.5, -6, -8.5] as const;
const BEAM_HALF_WIDTH = 0.15;
const BEAM_BOTTOM = WALL_HEIGHT - 0.25;
/** Library reading tables are 0.8 m high (`READING_TABLE_HALF` in the manifest). */
const TABLE_TOP = 0.8;
const CANDLE_SPOTS = [
  { id: 'castle-candle-a', x: 7.55, z: -5.2 },
  { id: 'castle-candle-b', x: 11.0, z: -7.2 },
] as const;

export const GREAT_LIBRARY_VISUALS: RoomVisuals = {
  look: {
    roomId: 'great-library',
    floor: 'planks-library',
    walls: 'ashlar-library',
    ceiling: 'planks-library',
    trim: 'trim-dark-wood',
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
      'castle-dais-tier-1',
      DAIS_GOLD,
      STORYBOOK_DAIS.x - STORYBOOK_DAIS.half,
      STORYBOOK_DAIS.x + STORYBOOK_DAIS.half,
      STORYBOOK_DAIS.z - STORYBOOK_DAIS.half,
      STORYBOOK_DAIS.z + STORYBOOK_DAIS.half,
      0,
      STORYBOOK_DAIS.tierHeight,
    ),
    box(
      'castle-dais-tier-2',
      DAIS_GOLD_BRIGHT,
      STORYBOOK_DAIS.x - UPPER_HALF,
      STORYBOOK_DAIS.x + UPPER_HALF,
      STORYBOOK_DAIS.z - UPPER_HALF,
      STORYBOOK_DAIS.z + UPPER_HALF,
      STORYBOOK_DAIS.tierHeight,
      STORYBOOK_DAIS.tierHeight * 2,
    ),
    // Three ceiling beams across the library: they break up the long dark ceiling and cannot be walked into.
    ...BEAM_Z.map((z, index) =>
      box(
        `castle-library-beam-${index + 1}`,
        BEAM_WOOD,
        5.3,
        14.7,
        z - BEAM_HALF_WIDTH,
        z + BEAM_HALF_WIDTH,
        BEAM_BOTTOM,
        WALL_HEIGHT,
      ),
    ),
    // A candle on each reading table, off to the side of anything the child picks up.
    ...CANDLE_SPOTS.flatMap((spot) => [
      box(
        `${spot.id}-wax`,
        CANDLE_WAX,
        spot.x - 0.03,
        spot.x + 0.03,
        spot.z - 0.03,
        spot.z + 0.03,
        TABLE_TOP,
        TABLE_TOP + 0.14,
      ),
      box(
        `${spot.id}-flame`,
        CANDLE_FLAME,
        spot.x - 0.015,
        spot.x + 0.015,
        spot.z - 0.015,
        spot.z + 0.015,
        TABLE_TOP + 0.14,
        TABLE_TOP + 0.19,
      ),
    ]),
  ],
  // The dais is solid, so the child walks around it. A low step is still a wall to a first-person controller.
  colliders: [
    solid(
      'storybook-dais',
      STORYBOOK_DAIS.x - STORYBOOK_DAIS.half,
      STORYBOOK_DAIS.x + STORYBOOK_DAIS.half,
      STORYBOOK_DAIS.z - STORYBOOK_DAIS.half,
      STORYBOOK_DAIS.z + STORYBOOK_DAIS.half,
      STORYBOOK_DAIS.tierHeight * 2,
    ),
  ],
};
