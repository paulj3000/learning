import { Box3, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { FirstPersonController } from './firstPersonController';

describe('FirstPersonController', () => {
  it('eases toward top speed rather than moving there instantly', () => {
    const controller = new FirstPersonController({ acceleration: 5, maxSpeed: 4 });

    controller.update(0.1, { forward: 1, strafe: 0 });
    const distanceAfterOneStep = controller.position.z;

    expect(distanceAfterOneStep).toBeGreaterThan(0);
    // With acceleration 5 and dt 0.1, velocity only eased 50% of the way to
    // max speed, so one step should cover much less than max-speed * dt.
    expect(distanceAfterOneStep).toBeLessThan(4 * 0.1);
  });

  it('decelerates toward zero rather than stopping instantly when input drops', () => {
    const controller = new FirstPersonController({
      acceleration: 100,
      deceleration: 5,
      maxSpeed: 4,
    });

    // Get up to speed first (high acceleration so it's effectively at max).
    for (let i = 0; i < 20; i++) {
      controller.update(0.1, { forward: 1, strafe: 0 });
    }
    const positionAtSpeed = controller.position.z;

    controller.update(0.1, { forward: 0, strafe: 0 });
    const advanceAfterInputStops = controller.position.z - positionAtSpeed;

    expect(advanceAfterInputStops).toBeGreaterThan(0);
    expect(advanceAfterInputStops).toBeLessThan(4 * 0.1);
  });

  it('clamps pitch so the camera cannot flip past straight up or down', () => {
    const controller = new FirstPersonController({ maxPitch: 1 });

    controller.applyLookDelta(0, -100000);
    expect(controller.pitch).toBeCloseTo(1);

    controller.applyLookDelta(0, 100000);
    expect(controller.pitch).toBeCloseTo(-1);
  });

  it('stops movement into a collider on the blocked axis while still sliding on the other', () => {
    const wall = new Box3(new Vector3(-1, -1, 0.5), new Vector3(1, 1, 1.5));
    const controller = new FirstPersonController({
      acceleration: 1000,
      maxSpeed: 4,
      colliders: [wall],
    });

    // Facing +Z (yaw 0), moving straight into the wall.
    for (let i = 0; i < 10; i++) {
      controller.update(0.1, { forward: 1, strafe: 0 });
    }

    expect(controller.position.z).toBeLessThan(0.5);
  });

  it('does not move when there is no input and velocity has already settled', () => {
    const controller = new FirstPersonController({ acceleration: 1000, deceleration: 1000 });

    controller.update(0.1, { forward: 0, strafe: 0 });

    expect(controller.position.x).toBe(0);
    expect(controller.position.z).toBe(0);
  });

  describe('placing the child', () => {
    const wall = new Box3(new Vector3(2, 0, -5), new Vector3(3, 3, 5));

    it('puts the child on open ground, facing the given way, looking level', () => {
      const controller = new FirstPersonController({ colliders: [wall] });
      controller.pitch = 0.4;

      expect(controller.teleportTo(-4, 1.5, Math.PI / 2)).toBe(true);

      expect(controller.position.x).toBe(-4);
      expect(controller.position.z).toBe(1.5);
      expect(controller.yaw).toBeCloseTo(Math.PI / 2);
      expect(controller.pitch).toBe(0);
    });

    it('refuses a solid spot and moves nothing', () => {
      const controller = new FirstPersonController({ colliders: [wall] });
      controller.position.set(-1, 0, 0);
      controller.yaw = 1;

      expect(controller.canStandAt(2.5, 0)).toBe(false);
      expect(controller.teleportTo(2.5, 0, 3)).toBe(false);

      expect(controller.position.x).toBe(-1);
      expect(controller.yaw).toBe(1);
    });

    it('keeps the current heading when none is given', () => {
      const controller = new FirstPersonController({ colliders: [wall] });
      controller.yaw = 0.7;

      controller.teleportTo(-3, 0);

      expect(controller.yaw).toBeCloseTo(0.7);
    });

    it('drops leftover walking speed, so the child is not carried on after being placed', () => {
      const controller = new FirstPersonController({
        colliders: [wall],
        acceleration: 1000,
        maxSpeed: 4,
      });
      for (let i = 0; i < 10; i++) controller.update(0.05, { forward: 1, strafe: 0 });
      controller.yaw = 0;

      controller.teleportTo(-4, -4, 0);
      const placed = controller.position.z;
      controller.update(0.1, { forward: 0, strafe: 0 });

      expect(controller.position.z).toBeCloseTo(placed, 9);
    });

    it('reads colliders as they are now, including one added after construction', () => {
      const colliders: Box3[] = [];
      const controller = new FirstPersonController({ colliders });
      expect(controller.canStandAt(0, 0)).toBe(true);

      colliders.push(new Box3(new Vector3(-1, 0, -1), new Vector3(1, 3, 1)));

      expect(controller.canStandAt(0, 0)).toBe(false);
    });
  });
});

describe('FirstPersonController strafe direction (ArrowLeft walked right)', () => {
  /** Screen-right of the camera the runtimes build: `rotation.y = yaw + PI`. */
  function cameraRight(yaw: number): Vector3 {
    const camera = new PerspectiveCamera();
    camera.rotation.y = yaw + Math.PI;
    camera.updateMatrixWorld();
    return new Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  }

  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0.7]) {
    it(`moves toward the camera's right on strafe +1 and left on -1 (yaw ${yaw.toFixed(2)})`, () => {
      const right = cameraRight(yaw);
      for (const strafe of [1, -1]) {
        const controller = new FirstPersonController({ acceleration: 1000 });
        controller.yaw = yaw;
        controller.update(0.1, { forward: 0, strafe });
        const moved = new Vector3(controller.position.x, 0, controller.position.z).normalize();
        expect(moved.dot(right)).toBeCloseTo(strafe, 5);
      }
    });
  }

  it('strafes at right angles to forward', () => {
    const controller = new FirstPersonController({ acceleration: 1000 });
    controller.yaw = 0.7;
    controller.update(0.1, { forward: 0, strafe: 1 });
    const forward = new Vector3(Math.sin(0.7), 0, Math.cos(0.7));
    expect(new Vector3(controller.position.x, 0, controller.position.z).dot(forward)).toBeCloseTo(0, 5);
  });
});
