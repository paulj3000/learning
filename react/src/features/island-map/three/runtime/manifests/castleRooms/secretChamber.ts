import { CHAMBER_CRYSTAL_HALF, CHAMBER_CRYSTAL_SPOTS } from '../../../storykeeperCastleRegion';
import { SECRET_PASSAGE_DISCOVERY_ID } from '../../../castleLayout';
import type { ColliderSpec, LightSpec } from '../../locationManifest';
import { box, rect, solid, type RoomVisuals } from './castleVisualKit';

/**
 * The Secret Chamber's look (SC-R03-05): a low stone room, dim and a little
 * magical, behind the tapestry nook. Cool flagstone, dark ashlar, three
 * glowing crystals, a round sealed door that is a promise of something to
 * come, a gold arrow on the floor toward the way out, and one warm lantern at
 * the passage so a child always knows where home is.
 *
 * It is gentle by design: rounded colours, nothing sharp at eye height, a lit
 * exit, no dark corners that are not also lit. The "magical locked door" is
 * a sealed door only: it has no puzzle, because the castle's one pattern lock
 * and secret door already live in the Library and are not duplicated here.
 *
 * Everything in the chamber is flavour and decoration. The one thing that is
 * gameplay is the **seal**: a solid collider filling the passage while the
 * tapestry nook has not been found (`DISCOVERY_ABSENT`), which the
 * castle-tale scene removes live the moment it is.
 */

const STONE_BASE = 0x5d544a;
const CRYSTAL_COLOURS = [0xb99cff, 0x6fd6c9, 0xff9ec4] as const;
const DOOR_FRAME = 0x3d3a45;
const DOOR_GLOW = 0x8f7bd9;
const LANTERN = 0xffc45a;

/** The sealed round door on the south wall (its room-facing plane is z = -9.75). */
export const CHAMBER_DOOR = { minX: -13.2, maxX: -11.8, nearZ: -9.68, farZ: -9.6 } as const;

/** The three gated surfaces that hide the gap in the Story Hall's wall while the passage is secret. */
export const SECRET_SEAL_SURFACE_IDS = [
  'look:story-hall:secret-seal:wainscot',
  'look:story-hall:secret-seal:walls',
  'look:story-hall:secret-seal:trim',
] as const;

/** Id of the collider that fills the passage while it is secret. castle-tale removes it by this id. */
export const SECRET_PASSAGE_SEAL_ID = 'collider:secret-passage-seal';

/** The passage's gap, as `arch-secret` in the region defines it. */
const PASSAGE = { minX: -9.25, maxX: -8.75, minZ: -5.75, maxZ: -4.25 } as const;

/** A solid fill of the passage, present only while the nook has not been found. */
export const SECRET_PASSAGE_SEAL: ColliderSpec = {
  rect: rect(SECRET_PASSAGE_SEAL_ID, PASSAGE.minX, PASSAGE.maxX, PASSAGE.minZ, PASSAGE.maxZ),
  minY: 0,
  maxY: 3,
  requirements: [{ type: 'DISCOVERY_ABSENT', discoveryId: SECRET_PASSAGE_DISCOVERY_ID }],
};

/** One warm lantern by the way out, on the east wall south of the passage, always a landmark. */
const LANTERN_LIGHT: LightSpec = {
  id: 'light:chamber-lantern',
  kind: 'POINT',
  position: { x: -9.9, y: 1.7, z: -6.4 },
  color: 0xffd080,
  intensity: 3,
  decay: 1.8,
  priority: 4,
};

export const SECRET_CHAMBER_VISUALS: RoomVisuals = {
  look: {
    roomId: 'secret-chamber',
    floor: 'flagstone-tower',
    walls: 'ashlar-library',
    ceiling: 'ashlar-library',
    trim: 'trim-dark-wood',
    // A gold arrow of tiles from the middle of the room to the passage: the way out.
    inlays: [
      {
        id: 'way-out',
        materialId: 'tiles-entry-inlay',
        area: { minX: -13.6, maxX: -9.9, minZ: -5.25, maxZ: -4.75 },
      },
    ],
    mood: { color: 0xb9a8ff, priority: 1 },
    motes: { color: 0xcdb8ff, count: 24, minY: 0.3, maxY: 2.4, size: 0.04, seed: 17 },
  },
  materials: [],
  decor: [
    ...CHAMBER_CRYSTAL_SPOTS.flatMap((spot, index) => {
      const n = index + 1;
      const half = CHAMBER_CRYSTAL_HALF;
      return [
        box(
          `castle-chamber-crystal-base-${n}`,
          STONE_BASE,
          spot.x - half,
          spot.x + half,
          spot.z - half,
          spot.z + half,
          0,
          0.3,
        ),
        box(
          `castle-chamber-crystal-${n}`,
          CRYSTAL_COLOURS[index],
          spot.x - 0.12,
          spot.x + 0.12,
          spot.z - 0.12,
          spot.z + 0.12,
          0.3,
          1.3,
        ),
      ];
    }),
    box(
      'castle-chamber-door-frame',
      DOOR_FRAME,
      CHAMBER_DOOR.minX,
      CHAMBER_DOOR.maxX,
      CHAMBER_DOOR.nearZ,
      CHAMBER_DOOR.farZ,
      0,
      2.1,
    ),
    box(
      'castle-chamber-door-glow',
      DOOR_GLOW,
      CHAMBER_DOOR.minX + 0.2,
      CHAMBER_DOOR.maxX - 0.2,
      CHAMBER_DOOR.nearZ - 0.04,
      CHAMBER_DOOR.nearZ,
      0.6,
      1.6,
    ),
    box('castle-chamber-lantern', LANTERN, -9.5, -9.36, -6.5, -6.3, 1.5, 1.8),
  ],
  lights: [LANTERN_LIGHT],
  colliders: [
    ...CHAMBER_CRYSTAL_SPOTS.map((spot) =>
      solid(
        spot.entityId,
        spot.x - CHAMBER_CRYSTAL_HALF,
        spot.x + CHAMBER_CRYSTAL_HALF,
        spot.z - CHAMBER_CRYSTAL_HALF,
        spot.z + CHAMBER_CRYSTAL_HALF,
        0.3,
      ),
    ),
    SECRET_PASSAGE_SEAL,
  ],
};
