import type { RectZone } from './runtime/locationManifest';

/**
 * The Writing Room's layout as plain data (SC-R10-01): a small round room
 * behind the Great Library's last bookshelf, approximated as a 10 by 10 square
 * with its four corners cut off. No `three` import: the manifest
 * (`runtime/manifests/castleWritingRoom.ts`) builds everything from these, and
 * the parity tests read them back.
 *
 * Positions are layout and stay in TypeScript (ADR-033, LAI-0805 open).
 * Interaction ids, titles and messages are NOT here: they are the shared
 * `CASTLE_WRITING_ROOM_INTERACTIONS` in `worldObjects.ts`, which the Phaser
 * room also reads, so the two renderers cannot drift apart.
 *
 * This room records nothing. The only durable fact that reaches it is
 * `THE_CASTLES_SECRET_DOOR_COMPLETE`, written by chapter 3 of the castle
 * story, which is also its unlock key.
 */

/** The world change that opens this room (same key as `locations.ts` and `CASTLE_EXITS`). */
export const WRITING_ROOM_UNLOCK_CHANGE_KEY = 'THE_CASTLES_SECRET_DOOR_COMPLETE';

export const WRITING_ROOM_HALF_EXTENT = 5;
export const WRITING_ROOM_WALL_HEIGHT = 3;
/** Where the child arrives, facing into the room (+X). The checkpoint in `discovery/checkpoints.ts` matches it. */
export const WRITING_ROOM_SPAWN = { x: -2.5, z: 0 } as const;

/** The ajar secret door on the west wall, and the walk-in zone in front of it that is the exit. */
export const WRITING_ROOM_EXIT_ZONE: RectZone = {
  id: 'writing-room-castle-exit',
  minX: -5,
  maxX: -4.1,
  minZ: -1.2,
  maxZ: 1.2,
};
export const WRITING_ROOM_DOOR_SPOT = { x: -4.8, z: 0, rotationY: -Math.PI / 2 } as const;

/** Half the footprint of `writing-desk`, used for its solid collider. */
export const WRITING_DESK_SPOT = { x: 2.5, z: -1, halfX: 0.7, halfZ: 0.45, height: 0.9 } as const;
export const INTERACTIVE_BOOKSHELF_SPOT = { x: 0, z: 4.8, rotationY: 0 } as const;

/** Decorative shelves, a bay of blank books each. Backed 0.2 m off the wall like the Great Library's. */
export const WRITING_ROOM_SHELVES = [
  { id: 'north-west', x: -2.5, z: 4.8, rotationY: 0 },
  { id: 'north-east', x: 2.5, z: 4.8, rotationY: 0 },
  { id: 'west-north', x: -4.8, z: 3, rotationY: -Math.PI / 2 },
  { id: 'west-south', x: -4.8, z: -3, rotationY: -Math.PI / 2 },
  { id: 'east-south', x: 4.8, z: -3, rotationY: Math.PI / 2 },
] as const;

/** The solid run of shelves along the north wall, two on the west, one on the east. */
export const WRITING_ROOM_SHELF_COLLIDERS: readonly RectZone[] = [
  { id: 'collider:writing-room-shelves-north', minX: -3.4, maxX: 3.4, minZ: 4.4, maxZ: 5 },
  { id: 'collider:writing-room-shelves-west-north', minX: -5, maxX: -4.4, minZ: 2.2, maxZ: 3.8 },
  { id: 'collider:writing-room-shelves-west-south', minX: -5, maxX: -4.4, minZ: -3.8, maxZ: -2.2 },
  { id: 'collider:writing-room-shelves-east-south', minX: 4.4, maxX: 5, minZ: -3.8, maxZ: -2.2 },
];

/** Four cut corners that make the square read as round. Clear of the spawn, the exit and every prop. */
export const WRITING_ROOM_CORNER_SIZE = 1.2;
const C = WRITING_ROOM_CORNER_SIZE;
export const WRITING_ROOM_CORNERS: readonly RectZone[] = [
  { id: 'corner-nw', minX: -5, maxX: -5 + C, minZ: 5 - C, maxZ: 5 },
  { id: 'corner-ne', minX: 5 - C, maxX: 5, minZ: 5 - C, maxZ: 5 },
  { id: 'corner-sw', minX: -5, maxX: -5 + C, minZ: -5, maxZ: -5 + C },
  { id: 'corner-se', minX: 5 - C, maxX: 5, minZ: -5, maxZ: -5 + C },
];

/** The round window on the east wall, and the warm light it lets in. */
export const WRITING_ROOM_WINDOW = { x: 4.9, y: 1.5, z: 1.5, rotationY: Math.PI / 2 } as const;
export const WRITING_ROOM_WINDOW_LIGHT = { x: 3.8, y: 2, z: 1.5 } as const;

/**
 * Optional low reading steps under the window (SC-JMP rules: tops at most
 * 0.5 m, never required, nothing gated on them, no motion). They are an
 * extra place to stand, nothing more: the room records nothing either way.
 */
export const WRITING_ROOM_STEP_SPOTS = [
  { id: 'writing-room-step:window-a', x: 3.4, z: 0.7 },
  { id: 'writing-room-step:window-b', x: 3.4, z: 2.3 },
] as const;
export const WRITING_ROOM_STEP_SIZE = 0.9;
export const WRITING_ROOM_STEP_HEIGHT = 0.3;
export const WRITING_ROOM_STEP_COLOR = 0xd9a066;
