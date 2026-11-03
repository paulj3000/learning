import { STORYKEEPER_CASTLE_CHECKPOINTS } from '../../discovery/checkpoints';
import {
  areRequirementsMet,
  type WorldInteractionContext,
  type WorldRequirement,
} from '../worldObjects';
import {
  ARCHWAYS,
  ROOMS,
  isInsideRect,
  type ArchwayDefinition,
  type RectZone,
} from './storykeeperCastleRegion';

/**
 * The castle's canonical world layout (SC-R03-01): one typed description of
 * its rooms, the doors between them, where a child lands when they pass
 * through one, which rooms they have discovered, which paths are locked,
 * and where the story sends them.
 *
 * **This derives from the region; it is not a second router.** Room floors
 * come from `ROOMS`, doors from `ARCHWAYS`, and zones from `ZONES`
 * (`storykeeperCastleRegion.ts`), so a door cannot drift from the wall gap
 * it describes. Locks use the same `WorldRequirement` vocabulary as every
 * interaction (`worldObjects.ts`), evaluated by the same
 * `areRequirementsMet`. What is added here is only what the region could not
 * say: stable ids as a contract, narrative roles, door labels, safe landing
 * spots, entry points, discovery, and the external exits.
 *
 * Pure: no `three`, no React, no storage. The map, the hub's door cues and
 * the navigation guidance read this; they never re-derive the castle.
 */

/**
 * The castle's room ids, **a save-compatibility contract**. Checkpoints,
 * discovery and the map are keyed by these, so an id is never renamed. New
 * rooms (the Trophy Room, the Secret Chamber) are appended when their tasks
 * build them.
 */
export const CASTLE_ROOM_IDS = [
  'entry-hall',
  'story-hall',
  'character-gallery',
  'costume-room',
  'east-corridor',
  'setting-tower',
  'illustration-studio',
  'great-library',
] as const;

export type CastleRoomId = (typeof CASTLE_ROOM_IDS)[number];

/** What a room is *for* in the story (reboot roadmap section 2.1), as a stable key. */
export type CastleRoomRole =
  | 'arrival'
  | 'hub'
  | 'choose-hero'
  | 'dress-up'
  | 'wayfinding'
  | 'choose-setting'
  | 'see-it-drawn'
  | 'secret-door-arc';

export interface CastleRoomNode {
  id: CastleRoomId;
  /** Child-facing, from the region's own label ("the Great Library"). */
  label: string;
  floor: RectZone;
  role: CastleRoomRole;
  /** What there is to do here, in one child-facing sentence, readable aloud. */
  destination: string;
  /** A spot a child can always be placed on: walkable, inside the room, clear of furniture. */
  safeSpot: { x: number; z: number };
  /** The checkpoint saved when the child is here, if the room has one (ADR-008). */
  checkpointId?: string;
  /** Known from the first step in. Only the entry hall. */
  initiallyDiscovered: boolean;
}

interface RoomMeta {
  role: CastleRoomRole;
  destination: string;
  safeSpot: { x: number; z: number };
  checkpointId?: string;
}

const checkpointPosition = (id: string): { x: number; z: number } => {
  const checkpoint = STORYKEEPER_CASTLE_CHECKPOINTS.find((candidate) => candidate.id === id);
  if (!checkpoint) throw new Error(`Storykeeper Castle has no checkpoint "${id}"`);
  return { x: checkpoint.x, z: checkpoint.z };
};

const ROOM_META: Readonly<Record<CastleRoomId, RoomMeta>> = {
  'entry-hall': {
    role: 'arrival',
    destination: 'Come in through the castle doors.',
    safeSpot: checkpointPosition('storykeeper-castle:entrance'),
    checkpointId: 'storykeeper-castle:entrance',
  },
  'story-hall': {
    role: 'hub',
    destination: 'Meet Keeper Quill and tell a story together.',
    safeSpot: checkpointPosition('storykeeper-castle:story-hall'),
    checkpointId: 'storykeeper-castle:story-hall',
  },
  'character-gallery': {
    role: 'choose-hero',
    destination: 'Choose a hero for your story.',
    safeSpot: checkpointPosition('storykeeper-castle:gallery'),
    checkpointId: 'storykeeper-castle:gallery',
  },
  'costume-room': {
    role: 'dress-up',
    destination: 'Look at the costumes.',
    safeSpot: { x: -4.5, z: -7.2 },
  },
  'east-corridor': {
    role: 'wayfinding',
    destination: 'Find the way to the rooms at the back of the castle.',
    safeSpot: { x: 4, z: 4 },
  },
  'setting-tower': {
    role: 'choose-setting',
    destination: 'Choose where your story happens.',
    safeSpot: checkpointPosition('storykeeper-castle:tower'),
    checkpointId: 'storykeeper-castle:tower',
  },
  'illustration-studio': {
    role: 'see-it-drawn',
    destination: 'See your story drawn.',
    safeSpot: { x: 6.2, z: 1 },
  },
  'great-library': {
    role: 'secret-door-arc',
    destination: 'Look for clues and open the secret door.',
    safeSpot: checkpointPosition('storykeeper-castle:library'),
    checkpointId: 'storykeeper-castle:library',
  },
};

export const CASTLE_ROOMS: readonly CastleRoomNode[] = CASTLE_ROOM_IDS.map((id) => {
  const room = ROOMS.find((candidate) => candidate.id === id);
  if (!room) throw new Error(`Storykeeper Castle has no room "${id}"`);
  return {
    id,
    label: room.label,
    floor: room.floor,
    ...ROOM_META[id],
    initiallyDiscovered: id === 'entry-hall',
  };
});

export function getCastleRoom(id: string): CastleRoomNode | undefined {
  return CASTLE_ROOMS.find((room) => room.id === id);
}

/** The room a point is standing in, or `undefined` in a wall or outside the castle. */
export function castleRoomAt(x: number, z: number): CastleRoomNode | undefined {
  return CASTLE_ROOMS.find((room) => isInsideRect(x, z, room.floor));
}

/** How far inside a room a door drops the child, from the shared edge. A metre clears the 0.25 m wall face. */
export const DOOR_ENTRY_OFFSET_METERS = 1;

/** Which way a child faces on arriving, in `firstPersonController`'s convention (0 faces +Z, PI/2 faces +X). */
export interface CastlePlacement {
  x: number;
  z: number;
  yaw: number;
}

export interface CastleDoorLock {
  requirements: readonly WorldRequirement[];
  /** Child-facing, readable aloud, never blaming: why the door is shut and what might open it. */
  hint: string;
}

export interface CastleDoor {
  /** The archway's own id (`arch-gallery`): the region owns it, the layout adopts it. */
  id: string;
  /** The two rooms it joins, in the region's order. */
  between: readonly [CastleRoomId, CastleRoomId];
  gap: RectZone;
  /** The point at the middle of the doorway. */
  centre: { x: number; z: number };
  /** Where a child lands in each room on arriving through this door, facing into it. */
  arrival: Readonly<Partial<Record<CastleRoomId, CastlePlacement>>>;
  /** Present only when the path is locked. No door is today: the castle is open by design. */
  lock?: CastleDoorLock;
}

function buildDoor(archway: ArchwayDefinition): CastleDoor {
  const { gap } = archway;
  const centre = { x: (gap.minX + gap.maxX) / 2, z: (gap.minZ + gap.maxZ) / 2 };
  // The gap is thin across the wall and wide along it, so the wall runs along the long axis.
  const crossesX = gap.maxX - gap.minX < gap.maxZ - gap.minZ;
  const sideA = crossesX
    ? { x: centre.x - DOOR_ENTRY_OFFSET_METERS, z: centre.z }
    : { x: centre.x, z: centre.z - DOOR_ENTRY_OFFSET_METERS };
  const sideB = crossesX
    ? { x: centre.x + DOOR_ENTRY_OFFSET_METERS, z: centre.z }
    : { x: centre.x, z: centre.z + DOOR_ENTRY_OFFSET_METERS };
  const roomOfA = castleRoomAt(sideA.x, sideA.z);
  const roomOfB = castleRoomAt(sideB.x, sideB.z);
  if (!roomOfA || !roomOfB) throw new Error(`Archway "${archway.id}" does not open onto two rooms`);
  // Arriving *in* a room means coming from the other side, so facing away from where you came.
  const towardsB = crossesX ? Math.PI / 2 : 0;
  const towardsA = crossesX ? -Math.PI / 2 : Math.PI;
  return {
    id: archway.id,
    between: [roomOfA.id, roomOfB.id],
    gap,
    centre,
    arrival: {
      [roomOfA.id]: { ...sideA, yaw: towardsA },
      [roomOfB.id]: { ...sideB, yaw: towardsB },
    },
  };
}

/** Every door, derived one-for-one from the region's archways. */
export const CASTLE_DOORS: readonly CastleDoor[] = ARCHWAYS.map(buildDoor);

/** Whether the path through a door is open for this child. A door with no lock is always open. */
export function isDoorOpen(door: CastleDoor, context: WorldInteractionContext): boolean {
  return door.lock === undefined || areRequirementsMet(door.lock.requirements, context);
}

/** Doors leaving a room. */
export function doorsOf(
  roomId: CastleRoomId,
  doors: readonly CastleDoor[] = CASTLE_DOORS,
): readonly CastleDoor[] {
  return doors.filter((door) => door.between.includes(roomId));
}

/** The room on the other side of `door` from `roomId`. */
export function otherSide(door: CastleDoor, roomId: CastleRoomId): CastleRoomId {
  return door.between[0] === roomId ? door.between[1] : door.between[0];
}

/** Where a child lands in `roomId` on coming through `door`, or `undefined` if the door does not open onto it. */
export function arrivalIn(door: CastleDoor, roomId: CastleRoomId): CastlePlacement | undefined {
  return door.arrival[roomId];
}

/** "To the Great Library", read from the room the child is in. Child-facing and readable aloud. */
export function doorLabel(door: CastleDoor, fromRoomId: CastleRoomId): string {
  const target = getCastleRoom(otherSide(door, fromRoomId));
  return target ? `To ${target.label}` : 'A doorway';
}

/**
 * An exit from the castle's own rooms to somewhere else: back to Welcome
 * Harbor, or through the opened secret door to the Writing Room. These
 * **mirror the authored interactions** (`castle-harbor-exit`,
 * `castle-last-bookshelf`), whose `zoneId` is where the child stands; a test
 * keeps the two in step, so there is one source of truth for what an exit
 * does.
 */
export interface CastleExit {
  id: string;
  roomId: CastleRoomId;
  /** The interaction that owns this exit, and the zone a child enters to use it. */
  interactionId: string;
  zoneId: string;
  /** `WorldAction` NAVIGATE's `to`, relative to `/island/:childId/`. */
  to: string;
  requirements: readonly WorldRequirement[];
  destination: string;
}

export const CASTLE_EXITS: readonly CastleExit[] = [
  {
    id: 'harbor',
    roomId: 'entry-hall',
    interactionId: 'castle-harbor-exit',
    zoneId: 'castle-harbor-exit',
    to: 'world',
    requirements: [{ type: 'ALWAYS' }],
    destination: 'Go back to Welcome Harbor.',
  },
  {
    id: 'writing-room',
    roomId: 'great-library',
    interactionId: 'castle-last-bookshelf',
    zoneId: 'castle-last-bookshelf',
    to: 'locations/castle-writing-room',
    requirements: [{ type: 'WORLD_CHANGE_PRESENT', changeKey: 'THE_CASTLES_SECRET_DOOR_COMPLETE' }],
    destination: 'Step through the secret door to the Writing Room.',
  },
];

/** Which exits a child can use right now. */
export function openExits(context: WorldInteractionContext): readonly CastleExit[] {
  return CASTLE_EXITS.filter((exit) => areRequirementsMet(exit.requirements, context));
}

/**
 * The doors to walk through, in order, from one room to another, around any
 * locked door. `null` when no open path exists; an empty list when already
 * there. Breadth first, so the route is the fewest doors, and ties follow
 * the region's archway order so the answer never flickers between runs.
 */
export function routeBetween(
  from: CastleRoomId,
  to: CastleRoomId,
  context: WorldInteractionContext,
  doors: readonly CastleDoor[] = CASTLE_DOORS,
): readonly CastleDoor[] | null {
  if (from === to) return [];
  const cameFrom = new Map<CastleRoomId, { door: CastleDoor; previous: CastleRoomId }>();
  const queue: CastleRoomId[] = [from];
  const seen = new Set<CastleRoomId>([from]);
  while (queue.length > 0) {
    const room = queue.shift() as CastleRoomId;
    for (const door of doorsOf(room, doors)) {
      if (!isDoorOpen(door, context)) continue;
      const next = otherSide(door, room);
      if (seen.has(next)) continue;
      seen.add(next);
      cameFrom.set(next, { door, previous: room });
      if (next === to) {
        const route: CastleDoor[] = [];
        let cursor: CastleRoomId = to;
        while (cursor !== from) {
          const step = cameFrom.get(cursor) as { door: CastleDoor; previous: CastleRoomId };
          route.unshift(step.door);
          cursor = step.previous;
        }
        return route;
      }
      queue.push(next);
    }
  }
  return null;
}

/** The next door to walk through to get from one room to another, or `null` if there is none or you are there. */
export function nextDoorToward(
  from: CastleRoomId,
  to: CastleRoomId,
  context: WorldInteractionContext,
  doors: readonly CastleDoor[] = CASTLE_DOORS,
): CastleDoor | null {
  return routeBetween(from, to, context, doors)?.[0] ?? null;
}

export type CastleDiscovery = 'discovered' | 'unseen';

/**
 * What the child has found. A room is discovered once they have been in it;
 * the entry hall is known from the start. `visited` is the set of room ids
 * they have entered: where it is stored is the map's business (SC-R03-06),
 * and this is the pure rule.
 */
export function discoveryState(
  visited: ReadonlySet<string>,
): Record<CastleRoomId, CastleDiscovery> {
  return Object.fromEntries(
    CASTLE_ROOMS.map((room) => [
      room.id,
      room.initiallyDiscovered || visited.has(room.id) ? 'discovered' : 'unseen',
    ]),
  ) as Record<CastleRoomId, CastleDiscovery>;
}

/**
 * Where to put a child whose position cannot be trusted (a saved spot that
 * is no longer walkable, a position outside the castle): their saved room's
 * safe spot, else the entry hall's. Never throws, never returns a wall.
 */
export function safePlacementFor(roomId: string | undefined): { x: number; z: number } {
  const room = (roomId && getCastleRoom(roomId)) || getCastleRoom('entry-hall');
  return room!.safeSpot;
}
