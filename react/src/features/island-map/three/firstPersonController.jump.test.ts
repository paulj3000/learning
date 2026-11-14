import { Box3, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  FirstPersonController,
  type FirstPersonControllerOptions,
  type MoveInput,
  type MovementEvent,
} from './firstPersonController';
import { DEFAULT_JUMP_CONFIGURATION, jumpLaunchSpeed } from './jumpConfiguration';

const STILL: MoveInput = { forward: 0, strafe: 0 };
const FORWARD: MoveInput = { forward: 1, strafe: 0 };
const FRAME = 1 / 60;

function box(minX: number, maxX: number, minY: number, maxY: number, minZ: number, maxZ: number) {
  return new Box3(new Vector3(minX, minY, minZ), new Vector3(maxX, maxY, maxZ));
}

/** A controller whose given boxes are all jumpable. */
function withJumpable(boxes: Box3[], options: FirstPersonControllerOptions = {}) {
  return new FirstPersonController({
    colliders: [...boxes, ...(options.colliders ?? [])],
    jumpableColliders: new Set(boxes),
    ...options,
  });
}

/** Runs frames until `done` or the limit; returns the frames run. */
function runUntil(
  controller: FirstPersonController,
  input: MoveInput,
  done: () => boolean,
  dt = FRAME,
  limit = 600,
): number {
  for (let frame = 1; frame <= limit; frame += 1) {
    controller.update(dt, input);
    if (done()) return frame;
  }
  throw new Error('condition never met');
}

function run(controller: FirstPersonController, input: MoveInput, seconds: number, dt = FRAME) {
  const frames = Math.round(seconds / dt);
  for (let i = 0; i < frames; i += 1) controller.update(dt, input);
}

function types(events: MovementEvent[]): string[] {
  return events.map((event) => event.type);
}

/** Peak feet height over one jump, sampled every frame. */
function apexOfJump(
  controller: FirstPersonController,
  dt: number,
): { apex: number; airtime: number } {
  controller.pressJump();
  let apex = 0;
  let airtime = 0;
  do {
    controller.update(dt, STILL);
    airtime += dt;
    apex = Math.max(apex, controller.position.y);
  } while (!controller.grounded && airtime < 5);
  return { apex, airtime };
}

describe('FirstPersonController jumping (LAI-JMP-01)', () => {
  describe('grounded and airborne', () => {
    it('starts grounded and idle at feet height 0', () => {
      const controller = new FirstPersonController();
      controller.update(FRAME, STILL);
      expect(controller.grounded).toBe(true);
      expect(controller.position.y).toBe(0);
      expect(controller.movementState).toBe('IDLE');
    });

    it('goes grounded -> jump start -> airborne -> falling -> landing -> idle', () => {
      const controller = new FirstPersonController();
      const seen: string[] = [];
      const note = () => {
        if (seen.at(-1) !== controller.movementState) seen.push(controller.movementState);
      };
      controller.update(FRAME, STILL);
      note();
      controller.pressJump();
      controller.update(FRAME, STILL);
      note();
      expect(controller.grounded).toBe(false);
      runUntil(controller, STILL, () => {
        note();
        return controller.grounded;
      });
      run(controller, STILL, 0.5);
      note();
      expect(seen).toEqual(['IDLE', 'JUMP_START', 'AIRBORNE', 'FALLING', 'LANDING', 'IDLE']);
    });

    it('reports one JUMPED and one LANDED event per jump', () => {
      const controller = new FirstPersonController();
      controller.pressJump();
      runUntil(controller, STILL, () => controller.grounded && controller.position.y === 0, FRAME);
      run(controller, STILL, 0.2);
      const events = controller.consumeEvents();
      expect(types(events)).toEqual(['JUMPED', 'LANDED']);
      const landed = events[1];
      expect(landed.type === 'LANDED' && landed.impactSpeed).toBeGreaterThan(5);
      expect(controller.consumeEvents()).toEqual([]);
    });
  });

  describe('standing and moving jumps', () => {
    it('a standing jump rises to the configured height and comes straight back down', () => {
      const controller = new FirstPersonController();
      const { apex } = apexOfJump(controller, FRAME);
      expect(apex).toBeCloseTo(DEFAULT_JUMP_CONFIGURATION.jumpHeight, 1);
      expect(controller.position.x).toBe(0);
      expect(controller.position.z).toBe(0);
      expect(controller.position.y).toBe(0);
    });

    it('honours a per-location jump height', () => {
      const controller = new FirstPersonController({ jump: { jumpHeight: 0.6 } });
      expect(apexOfJump(controller, FRAME).apex).toBeCloseTo(0.6, 1);
    });

    it('a moving jump carries the walking speed forward through the air', () => {
      const controller = new FirstPersonController({ acceleration: 1000 });
      run(controller, FORWARD, 0.5);
      const takeOffZ = controller.position.z;
      controller.pressJump();
      controller.update(FRAME, FORWARD);
      runUntil(controller, FORWARD, () => controller.grounded);
      const distance = controller.position.z - takeOffZ;
      const airtime =
        (2 * jumpLaunchSpeed(DEFAULT_JUMP_CONFIGURATION)) / DEFAULT_JUMP_CONFIGURATION.gravity;
      expect(distance).toBeCloseTo(4 * airtime, 0);
    });
  });

  describe('gravity and landing', () => {
    it('launches at sqrt(2gh) and lands back on the ground with no bounce', () => {
      const controller = new FirstPersonController();
      controller.pressJump();
      controller.update(1e-6, STILL);
      expect(controller.verticalVelocity).toBeCloseTo(
        jumpLaunchSpeed(DEFAULT_JUMP_CONFIGURATION),
        3,
      );
      runUntil(controller, STILL, () => controller.grounded);
      expect(controller.position.y).toBe(0);
      expect(controller.verticalVelocity).toBe(0);
      run(controller, STILL, 1);
      expect(controller.position.y).toBe(0);
    });

    it('caps falling speed at maxFallSpeed', () => {
      const controller = new FirstPersonController({
        jump: { maxFallSpeed: 5 },
        groundHeightAt: () => null,
        recoveryDepth: -1000,
      });
      run(controller, STILL, 3);
      expect(controller.verticalVelocity).toBeCloseTo(-5, 5);
    });
  });

  describe('airborne movement', () => {
    it('still steers in the air, at airControl of the ground rate', () => {
      const steering = new FirstPersonController({ jump: { airControl: 1 } });
      const drifting = new FirstPersonController({ jump: { airControl: 0 } });
      for (const controller of [steering, drifting]) {
        controller.pressJump();
        controller.update(FRAME, STILL);
        run(controller, { forward: 0, strafe: 1 }, 0.3);
      }
      expect(Math.abs(steering.position.x)).toBeGreaterThan(0.3);
      expect(drifting.position.x).toBe(0);
    });

    it('keeps take-off momentum when input stops mid-air', () => {
      const controller = new FirstPersonController({ acceleration: 1000 });
      run(controller, FORWARD, 0.5);
      controller.pressJump();
      controller.update(FRAME, FORWARD);
      const before = controller.horizontalSpeed;
      run(controller, STILL, 0.1);
      expect(controller.grounded).toBe(false);
      expect(controller.horizontalSpeed).toBeGreaterThan(before * 0.5);
    });
  });

  describe('no unintended jumps', () => {
    it('one press jumps once, however long the child keeps moving', () => {
      const controller = new FirstPersonController();
      controller.pressJump();
      run(controller, FORWARD, 3);
      expect(types(controller.consumeEvents()).filter((type) => type === 'JUMPED')).toHaveLength(1);
      expect(controller.grounded).toBe(true);
    });

    it('does not double-jump by default: a press in mid-air does nothing', () => {
      const controller = new FirstPersonController();
      controller.pressJump();
      run(controller, STILL, 0.25);
      expect(controller.grounded).toBe(false);
      const falling = controller.verticalVelocity;
      controller.pressJump();
      controller.update(FRAME, STILL);
      expect(controller.verticalVelocity).toBeLessThan(falling);
      expect(types(controller.consumeEvents())).toEqual(['JUMPED']);
    });

    it('allows exactly one air jump where a location enables double jump', () => {
      const controller = new FirstPersonController({ jump: { allowDoubleJump: true } });
      controller.pressJump();
      run(controller, STILL, 0.25);
      controller.pressJump();
      controller.update(FRAME, STILL);
      run(controller, STILL, 0.1);
      controller.pressJump();
      controller.update(FRAME, STILL);
      const jumps = controller.consumeEvents().filter((event) => event.type === 'JUMPED');
      expect(jumps).toHaveLength(2);
      expect(jumps[1]).toMatchObject({ airJump: true });
    });
  });

  describe('coyote time', () => {
    // A ledge 1 m tall ending at z = 1 (about 0.3 s of fall); the child walks off its far edge.
    const ledge = () => box(-2, 2, 0, 1, -2, 1);

    function walkOffLedge(coyoteTimeMs: number) {
      const controller = withJumpable([ledge()], {
        startPosition: new Vector3(0, 1, 0),
        acceleration: 1000,
        jump: { coyoteTimeMs },
      });
      runUntil(controller, FORWARD, () => !controller.grounded);
      controller.consumeEvents();
      return controller;
    }

    it('still jumps shortly after walking off an edge', () => {
      const controller = walkOffLedge(120);
      run(controller, FORWARD, 0.05);
      controller.pressJump();
      controller.update(FRAME, FORWARD);
      expect(controller.consumeEvents()).toEqual([
        { type: 'JUMPED', fromCoyote: true, buffered: false, airJump: false },
      ]);
      expect(controller.verticalVelocity).toBeGreaterThan(0);
    });

    it('does not jump once the coyote window has passed', () => {
      const controller = walkOffLedge(120);
      run(controller, FORWARD, 0.15);
      expect(controller.grounded).toBe(false);
      controller.pressJump();
      controller.update(FRAME, FORWARD);
      expect(types(controller.consumeEvents())).not.toContain('JUMPED');
    });
  });

  describe('jump buffering', () => {
    function fallingNearGround(jumpBufferMs: number) {
      const controller = new FirstPersonController({ jump: { jumpBufferMs } });
      controller.pressJump();
      controller.update(FRAME, STILL);
      // Falling, a few frames above the ground.
      runUntil(
        controller,
        STILL,
        () => controller.verticalVelocity < 0 && controller.position.y < 0.3,
      );
      controller.consumeEvents();
      return controller;
    }

    it('a press just before landing jumps on landing', () => {
      const controller = fallingNearGround(150);
      controller.pressJump();
      runUntil(
        controller,
        STILL,
        () => controller.consumeEvents().some((e) => e.type === 'JUMPED'),
        FRAME,
        30,
      );
      expect(controller.verticalVelocity).toBeGreaterThan(0);
    });

    it('a press too early is forgotten', () => {
      const controller = new FirstPersonController({ jump: { jumpBufferMs: 100 } });
      controller.pressJump();
      controller.update(FRAME, STILL);
      run(controller, STILL, 0.1);
      controller.pressJump(); // still rising: far more than 100 ms from landing
      runUntil(controller, STILL, () => controller.grounded);
      run(controller, STILL, 0.3);
      expect(types(controller.consumeEvents())).toEqual(['JUMPED', 'LANDED']);
    });

    it('clearJumpInput drops a buffered press (focus lost, panel opened)', () => {
      const controller = fallingNearGround(400);
      controller.pressJump();
      controller.update(FRAME, STILL);
      controller.clearJumpInput();
      runUntil(controller, STILL, () => controller.grounded);
      run(controller, STILL, 0.3);
      expect(types(controller.consumeEvents())).toEqual(['LANDED']);
    });
  });

  describe('enabled and disabled', () => {
    it('ignores presses where jumping is off, and walks as before', () => {
      const controller = new FirstPersonController({ jump: { enabled: false } });
      expect(controller.jumpEnabled).toBe(false);
      controller.pressJump();
      run(controller, FORWARD, 0.5);
      expect(controller.position.y).toBe(0);
      expect(controller.consumeEvents()).toEqual([]);
      expect(controller.position.z).toBeGreaterThan(0);
    });

    it('still falls off a ledge where jumping is off', () => {
      const controller = withJumpable([box(-2, 2, 0, 0.5, -2, 1)], {
        startPosition: new Vector3(0, 0.5, 0),
        jump: { enabled: false },
      });
      runUntil(controller, FORWARD, () => controller.position.z > 1.5);
      runUntil(controller, STILL, () => controller.grounded);
      expect(controller.position.y).toBe(0);
    });

    it('configureJump can turn jumping off and drops a pending press', () => {
      const controller = new FirstPersonController();
      controller.pressJump();
      controller.configureJump({ enabled: false });
      controller.update(FRAME, STILL);
      expect(controller.grounded).toBe(true);
    });
  });

  describe('frame-rate independence', () => {
    it.each([30, 60, 144])('reaches the same apex and airtime at %i fps', (fps) => {
      const { apex, airtime } = apexOfJump(new FirstPersonController(), 1 / fps);
      const expectedAirtime =
        (2 * jumpLaunchSpeed(DEFAULT_JUMP_CONFIGURATION)) / DEFAULT_JUMP_CONFIGURATION.gravity;
      expect(apex).toBeCloseTo(DEFAULT_JUMP_CONFIGURATION.jumpHeight, 1);
      expect(Math.abs(airtime - expectedAirtime)).toBeLessThanOrEqual(1 / fps + 1e-6);
    });

    it('a long frame (a background tab) does not tunnel through the ground', () => {
      const controller = new FirstPersonController();
      controller.pressJump();
      controller.update(0.1, STILL);
      for (let i = 0; i < 20; i += 1) controller.update(0.1, STILL);
      expect(controller.position.y).toBe(0);
      expect(controller.grounded).toBe(true);
    });
  });

  describe('collisions', () => {
    it('a solid wall still blocks at the top of a jump', () => {
      const wall = box(-2, 2, -1, 0.5, 1, 1.5); // low, but solid: a gate, not an obstacle
      const controller = new FirstPersonController({ colliders: [wall], acceleration: 1000 });
      controller.pressJump();
      run(controller, FORWARD, 2);
      expect(controller.position.z).toBeLessThan(1);
    });

    it('a jumpable crate blocks walking but can be jumped onto, walked along and stepped off', () => {
      const crate = box(-1, 1, 0, 0.8, 1, 3);
      const controller = withJumpable([crate], { acceleration: 1000 });
      run(controller, FORWARD, 1);
      expect(controller.position.z).toBeLessThan(1);
      expect(controller.position.y).toBe(0);

      controller.pressJump();
      runUntil(controller, FORWARD, () => controller.grounded && controller.position.y > 0);
      expect(controller.position.y).toBeCloseTo(0.8, 5);
      expect(controller.position.z).toBeGreaterThan(1);

      runUntil(controller, FORWARD, () => controller.position.z > 3.5 && controller.grounded);
      expect(controller.position.y).toBe(0);
    });

    it('jumps clean over a low log', () => {
      const log = box(-2, 2, 0, 0.4, 2, 2.4);
      const controller = withJumpable([log], { acceleration: 1000 });
      run(controller, FORWARD, 0.2);
      controller.pressJump();
      runUntil(controller, FORWARD, () => controller.position.z > 3 && controller.grounded);
      expect(controller.position.y).toBe(0);
    });

    it('walks up a step no taller than stepHeight without jumping', () => {
      const step = box(-2, 2, 0, 0.2, 1, 4);
      const controller = withJumpable([step], { acceleration: 1000 });
      runUntil(controller, FORWARD, () => controller.position.z > 2);
      expect(controller.grounded).toBe(true);
      expect(controller.position.y).toBeCloseTo(0.2, 5);
    });

    it('bumps its head on a jumpable underside and falls back', () => {
      const shelf = box(-2, 2, 2, 2.5, -2, 2); // underside 2 m up, over the child
      const controller = withJumpable([shelf]);
      const { apex } = apexOfJump(controller, FRAME);
      expect(apex).toBeLessThanOrEqual(2 - 1.7 + 1e-6);
      expect(controller.position.y).toBe(0);
    });

    it('canStandAt and teleportTo refuse the inside of a crate', () => {
      const crate = box(-1, 1, 0, 0.8, 1, 3);
      const controller = withJumpable([crate]);
      expect(controller.canStandAt(0, 2)).toBe(false);
      expect(controller.teleportTo(0, 2)).toBe(false);
      expect(controller.teleportTo(0, 5)).toBe(true);
    });
  });

  describe('safe recovery', () => {
    it('puts a child who falls out of the world back where they last stood', () => {
      // Ground ends at z = 1: a hole beyond it.
      const controller = new FirstPersonController({
        acceleration: 1000,
        groundHeightAt: (_x, z) => (z < 1 ? 0 : null),
        recoveryDepth: -5,
      });
      runUntil(controller, FORWARD, () => !controller.grounded);
      const lastSafeZ = controller.position.z;
      runUntil(controller, STILL, () =>
        controller.consumeEvents().some((event) => event.type === 'RECOVERED'),
      );
      expect(controller.grounded).toBe(true);
      expect(controller.position.y).toBe(0);
      expect(controller.position.z).toBeLessThan(1);
      expect(controller.position.z).toBeLessThanOrEqual(lastSafeZ);
      expect(controller.horizontalSpeed).toBe(0);
    });

    it('puts back a child outside the playable area', () => {
      const controller = new FirstPersonController({
        acceleration: 1000,
        isInPlayableArea: (_x, z) => z < 1,
      });
      runUntil(controller, FORWARD, () =>
        controller
          .consumeEvents()
          .some((event) => event.type === 'RECOVERED' && event.reason === 'LEFT_PLAYABLE_AREA'),
      );
      expect(controller.position.z).toBeLessThan(1);
    });

    it('recovers from a non-finite position', () => {
      const controller = new FirstPersonController();
      controller.update(FRAME, STILL);
      controller.position.x = Number.NaN;
      controller.update(FRAME, STILL);
      expect(controller.consumeEvents()).toEqual([
        { type: 'RECOVERED', reason: 'INVALID_POSITION' },
      ]);
      expect(controller.position.x).toBe(0);
    });

    it('teleport lands the child on the ground with no jump in progress', () => {
      const controller = new FirstPersonController();
      controller.pressJump();
      run(controller, STILL, 0.2);
      controller.teleport(3, 4, 1);
      expect(controller.position.toArray()).toEqual([3, 0, 4]);
      expect(controller.grounded).toBe(true);
      expect(controller.verticalVelocity).toBe(0);
    });
  });
});
