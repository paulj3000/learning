import { box, solid, type RoomVisuals } from './castleVisualKit';

/**
 * The Illustration Studio's look (SC-R02-04e): bright, neutral and busy. Honey
 * planks, cream plaster, a paint table with four pots, and three framed
 * drawings on the east wall. The easel (`studio-easel`, x 7.5, z 1) and its
 * zone (x 6.5 to 8.5, z 0 to 2) are the room's point, so the table stands
 * in the south-east corner and everything else is flat on a wall.
 */

const WOOD = 0x8f6636;
const TABLE_TOP = 0xb98a50;
const POTS = [0xd64545, 0x3f7fd0, 0xf2c94c, 0x5fae6b] as const;
const FRAME_COLOURS = [0xf2c94c, 0x4a7ac2, 0x5fae6b] as const;
const PARCHMENT = 0xe8d8bc;

/** The paint table's centre and half-extent. East of the easel zone, which ends at x = 8.5. */
export const PAINT_TABLE = { x: 9.1, z: 2.0, halfX: 0.4, halfZ: 0.6, height: 0.8 } as const;

/** Drawings on the east wall (its plane is x = 9.75), above the table's height. */
const DRAWING_Z = [-0.3, 0.7, 1.9] as const;

export const ILLUSTRATION_STUDIO_VISUALS: RoomVisuals = {
  look: {
    roomId: 'illustration-studio',
    floor: 'planks-honey',
    walls: 'plaster-entry',
    ceiling: 'plaster-entry',
    trim: 'trim-dark-wood',
  },
  materials: [],
  decor: [
    box(
      'castle-paint-table-body',
      WOOD,
      PAINT_TABLE.x - PAINT_TABLE.halfX,
      PAINT_TABLE.x + PAINT_TABLE.halfX,
      PAINT_TABLE.z - PAINT_TABLE.halfZ,
      PAINT_TABLE.z + PAINT_TABLE.halfZ,
      0,
      PAINT_TABLE.height - 0.08,
    ),
    box(
      'castle-paint-table-top',
      TABLE_TOP,
      PAINT_TABLE.x - PAINT_TABLE.halfX,
      PAINT_TABLE.x + PAINT_TABLE.halfX,
      PAINT_TABLE.z - PAINT_TABLE.halfZ,
      PAINT_TABLE.z + PAINT_TABLE.halfZ,
      PAINT_TABLE.height - 0.08,
      PAINT_TABLE.height,
    ),
    ...POTS.map((color, index) =>
      box(
        `castle-paint-pot-${index + 1}`,
        color,
        PAINT_TABLE.x - 0.28 + index * 0.18,
        PAINT_TABLE.x - 0.16 + index * 0.18,
        PAINT_TABLE.z - 0.08,
        PAINT_TABLE.z + 0.04,
        PAINT_TABLE.height,
        PAINT_TABLE.height + 0.08,
      ),
    ),
    ...DRAWING_Z.flatMap((z, index) => [
      box(
        `castle-drawing-${index + 1}-frame`,
        FRAME_COLOURS[index],
        9.64,
        9.7,
        z - 0.4,
        z + 0.4,
        1.4,
        2.2,
      ),
      box(
        `castle-drawing-${index + 1}-paper`,
        PARCHMENT,
        9.6,
        9.66,
        z - 0.32,
        z + 0.32,
        1.48,
        2.12,
      ),
    ]),
  ],
  colliders: [
    solid(
      'paint-table',
      PAINT_TABLE.x - PAINT_TABLE.halfX,
      PAINT_TABLE.x + PAINT_TABLE.halfX,
      PAINT_TABLE.z - PAINT_TABLE.halfZ,
      PAINT_TABLE.z + PAINT_TABLE.halfZ,
      PAINT_TABLE.height,
    ),
  ],
};
