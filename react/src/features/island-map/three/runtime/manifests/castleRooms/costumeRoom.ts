import { box, solid, type RoomVisuals } from './castleVisualKit';

/**
 * The Costume Room's look (SC-R02-04c): plum plaster, a patterned carpet,
 * brass and a mirror. The three costume racks the region authored in Phase
 * 14 and never placed (`COSTUME_RACK_SPOTS`) are finally stood up, each one
 * solid on its authored spot. Their `entityId`s are decorative, never
 * interactive: the room is flavour only today, and SC-R07 will use the
 * pedestals the roadmap plans here.
 */

const POST_WOOD = 0x6b4a2a;
const BRASS = 0xc9a24a;
const GLASS = 0xcfe6f0;
const GARMENTS = [0xc0392b, 0x2f6fb0, 0x4c9a5a] as const;

/** The racks' centres, matching `COSTUME_RACK_SPOTS`. */
export const COSTUME_RACKS = [
  { id: 'a', x: -6.5, z: -8.5 },
  { id: 'b', x: -4.5, z: -8.5 },
  { id: 'c', x: -2.5, z: -8.5 },
] as const;

const RACK_HALF_WIDTH = 0.7;
const RACK_HALF_DEPTH = 0.2;
const RACK_HEIGHT = 1.7;

const rack = (id: string, x: number, z: number) => [
  box(
    `castle-rack-${id}-post-w`,
    POST_WOOD,
    x - RACK_HALF_WIDTH,
    x - RACK_HALF_WIDTH + 0.06,
    z - 0.03,
    z + 0.03,
    0,
    RACK_HEIGHT,
  ),
  box(
    `castle-rack-${id}-post-e`,
    POST_WOOD,
    x + RACK_HALF_WIDTH - 0.06,
    x + RACK_HALF_WIDTH,
    z - 0.03,
    z + 0.03,
    0,
    RACK_HEIGHT,
  ),
  box(
    `castle-rack-${id}-bar`,
    BRASS,
    x - RACK_HALF_WIDTH,
    x + RACK_HALF_WIDTH,
    z - 0.03,
    z + 0.03,
    RACK_HEIGHT - 0.06,
    RACK_HEIGHT,
  ),
  ...GARMENTS.map((color, index) =>
    box(
      `castle-rack-${id}-garment-${index + 1}`,
      color,
      x - 0.55 + index * 0.4,
      x - 0.25 + index * 0.4,
      z - 0.1,
      z + 0.1,
      0.55,
      RACK_HEIGHT - 0.08,
    ),
  ),
];

export const COSTUME_ROOM_VISUALS: RoomVisuals = {
  look: {
    roomId: 'costume-room',
    floor: 'carpet-costume',
    walls: 'plaster-costume',
    ceiling: 'plaster-hall',
    trim: 'trim-dark-wood',
  },
  materials: [
    {
      id: 'carpet-costume',
      pattern: 'CARPET',
      baseColor: 0x6a2c5b,
      accentColor: 0xd8b45a,
      roughness: 1,
      metersPerRepeat: 1.2,
      seed: 61,
    },
    {
      id: 'plaster-costume',
      pattern: 'PLASTER',
      baseColor: 0x7a3f6a,
      accentColor: 0x5f2f52,
      roughness: 0.95,
      metersPerRepeat: 3,
      seed: 62,
    },
  ],
  decor: [
    ...COSTUME_RACKS.flatMap((r) => rack(r.id, r.x, r.z)),
    // A mirror on the west wall: a brass frame and glass, proud of the trim. Flat, so never solid.
    box('castle-mirror-frame', BRASS, -7.7, -7.62, -8.4, -7.0, 0.5, 2.25),
    box('castle-mirror-glass', GLASS, -7.66, -7.58, -8.3, -7.1, 0.6, 2.15),
  ],
  colliders: COSTUME_RACKS.map((r) =>
    solid(
      `costume-rack-${r.id}`,
      r.x - RACK_HALF_WIDTH,
      r.x + RACK_HALF_WIDTH,
      r.z - RACK_HALF_DEPTH,
      r.z + RACK_HALF_DEPTH,
      RACK_HEIGHT,
    ),
  ),
};
