import { Box3, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BODY_HEIGHT,
  FirstPersonController,
  type FirstPersonControllerOptions,
  type MoveInput,
} from './firstPersonController';
import { DEFAULT_PLAYER_COLLISION } from './playerCollision';

/**
 * GE-L16: raised Solid colliders on the shared controller. A Solid part keeps its height and
 * leaves the space under it open only when the gap is at least the avatar's collision height plus
 * the margin; otherwise it blocks at every height. Elevation never makes a part jumpable.
 */

const FORWARD: MoveInput = { forward: 1, strafe: 0 };
const STILL: MoveInput = { forward: 0, strafe: 0 };
const FRAME = 1 / 60;
const REACH = DEFAULT_PLAYER_COLLISION.radius + DEFAULT_PLAYER_COLLISION.skin;

function box(minX: number, maxX: number, minY: number, maxY: number, minZ: number, maxZ: number) {
  return new Box3(new Vector3(minX, minY, minZ), new Vector3(maxX, maxY, maxZ));
}

function run(controller: FirstPersonController, input: MoveInput, seconds: number) {
  for (let i = 0; i < Math.round(seconds / FRAME); i += 1) controller.update(FRAME, input);
}

/** Solid boxes (and optional jumpable ones); the child starts at the origin facing +Z. */
function controllerWith(
  solids: Box3[],
  options: FirstPersonControllerOptions & { jumpable?: Box3[] } = {},
) {
  const jumpable = options.jumpable ?? [];
  const controller = new FirstPersonController({
    ...options,
    colliders: [...solids, ...jumpable],
    jumpableColliders: new Set(jumpable),
  });
  controller.teleport(0, 0, 0);
  return controller;
}

/** A 4 m wide part across the path, 1 m deep, from z 2 to 3. */
const across = (minY: number, maxY: number) => box(-2, 2, minY, maxY, 2, 3);

/** Walks forward with jump pressed every frame for `seconds`; returns the furthest z reached. */
function walkAndJump(controller: FirstPersonController, seconds: number): number {
  let furthest = controller.position.z;
  for (let i = 0; i < Math.round(seconds / FRAME); i += 1) {
    controller.pressJump();
    controller.update(FRAME, FORWARD);
    furthest = Math.max(furthest, controller.position.z);
  }
  return furthest;
}

describe('raised Solid clearance on the shared controller (GE-L16)', () => {
  describe('clearance', () => {
    it('walks under a raised Solid with enough clearance (a lintel 1.8 m up)', () => {
      const controller = controllerWith([across(1.8, 2.2)]);
      run(controller, FORWARD, 1.5);
      expect(controller.position.z).toBeGreaterThan(4);
      expect(controller.position.y).toBe(0);
    });

    it('is blocked by a raised Solid without enough clearance (1.5 m up), as by a wall', () => {
      const controller = controllerWith([across(1.5, 2.2)]);
      run(controller, FORWARD, 1.5);
      expect(controller.position.z).toBeLessThanOrEqual(2 - REACH + 1e-6);
      expect(controller.position.z).toBeGreaterThan(2 - REACH - 0.05); // rests against it
    });

    it('exactly the avatar height is a passage; a centimetre less is not', () => {
      const fits = controllerWith([across(DEFAULT_BODY_HEIGHT, 2.2)]);
      run(fits, FORWARD, 1.5);
      expect(fits.position.z).toBeGreaterThan(4);

      const tooLow = controllerWith([across(DEFAULT_BODY_HEIGHT - 0.01, 2.2)]);
      run(tooLow, FORWARD, 1.5);
      expect(tooLow.position.z).toBeLessThan(2);
    });

    it('the safety margin raises the clearance a passage needs', () => {
      const margin = { collision: { clearanceMargin: 0.2 } };
      const blocked = controllerWith([across(1.85, 2.2)], margin);
      run(blocked, FORWARD, 1.5);
      expect(blocked.position.z).toBeLessThan(2);

      const passes = controllerWith([across(1.9, 2.2)], margin);
      run(passes, FORWARD, 1.5);
      expect(passes.position.z).toBeGreaterThan(4);
    });

    it('depends on the avatar height: a 1.2 m avatar fits under 1.4 m, a 1.7 m one does not', () => {
      const small = controllerWith([across(1.4, 2)], { bodyHeight: 1.2 });
      run(small, FORWARD, 1.5);
      expect(small.position.z).toBeGreaterThan(4);

      const standard = controllerWith([across(1.4, 2)]);
      run(standard, FORWARD, 1.5);
      expect(standard.position.z).toBeLessThan(2);
    });

    it('a passage narrower than the body is blocked even with headroom (pillars 0.6 m apart)', () => {
      const lintel = box(-2, 2, 2, 2.4, 2, 3);
      const narrow = [box(-2, -0.3, 0, 2.4, 2, 3), box(0.3, 2, 0, 2.4, 2, 3), lintel];
      const blocked = controllerWith(narrow);
      run(blocked, FORWARD, 1.5);
      expect(blocked.position.z).toBeLessThan(2);

      const wide = [box(-2, -0.6, 0, 2.4, 2, 3), box(0.6, 2, 0, 2.4, 2, 3), lintel];
      const passes = controllerWith(wide);
      run(passes, FORWARD, 1.5);
      expect(passes.position.z).toBeGreaterThan(4);
    });

    it('overlapping parts: a lintel resting into its pillars blocks only where a pillar stands', () => {
      const arch = [
        box(-2, -0.8, 0, 2.3, 2, 3),
        box(0.8, 2, 0, 2.3, 2, 3),
        box(-2, 2, 2.0, 2.5, 2, 3),
      ];
      const middle = controllerWith(arch);
      run(middle, FORWARD, 1.5);
      expect(middle.position.z).toBeGreaterThan(4);

      const throughPillar = controllerWith(arch);
      throughPillar.teleport(-1.4, 0, 0);
      run(throughPillar, FORWARD, 1.5);
      expect(throughPillar.position.z).toBeLessThan(2);
    });
  });

  describe('Solid geometry', () => {
    it('a low raised Solid (a fence a few centimetres up) cannot be jumped over or stood on', () => {
      const controller = controllerWith([across(0.05, 0.6)]);
      expect(walkAndJump(controller, 2)).toBeLessThan(2);
      controller.clearJumpInput();
      run(controller, STILL, 1);
      expect(controller.position.y).toBe(0);
      expect(controller.supportingBox()).toBeNull();
    });

    it('a low ground Solid is still a wall at every height', () => {
      const controller = controllerWith([across(0, 0.3)]);
      expect(walkAndJump(controller, 2)).toBeLessThan(2);
    });

    it('an overhead Solid is never jumped onto or over: it blocks from its underside up', () => {
      const shelf = across(1.75, 1.9); // top within a strong jump's reach
      const controller = controllerWith([shelf], { jump: { jumpHeight: 2.5 } });
      controller.teleport(0, 1, 0); // start beside it, in the open
      const before = controller.position.z;
      for (let i = 0; i < 240; i += 1) {
        controller.pressJump();
        controller.update(FRAME, i < 30 ? STILL : FORWARD);
        // The body (its radius; the skin is contact slack) never enters the part's volume.
        const radius = DEFAULT_PLAYER_COLLISION.radius;
        const inside =
          controller.position.z > 2 - radius + 1e-6 &&
          controller.position.z < 3 + radius - 1e-6 &&
          controller.position.y + DEFAULT_BODY_HEIGHT > 1.75 + 1e-4;
        expect(inside).toBe(false);
      }
      expect(controller.position.z).toBeGreaterThan(before);
      expect(controller.supportingBox()).toBeNull();
    });

    it('a rising head stops at an overhead underside (a jump under a low beam)', () => {
      const beam = box(-2, 2, 2.4, 2.8, -2, 2); // over the child, 2.4 m up
      const controller = controllerWith([beam]);
      let apex = 0;
      controller.pressJump();
      for (let i = 0; i < 120; i += 1) {
        controller.update(FRAME, STILL);
        apex = Math.max(apex, controller.position.y);
      }
      expect(apex).toBeLessThanOrEqual(2.4 - DEFAULT_BODY_HEIGHT + 1e-6);
      expect(apex).toBeGreaterThan(0.6);
      expect(controller.grounded).toBe(true);
    });

    it('a child placed above an overhead part rests on it rather than sinking in', () => {
      const roof = box(-2, 2, 2.2, 2.5, -2, 2);
      const controller = new FirstPersonController({
        colliders: [roof],
        startPosition: new Vector3(0, 2.5, 0),
      });
      run(controller, STILL, 0.5);
      expect(controller.position.y).toBeCloseTo(2.5, 6);
      expect(controller.grounded).toBe(true);
    });

    it('blocks from every approach direction when the gap is too low, and lets all four through when it is not', () => {
      const directions = [
        { yaw: 0, start: [0, -3] },
        { yaw: Math.PI, start: [0, 3] },
        { yaw: Math.PI / 2, start: [-3, 0] },
        { yaw: -Math.PI / 2, start: [3, 0] },
      ] as const;
      for (const { yaw, start } of directions) {
        const low = controllerWith([box(-1, 1, 1.2, 2, -1, 1)]);
        low.teleport(start[0], start[1], yaw);
        run(low, FORWARD, 2);
        // Stopped against the near face, still on the side it came from.
        expect(Math.hypot(low.position.x, low.position.z)).toBeCloseTo(1 + REACH, 1);
        expect(low.position.x * start[0] >= 0 && low.position.z * start[1] >= 0).toBe(true);

        const high = controllerWith([box(-1, 1, 1.9, 2.4, -1, 1)]);
        high.teleport(start[0], start[1], yaw);
        run(high, FORWARD, 2);
        expect(Math.hypot(high.position.x, high.position.z)).toBeGreaterThan(3);
        // It went right through: now on the far side.
        expect(Math.sign(high.position.x) * Math.sign(start[0]) <= 0).toBe(true);
        expect(Math.sign(high.position.z) * Math.sign(start[1]) <= 0).toBe(true);
      }
    });

    it('a ground-level Solid behaves exactly as before', () => {
      const wall = across(-1, 3);
      const controller = controllerWith([wall]);
      run(controller, FORWARD, 1.5);
      expect(controller.position.z).toBeLessThan(2);
      expect(controller.canStandAt(0, 2.5)).toBe(false);
    });

    it('measures clearance from the ground under the part, not from y 0 (ground 1 m up)', () => {
      const raisedGround = { groundHeightAt: () => 1, startPosition: new Vector3(0, 1, 0) };
      const tooLow = controllerWith([across(2.4, 2.8)], raisedGround); // 1.4 m above the ground
      run(tooLow, FORWARD, 1.5);
      expect(tooLow.position.z).toBeLessThan(2);

      const fits = controllerWith([across(2.8, 3.2)], raisedGround); // 1.8 m above the ground
      run(fits, FORWARD, 1.5);
      expect(fits.position.z).toBeGreaterThan(4);
      expect(fits.position.y).toBe(1);
    });
  });

  describe('jumping and elevated surfaces', () => {
    it('jumps onto a reachable Jumpable platform and stands on it', () => {
      const platform = box(-2, 2, 0, 1, 2, 12);
      const controller = controllerWith([], { jumpable: [platform] });
      walkAndJump(controller, 1.5);
      controller.clearJumpInput();
      run(controller, STILL, 1);
      expect(controller.position.y).toBeCloseTo(1, 6);
      expect(controller.supportingBox()).toBe(platform);
    });

    it('cannot reach a Jumpable platform above the jump (1.6 m with a 1.2 m jump)', () => {
      const ledge = across(0, 1.6);
      const controller = controllerWith([], { jumpable: [ledge] });
      expect(walkAndJump(controller, 2)).toBeLessThan(2);
      controller.clearJumpInput();
      run(controller, STILL, 1);
      expect(controller.position.y).toBe(0);
    });

    it('walks off a high platform and lands on a lower elevated one', () => {
      const high = box(-2, 2, 0, 2, -2, 1);
      const low = box(-2, 2, 0, 1, 1, 8);
      const controller = new FirstPersonController({
        colliders: [high, low],
        jumpableColliders: new Set([high, low]),
        startPosition: new Vector3(0, 2, 0),
      });
      const landed: number[] = [];
      for (let i = 0; i < 60; i += 1) {
        controller.update(FRAME, FORWARD);
        for (const event of controller.consumeEvents()) {
          if (event.type === 'LANDED') landed.push(controller.position.y);
        }
      }
      run(controller, STILL, 0.3);
      expect(landed).toContain(1);
      expect(controller.position.y).toBeCloseTo(1, 6);
    });

    it('walks under a raised Jumpable platform with headroom, and stops in front of a low one', () => {
      const bridge = controllerWith([], { jumpable: [across(1.8, 2)] });
      run(bridge, FORWARD, 1.5);
      expect(bridge.position.z).toBeGreaterThan(4);

      const shelf = controllerWith([], { jumpable: [across(1.0, 1.3)] });
      run(shelf, FORWARD, 1.5);
      expect(shelf.position.z).toBeLessThan(2);
    });

    it('walking into an obstruction stops the walk (no walking on the spot)', () => {
      const controller = controllerWith([across(1.0, 2.5)]);
      run(controller, FORWARD, 1.5);
      const z = controller.position.z;
      run(controller, FORWARD, 0.5);
      expect(controller.position.z).toBeCloseTo(z, 6);
      expect(controller.horizontalSpeed).toBeLessThan(0.05);
      expect(controller.gait).toBe('idle');
    });
  });
});
