import { afterEach, describe, expect, it, vi } from 'vitest';
import { Box3, Vector3 } from 'three';
import type { WorldInteractionContext } from '../../../worldObjects';
import {
  CASTLE_DOORS,
  CASTLE_ROOM_IDS,
  SECRET_PASSAGE_DISCOVERY_ID,
  arrivalIn,
  castleRoomAt,
  isDoorOpen,
  safePlacementFor,
  type CastleRoomId,
} from '../../castleLayout';
import type { FirstPersonController, MovementState } from '../../firstPersonController';
import { playerAnimationState } from '../../playerAnimation';
import { ROOMS } from '../../storykeeperCastleRegion';
import { solidColliders } from '../sceneLayout';
import { mount, named, standAt, type Drive, type Harness } from '../testing/engineHarness';
import { STORYKEEPER_CASTLE_MANIFEST as MANIFEST } from './storykeeperCastle';
import { CASTLE_ENGINE_PROFILE, CASTLE_CEILING_UNDERSIDE } from '../../castleEngineProfile';

/**
 * SC-JMP-01 and SC-JMP-02: the castle's movement audit, room by room, on the real shared runtime
 * (`createLocationEngine`, `FirstPersonController`, the shared camera). There is no castle
 * movement code to test: this suite proves the shared controller, as the castle configures it,
 * keeps every room's rules. For each of the ten rooms, in both worlds (before and after the
 * tapestry nook is found):
 *
 * - walking, running, sprinting and jumping into every wall never puts the child inside a solid
 *   or off the castle's floors, and never into a room the story has not opened;
 * - the top of a jump keeps the eye under the ceiling slabs;
 * - the third-person camera never enters a wall, never rises above its ceiling cap and never
 *   looks into a sealed room;
 * - every open doorway can be crossed at a walk and with a jump in the doorway;
 * - a child who leaves the playable area, or whose position becomes invalid, is returned to the
 *   castle floor with nothing else changed;
 * - every movement state maps to an animation the castle's avatars can show.
 *
 * Browser and WebGL checks stay with the owner (SC-JMP-20, SC-R12-01).
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

const SECRET_ROOM: CastleRoomId = 'secret-chamber';
const HEADINGS = 12;
const EPSILON = 1e-6;

let harness: Harness | null = null;
let controller: FirstPersonController | null = null;

afterEach(() => {
  harness?.engine.dispose();
  harness = null;
  controller = null;
  vi.restoreAllMocks();
});

function quiet() {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
}

function castle(
  world: WorldInteractionContext,
  cameraMode: 'first-person' | null = 'first-person',
) {
  quiet();
  harness = mount({ manifest: MANIFEST, worldState: world, cameraMode });
  harness.runFrames(1);
  return harness;
}

/** Wraps a drive so the test can read the controller after every frame. */
function observed(drive: Drive): Drive {
  return (c, delta) => {
    controller = c;
    drive(c, delta);
  };
}

function idle(): Drive {
  return (c, delta) => c.update(delta, { forward: 0, strafe: 0 });
}

function sprint(yaw: number): Drive {
  return (c, delta) => {
    c.yaw = yaw;
    c.update(delta, { forward: 1, strafe: 0, sprint: true });
  };
}

/** Walks toward each target in turn, then stands still. */
function steer(targets: readonly { x: number; z: number }[]): Drive {
  let index = 0;
  return (c, delta) => {
    const target = targets[index];
    if (!target) {
      c.update(delta, { forward: 0, strafe: 0 });
      return;
    }
    const dx = target.x - c.position.x;
    const dz = target.z - c.position.z;
    if (Math.hypot(dx, dz) < 0.15) {
      index += 1;
      c.update(delta, { forward: 0, strafe: 0 });
      return;
    }
    c.yaw = Math.atan2(dx, dz);
    c.update(delta, { forward: 1, strafe: 0 });
  };
}

function place(h: Harness, x: number, z: number, yaw = 0) {
  h.setDrive(observed(standAt(x, z, yaw)));
  h.runFrames(1);
  h.setDrive(observed(idle()));
  h.runFrames(30);
}

const walkingSolids = (world: WorldInteractionContext) =>
  solidColliders(MANIFEST, world).filter((collider) => !collider.jumpable);

function insideSolid(
  world: WorldInteractionContext,
  x: number,
  y: number,
  z: number,
): string | null {
  for (const { id, box } of walkingSolids(world)) {
    if (
      x > box.minX + EPSILON &&
      x < box.maxX - EPSILON &&
      z > box.minZ + EPSILON &&
      z < box.maxZ - EPSILON &&
      y >= box.minY - EPSILON &&
      y < box.maxY - EPSILON
    ) {
      return id ?? 'a solid';
    }
  }
  return null;
}

describe('the castle engine profile (SC-JMP-01)', () => {
  it('is what the manifest hands the shared controller, and nothing castle-specific besides', () => {
    quiet();
    const h = castle(NOTHING);
    expect(h.engine.jump.jumpHeight).toBe(CASTLE_ENGINE_PROFILE.movement.jump.jumpHeight);
    expect(MANIFEST.movement).toEqual(CASTLE_ENGINE_PROFILE.movement);
    expect(MANIFEST.player).toEqual({ camera: CASTLE_ENGINE_PROFILE.camera });
  });
});

describe.each(WORLDS)('every castle room, %s (SC-JMP-01, SC-JMP-02)', (_label, world) => {
  const rooms = CASTLE_ROOM_IDS.filter((id) => world === FOUND || id !== SECRET_ROOM);

  it('sprinting and jumping into every wall never enters a solid, leaves the floor or opens a sealed room', () => {
    const h = castle(world);
    for (const roomId of rooms) {
      const start = safePlacementFor(roomId);
      for (let heading = 0; heading < HEADINGS; heading += 1) {
        const yaw = (heading / HEADINGS) * Math.PI * 2;
        place(h, start.x, start.z, yaw);
        h.setDrive(observed(sprint(yaw)));
        for (let frame = 0; frame < 150; frame += 1) {
          if (frame % 25 === 5) h.engine.pressJump();
          h.runFrames(1);
          const { x, y, z } = controller!.position;
          const where = `${roomId} heading ${heading} frame ${frame} at (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`;
          expect(insideSolid(world, x, y, z), where).toBeNull();
          const room = castleRoomAt(x, z);
          expect(room, `${where}: off every floor`).toBeDefined();
          if (world === NOTHING) expect(room?.id, `${where}: sealed room`).not.toBe(SECRET_ROOM);
        }
      }
    }
    expect(named(h.events, 'PlayerRecovered')).toEqual([]);
    expect(named(h.events, 'PlayerJumped').length).toBeGreaterThan(rooms.length * HEADINGS);
  });

  it('keeps the top of a jump under the ceiling slabs in every room', () => {
    const h = castle(world);
    for (const roomId of rooms) {
      const start = safePlacementFor(roomId);
      place(h, start.x, start.z);
      let apex = 0;
      h.engine.pressJump();
      for (let frame = 0; frame < 80; frame += 1) {
        h.runFrames(1);
        apex = Math.max(apex, h.camera().position.y);
      }
      expect(apex, roomId).toBeGreaterThan(1.6 + 0.5);
      expect(apex, roomId).toBeLessThan(CASTLE_CEILING_UNDERSIDE);
      expect(controller!.grounded, roomId).toBe(true);
    }
  });

  it('crosses every open doorway at a walk, and with a jump in the doorway, landing in the other room', () => {
    const h = castle(world);
    const doors = CASTLE_DOORS.filter((door) => isDoorOpen(door, world));
    if (world === NOTHING) expect(doors.some((door) => door.id === 'arch-secret')).toBe(false);
    for (const door of doors) {
      for (const [from, to] of [door.between, [door.between[1], door.between[0]] as const]) {
        for (const jumpInDoorway of [false, true]) {
          const start = arrivalIn(door, from);
          const end = arrivalIn(door, to);
          expect(start && end, door.id).toBeTruthy();
          place(h, start!.x, start!.z, start!.yaw);
          h.setDrive(observed(steer([door.centre, end!])));
          let jumped = false;
          for (let frame = 0; frame < 400; frame += 1) {
            h.runFrames(1);
            const { x, y, z } = controller!.position;
            expect(insideSolid(world, x, y, z), `${door.id} ${from}->${to}`).toBeNull();
            const inGap =
              x >= door.gap.minX && x <= door.gap.maxX && z >= door.gap.minZ && z <= door.gap.maxZ;
            if (jumpInDoorway && inGap && !jumped) {
              h.engine.pressJump();
              jumped = true;
            }
          }
          expect(
            castleRoomAt(controller!.position.x, controller!.position.z)?.id,
            `${door.id} ${from}->${to}`,
          ).toBe(to);
          if (jumpInDoorway) expect(jumped, door.id).toBe(true);
        }
      }
    }
  });

  it('holds the third-person camera inside the castle, under its cap, and out of every sealed room', async () => {
    const h = castle(world, null);
    await h.engine.ready;
    const walls = solidColliders(MANIFEST, world).map(
      ({ box }) =>
        new Box3(
          new Vector3(box.minX, box.minY, box.minZ),
          new Vector3(box.maxX, box.maxY, box.maxZ),
        ),
    );
    const cap = CASTLE_ENGINE_PROFILE.camera.maxHeight;
    for (const roomId of rooms) {
      const start = safePlacementFor(roomId);
      place(h, start.x, start.z);
      let heading = 0;
      h.setDrive(
        observed((c, delta) => {
          c.yaw = heading;
          c.update(delta, { forward: 0, strafe: 0 });
        }),
      );
      for (let step = 0; step < 24; step += 1) {
        heading = (step / 24) * Math.PI * 2;
        h.runFrames(3);
        const camera = h.camera().position;
        const where = `${roomId} step ${step} camera (${camera.toArray().map((n) => n.toFixed(2))})`;
        expect(
          walls.some((wall) => wall.containsPoint(camera)),
          where,
        ).toBe(false);
        expect(camera.y, where).toBeLessThanOrEqual(cap + EPSILON);
        if (world === NOTHING)
          expect(castleRoomAt(camera.x, camera.z)?.id, where).not.toBe(SECRET_ROOM);
      }
    }
  });
});

describe('safe recovery inside the castle (SC-JMP-02)', () => {
  const isOnACastleFloor = (x: number, z: number) =>
    ROOMS.some(
      (room) =>
        x >= room.floor.minX &&
        x <= room.floor.maxX &&
        z >= room.floor.minZ &&
        z <= room.floor.maxZ,
    );

  it('returns a child who leaves the playable area to the last floor they stood on', () => {
    const h = castle(NOTHING);
    const start = safePlacementFor('great-library');
    place(h, start.x, start.z);
    h.setDrive(observed(standAt(40, 0, 0)));
    h.runFrames(1);
    h.setDrive(observed(idle()));
    h.runFrames(2);
    const recovered = named(h.events, 'PlayerRecovered') as { reason: string }[];
    expect(recovered.map((event) => event.reason)).toContain('LEFT_PLAYABLE_AREA');
    const { x, z } = controller!.position;
    expect(isOnACastleFloor(x, z)).toBe(true);
    expect(castleRoomAt(x, z)?.id).toBe('great-library');
  });

  it('returns a child whose position becomes invalid, and loses nothing the world recorded', () => {
    const h = castle(FOUND);
    const start = safePlacementFor(SECRET_ROOM);
    place(h, start.x, start.z);
    h.setDrive(
      observed((c) => {
        c.position.set(Number.NaN, 0, 0);
      }),
    );
    h.runFrames(1);
    h.setDrive(observed(idle()));
    h.runFrames(2);
    const recovered = named(h.events, 'PlayerRecovered') as { reason: string }[];
    expect(recovered.map((event) => event.reason)).toContain('INVALID_POSITION');
    expect(castleRoomAt(controller!.position.x, controller!.position.z)?.id).toBe(SECRET_ROOM);
    // Recovery is position only: no zone, interaction or collectible event is raised by it.
    expect(named(h.events, 'CollectiblePickedUp')).toEqual([]);
    expect(named(h.events, 'ObjectInteracted')).toEqual([]);
  });
});

describe('avatar animation in the castle (SC-JMP-01)', () => {
  it('passes through idle, sprint, jump, airborne and landing, each a clip a castle avatar can show', () => {
    const h = castle(NOTHING);
    const start = safePlacementFor('story-hall');
    place(h, start.x, start.z, Math.PI / 2);
    const seen = new Set<MovementState>();
    h.setDrive(
      observed((c, delta) => {
        sprint(Math.PI / 2)(c, delta);
        seen.add(c.movementState);
      }),
    );
    for (let frame = 0; frame < 120; frame += 1) {
      if (frame === 40) h.engine.pressJump();
      h.runFrames(1);
    }
    h.setDrive(
      observed((c, delta) => {
        idle()(c, delta);
        seen.add(c.movementState);
      }),
    );
    h.runFrames(60);
    for (const state of ['SPRINT', 'AIRBORNE', 'IDLE'] as const)
      expect(seen.has(state), state).toBe(true);
    expect([...seen].some((state) => state === 'JUMP_START' || state === 'AIRBORNE')).toBe(true);
    const clips = new Set(['idle', 'walk', 'run', 'jump', 'fall', 'land']);
    for (const state of seen) {
      // The stand-in avatar has no jump clip: it keeps its ground clip in the air.
      const withoutJump = playerAnimationState(state, {
        horizontalSpeed: 5,
        hasJumpClip: false,
        walkSpeed: 2,
      });
      const withJump = playerAnimationState(state, {
        horizontalSpeed: 5,
        hasJumpClip: true,
        hasRunClip: true,
        walkSpeed: 2,
      });
      expect(clips.has(withoutJump), state).toBe(true);
      expect(clips.has(withJump), state).toBe(true);
      if (state === 'AIRBORNE') expect(withoutJump).not.toBe('jump');
    }
  });
});
