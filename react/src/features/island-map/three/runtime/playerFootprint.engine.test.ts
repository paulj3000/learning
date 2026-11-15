import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALL_CHECKPOINTS } from '../../../discovery/checkpoints';
import { arrivalIn, CASTLE_DOORS, castleRoomAt } from '../castleLayout';
import type { FirstPersonController } from '../firstPersonController';
import { DEFAULT_PLAYER_COLLISION, footprintDistance } from '../playerCollision';
import { SOURCE_LOCATION_MANIFESTS } from './manifests';
import { STORYKEEPER_CASTLE_MANIFEST } from './manifests/storykeeperCastle';
import { WELCOME_HARBOR_MANIFEST } from './manifests/welcomeHarbor';
import { mount, type Harness } from './testing/engineHarness';

/**
 * Defect 2 through the shared runtime: the footprint against every shipped location's real
 * colliders (authored and derived), Storykeeper Castle's walls and doors in particular.
 */

const REACH = DEFAULT_PLAYER_COLLISION.radius + DEFAULT_PLAYER_COLLISION.skin;
const FRAME_MS = 1000 / 60;

let harness: Harness | null = null;
afterEach(() => {
  harness?.engine.dispose();
  harness = null;
  vi.restoreAllMocks();
});

function open(manifest = STORYKEEPER_CASTLE_MANIFEST): {
  h: Harness;
  controller: () => FirstPersonController;
} {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  harness = mount({ manifest, worldState: undefined });
  let current: FirstPersonController | null = null;
  const h = harness;
  h.setDrive((c) => {
    current = c;
  });
  h.runFrames(1);
  return {
    h,
    controller: () => {
      if (!current) throw new Error('no controller yet');
      return current;
    },
  };
}

/** Every box the controller blocks on at ground level that is not jumpable. */
function solidBoxes(controller: FirstPersonController) {
  const internal = controller as unknown as {
    colliders: {
      min: { x: number; y: number; z: number };
      max: { x: number; y: number; z: number };
    }[];
    jumpable: ReadonlySet<unknown>;
  };
  return internal.colliders.filter(
    (box) => !internal.jumpable.has(box) && box.min.y <= 0 && box.max.y >= 0,
  );
}

describe('spawns and checkpoints stay clear of the body', () => {
  for (const manifest of SOURCE_LOCATION_MANIFESTS) {
    it(`every ${manifest.regionId} checkpoint is standable with a ${REACH} m footprint`, async () => {
      const { h, controller } = open(manifest);
      await h.engine.ready;
      const checkpoints = ALL_CHECKPOINTS.filter((point) => point.regionId === manifest.regionId);
      expect(checkpoints.length).toBeGreaterThan(0);
      for (const point of checkpoints) {
        expect(controller().canStandAt(point.x, point.z), point.id).toBe(true);
      }
    });
  }
});

describe('Storykeeper Castle walls and doors', () => {
  it('a child walking into each wall of each room stops with the body outside it', async () => {
    const { h, controller } = open();
    await h.engine.ready;
    for (const door of CASTLE_DOORS) {
      for (const roomId of door.between) {
        const start = arrivalIn(door, roomId)!;
        for (const yaw of [
          0,
          Math.PI / 2,
          Math.PI,
          -Math.PI / 2,
          Math.PI / 4,
          (-3 * Math.PI) / 4,
        ]) {
          const c = controller();
          expect(c.teleportTo(start.x, start.z, yaw), `${door.id}/${roomId}`).toBe(true);
          h.setDrive((ctrl, delta) => ctrl.update(delta, { forward: 1, strafe: 0 }));
          h.runFrames(180, FRAME_MS);
          const solids = solidBoxes(c);
          const nearest = Math.min(
            ...solids.map((box) => footprintDistance(box, c.position.x, c.position.z)),
          );
          expect(nearest, `${door.id}/${roomId} yaw ${yaw.toFixed(2)}`).toBeGreaterThanOrEqual(
            REACH - 1e-6,
          );
          h.setDrive(() => undefined);
        }
      }
    }
  });

  it('every open door can be walked through, from either side', async () => {
    const { h, controller } = open();
    await h.engine.ready;
    for (const door of CASTLE_DOORS) {
      if (door.lock) continue; // the secret passage: tested below
      const [a, b] = door.between;
      for (const [from, to] of [
        [a, b],
        [b, a],
      ] as const) {
        const start = arrivalIn(door, from)!;
        const goal = arrivalIn(door, to)!;
        const yaw = Math.atan2(goal.x - start.x, goal.z - start.z);
        expect(controller().teleportTo(start.x, start.z, yaw)).toBe(true);
        h.setDrive((ctrl, delta) => ctrl.update(delta, { forward: 1, strafe: 0 }));
        h.runFrames(40, FRAME_MS); // 2 m at walking pace, with room to spare
        const c = controller();
        expect(castleRoomAt(c.position.x, c.position.z)?.id, `${door.id} ${from} -> ${to}`).toBe(
          to,
        );
        h.setDrive(() => undefined);
      }
    }
  });

  it('the locked secret door still cannot be walked through', async () => {
    const { h, controller } = open();
    await h.engine.ready;
    const door = CASTLE_DOORS.find((candidate) => candidate.lock)!;
    const [a, b] = door.between;
    const start = arrivalIn(door, a)!;
    const goal = arrivalIn(door, b)!;
    const yaw = Math.atan2(goal.x - start.x, goal.z - start.z);
    if (!controller().teleportTo(start.x, start.z, yaw)) return; // the room itself is not open
    h.setDrive((ctrl, delta) => ctrl.update(delta, { forward: 1, strafe: 0 }));
    h.runFrames(90, FRAME_MS);
    const c = controller();
    expect(castleRoomAt(c.position.x, c.position.z)?.id).not.toBe(b);
  });
});

describe('NPCs and interaction reach', () => {
  it('stops the body at an NPC, still close enough to talk', async () => {
    const pip = WELCOME_HARBOR_MANIFEST.npcs[0]!;
    const { h, controller } = open(WELCOME_HARBOR_MANIFEST);
    await h.engine.ready;
    const c = controller();
    // Stand 3 m south of Pip, facing them, and walk in.
    expect(c.teleportTo(pip.position.x, pip.position.z - 3, 0)).toBe(true);
    h.setDrive((ctrl, delta) => {
      ctrl.pitch = 0;
      ctrl.update(delta, { forward: 1, strafe: 0 });
    });
    h.runFrames(120, FRAME_MS);
    const gap = Math.hypot(c.position.x - pip.position.x, c.position.z - pip.position.z);
    expect(gap).toBeLessThan(3); // walked toward them
    expect(gap).toBeGreaterThan(REACH - 1e-6); // never inside them
    const approached = h.events.filter((event) => event.name === 'NpcApproached');
    expect(approached.length).toBeGreaterThan(0);
  });
});
