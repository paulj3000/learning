import { describe, expect, it } from 'vitest';
import type { WalkabilityInput } from '@lai/game-engine/navigation';
import { createGuidedWalk } from './guidedWalk';

const wall = (minX: number, minZ: number, maxX: number, maxZ: number) => ({
  min: { x: minX, y: -1, z: minZ },
  max: { x: maxX, y: 2, z: maxZ },
});
const YARD = { minX: -10, maxX: 10, minZ: -10, maxZ: 10 };
const IDLE = { forward: 0, strafe: 0 };

function setup(walkability: () => WalkabilityInput, reducedMotion = false) {
  const position = { x: -6, z: 0 };
  const walk = createGuidedWalk({ walkability, position: () => position, reducedMotion });
  return { walk, position };
}

describe('guided walk (live glue)', () => {
  it('plans round a wall and steers the shared controller input toward the first leg', () => {
    const { walk, position } = setup(() => ({ bounds: YARD, colliders: [wall(-0.3, -8, 0.3, 4)] }));
    const path = walk.walkTo({ x: 5, z: 0 });
    expect(path?.status).toBe('REACHED');
    expect(walk.active).toBe(true);
    const input = walk.shapeInput(IDLE, 0.016, 0);
    expect(Math.hypot(input.forward, input.strafe)).toBeGreaterThan(0.5);
    expect(input.analog).toBeUndefined();
    expect(position.x).toBe(-6);
  });

  it('a manual push cancels the walk and is passed through untouched', () => {
    const { walk } = setup(() => ({ bounds: YARD, colliders: [] }));
    walk.walkTo({ x: 5, z: 0 });
    const manual = { forward: 1, strafe: 0, analog: true };
    expect(walk.shapeInput(manual, 0.016, 0)).toBe(manual);
    expect(walk.active).toBe(false);
    expect(walk.consumeEvents().map((event) => event.type)).toEqual(['STARTED', 'CANCELLED']);
  });

  it('an object tap stops at approach range and then turns to face the object', () => {
    const { walk, position } = setup(() => ({ bounds: YARD, colliders: [] }));
    const path = walk.walkTo({ x: 4, z: 0 }, { stopWithin: 2, faceTarget: true });
    expect(path?.goalDistance).toBeLessThanOrEqual(2);
    position.x = (path?.goal.x ?? 0) - 1;
    walk.shapeInput(IDLE, 0.016, 0);
    expect(walk.active).toBe(true);
    position.x = path?.goal.x ?? 0;
    walk.shapeInput(IDLE, 0.016, 0);
    expect(walk.active).toBe(false);
    expect(walk.consumeEvents().map((event) => event.type)).toContain('ARRIVED');
    // Facing +X is yaw PI/2: the view turns toward it from yaw 0.
    const turned = walk.assistYaw(0, 0.1);
    expect(turned).toBeGreaterThan(0);
    expect(turned).toBeLessThan(Math.PI / 2);
  });

  it('replans once from where the child is when it gets stuck, then gives up', () => {
    let plans = 0;
    const { walk } = setup(() => {
      plans += 1;
      return { bounds: YARD, colliders: [] };
    });
    walk.walkTo({ x: 8, z: 0 });
    expect(plans).toBe(1);
    // The child never moves: no progress.
    for (let frame = 0; frame < 20 * 4 && (walk.active || plans < 2); frame += 1) {
      walk.shapeInput(IDLE, 0.25, 0);
    }
    for (let frame = 0; frame < 20 * 4 && walk.active; frame += 1) {
      walk.shapeInput(IDLE, 0.25, 0);
    }
    expect(plans).toBe(2);
    expect(walk.active).toBe(false);
    expect(walk.consumeEvents().map((event) => event.type)).toContain('CANCELLED');
  });

  it('a walled-in start refuses to start', () => {
    const { walk } = setup(() => ({ bounds: YARD, colliders: [wall(-10, -10, 10, 10)] }));
    expect(walk.walkTo({ x: 5, z: 0 })).toBeNull();
    expect(walk.active).toBe(false);
  });

  it('the assisted camera holds still under reduced motion unless the heading is far away', () => {
    const { walk } = setup(() => ({ bounds: YARD, colliders: [] }), true);
    walk.walkTo({ x: -6, z: 8 });
    walk.shapeInput(IDLE, 0.016, 0);
    // Heading +Z is yaw 0: already behind the child.
    expect(walk.assistYaw(0.2, 0.016)).toBe(0.2);
    walk.cancel();
    walk.walkTo({ x: 8, z: 0 });
    walk.shapeInput(IDLE, 0.016, 0);
    // Heading +X (PI/2) from yaw -1.2 is well away: one cut, no sweep.
    expect(walk.assistYaw(-1.2, 0.016)).toBeCloseTo(Math.PI / 2, 5);
  });
});
