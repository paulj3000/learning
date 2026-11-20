import { describe, expect, it } from 'vitest';
import { CameraHeightFollower, MAX_LANDING_DIP } from './cameraHeightFollower';

const FRAME = 1 / 60;

describe('CameraHeightFollower (LAI-JMP-01)', () => {
  it('rides a jump exactly while airborne', () => {
    const follower = new CameraHeightFollower();
    follower.update(FRAME, 0, true);
    expect(follower.update(FRAME, 0.7, false)).toBe(0.7);
    expect(follower.update(FRAME, 1.1, false)).toBe(1.1);
  });

  it('eases a sudden step up on the ground instead of snapping', () => {
    const follower = new CameraHeightFollower();
    follower.update(FRAME, 0, true);
    const first = follower.update(FRAME, 0.25, true);
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(0.25);
    let height = first;
    for (let i = 0; i < 60; i += 1) height = follower.update(FRAME, 0.25, true);
    expect(height).toBeCloseTo(0.25, 3);
  });

  it('dips slightly on a hard landing and springs back', () => {
    const follower = new CameraHeightFollower();
    follower.update(FRAME, 0, true);
    follower.landed(7);
    const dipped = follower.update(FRAME, 0, true);
    expect(dipped).toBeLessThan(0);
    expect(dipped).toBeGreaterThanOrEqual(-MAX_LANDING_DIP);
    let height = dipped;
    for (let i = 0; i < 60; i += 1) height = follower.update(FRAME, 0, true);
    expect(height).toBe(0);
  });

  it('has no landing dip with reduced motion, and eases steps more gently', () => {
    const calm = new CameraHeightFollower({ reducedMotion: true });
    const usual = new CameraHeightFollower();
    for (const follower of [calm, usual]) follower.update(FRAME, 0, true);
    calm.landed(7);
    expect(calm.update(FRAME, 0, true)).toBe(0);
    expect(calm.update(FRAME, 0.25, true)).toBeLessThan(usual.update(FRAME, 0.25, true));
  });

  it('snaps on a teleport-sized change and after reset', () => {
    const follower = new CameraHeightFollower();
    follower.update(FRAME, 0, true);
    expect(follower.update(FRAME, 10, true)).toBe(10);
    follower.landed(10);
    follower.reset(2);
    expect(follower.update(FRAME, 2, true)).toBe(2);
  });
});
