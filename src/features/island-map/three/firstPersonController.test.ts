import { Box3, Vector3 } from 'three';
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
    const controller = new FirstPersonController({ acceleration: 100, deceleration: 5, maxSpeed: 4 });

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
});
