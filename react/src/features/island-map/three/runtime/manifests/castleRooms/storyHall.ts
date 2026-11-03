import { CASTLE_DOORS, arrivalIn, type CastleDoor } from '../../../castleLayout';
import type { ScenerySpec } from '../../locationManifest';
import { box, solid, type RoomVisuals } from './castleVisualKit';

/**
 * The Story Hall's look (SC-R02-04a): the hub, and the brightest room. Honey
 * wood, warm plaster over an ashlar wainscot, crimson and gold. The hearth
 * gets a stone surround, a glowing fire and a rug; three crimson banners hang
 * on the north wall.
 *
 * Two things are left alone on purpose. The mantel's three carved words
 * (beat 5) hang at y = 2.2 on the south wall, so the hearth's jambs stop at
 * y = 2.0 and nothing covers that wall above them. And the carpet line to
 * Keeper Quill (z = 0) stays clear.
 */

const STONE = 0x8c7f6e;
const STONE_LIGHT = 0xa39580;
const FIRE = 0xff9c3a;
const FIRE_BRIGHT = 0xffcf6a;
const CRIMSON = 0x8e1f2f;
const GOLD = 0xd8b45a;

/** The south wall's room-facing plane is z = -5.75; decor tucks 1 cm into the wall behind it. */
const WALL_Z = -5.75;
const TUCKED_Z = WALL_Z - 0.01;
const HEARTH_HALF_WIDTH = 1.5;
const HEARTH_DEPTH_Z = -5;
const JAMB_TOP = 2;

/** Banner x ranges on the north wall, leaving the gallery archway (x -5.5 to -3.5) clear. */
const NORTH_BANNERS = [
  { id: 'a', minX: -7.4, maxX: -6.6 },
  { id: 'b', minX: -2.4, maxX: -1.6 },
  { id: 'c', minX: 0.4, maxX: 1.2 },
] as const;

/**
 * The hub's door cues (SC-R03-02): a colour-coded plate above each archway
 * leaving the Story Hall, so a child can tell the four doors apart without
 * reading. A box cannot carry text; the words ("To the Character Gallery")
 * come from the castle guide and the reticle. Each plate is derived from the
 * canonical door's own gap (`castleLayout.ts`), so a cue cannot drift from
 * the doorway it marks. Colours echo the destination room's palette.
 */
export const HUB_DOOR_CUES: readonly { doorId: string; color: number }[] = [
  { doorId: 'arch-entry-hall', color: 0x2c4ea0 }, // royal blue, as the Entry Hall banners
  { doorId: 'arch-gallery', color: 0x2f5d46 }, // deep green, as the Gallery walls
  { doorId: 'arch-costume', color: 0x7a3f6a }, // plum, as the Costume Room
  { doorId: 'arch-corridor', color: 0x6d7680 }, // cool grey, the way to the deep rooms
];

/** The lintel plate sits above the archway model (2.6 m) and under the 3 m ceiling. */
export const CUE_MIN_Y = 2.62;
export const CUE_MAX_Y = 2.92;
const CUE_GOLD = 0xd8b45a;
/** How far a plate stands off the wall's room-facing plane, nearest and furthest. */
const CUE_NEAR = 0.09;
const CUE_FAR = 0.15;
/** A plate overhangs the doorway by this much each side. */
const CUE_OVERHANG = 0.2;

function cuePlates(door: CastleDoor, color: number): ScenerySpec[] {
  const hall = arrivalIn(door, 'story-hall');
  if (!hall) throw new Error(`Door "${door.id}" does not open onto the story hall`);
  const crossesX = door.gap.maxX - door.gap.minX < door.gap.maxZ - door.gap.minZ;
  // Which way the hall lies from the door: the plate hangs on the hall's face of the wall.
  const toward = Math.sign(crossesX ? hall.x - door.centre.x : hall.z - door.centre.z);
  const plane = (crossesX ? door.centre.x : door.centre.z) + toward * 0.25;
  const near = Math.min(plane + toward * CUE_NEAR, plane + toward * CUE_FAR);
  const far = Math.max(plane + toward * CUE_NEAR, plane + toward * CUE_FAR);
  const [lo, hi] = crossesX
    ? [door.gap.minZ - CUE_OVERHANG, door.gap.maxZ + CUE_OVERHANG]
    : [door.gap.minX - CUE_OVERHANG, door.gap.maxX + CUE_OVERHANG];
  const plate = (id: string, c: number, minY: number, maxY: number, grow: number) =>
    crossesX
      ? box(id, c, near, far, lo - grow, hi + grow, minY, maxY)
      : box(id, c, lo - grow, hi + grow, near, far, minY, maxY);
  return [
    plate(`castle-door-cue-${door.id}`, color, CUE_MIN_Y, CUE_MAX_Y, 0),
    plate(`castle-door-cue-${door.id}-edge`, CUE_GOLD, CUE_MIN_Y, CUE_MIN_Y + 0.04, 0.04),
  ];
}

export const STORY_HALL_VISUALS: RoomVisuals = {
  look: {
    roomId: 'story-hall',
    floor: 'planks-honey',
    walls: 'plaster-hall',
    ceiling: 'plaster-hall',
    wainscot: { materialId: 'ashlar-hall', height: 1 },
    trim: 'trim-dark-wood',
    mood: { color: 0xffe2b8, priority: 9 },
    // A crimson rug before the hearth.
    inlays: [
      {
        id: 'hearth-rug',
        materialId: 'carpet-hall-rug',
        area: { minX: -1.6, maxX: 1.6, minZ: -4.6, maxZ: -3.2 },
      },
    ],
    // Embers drifting up from the fire.
    motes: { color: 0xffb066, count: 30, minY: 0.3, maxY: 2.8, size: 0.04, seed: 5 },
  },
  materials: [
    {
      id: 'planks-honey',
      pattern: 'PLANKS',
      baseColor: 0xb98a50,
      accentColor: 0x8f6636,
      roughness: 0.75,
      metersPerRepeat: 1.6,
      seed: 41,
    },
    {
      id: 'ashlar-hall',
      pattern: 'ASHLAR',
      baseColor: 0xb59a76,
      accentColor: 0x84704f,
      roughness: 0.9,
      metersPerRepeat: 2,
      seed: 42,
    },
    {
      id: 'plaster-hall',
      pattern: 'PLASTER',
      baseColor: 0xe2c696,
      accentColor: 0xc4a470,
      roughness: 0.95,
      metersPerRepeat: 3,
      seed: 43,
    },
    {
      id: 'carpet-hall-rug',
      pattern: 'CARPET',
      baseColor: CRIMSON,
      accentColor: GOLD,
      roughness: 1,
      metersPerRepeat: 1,
      seed: 44,
    },
  ],
  decor: [
    // The hearth: a stone base, two jambs that stop under the mantel carving, and a fire.
    box(
      'castle-hearth-base',
      STONE,
      -HEARTH_HALF_WIDTH,
      HEARTH_HALF_WIDTH,
      TUCKED_Z,
      HEARTH_DEPTH_Z,
      0,
      0.25,
    ),
    box(
      'castle-hearth-jamb-w',
      STONE_LIGHT,
      -HEARTH_HALF_WIDTH,
      -1,
      TUCKED_Z,
      HEARTH_DEPTH_Z - 0.1,
      0.25,
      JAMB_TOP,
    ),
    box(
      'castle-hearth-jamb-e',
      STONE_LIGHT,
      1,
      HEARTH_HALF_WIDTH,
      TUCKED_Z,
      HEARTH_DEPTH_Z - 0.1,
      0.25,
      JAMB_TOP,
    ),
    box('castle-hearth-fire', FIRE, -0.8, 0.8, -5.7, -5.45, 0.25, 0.75),
    box('castle-hearth-flame', FIRE_BRIGHT, -0.45, 0.45, -5.68, -5.5, 0.75, 1),
    ...HUB_DOOR_CUES.flatMap((cue) =>
      cuePlates(
        CASTLE_DOORS.find((door) => door.id === cue.doorId)!,
        cue.color,
      ),
    ),
    ...NORTH_BANNERS.flatMap((banner) => [
      box(
        `castle-hall-banner-${banner.id}-cloth`,
        CRIMSON,
        banner.minX,
        banner.maxX,
        5.6,
        5.66,
        1,
        2.7,
      ),
      box(
        `castle-hall-banner-${banner.id}-hem`,
        GOLD,
        banner.minX - 0.04,
        banner.maxX + 0.04,
        5.58,
        5.66,
        1,
        1.12,
      ),
    ]),
  ],
  // The whole hearth is solid: no one walks into the fire.
  colliders: [
    solid('hearth', -HEARTH_HALF_WIDTH, HEARTH_HALF_WIDTH, WALL_Z, HEARTH_DEPTH_Z, JAMB_TOP),
  ],
};
