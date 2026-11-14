import { describe, expect, it } from 'vitest';
import { advanceMotion, createPathMotion, initialMotionState, motionOffset } from './platformMotion';

const at = (motion: ReturnType<typeof createPathMotion>, state: ReturnType<typeof initialMotionState>) =>
  motionOffset(motion, state, { x: 0, y: 0, z: 0 });

describe('platform path motion', () => {
  it('interpolates along a horizontal path at its speed', () => {
    const motion = createPathMotion([{ x: 4, y: 0, z: 0 }], 'PING_PONG');
    const state = initialMotionState();
    advanceMotion(motion, state, 1, 2);
    expect(at(motion, state).x).toBeCloseTo(2);
    advanceMotion(motion, state, 0.5, 2);
    expect(at(motion, state).x).toBeCloseTo(3);
  });

  it('ping-pongs: waits at the end, then comes back', () => {
    const motion = createPathMotion([{ x: 0, y: 3, z: 0 }], 'PING_PONG', 1);
    const state = initialMotionState();
    advanceMotion(motion, state, 1.5, 2); // reaches the top at 1.5 s
    expect(at(motion, state).y).toBeCloseTo(3);
    advanceMotion(motion, state, 0.9, 2); // still waiting
    expect(at(motion, state).y).toBeCloseTo(3);
    advanceMotion(motion, state, 0.6, 2); // 0.1 s pause left, then 0.5 s down
    expect(at(motion, state).y).toBeCloseTo(2);
  });

  it('loops through every waypoint and back to the start', () => {
    const motion = createPathMotion([{ x: 2, y: 0, z: 0 }, { x: 2, y: 0, z: 2 }], 'LOOP');
    const state = initialMotionState();
    advanceMotion(motion, state, 3, 1); // 2 m to the first, 1 m toward the second
    expect(at(motion, state)).toEqual({ x: 2, y: 0, z: 1 });
    advanceMotion(motion, state, 1 + 2 * Math.SQRT2, 1); // the rest, and the closing leg
    const back = at(motion, state);
    expect(back.x).toBeCloseTo(0);
    expect(back.z).toBeCloseTo(0);
  });

  it('stops at the end of a ONCE path', () => {
    const motion = createPathMotion([{ x: 0, y: 2, z: 0 }], 'ONCE');
    const state = initialMotionState();
    advanceMotion(motion, state, 10, 1);
    expect(state.finished).toBe(true);
    expect(at(motion, state).y).toBeCloseTo(2);
    expect(advanceMotion(motion, state, 1, 1)).toBe(false);
  });

  it('returns to the start on request and stops there', () => {
    const motion = createPathMotion([{ x: 4, y: 0, z: 0 }], 'PING_PONG');
    const state = initialMotionState();
    advanceMotion(motion, state, 1.5, 2); // at x = 3, heading out
    advanceMotion(motion, state, 1, 2, true); // turns round: 3 -> 1
    expect(at(motion, state).x).toBeCloseTo(1);
    advanceMotion(motion, state, 5, 2, true);
    expect(at(motion, state).x).toBeCloseTo(0);
    expect(advanceMotion(motion, state, 1, 2, true)).toBe(false);
  });

  it('is deterministic however the time is split into frames', () => {
    const motion = createPathMotion([{ x: 5, y: 0, z: 0 }, { x: 5, y: 2, z: 3 }], 'PING_PONG', 0.4);
    const coarse = initialMotionState();
    const fine = initialMotionState();
    for (let i = 0; i < 30; i += 1) advanceMotion(motion, coarse, 1 / 30, 1.5);
    for (let i = 0; i < 144; i += 1) advanceMotion(motion, fine, 1 / 144, 1.5);
    const a = at(motion, coarse);
    const b = at(motion, fine);
    expect(a.x).toBeCloseTo(b.x, 5);
    expect(a.y).toBeCloseTo(b.y, 5);
    expect(a.z).toBeCloseTo(b.z, 5);
  });
});
