import { describe, expect, it } from 'vitest';
import {
  FramingError,
  boundingSphere,
  clipPlanes,
  direction,
  frame,
  FOV_DEGREES,
  PADDING,
} from './thumbnailFraming';

const dist = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe('thumbnail framing (spec v1, port of thumbnail_framing.py)', () => {
  it('points the camera front right and above', () => {
    const [x, y, z] = direction();
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 12);
    expect(y).toBeCloseTo(Math.sin((20 * Math.PI) / 180), 12);
    expect(x).toBeGreaterThan(0);
    expect(z).toBeGreaterThan(x);
  });

  it('frames the bounding sphere with the padding at the spec distance', () => {
    const cam = frame([-1, -1, -1], [1, 1, 1]);
    const radius = Math.sqrt(3);
    expect(cam.radius).toBeCloseTo(radius, 12);
    expect(cam.target).toEqual([0, 0, 0]);
    const expected = (PADDING * radius) / Math.sin((FOV_DEGREES * Math.PI) / 360);
    expect(cam.distance).toBeCloseTo(expected, 10);
    expect(dist(cam.position, cam.target)).toBeCloseTo(expected, 10);
    expect(cam.near).toBeCloseTo(Math.max(expected - 2 * radius, 0.01 * expected), 10);
    expect(cam.far).toBeCloseTo(expected + 2 * radius, 10);
  });

  it('keeps the whole sphere inside the view at any size', () => {
    for (const scale of [0.001, 1, 1000]) {
      const cam = frame([0, 0, 0], [scale, 2 * scale, scale]);
      const half = Math.asin(cam.radius / cam.distance);
      expect(half).toBeLessThan((FOV_DEGREES * Math.PI) / 360);
    }
  });

  it('frames a point as a unit sphere and flags it', () => {
    const cam = frame([2, 2, 2], [2, 2, 2]);
    expect(cam.degenerate).toBe(true);
    expect(cam.radius).toBe(1);
    expect(cam.target).toEqual([2, 2, 2]);
  });

  it('uses the narrower half angle for a narrow aspect', () => {
    const wide = frame([-1, -1, -1], [1, 1, 1], { aspect: 2 });
    const narrow = frame([-1, -1, -1], [1, 1, 1], { aspect: 0.5 });
    expect(narrow.distance).toBeGreaterThan(wide.distance);
  });

  it('matches the Python reference module on a box (golden values from thumbnail_framing.py)', () => {
    const cam = frame([-0.5, 0, -0.25], [0.5, 2, 0.25]);
    expect(cam.position[0]).toBeCloseTo(2.0169592607118987, 9);
    expect(cam.position[1]).toBeCloseTo(2.279887192188273, 9);
    expect(cam.position[2]).toBeCloseTo(2.8805163478657474, 9);
    expect(cam.distance).toBeCloseTo(3.742139804232452, 9);
    expect(cam.near).toBeCloseTo(1.4508519567545322, 9);
    expect(cam.far).toBeCloseTo(6.033427651710372, 9);
    expect(cam.radius).toBeCloseTo(1.14564392373896, 9);
  });

  it('refuses unusable bounds and parameters instead of guessing', () => {
    expect(() => frame([Number.NaN, 0, 0], [1, 1, 1])).toThrow(FramingError);
    expect(() => frame([0, 0, 0], [Infinity, 1, 1])).toThrow(FramingError);
    expect(() => frame([1, 0, 0], [0, 1, 1])).toThrow(FramingError);
    expect(() => frame([0, 0, 0], [1, 1, 1], { fov: 0 })).toThrow(FramingError);
    expect(() => frame([0, 0, 0], [1, 1, 1], { aspect: -1 })).toThrow(FramingError);
  });

  it('computes sphere and clip planes as the spec says', () => {
    expect(boundingSphere([0, 0, 0], [2, 0, 0])).toEqual({ centre: [1, 0, 0], radius: 1 });
    expect(clipPlanes(10, 1)).toEqual({ near: 8, far: 12 });
    expect(clipPlanes(10, 5).near).toBeCloseTo(0.1, 12); // never closer than 1 percent
  });
});
