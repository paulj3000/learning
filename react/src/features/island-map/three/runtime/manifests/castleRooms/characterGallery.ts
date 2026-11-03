import { box, type RoomVisuals } from './castleVisualKit';

/**
 * The Character Gallery's look (SC-R02-04b): the Hall of Heroes. Honey
 * planks, deep green plaster, a crimson runner, and a brass plaque under each
 * portrait. The room's choice is made by standing in front of a portrait
 * (SC-10), so nothing here stands in front of one: the portrait zones
 * (z 8.6 to 9.6) and the arrival zone (z 6.6 to 7.6) stay open floor, and
 * the plaques are flat and un-solid.
 */

const BRASS = 0xc9a24a;

/** The three portraits' x centres, matching `GALLERY_PORTRAIT_SPOTS`. */
const PORTRAIT_X = { puppy: -6.5, dragon: -4.5, fox: -2.5 } as const;
/** The north wall's room-facing plane is z = 9.75; plaques stand proud of its trim. */
const PLAQUE_NEAR = 9.64;
const PLAQUE_FAR = 9.7;

export const CHARACTER_GALLERY_VISUALS: RoomVisuals = {
  look: {
    roomId: 'character-gallery',
    floor: 'planks-honey',
    walls: 'plaster-gallery',
    ceiling: 'plaster-hall',
    trim: 'trim-dark-wood',
    mood: { color: 0xffe6bf, priority: 3 },
    // A crimson runner from the archway toward the portraits, stopping short of their zones.
    inlays: [
      {
        id: 'runner',
        materialId: 'carpet-hall-rug',
        area: { minX: -6.9, maxX: -2.1, minZ: 6.5, maxZ: 8.3 },
      },
    ],
    // Faint gold dust in the spotlight warmth.
    motes: { color: 0xffe2a0, count: 16, minY: 0.5, maxY: 2.6, size: 0.04, seed: 9 },
  },
  materials: [
    {
      id: 'plaster-gallery',
      pattern: 'PLASTER',
      baseColor: 0x2f5d46,
      accentColor: 0x244b38,
      roughness: 0.95,
      metersPerRepeat: 3,
      seed: 51,
    },
  ],
  decor: Object.entries(PORTRAIT_X).map(([name, x]) =>
    box(
      `castle-gallery-plaque-${name}`,
      BRASS,
      x - 0.35,
      x + 0.35,
      PLAQUE_NEAR,
      PLAQUE_FAR,
      0.75,
      0.87,
    ),
  ),
  colliders: [],
};
