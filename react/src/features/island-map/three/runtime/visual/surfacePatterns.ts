import type { SurfacePattern } from '../locationManifest';

/**
 * Procedural surface patterns, painted in code as RGBA bytes
 * (ADR-028's recommended decision, item 4). Pure: no `three`, no canvas, no
 * image decoding, so it runs the same in Node, jsdom and a browser, and a
 * test can assert on pixels. Every pattern tiles seamlessly at any size that
 * is a multiple of 16, because every feature (stones, courses, planks, noise
 * cells) is laid out on a grid that divides the texture exactly.
 *
 * The look is stylized on purpose - chunky stones, wide planks, bold weave -
 * which reads at the 64 to 256 texel sizes the quality tiers use.
 */

export interface PatternColors {
  /** 24-bit sRGB. */
  base: number;
  /** 24-bit sRGB. */
  accent: number;
}

/** Sizes the painter accepts: multiples of 16, so every pattern's grid divides them. */
export function isPaintableSize(size: number): boolean {
  return Number.isInteger(size) && size >= 16 && size <= 1024 && size % 16 === 0;
}

/** Mulberry32: a tiny, fast, well-distributed 32-bit PRNG. Same seed, same sequence. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A hash of an integer lattice point, in [0, 1). Wraps by its periods, so noise built on it tiles. */
function latticeValue(
  ix: number,
  iy: number,
  period: number,
  seed: number,
  periodY: number = period,
): number {
  const x = ((ix % period) + period) % period;
  const y = ((iy % periodY) + periodY) % periodY;
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Smooth, tileable value noise in [0, 1) with `cells` cells across the
 * texture (and `cellsY` down it, for grain that runs one way).
 */
function tileableNoise(
  u: number,
  v: number,
  cells: number,
  seed: number,
  cellsY: number = cells,
): number {
  const x = u * cells;
  const y = v * cellsY;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = latticeValue(x0, y0, cells, seed, cellsY);
  const b = latticeValue(x0 + 1, y0, cells, seed, cellsY);
  const c = latticeValue(x0, y0 + 1, cells, seed, cellsY);
  const d = latticeValue(x0 + 1, y0 + 1, cells, seed, cellsY);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function channels(color: number): [number, number, number] {
  return [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];
}

/** A colour scaled by `factor` (1 is unchanged), clamped to a byte per channel. */
function shade(rgb: readonly [number, number, number], factor: number): [number, number, number] {
  return [
    Math.max(0, Math.min(255, Math.round(rgb[0] * factor))),
    Math.max(0, Math.min(255, Math.round(rgb[1] * factor))),
    Math.max(0, Math.min(255, Math.round(rgb[2] * factor))),
  ];
}

/** The accent a preset gets when it names none: the base, a third darker. */
export function defaultAccent(base: number): number {
  const [r, g, b] = shade(channels(base), 0.66);
  return (r << 16) | (g << 8) | b;
}

/**
 * What a texel is, before colour: which of the two colours it takes, a
 * per-feature tint (one stone lighter than its neighbour), and a fine-grain
 * brightness wobble.
 */
interface Texel {
  accent: boolean;
  /** Multiplier for the whole feature the texel belongs to, around 1. */
  featureTint: number;
}

type PatternFn = (u: number, v: number, size: number, seed: number) => Texel;

/** Distance in texels from `t` to the nearest multiple of `1 / count`, in a texture `size` wide. */
function distanceToLine(t: number, count: number, size: number): number {
  const scaled = t * count;
  const fraction = scaled - Math.floor(scaled);
  return (Math.min(fraction, 1 - fraction) * size) / count;
}

function featureTint(ix: number, iy: number, period: number, seed: number, spread: number): number {
  return 1 + (latticeValue(ix, iy, period, seed + 101) - 0.5) * 2 * spread;
}

const PATTERNS: Readonly<Record<SurfacePattern, PatternFn>> = {
  PLAIN: () => ({ accent: false, featureTint: 1 }),

  /** Four rows of four stones, alternate rows offset by half a stone. */
  FLAGSTONE: (u, v, size, seed) => {
    const rows = 4;
    const row = Math.floor(v * rows);
    const shifted = (u + (row % 2) * 0.125) % 1;
    const col = Math.floor(shifted * rows);
    const mortar = Math.max(1, size / 64);
    const onMortar =
      distanceToLine(v, rows, size) < mortar || distanceToLine(shifted, rows, size) < mortar;
    return { accent: onMortar, featureTint: featureTint(col, row, rows, seed, 0.09) };
  },

  /** Cut-stone courses: four courses of two long blocks, alternate courses offset. */
  ASHLAR: (u, v, size, seed) => {
    const courses = 4;
    const course = Math.floor(v * courses);
    const shifted = (u + (course % 2) * 0.25) % 1;
    const block = Math.floor(shifted * 2);
    const mortar = Math.max(1, size / 80);
    const onMortar =
      distanceToLine(v, courses, size) < mortar || distanceToLine(shifted, 2, size) < mortar;
    return { accent: onMortar, featureTint: featureTint(block, course, 4, seed, 0.07) };
  },

  /** Four planks along u, each with two butt joints at its own seeded offset, and grain. */
  PLANKS: (u, v, size, seed) => {
    const planks = 4;
    const plank = Math.floor(u * planks);
    const seam = Math.max(1, size / 96);
    const joint = Math.floor(latticeValue(plank, 0, planks, seed + 7) * 4) / 8;
    const along = (v - joint + 1) % 1;
    const segment = Math.floor(along * 2);
    const onSeam = distanceToLine(u, planks, size) < seam || distanceToLine(along, 2, size) < seam;
    // Grain runs along the plank: many cells across, few down.
    const grain = tileableNoise(u, v, 32, seed, 2) - 0.5;
    return {
      accent: onSeam,
      featureTint: featureTint(plank, segment, planks, seed, 0.08) + grain * 0.12,
    };
  },

  /** Mottled, hand-finished plaster: low-frequency noise only. */
  PLASTER: (u, v, _size, seed) => ({
    accent: false,
    featureTint: 1 + (tileableNoise(u, v, 4, seed) - 0.5) * 0.16,
  }),

  /** A diamond lattice on a woven ground. */
  CARPET: (u, v, size, seed) => {
    const cells = 4;
    const line = Math.max(1, size / 64);
    const diagonalA = distanceToLine((u + v) % 1, cells, size);
    const diagonalB = distanceToLine((u - v + 1) % 1, cells, size);
    const weave = (Math.floor(u * size * 0.5) + Math.floor(v * size * 0.5)) % 2 === 0 ? 1.03 : 0.97;
    return {
      accent: diagonalA < line || diagonalB < line,
      featureTint: weave + (tileableNoise(u, v, 8, seed) - 0.5) * 0.06,
    };
  },

  /** Wainscot panels: a frame around a raised, lighter field. */
  PANELS: (u, v, size, seed) => {
    const across = 2;
    const frame = Math.max(2, size / 24);
    const edgeU = distanceToLine(u, across, size);
    const edgeV = distanceToLine(v, 1, size);
    const onFrame = edgeU < frame || edgeV < frame;
    const bevel = edgeU < frame * 1.4 || edgeV < frame * 1.4;
    return {
      accent: onFrame,
      featureTint:
        (bevel && !onFrame ? 0.9 : 1.04) + (tileableNoise(u, v, 8, seed, 2) - 0.5) * 0.06,
    };
  },

  /** A checker of the two colours with thin grout. */
  TILES: (u, v, size, seed) => {
    const cells = 4;
    const col = Math.floor(u * cells);
    const row = Math.floor(v * cells);
    const grout = Math.max(1, size / 96);
    const onGrout =
      distanceToLine(u, cells, size) < grout || distanceToLine(v, cells, size) < grout;
    return {
      accent: onGrout ? false : (col + row) % 2 === 1,
      featureTint: onGrout ? 0.6 : featureTint(col, row, cells, seed, 0.04),
    };
  },
};

/**
 * Paints `pattern` into a fresh `size` × `size` RGBA byte array (row-major,
 * row 0 first). Deterministic: the same arguments always produce the same
 * bytes. Throws on a size the patterns cannot tile at.
 */
export function paintSurfacePattern(
  pattern: SurfacePattern,
  size: number,
  colors: PatternColors,
  seed = 1,
): Uint8Array {
  if (!isPaintableSize(size)) {
    throw new Error(`surface textures must be 16 to 1024 texels, a multiple of 16 (got ${size})`);
  }
  const paint = PATTERNS[pattern];
  const base = channels(colors.base);
  const accent = channels(colors.accent);
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      const texel = paint(u, v, size, seed);
      const grain = 1 + (tileableNoise(u, v, 16, seed + 31) - 0.5) * 0.08;
      const [r, g, b] = shade(texel.accent ? accent : base, texel.featureTint * grain);
      const offset = (y * size + x) * 4;
      pixels[offset] = r;
      pixels[offset + 1] = g;
      pixels[offset + 2] = b;
      pixels[offset + 3] = 255;
    }
  }
  return pixels;
}
