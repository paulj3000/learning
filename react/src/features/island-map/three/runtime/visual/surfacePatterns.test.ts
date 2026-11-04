import { describe, expect, it } from 'vitest';
import { SURFACE_PATTERNS } from '../locationManifest';
import {
  defaultAccent,
  isPaintableSize,
  paintSurfacePattern,
  seededRandom,
} from './surfacePatterns';

const COLORS = { base: 0xc8a165, accent: 0x5a4030 };

function pixel(pixels: Uint8Array, size: number, x: number, y: number): number[] {
  const offset = (y * size + x) * 4;
  return Array.from(pixels.slice(offset, offset + 4));
}

/** Mean absolute difference between two rows or two columns of texels, per channel. */
function edgeDifference(
  pixels: Uint8Array,
  size: number,
  axis: 'row' | 'col',
  a: number,
  b: number,
) {
  let total = 0;
  for (let i = 0; i < size; i += 1) {
    const p = axis === 'row' ? pixel(pixels, size, i, a) : pixel(pixels, size, a, i);
    const q = axis === 'row' ? pixel(pixels, size, i, b) : pixel(pixels, size, b, i);
    total += Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]);
  }
  return total / (size * 3);
}

describe('paintSurfacePattern', () => {
  it.each(SURFACE_PATTERNS)('%s paints an opaque size x size RGBA image', (pattern) => {
    const pixels = paintSurfacePattern(pattern, 64, COLORS, 3);
    expect(pixels).toHaveLength(64 * 64 * 4);
    for (let offset = 3; offset < pixels.length; offset += 4) expect(pixels[offset]).toBe(255);
  });

  it.each(SURFACE_PATTERNS)('%s is deterministic for a seed and varies with it', (pattern) => {
    const once = paintSurfacePattern(pattern, 32, COLORS, 7);
    expect(paintSurfacePattern(pattern, 32, COLORS, 7)).toEqual(once);
    if (pattern !== 'PLAIN') {
      expect(paintSurfacePattern(pattern, 32, COLORS, 8)).not.toEqual(once);
    }
  });

  it.each(SURFACE_PATTERNS)(
    '%s tiles: wrapping edges match like neighbouring rows do',
    (pattern) => {
      const size = 128;
      const pixels = paintSurfacePattern(pattern, size, COLORS, 5);
      // The seam between the last and first row/column should be no rougher
      // than the texture already is between neighbours somewhere inside it.
      let worstInterior = 0;
      for (let i = 1; i < size; i += 1) {
        worstInterior = Math.max(
          worstInterior,
          edgeDifference(pixels, size, 'row', i - 1, i),
          edgeDifference(pixels, size, 'col', i - 1, i),
        );
      }
      expect(edgeDifference(pixels, size, 'row', size - 1, 0)).toBeLessThanOrEqual(
        worstInterior + 1e-9,
      );
      expect(edgeDifference(pixels, size, 'col', size - 1, 0)).toBeLessThanOrEqual(
        worstInterior + 1e-9,
      );
    },
  );

  it('draws its accent: a flagstone has mortar, a plain surface has none', () => {
    const count = (pixels: Uint8Array) => {
      let dark = 0;
      for (let offset = 0; offset < pixels.length; offset += 4) if (pixels[offset] < 130) dark += 1;
      return dark;
    };
    expect(count(paintSurfacePattern('FLAGSTONE', 64, COLORS))).toBeGreaterThan(100);
    expect(count(paintSurfacePattern('PLAIN', 64, COLORS))).toBe(0);
  });

  it('refuses a size the patterns cannot tile at', () => {
    expect(() => paintSurfacePattern('PLANKS', 100, COLORS)).toThrow(/multiple of 16/);
    expect(isPaintableSize(0)).toBe(false);
    expect(isPaintableSize(2048)).toBe(false);
    expect(isPaintableSize(256)).toBe(true);
  });
});

describe('helpers', () => {
  it('seededRandom repeats per seed and stays in [0, 1)', () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    for (let i = 0; i < 100; i += 1) {
      const value = a();
      expect(value).toBe(b());
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('defaultAccent darkens the base', () => {
    expect(defaultAccent(0xffffff)).toBe(0xa8a8a8);
    expect(defaultAccent(0x000000)).toBe(0x000000);
  });
});
