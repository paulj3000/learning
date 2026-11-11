import { box, type RoomVisuals } from './castleVisualKit';

/**
 * The East Corridor's look (SC-R02-04f): the spine to the deep rooms, and
 * the dimmest passage. Flagstone, grey ashlar, a long crimson runner,
 * brass sconces down both walls, and a framed island map on the west wall
 * that SC-R04 and SC-R03-06 will mark. Everything here is flat against a
 * wall or lying on the floor, so the corridor gains no collider.
 *
 * The corridor is x 3 to 5 and z -10 to 10; its inner wall planes are
 * x = 3.25 and 4.75. Its seven archways (the hub at x = 3, and the tower,
 * studio and library at x = 5) are kept clear.
 */

const BRASS = 0xc9a24a;
const FLAME = 0xffc45a;
const FRAME_WOOD = 0x5a3b25;
const PARCHMENT = 0xe8d8bc;

/** Wall sconces, by wall, clear of the corridor's archways (x = 5: z 6.5 to 8.5, 0 to 2, -7 to -5; x = 3: z -1 to 1). */
const WEST_SCONCES = [-8, -5.5, 4.5, 8.5] as const;
const EAST_SCONCES = [-9, -3.5, 3.8, 9.3] as const;

/** The framed island map on the west wall. Exported so the wayfinding tasks read its place from one source. */
export const CORRIDOR_MAP = { x: 3.42, minZ: -3.7, maxZ: -1.8, minY: 0.9, maxY: 2.2 } as const;

const sconce = (id: string, side: 'w' | 'e', z: number) => {
  const [near, far, flameNear, flameFar] =
    side === 'w' ? [3.29, 3.4, 3.32, 3.37] : [4.6, 4.71, 4.63, 4.68];
  return [
    box(`${id}-bracket`, BRASS, near, far, z - 0.06, z + 0.06, 1.7, 1.95),
    box(`${id}-flame`, FLAME, flameNear, flameFar, z - 0.03, z + 0.03, 1.95, 2.1),
  ];
};

export const EAST_CORRIDOR_VISUALS: RoomVisuals = {
  look: {
    roomId: 'east-corridor',
    floor: 'flagstone-entry',
    walls: 'ashlar-library',
    ceiling: 'plaster-entry',
    trim: 'trim-dark-wood',
    mood: { color: 0xffcf9a, priority: 5 },
    // A runner the whole length, one metre wide, down the middle.
    inlays: [
      {
        id: 'runner',
        materialId: 'carpet-hall-rug',
        area: { minX: 3.5, maxX: 4.5, minZ: -9.5, maxZ: 9.5 },
      },
    ],
  },
  materials: [],
  decor: [
    ...WEST_SCONCES.flatMap((z, index) => sconce(`castle-corridor-sconce-w${index + 1}`, 'w', z)),
    ...EAST_SCONCES.flatMap((z, index) => sconce(`castle-corridor-sconce-e${index + 1}`, 'e', z)),
    box(
      'castle-corridor-map-frame',
      FRAME_WOOD,
      3.29,
      3.38,
      CORRIDOR_MAP.minZ,
      CORRIDOR_MAP.maxZ,
      CORRIDOR_MAP.minY,
      CORRIDOR_MAP.maxY,
    ),
    box(
      'castle-corridor-map-parchment',
      PARCHMENT,
      3.33,
      CORRIDOR_MAP.x,
      CORRIDOR_MAP.minZ + 0.15,
      CORRIDOR_MAP.maxZ - 0.15,
      CORRIDOR_MAP.minY + 0.15,
      CORRIDOR_MAP.maxY - 0.15,
    ),
  ],
  colliders: [],
};
