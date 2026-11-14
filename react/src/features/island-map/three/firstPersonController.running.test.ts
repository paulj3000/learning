import { Box3, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { FirstPersonController, MAX_COLLISION_STEP, type MoveInput } from './firstPersonController';

const FRAME = 1 / 60;
const KEYS: MoveInput = { forward: 1, strafe: 0 };
const STICK: MoveInput = { forward: 1, strafe: 0, analog: true };
const SPRINT: MoveInput = { forward: 1, strafe: 0, sprint: true };
const STILL: MoveInput = { forward: 0, strafe: 0 };

function run(controller: FirstPersonController, input: MoveInput, seconds: number, dt = FRAME) {
  for (let i = 0; i < Math.round(seconds / dt); i += 1) controller.update(dt, input);
}

function box(minX: number, maxX: number, minZ: number, maxZ: number, maxY = 3) {
  return new Box3(new Vector3(minX, -1, minZ), new Vector3(maxX, maxY, maxZ));
}

/** Horizontal distance from take-off to landing for a jump started at full `input` speed. */
function jumpDistance(input: MoveInput): number {
  const controller = new FirstPersonController();
  run(controller, input, 2);
  const start = controller.position.z;
  controller.pressJump();
  controller.update(FRAME, input);
  let frames = 0;
  while (!controller.grounded && frames < 300) {
    controller.update(FRAME, input);
    frames += 1;
  }
  return controller.position.z - start;
}

describe('FirstPersonController running & sprinting', () => {
  it('walks at 4 m/s with the keys, exactly as before', () => {
    const controller = new FirstPersonController();
    run(controller, KEYS, 1);
    expect(controller.horizontalSpeed).toBeCloseTo(4, 3);
    expect(controller.gait).toBe('walk');
    expect(controller.movementState).toBe('WALK');
  });

  it('runs at 5.5 m/s with a fully tilted stick or a long drag', () => {
    const controller = new FirstPersonController();
    run(controller, STICK, 1);
    expect(controller.horizontalSpeed).toBeCloseTo(5.5, 3);
    expect(controller.gait).toBe('run');
    expect(controller.movementState).toBe('RUN');
  });

  it('walks with a partly tilted stick', () => {
    const controller = new FirstPersonController();
    run(controller, { forward: 0.5, strafe: 0, analog: true }, 1);
    expect(controller.horizontalSpeed).toBeCloseTo(2.5, 3);
    expect(controller.gait).toBe('walk');
  });

  it('sprints at 6.5 m/s with sprint on', () => {
    const controller = new FirstPersonController();
    run(controller, SPRINT, 1.5);
    expect(controller.horizontalSpeed).toBeCloseTo(6.5, 3);
    expect(controller.gait).toBe('sprint');
    expect(controller.movementState).toBe('SPRINT');
  });

  it('eases from walking to sprinting over about a third of a second, never in one step', () => {
    const controller = new FirstPersonController();
    run(controller, KEYS, 1);
    let previous = controller.horizontalSpeed;
    let frames = 0;
    while (controller.horizontalSpeed < 6.49 && frames < 120) {
      controller.update(FRAME, SPRINT);
      expect(controller.horizontalSpeed - previous).toBeLessThanOrEqual(8 * FRAME + 1e-9);
      previous = controller.horizontalSpeed;
      frames += 1;
    }
    expect(frames * FRAME).toBeGreaterThan(0.25);
    expect(frames * FRAME).toBeLessThan(0.6);
  });

  it('eases back down from sprinting to walking, and still stops quickly when let go', () => {
    const controller = new FirstPersonController();
    run(controller, SPRINT, 1.5);
    controller.update(FRAME, KEYS);
    expect(controller.horizontalSpeed).toBeGreaterThan(6.5 - 10 * FRAME - 1e-9);
    run(controller, KEYS, 1);
    expect(controller.horizontalSpeed).toBeCloseTo(4, 3);
    run(controller, SPRINT, 1.5);
    run(controller, STILL, 0.3);
    expect(controller.horizontalSpeed).toBeLessThan(0.1);
  });

  it('honours a location turning running and sprinting off', () => {
    const controller = new FirstPersonController({
      locomotion: { runEnabled: false, sprintEnabled: false },
    });
    run(controller, { ...STICK, sprint: true }, 1.5);
    expect(controller.horizontalSpeed).toBeCloseTo(4, 3);
  });

  it('uses a location’s own speeds (an indoor castle)', () => {
    const controller = new FirstPersonController({
      locomotion: { runSpeed: 4.8, sprintSpeed: 5.6 },
    });
    run(controller, SPRINT, 1.5);
    expect(controller.horizontalSpeed).toBeCloseTo(5.6, 3);
    expect(controller.speeds.runSpeed).toBe(4.8);
  });

  describe('running jumps', () => {
    it('carry further the faster the take-off, at the same height', () => {
      const standing = jumpDistance(STILL);
      const walking = jumpDistance(KEYS);
      const running = jumpDistance(STICK);
      const sprinting = jumpDistance(SPRINT);
      expect(standing).toBeCloseTo(0, 5);
      expect(running).toBeGreaterThan(walking + 0.5);
      expect(sprinting).toBeGreaterThan(running + 0.3);
    });

    it('do not change the jump’s height', () => {
      const apex = (input: MoveInput) => {
        const controller = new FirstPersonController();
        run(controller, input, 2);
        controller.pressJump();
        let top = 0;
        for (let i = 0; i < 60; i += 1) {
          controller.update(FRAME, input);
          top = Math.max(top, controller.position.y);
        }
        return top;
      };
      expect(apex(SPRINT)).toBeCloseTo(apex(STILL), 6);
    });
  });

  describe('collision at full speed', () => {
    it('never tunnels through a thin wall on a long frame while sprinting', () => {
      // A wall only 0.12 m thick, and frames as long as the engine allows (0.1 s = 0.65 m a frame).
      const wall = box(-5, 5, 3, 3.12);
      const controller = new FirstPersonController({ colliders: [wall] });
      run(controller, SPRINT, 3, 0.1);
      expect(controller.position.z).toBeLessThan(3);
      expect(MAX_COLLISION_STEP).toBeLessThan(0.12);
    });

    it('keeps a low solid gate solid, even sprinting and jumping at it', () => {
      const gate = box(-5, 5, 3, 3.3, 0.5); // low, but solid: a quest gate
      const controller = new FirstPersonController({ colliders: [gate] });
      for (let i = 0; i < 6; i += 1) {
        controller.pressJump();
        run(controller, SPRINT, 0.5);
      }
      expect(controller.position.z).toBeLessThan(3);
    });

    it('still slides along a wall at sprinting speed', () => {
      const wall = box(-5, 5, 2, 2.5);
      const controller = new FirstPersonController({ colliders: [wall] });
      run(controller, { forward: 1, strafe: 1, sprint: true }, 1, 0.1);
      expect(controller.position.z).toBeLessThan(2);
      expect(Math.abs(controller.position.x)).toBeGreaterThan(2);
    });

    it('still recovers a child who sprints off the world', () => {
      const controller = new FirstPersonController({
        groundHeightAt: (_x, z) => (z < 2 ? 0 : null),
        recoveryDepth: -5,
      });
      let recovered = false;
      for (let i = 0; i < 300 && !recovered; i += 1) {
        controller.update(FRAME, SPRINT);
        recovered = controller.consumeEvents().some((event) => event.type === 'RECOVERED');
      }
      expect(recovered).toBe(true);
      expect(controller.position.z).toBeLessThan(2);
      expect(controller.grounded).toBe(true);
      expect(controller.horizontalSpeed).toBe(0);
    });
  });
});
