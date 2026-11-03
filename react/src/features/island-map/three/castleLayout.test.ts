import { describe, expect, it } from 'vitest';
import { STORYKEEPER_CASTLE_CHECKPOINTS } from '../../discovery/checkpoints';
import { STORYKEEPER_CASTLE_INTERACTIONS, type WorldInteractionContext } from '../worldObjects';
import {
  CASTLE_DOORS,
  CASTLE_EXITS,
  CASTLE_ROOMS,
  CASTLE_ROOM_IDS,
  DOOR_ENTRY_OFFSET_METERS,
  arrivalIn,
  castleRoomAt,
  discoveryState,
  doorLabel,
  getCastleRoom,
  isCastleRoomVisible,
  isDoorOpen,
  doorsOf,
  nextDoorToward,
  openExits,
  otherSide,
  planTravel,
  routeBetween,
  safePlacementFor,
  SECRET_PASSAGE_DISCOVERY_ID,
  visibleCastleRooms,
  type CastleDoor,
} from './castleLayout';
import { ARCHWAYS, ROOMS, ZONES, isInsideRect, isWalkable } from './storykeeperCastleRegion';

/**
 * The canonical layout is derived from the region, so these tests are about
 * what the derivation must preserve (stable ids, one door per archway),
 * what it adds that can be wrong (landing spots, yaws, routes, locks), and
 * that nothing the child needs is stranded.
 */

const NOTHING_YET: WorldInteractionContext = {
  worldChangeKeys: [],
  ownedItemIds: [],
  discoveryIds: [],
};

/** A child who has found the tapestry nook: the secret passage is open and the chamber is on the map. */
const FOUND_NOOK: WorldInteractionContext = {
  ...NOTHING_YET,
  discoveryIds: ['castle-tapestry-stair'],
};

const door = (id: string): CastleDoor => CASTLE_DOORS.find((candidate) => candidate.id === id)!;

describe('castle layout identity (save compatibility)', () => {
  it('keeps the first eight stable room ids in order, appends later rooms, and invents none the region lacks', () => {
    // The eight rooms every earlier save knows. Never renamed, never reordered.
    expect(CASTLE_ROOM_IDS.slice(0, 8)).toEqual([
      'entry-hall',
      'story-hall',
      'character-gallery',
      'costume-room',
      'east-corridor',
      'setting-tower',
      'illustration-studio',
      'great-library',
    ]);
    // Rooms added since are appended, in the order they were built: the Trophy Room (SC-R03-03),
    // then the Secret Chamber (SC-R03-05).
    expect(CASTLE_ROOM_IDS.slice(8)).toEqual(['trophy-room', 'secret-chamber']);
    expect(CASTLE_ROOMS.map((room) => room.id)).toEqual([...CASTLE_ROOM_IDS]);
    expect(ROOMS.map((room) => room.id).sort()).toEqual([...CASTLE_ROOM_IDS].sort());
  });

  it('takes each room floor and label from the region rather than restating them', () => {
    for (const node of CASTLE_ROOMS) {
      const region = ROOMS.find((room) => room.id === node.id)!;
      expect(node.floor).toBe(region.floor);
      expect(node.label).toBe(region.label);
    }
  });

  it('keeps every saved checkpoint inside the room that claims it', () => {
    for (const node of CASTLE_ROOMS) {
      if (!node.checkpointId) continue;
      const checkpoint = STORYKEEPER_CASTLE_CHECKPOINTS.find((c) => c.id === node.checkpointId);
      expect(checkpoint, `${node.id} names a missing checkpoint`).toBeDefined();
      expect(isInsideRect(checkpoint!.x, checkpoint!.z, node.floor)).toBe(true);
    }
    // Every castle checkpoint lands in some room, so a saved spot always resolves to one.
    for (const checkpoint of STORYKEEPER_CASTLE_CHECKPOINTS.filter((c) =>
      c.id.startsWith('storykeeper-castle:'),
    )) {
      expect(castleRoomAt(checkpoint.x, checkpoint.z), checkpoint.id).toBeDefined();
    }
  });

  it("lists the primary role first among each room's functions, and the tower is also the Observatory", () => {
    for (const room of CASTLE_ROOMS) expect(room.functions[0]).toBe(room.role);
    const tower = getCastleRoom('setting-tower')!;
    expect(tower.role).toBe('choose-setting');
    expect(tower.functions).toEqual(['choose-setting', 'observatory']);
    // The Observatory is not a room of its own: no 'observatory' room id exists.
    expect(CASTLE_ROOM_IDS as readonly string[]).not.toContain('observatory');
  });

  it('writes child-facing text without em dashes, and every line readable aloud', () => {
    const lines = [
      ...CASTLE_ROOMS.flatMap((room) => [room.label, room.destination]),
      ...CASTLE_EXITS.map((exit) => exit.destination),
    ];
    for (const line of lines) {
      expect(line.length).toBeGreaterThan(0);
      expect(line, line).not.toMatch(/—|–/);
    }
  });
});

describe('castle doors', () => {
  it('has exactly one door per archway, taking its id and joined rooms from it', () => {
    expect(CASTLE_DOORS).toHaveLength(ARCHWAYS.length);
    expect(new Set(CASTLE_DOORS.map((d) => d.id)).size).toBe(CASTLE_DOORS.length);
    for (const archway of ARCHWAYS) {
      const found = door(archway.id);
      expect(found, archway.id).toBeDefined();
      expect([...found.between].sort()).toEqual([...archway.between].sort());
      expect(found.gap).toBe(archway.gap);
    }
  });

  it('lands the child inside each room it joins, walkable, a metre from the doorway', () => {
    for (const d of CASTLE_DOORS) {
      for (const roomId of d.between) {
        const placement = arrivalIn(d, roomId);
        expect(placement, `${d.id} has no arrival in ${roomId}`).toBeDefined();
        const { x, z } = placement!;
        expect(castleRoomAt(x, z)?.id, `${d.id} drops into the wrong room`).toBe(roomId);
        expect(isWalkable(x, z), `${d.id} drops into ${roomId} on a wall`).toBe(true);
        expect(Math.hypot(x - d.centre.x, z - d.centre.z)).toBeCloseTo(DOOR_ENTRY_OFFSET_METERS, 6);
      }
    }
  });

  it('turns the child to face into the room they arrive in, not back at the door', () => {
    for (const d of CASTLE_DOORS) {
      for (const roomId of d.between) {
        const { x, z, yaw } = arrivalIn(d, roomId)!;
        // forward = (sin yaw, cos yaw). Half a metre ahead: the east corridor is only two metres wide.
        const ahead = { x: x + Math.sin(yaw) * 0.5, z: z + Math.cos(yaw) * 0.5 };
        expect(castleRoomAt(ahead.x, ahead.z)?.id, `${d.id} faces out of ${roomId}`).toBe(roomId);
        const before = Math.hypot(x - d.centre.x, z - d.centre.z);
        const after = Math.hypot(ahead.x - d.centre.x, ahead.z - d.centre.z);
        expect(after).toBeGreaterThan(before);
      }
    }
  });

  it('says where each door goes from whichever side the child stands on', () => {
    expect(doorLabel(door('arch-library'), 'east-corridor')).toBe('To the Great Library');
    expect(doorLabel(door('arch-library'), 'great-library')).toBe('To the east corridor');
    expect(otherSide(door('arch-gallery'), 'story-hall')).toBe('character-gallery');
    expect(otherSide(door('arch-gallery'), 'character-gallery')).toBe('story-hall');
  });

  it('locks only the secret passage: the castle is open by design everywhere else', () => {
    for (const d of CASTLE_DOORS) {
      if (d.id === 'arch-secret') {
        expect(d.lock).toBeDefined();
        expect(isDoorOpen(d, NOTHING_YET)).toBe(false);
        expect(isDoorOpen(d, FOUND_NOOK)).toBe(true);
      } else {
        expect(d.lock, d.id).toBeUndefined();
        expect(isDoorOpen(d, NOTHING_YET), d.id).toBe(true);
      }
    }
  });
});

describe('castle routes', () => {
  it('reaches every room from the entry hall by open doors alone', () => {
    for (const room of CASTLE_ROOMS) {
      expect(routeBetween('entry-hall', room.id, FOUND_NOOK), room.id).not.toBeNull();
    }
  });

  it('makes the story hall the hub and the library the deepest room, as designed', () => {
    const doorsTo = (id: Parameters<typeof routeBetween>[1]) =>
      routeBetween('entry-hall', id, FOUND_NOOK)!.length;
    expect(doorsTo('story-hall')).toBe(1);
    expect(doorsTo('character-gallery')).toBe(2);
    expect(doorsTo('costume-room')).toBe(2);
    expect(doorsTo('east-corridor')).toBe(2);
    const deepest = Math.max(...CASTLE_ROOMS.map((room) => doorsTo(room.id)));
    expect(doorsTo('great-library')).toBe(deepest);
    const route = routeBetween('entry-hall', 'great-library', FOUND_NOOK)!;
    expect(route.map((d) => d.id)).toEqual(['arch-entry-hall', 'arch-corridor', 'arch-library']);
  });

  it('is symmetric and is empty when already there', () => {
    expect(routeBetween('story-hall', 'story-hall', FOUND_NOOK)).toEqual([]);
    for (const a of CASTLE_ROOM_IDS) {
      for (const b of CASTLE_ROOM_IDS) {
        expect(routeBetween(a, b, FOUND_NOOK)!.length).toBe(routeBetween(b, a, FOUND_NOOK)!.length);
      }
    }
  });

  it('names the next door to walk through, and none once you are there', () => {
    expect(nextDoorToward('entry-hall', 'setting-tower', NOTHING_YET)?.id).toBe('arch-entry-hall');
    expect(nextDoorToward('east-corridor', 'setting-tower', NOTHING_YET)?.id).toBe('arch-tower');
    expect(nextDoorToward('setting-tower', 'setting-tower', NOTHING_YET)).toBeNull();
  });

  it('honours a lock with the same requirement vocabulary as every interaction', () => {
    const locked: CastleDoor[] = CASTLE_DOORS.map((d) =>
      d.id === 'arch-corridor'
        ? {
            ...d,
            lock: {
              requirements: [{ type: 'WORLD_CHANGE_PRESENT', changeKey: 'A_KEY_TURNED' }],
              hint: 'The way east is shut for now.',
            },
          }
        : d,
    );
    expect(
      isDoorOpen(
        locked.find((d) => d.id === 'arch-corridor')!,
        NOTHING_YET,
      ),
    ).toBe(false);
    // Everything behind the corridor is cut off, and the rest is untouched.
    expect(routeBetween('entry-hall', 'great-library', NOTHING_YET, locked)).toBeNull();
    expect(routeBetween('entry-hall', 'character-gallery', NOTHING_YET, locked)).not.toBeNull();
    const withKey = { ...NOTHING_YET, worldChangeKeys: ['A_KEY_TURNED'] };
    expect(routeBetween('entry-hall', 'great-library', withKey, locked)).not.toBeNull();
    expect(nextDoorToward('story-hall', 'great-library', NOTHING_YET, locked)).toBeNull();
  });
});

describe('castle exits', () => {
  it('mirror the authored interactions exactly, so there is one source of truth', () => {
    for (const exit of CASTLE_EXITS) {
      const interaction = STORYKEEPER_CASTLE_INTERACTIONS.find((i) => i.id === exit.interactionId);
      expect(interaction, exit.id).toBeDefined();
      // An interaction's zone defaults to its own id when it names none.
      expect(interaction!.zoneId ?? interaction!.id).toBe(exit.zoneId);
      expect(interaction!.action).toEqual({ kind: 'NAVIGATE', to: exit.to });
      expect(interaction!.requirements).toEqual(exit.requirements);
      const zone = ZONES.find((candidate) => candidate.id === exit.zoneId)!;
      expect(zone, `${exit.zoneId} is not a zone`).toBeDefined();
      expect(castleRoomAt((zone.minX + zone.maxX) / 2, (zone.minZ + zone.maxZ) / 2)?.id).toBe(
        exit.roomId,
      );
    }
  });

  it('always lets a child back out to the harbor, and opens the Writing Room only after the arc', () => {
    expect(openExits(NOTHING_YET).map((exit) => exit.id)).toEqual(['harbor']);
    const done = { ...NOTHING_YET, worldChangeKeys: ['THE_CASTLES_SECRET_DOOR_COMPLETE'] };
    expect(openExits(done).map((exit) => exit.id)).toEqual(['harbor', 'writing-room']);
  });
});

describe('castle content reachability', () => {
  it('places every trigger zone inside a room that can be reached from the entry hall', () => {
    for (const zone of ZONES) {
      const room = castleRoomAt((zone.minX + zone.maxX) / 2, (zone.minZ + zone.maxZ) / 2);
      expect(room, `zone ${zone.id} is outside every room`).toBeDefined();
      expect(
        routeBetween('entry-hall', room!.id, FOUND_NOOK),
        `${zone.id} is unreachable`,
      ).not.toBeNull();
    }
  });

  it('keeps the zone of every castle interaction that names one', () => {
    for (const interaction of STORYKEEPER_CASTLE_INTERACTIONS) {
      if (!interaction.zoneId) continue;
      expect(
        ZONES.map((zone) => zone.id),
        interaction.id,
      ).toContain(interaction.zoneId);
    }
  });
});

describe('discovery and safe placement', () => {
  it('knows only the entry hall at first, and adds a room once it has been entered', () => {
    const start = discoveryState(new Set());
    expect(Object.entries(start).filter(([, state]) => state === 'discovered')).toEqual([
      ['entry-hall', 'discovered'],
    ]);
    const later = discoveryState(new Set(['story-hall', 'great-library', 'not-a-room']));
    expect(later['story-hall']).toBe('discovered');
    expect(later['great-library']).toBe('discovered');
    expect(later['setting-tower']).toBe('unseen');
    expect(Object.keys(later)).toHaveLength(CASTLE_ROOM_IDS.length);
  });

  it('gives every room a safe spot inside it, on walkable floor', () => {
    for (const room of CASTLE_ROOMS) {
      expect(castleRoomAt(room.safeSpot.x, room.safeSpot.z)?.id).toBe(room.id);
      expect(isWalkable(room.safeSpot.x, room.safeSpot.z), room.id).toBe(true);
    }
  });

  it('never returns a wall: an unknown or missing room falls back to the entry hall', () => {
    const entry = getCastleRoom('entry-hall')!.safeSpot;
    expect(safePlacementFor(undefined)).toEqual(entry);
    expect(safePlacementFor('a-room-from-a-newer-version')).toEqual(entry);
    expect(safePlacementFor('great-library')).toEqual(getCastleRoom('great-library')!.safeSpot);
  });
});

describe('castle travel: the accessible equivalent of walking (SC-R03-02)', () => {
  const LOCKED_CORRIDOR: CastleDoor[] = CASTLE_DOORS.map((d) =>
    d.id === 'arch-corridor'
      ? {
          ...d,
          lock: {
            requirements: [{ type: 'WORLD_CHANGE_PRESENT', changeKey: 'A_KEY_TURNED' }],
            hint: 'The way east is shut for now.',
          },
        }
      : d,
  );

  it('puts the child at the room safe spot, facing into the room, with the doors a walker would pass', () => {
    const plan = planTravel('entry-hall', 'great-library', NOTHING_YET);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.room.id).toBe('great-library');
    expect(plan.placement).toMatchObject(plan.room.safeSpot);
    expect(plan.route.map((d) => d.id)).toEqual([
      'arch-entry-hall',
      'arch-corridor',
      'arch-library',
    ]);
    // Facing the middle of the room: a step ahead brings them closer to it.
    const centre = {
      x: (plan.room.floor.minX + plan.room.floor.maxX) / 2,
      z: (plan.room.floor.minZ + plan.room.floor.maxZ) / 2,
    };
    const before = Math.hypot(plan.placement.x - centre.x, plan.placement.z - centre.z);
    const after = Math.hypot(
      plan.placement.x + Math.sin(plan.placement.yaw) - centre.x,
      plan.placement.z + Math.cos(plan.placement.yaw) - centre.z,
    );
    expect(after).toBeLessThan(before);
  });

  it('lets a child go from any room to any other, landing inside it on walkable floor', () => {
    for (const from of CASTLE_ROOM_IDS) {
      for (const to of CASTLE_ROOM_IDS) {
        if (from === to) continue;
        const plan = planTravel(from, to, FOUND_NOOK);
        expect(plan.ok, `${from} to ${to}`).toBe(true);
        if (!plan.ok) continue;
        expect(castleRoomAt(plan.placement.x, plan.placement.z)?.id).toBe(to);
        expect(isWalkable(plan.placement.x, plan.placement.z)).toBe(true);
      }
    }
  });

  it('treats a child outside every room as being in the entry hall', () => {
    const plan = planTravel(undefined, 'story-hall', NOTHING_YET);
    expect(plan.ok && plan.route.map((d) => d.id)).toEqual(['arch-entry-hall']);
  });

  it('refuses a room that is not on the map, and the room you are already in', () => {
    const unknown = planTravel('entry-hall', 'a-room-from-a-newer-version', NOTHING_YET);
    expect(unknown).toMatchObject({ ok: false, reason: 'unknown-room' });
    const here = planTravel('story-hall', 'story-hall', NOTHING_YET);
    expect(here).toMatchObject({ ok: false, reason: 'already-there' });
    expect(!here.ok && here.message).toBe('You are already in the story hall.');
  });

  it('is never a way around a locked door: it names the shut door and its own hint', () => {
    const refused = planTravel('story-hall', 'great-library', NOTHING_YET, LOCKED_CORRIDOR);
    expect(refused).toMatchObject({ ok: false, reason: 'locked' });
    if (refused.ok || refused.reason !== 'locked') return;
    expect(refused.door.id).toBe('arch-corridor');
    expect(refused.message).toBe('The way east is shut for now.');
    // Rooms that do not need that door are untouched.
    expect(planTravel('story-hall', 'character-gallery', NOTHING_YET, LOCKED_CORRIDOR).ok).toBe(
      true,
    );
    // And the door opens it again, by the same requirement vocabulary as everything else.
    const withKey = { ...NOTHING_YET, worldChangeKeys: ['A_KEY_TURNED'] };
    expect(planTravel('story-hall', 'great-library', withKey, LOCKED_CORRIDOR).ok).toBe(true);
  });

  it('says every refusal in words safe to read aloud, with no em dash', () => {
    const refusals = [
      planTravel('entry-hall', 'nowhere', NOTHING_YET),
      planTravel('entry-hall', 'entry-hall', NOTHING_YET),
      planTravel('story-hall', 'great-library', NOTHING_YET, LOCKED_CORRIDOR),
    ];
    for (const refusal of refusals) {
      expect(refusal.ok).toBe(false);
      if (refusal.ok) continue;
      expect(refusal.message.length).toBeGreaterThan(0);
      expect(refusal.message).not.toMatch(/\u2014|\u2013/);
    }
  });
});

describe('the secret chamber stays secret until the nook is found (SC-R03-05)', () => {
  const chamber = () => getCastleRoom('secret-chamber')!;

  it('is not on the map: not visible, and not offered, until the nook is found', () => {
    expect(isCastleRoomVisible(chamber(), NOTHING_YET)).toBe(false);
    expect(visibleCastleRooms(NOTHING_YET).map((room) => room.id)).not.toContain('secret-chamber');
    expect(isCastleRoomVisible(chamber(), FOUND_NOOK)).toBe(true);
    expect(visibleCastleRooms(FOUND_NOOK).map((room) => room.id)).toContain('secret-chamber');
    // Every other room is always visible.
    expect(visibleCastleRooms(NOTHING_YET)).toHaveLength(CASTLE_ROOMS.length - 1);
  });

  it('is refused as "not on the map", never as "locked", and in the very words for a room that does not exist', () => {
    const hidden = planTravel('story-hall', 'secret-chamber', NOTHING_YET);
    const nonexistent = planTravel('story-hall', 'no-such-room', NOTHING_YET);
    expect(hidden).toMatchObject({ ok: false, reason: 'unknown-room' });
    // A child cannot tell the two apart, so asking for it reveals nothing.
    expect(hidden).toEqual(nonexistent);
  });

  it('is reachable by the open passage once found, from the hub and from anywhere', () => {
    const plan = planTravel('story-hall', 'secret-chamber', FOUND_NOOK);
    expect(plan.ok && plan.route.map((d) => d.id)).toEqual(['arch-secret']);
    expect(planTravel('entry-hall', 'secret-chamber', FOUND_NOOK).ok).toBe(true);
  });

  it('has exactly one way in, the passage behind the tapestry, and it is shut until found', () => {
    expect(doorsOf('secret-chamber').map((d) => d.id)).toEqual(['arch-secret']);
    expect(routeBetween('entry-hall', 'secret-chamber', NOTHING_YET)).toBeNull();
    expect(routeBetween('entry-hall', 'secret-chamber', FOUND_NOOK)).not.toBeNull();
  });

  it('uses the one requirement for the room and its door, so they can never disagree', () => {
    expect(chamber().hiddenUntil).toEqual(door('arch-secret').lock?.requirements);
    expect(chamber().hiddenUntil).toEqual([
      { type: 'DISCOVERY_PRESENT', discoveryId: SECRET_PASSAGE_DISCOVERY_ID },
    ]);
  });

  it('opens the secret passage on the discovery the tapestry nook records, and nothing else', () => {
    expect(SECRET_PASSAGE_DISCOVERY_ID).toBe('castle-tapestry-stair');
  });
});
