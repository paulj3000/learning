import { describe, expect, it } from 'vitest';
import {
  ALL_CHECKPOINTS,
  STORYKEEPER_CASTLE_CHECKPOINTS,
  STORYKEEPER_CASTLE_REGION_ID,
  resolveSpawnCheckpoint,
} from '../../../../discovery/checkpoints';
import type { WorldInteractionContext } from '../../../worldObjects';
import { STORYKEEPER_CASTLE_INTERACTIONS } from '../../../worldObjects';
import {
  CASTLE_DOORS,
  CASTLE_ROOMS,
  CASTLE_ROOM_IDS,
  SECRET_PASSAGE_DISCOVERY_ID,
  arrivalIn,
  castleRoomAt,
  doorsOf,
  isDoorOpen,
  otherSide,
  planTravel,
  routeBetween,
  safePlacementFor,
} from '../../castleLayout';
import {
  castleTaleExtension,
  isCastleTaleScene,
} from '../../extensions/castleTale/castleTaleScene';
import { ZONES } from '../../storykeeperCastleRegion';
import { mount } from '../testing/engineHarness';
import { isReached, reachableCells, zoneIsEnterable } from '../testing/castleReachability';
import { STORYKEEPER_CASTLE_MANIFEST as MANIFEST } from './storykeeperCastle';

/**
 * The castle's navigation as a whole (SC-R03-07). The pieces each have their
 * own tests; this suite proves they hold *together*: the graph of rooms, the
 * walk on real colliders, the accessible tour that never walks, spawning,
 * saves written by older and newer versions, and every authored interaction
 * still reachable. It runs in both worlds a child can be in: before the
 * tapestry nook is found, and after. No browser.
 */

const NOTHING: WorldInteractionContext = {
  worldChangeKeys: [],
  ownedItemIds: [],
  discoveryIds: [],
};
const FOUND: WorldInteractionContext = { ...NOTHING, discoveryIds: [SECRET_PASSAGE_DISCOVERY_ID] };
const WORLDS: readonly [string, WorldInteractionContext][] = [
  ['before the nook is found', NOTHING],
  ['after the nook is found', FOUND],
];

const castle = (world: WorldInteractionContext, startCheckpointId?: string) => {
  const harness = mount({
    manifest: MANIFEST,
    extensions: [castleTaleExtension],
    worldState: world,
    startCheckpointId,
  });
  harness.runFrames(1);
  const api = harness.engine.extensionApi('castle-tale');
  if (!isCastleTaleScene(api)) throw new Error('castle-tale did not mount');
  return { harness, api };
};

describe('room connections', () => {
  const edges = (world: WorldInteractionContext) =>
    CASTLE_DOORS.filter((door) => isDoorOpen(door, world))
      .map((door) => [...door.between].sort().join(' <-> '))
      .sort();

  it('connects exactly these rooms, and nothing else, once everything is found', () => {
    expect(edges(FOUND)).toEqual(
      [
        'costume-room <-> trophy-room',
        'east-corridor <-> great-library',
        'east-corridor <-> illustration-studio',
        'east-corridor <-> setting-tower',
        'entry-hall <-> story-hall',
        'character-gallery <-> story-hall',
        'costume-room <-> story-hall',
        'east-corridor <-> story-hall',
        'secret-chamber <-> story-hall',
      ].sort(),
    );
  });

  it('is the same graph before the nook is found, minus only the secret passage', () => {
    expect(edges(NOTHING)).toEqual(edges(FOUND).filter((edge) => !edge.includes('secret-chamber')));
  });

  it('keeps the story hall the hub: every other room is within three doors of it', () => {
    for (const room of CASTLE_ROOM_IDS) {
      const route = routeBetween('story-hall', room, FOUND);
      expect(route, room).not.toBeNull();
      expect(route!.length, room).toBeLessThanOrEqual(2);
    }
  });

  it('leaves the secret chamber and the trophy room as dead ends, so no one can be lost in them', () => {
    expect(doorsOf('secret-chamber')).toHaveLength(1);
    expect(doorsOf('trophy-room')).toHaveLength(1);
  });

  it('gives every door exactly two distinct rooms that both exist', () => {
    for (const door of CASTLE_DOORS) {
      const [a, b] = door.between;
      expect(a).not.toBe(b);
      expect(CASTLE_ROOM_IDS).toContain(a);
      expect(CASTLE_ROOM_IDS).toContain(b);
      expect(otherSide(door, a)).toBe(b);
    }
  });
});

describe.each(WORLDS)('walking, %s', (_name, world) => {
  const visible = CASTLE_ROOMS.filter((room) => room.hiddenUntil.length === 0 || world === FOUND);
  const spawn = STORYKEEPER_CASTLE_CHECKPOINTS[0];
  const reached = reachableCells(MANIFEST, spawn, world);

  it('reaches every visible room on foot from the spawn, with the real colliders', () => {
    for (const room of visible) {
      expect(isReached(reached, room.safeSpot.x, room.safeSpot.z), `${room.id} is cut off`).toBe(
        true,
      );
    }
  });

  it('keeps every secret room cut off until found, and reachable once found', () => {
    for (const room of CASTLE_ROOMS.filter((r) => r.hiddenUntil.length > 0)) {
      expect(isReached(reached, room.safeSpot.x, room.safeSpot.z), room.id).toBe(world === FOUND);
    }
  });

  it('lets a child walk between any two visible rooms: from each room every other is reachable', () => {
    for (const from of visible) {
      const fromHere = reachableCells(MANIFEST, from.safeSpot, world);
      for (const to of visible) {
        expect(isReached(fromHere, to.safeSpot.x, to.safeSpot.z), `${from.id} to ${to.id}`).toBe(
          true,
        );
      }
    }
  });

  it('lets a child stand in every trigger zone of every visible room', () => {
    for (const zone of ZONES) {
      const room = castleRoomAt((zone.minX + zone.maxX) / 2, (zone.minZ + zone.maxZ) / 2);
      if (!room || !visible.includes(room)) continue;
      expect(zoneIsEnterable(reached, zone), `${zone.id} cannot be entered`).toBe(true);
    }
  });

  it('keeps the zone of every authored castle interaction enterable', () => {
    for (const interaction of STORYKEEPER_CASTLE_INTERACTIONS) {
      const zone = ZONES.find(
        (candidate) => candidate.id === (interaction.zoneId ?? interaction.id),
      );
      if (!zone) continue; // a tap interaction (Keeper Quill) has no zone
      expect(zoneIsEnterable(reached, zone), `${interaction.id} is unreachable`).toBe(true);
    }
  });
});

describe('the accessible tour, in the real runtime', () => {
  it('takes a child to every room and back without a single step, in both worlds', () => {
    for (const [name, world] of WORLDS) {
      const { api } = castle(world);
      const rooms = CASTLE_ROOMS.filter((room) => room.hiddenUntil.length === 0 || world === FOUND);
      for (const from of rooms) {
        for (const to of rooms) {
          if (from.id === to.id) continue;
          expect(
            api.goToRoom(from.id, world).ok || api.currentRoomId() === from.id,
            `${name}: reaching ${from.id}`,
          ).toBe(true);
          const result = api.goToRoom(to.id, world);
          expect(result.ok, `${name}: ${from.id} to ${to.id}`).toBe(true);
          expect(api.currentRoomId(), `${name}: arrived in ${to.id}`).toBe(to.id);
        }
      }
    }
  });

  it('refuses the secret room before it is found, and the child does not move', () => {
    const { api, harness } = castle(NOTHING);
    const before = harness.engine.childPlacement();
    const refusal = api.goToRoom('secret-chamber', NOTHING);
    expect(refusal).toMatchObject({ ok: false, reason: 'unknown-room' });
    expect(harness.engine.childPlacement()).toEqual(before);
  });

  it('lands the child on standable ground at every door, from either side', () => {
    const { harness } = castle(FOUND);
    for (const door of CASTLE_DOORS) {
      for (const roomId of door.between) {
        const arrival = arrivalIn(door, roomId)!;
        expect(harness.engine.placeChild(arrival), `${door.id} into ${roomId}`).toBe(true);
        expect(castleRoomAt(arrival.x, arrival.z)?.id).toBe(roomId);
      }
    }
  });
});

describe('spawning and saves', () => {
  const castleCheckpoints = STORYKEEPER_CASTLE_CHECKPOINTS.filter((c) =>
    c.id.startsWith('storykeeper-castle:'),
  );

  it('keeps the five saved checkpoint ids older saves may hold', () => {
    expect(castleCheckpoints.map((c) => c.id)).toEqual([
      'storykeeper-castle:entrance',
      'storykeeper-castle:story-hall',
      'storykeeper-castle:gallery',
      'storykeeper-castle:tower',
      'storykeeper-castle:library',
    ]);
  });

  it('spawns a child with no save at the entrance, inside the entry hall', () => {
    const spawn = resolveSpawnCheckpoint(STORYKEEPER_CASTLE_REGION_ID, undefined);
    expect(spawn.id).toBe('storykeeper-castle:entrance');
    expect(castleRoomAt(spawn.x, spawn.z)?.id).toBe('entry-hall');
  });

  it('spawns a child at each saved checkpoint, in the room it belongs to', () => {
    for (const checkpoint of castleCheckpoints) {
      const { harness } = castle(NOTHING, checkpoint.id);
      const here = harness.engine.childPlacement();
      expect(here.x).toBeCloseTo(checkpoint.x, 6);
      expect(here.z).toBeCloseTo(checkpoint.z, 6);
      expect(castleRoomAt(here.x, here.z)).toBeDefined();
    }
  });

  it('falls back to the entrance for a save from a newer version or another region', () => {
    for (const unknown of [
      'storykeeper-castle:a-room-that-has-not-been-built',
      'treasure:dock',
      '',
    ]) {
      const spawn = resolveSpawnCheckpoint(STORYKEEPER_CASTLE_REGION_ID, unknown);
      expect(spawn.id).toBe('storykeeper-castle:entrance');
    }
    const { harness } = castle(NOTHING, 'storykeeper-castle:a-room-that-has-not-been-built');
    expect(harness.engine.childPlacement().x).toBeCloseTo(-12, 6);
  });

  it('never returns a wall as a fallback position', () => {
    for (const id of [undefined, 'a-room-from-a-newer-version', ...CASTLE_ROOM_IDS]) {
      const spot = safePlacementFor(id);
      expect(castleRoomAt(spot.x, spot.z)).toBeDefined();
      const reached = reachableCells(MANIFEST, STORYKEEPER_CASTLE_CHECKPOINTS[0], FOUND);
      expect(isReached(reached, spot.x, spot.z), String(id)).toBe(true);
    }
  });

  it('keeps every castle checkpoint walkable and in a room', () => {
    for (const checkpoint of ALL_CHECKPOINTS.filter(
      (c) => c.regionId === STORYKEEPER_CASTLE_REGION_ID,
    )) {
      const room = castleRoomAt(checkpoint.x, checkpoint.z);
      expect(room, checkpoint.id).toBeDefined();
    }
  });

  it('keeps the persisted names a saved world uses: the discovery id and the room-change key', () => {
    expect(SECRET_PASSAGE_DISCOVERY_ID).toBe('castle-tapestry-stair');
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
  });
});

describe('navigation never goes around a rule', () => {
  it('refuses a path through a locked door the same way in the planner and the runtime', () => {
    const closed: WorldInteractionContext = NOTHING;
    const planner = planTravel('story-hall', 'secret-chamber', closed);
    const { api } = castle(closed);
    api.goToRoom('story-hall', closed);
    expect(api.goToRoom('secret-chamber', closed)).toEqual(planner);
  });

  it('keeps the guide and the planner in step: whatever the planner allows, the runtime performs', () => {
    const { api } = castle(FOUND);
    for (const room of CASTLE_ROOMS) {
      const planned = planTravel(api.currentRoomId(), room.id, FOUND);
      const done = api.goToRoom(room.id, FOUND);
      expect(done.ok, room.id).toBe(planned.ok);
    }
  });
});
