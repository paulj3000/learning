import { box, solid, type RoomVisuals } from './castleVisualKit';

/**
 * The Entry Hall's look (SC-R02-03): the castle's first impression. Warm
 * ashlar and flagstone, a blue and gold floor medallion where the child
 * arrives, four columns, four banners, and a framed blank mural that the
 * Great Storybook's restored pages fill in SC-R04.
 *
 * The room is x -16 to -9 and z -3 to 3; its inner wall faces are at
 * x = -15.75 and -9.25 and z = +-2.75. The castle doors, the carpet to
 * Quill and the arrival zones are untouched; every piece of decor here
 * keeps clear of the carpet line (z = 0) and of both arrival zones, which
 * `storykeeperCastleVisuals.test.ts` checks by walking the castle.
 */

const STONE = 0xcbbfa8;
const STONE_SHADE = 0xb3a68d;
const BANNER_BLUE = 0x2c4ea0;
const BANNER_GOLD = 0xd8b45a;
const FRAME_WOOD = 0x5a3b25;
const PARCHMENT = 0xe8d8bc;

/**
 * The blank mural that restored Storybook pages will fill in SC-R04.
 * Exported so that task reads the frame's place from one source. Centred on
 * the north wall, facing south into the room.
 */
export const ENTRY_MURAL = {
  x: -12.4,
  /** Where the parchment's visible face sits. */
  z: 2.58,
  halfWidth: 1.2,
  minY: 1,
  maxY: 2.3,
} as const;

const PILLAR_X = [-13.8, -10.8] as const;
const PILLAR_Z = [-2, 2] as const;
const PILLARS = PILLAR_X.flatMap((x) =>
  PILLAR_Z.map((z) => ({
    id: `castle-entry-pillar-${x < -12 ? 'w' : 'e'}${z < 0 ? 's' : 'n'}`,
    x,
    z,
  })),
);

/** Banner x ranges, hung either side of the arrival, on both long walls. */
const BANNER_X = [
  { id: 'w', minX: -15.3, maxX: -14.5 },
  { id: 'e', minX: -10.6, maxX: -9.8 },
] as const;
/** A banner stands this far off the wall's room-facing plane, behind the trim and the wall surface. */
const BANNER_NEAR = 2.6;
const BANNER_FAR = 2.66;

const pillar = (id: string, x: number, z: number) => [
  box(`${id}-base`, STONE_SHADE, x - 0.35, x + 0.35, z - 0.35, z + 0.35, 0, 0.22),
  box(`${id}-shaft`, STONE, x - 0.25, x + 0.25, z - 0.25, z + 0.25, 0.22, 2.78),
  box(`${id}-cap`, STONE_SHADE, x - 0.35, x + 0.35, z - 0.35, z + 0.35, 2.78, 3),
];

const banner = (id: string, side: 'n' | 's', minX: number, maxX: number) => {
  const near = side === 'n' ? BANNER_NEAR : -BANNER_FAR;
  const far = side === 'n' ? BANNER_FAR : -BANNER_NEAR;
  return [
    box(`${id}-cloth`, BANNER_BLUE, minX, maxX, near, far, 1, 2.7),
    box(`${id}-hem`, BANNER_GOLD, minX - 0.04, maxX + 0.04, near - 0.02, far, 1, 1.12),
    box(`${id}-rail`, BANNER_GOLD, minX - 0.04, maxX + 0.04, near - 0.02, far, 2.62, 2.7),
  ];
};

export const ENTRY_HALL_VISUALS: RoomVisuals = {
  look: {
    roomId: 'entry-hall',
    floor: 'flagstone-entry',
    walls: 'ashlar-entry',
    ceiling: 'plaster-entry',
    trim: 'trim-dark-wood',
    mood: { color: 0xfff0d6, priority: 4 },
    // A medallion where the child arrives. It lies under the carpet, which stays 1 cm above it.
    inlays: [
      {
        id: 'medallion',
        materialId: 'tiles-entry-inlay',
        area: { minX: -13.4, maxX: -11, minZ: -1.7, maxZ: 1.7 },
      },
    ],
    // Daylight dust drifting in from the doors.
    motes: { color: 0xfff4d6, count: 24, minY: 0.3, maxY: 2.6, size: 0.04, seed: 3 },
  },
  materials: [
    {
      id: 'flagstone-entry',
      pattern: 'FLAGSTONE',
      baseColor: 0xb5a58a,
      accentColor: 0x7f7058,
      roughness: 0.85,
      metersPerRepeat: 2,
      seed: 31,
    },
    {
      id: 'ashlar-entry',
      pattern: 'ASHLAR',
      baseColor: 0xc2a77f,
      accentColor: 0x8d7650,
      roughness: 0.9,
      metersPerRepeat: 2,
      seed: 32,
    },
    {
      id: 'plaster-entry',
      pattern: 'PLASTER',
      baseColor: 0xe3d6bc,
      accentColor: 0xc9b998,
      roughness: 0.95,
      metersPerRepeat: 3,
      seed: 33,
    },
    {
      id: 'tiles-entry-inlay',
      pattern: 'TILES',
      baseColor: BANNER_BLUE,
      accentColor: BANNER_GOLD,
      roughness: 0.6,
      metersPerRepeat: 1,
      seed: 34,
    },
  ],
  decor: [
    ...PILLARS.flatMap((p) => pillar(p.id, p.x, p.z)),
    ...BANNER_X.flatMap((b) => [
      ...banner(`castle-entry-banner-n${b.id}`, 'n', b.minX, b.maxX),
      ...banner(`castle-entry-banner-s${b.id}`, 's', b.minX, b.maxX),
    ]),
    // The mural: a wooden frame and a blank parchment, proud of it, on the north wall.
    box(
      'castle-entry-mural-frame',
      FRAME_WOOD,
      ENTRY_MURAL.x - ENTRY_MURAL.halfWidth - 0.2,
      ENTRY_MURAL.x + ENTRY_MURAL.halfWidth + 0.2,
      2.62,
      2.67,
      ENTRY_MURAL.minY - 0.15,
      ENTRY_MURAL.maxY + 0.15,
    ),
    box(
      'castle-entry-mural-parchment',
      PARCHMENT,
      ENTRY_MURAL.x - ENTRY_MURAL.halfWidth,
      ENTRY_MURAL.x + ENTRY_MURAL.halfWidth,
      ENTRY_MURAL.z,
      2.64,
      ENTRY_MURAL.minY,
      ENTRY_MURAL.maxY,
    ),
  ],
  colliders: PILLARS.map((p) =>
    solid(p.id.replace('castle-', ''), p.x - 0.35, p.x + 0.35, p.z - 0.35, p.z + 0.35, 3),
  ),
};
