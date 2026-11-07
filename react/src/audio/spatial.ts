import type { SpatialDefaults, SpatialOptions, SpatialParams, Vec3 } from './AudioTypes';

/**
 * Pure helpers for positional audio (SM-P7). No Web Audio, no Three.js: positions are plain
 * `[x, y, z]` tuples in metres, so the same code serves the engine, the emitters and the tests.
 */

export const DEFAULT_SPATIAL: Required<
  Pick<SpatialDefaults, 'refDistance' | 'maxDistance' | 'rolloffFactor' | 'distanceModel'>
> = {
  refDistance: 2,
  maxDistance: 25,
  rolloffFactor: 1,
  distanceModel: 'inverse',
};

export const MAX_SPATIAL_VOICES = 12;

const MODELS = new Set(['linear', 'inverse', 'exponential']);
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

export function isVec3(value: unknown): value is Vec3 {
  return Array.isArray(value) && value.length === 3 && value.every(finite);
}

/** The first problem with a spatial configuration (no position), or `undefined`. */
export function spatialDefaultsProblem(defaults: SpatialDefaults | undefined): string | undefined {
  if (!defaults) return undefined;
  const { refDistance, maxDistance, rolloffFactor, distanceModel } = defaults;
  if (refDistance !== undefined && !(finite(refDistance) && refDistance > 0)) {
    return 'refDistance must be greater than 0';
  }
  if (maxDistance !== undefined && !(finite(maxDistance) && maxDistance > 0)) {
    return 'maxDistance must be greater than 0';
  }
  if (
    (refDistance ?? DEFAULT_SPATIAL.refDistance) >= (maxDistance ?? DEFAULT_SPATIAL.maxDistance)
  ) {
    return 'maxDistance must be greater than refDistance';
  }
  if (rolloffFactor !== undefined && !(finite(rolloffFactor) && rolloffFactor >= 0)) {
    return 'rolloffFactor must be 0 or more';
  }
  if (distanceModel !== undefined && !MODELS.has(distanceModel)) {
    return 'distanceModel must be linear, inverse or exponential';
  }
  const { coneInnerAngle: inner, coneOuterAngle: outer, coneOuterGain: gain } = defaults;
  for (const [name, angle] of [
    ['coneInnerAngle', inner],
    ['coneOuterAngle', outer],
  ] as const) {
    if (angle !== undefined && !(finite(angle) && angle >= 0 && angle <= 360)) {
      return `${name} must be from 0 to 360`;
    }
  }
  if (inner !== undefined && outer !== undefined && outer < inner) {
    return 'coneOuterAngle must not be smaller than coneInnerAngle';
  }
  if (gain !== undefined && !(finite(gain) && gain >= 0 && gain <= 1)) {
    return 'coneOuterGain must be from 0 to 1';
  }
  return undefined;
}

export type SpatialResolution =
  | { kind: 'plain' }
  | { kind: 'invalid'; reason: string }
  | { kind: 'spatial'; params: SpatialParams };

/**
 * Merges a sound's staff-set defaults with the play-time options into engine parameters.
 * - A definition with `enabled: false` is never positional, whatever the game asks.
 * - Without a position there is nothing to place: plain playback.
 * - A bad value is reported and the sound plays plain rather than not at all.
 */
export function resolveSpatial(
  defaults: SpatialDefaults | undefined,
  options: SpatialOptions | undefined,
): SpatialResolution {
  if (!options || defaults?.enabled === false) return { kind: 'plain' };
  if (!isVec3(options.position)) return { kind: 'invalid', reason: 'position must be [x, y, z]' };
  if (options.orientation !== undefined && !isVec3(options.orientation)) {
    return { kind: 'invalid', reason: 'orientation must be [x, y, z]' };
  }
  const merged: SpatialDefaults = { ...defaults, ...stripUndefined(options) };
  const problem = spatialDefaultsProblem(merged);
  if (problem) return { kind: 'invalid', reason: problem };
  const orientation = options.orientation;
  const directional = merged.coneInnerAngle !== undefined || merged.coneOuterAngle !== undefined;
  return {
    kind: 'spatial',
    params: {
      position: options.position,
      refDistance: merged.refDistance ?? DEFAULT_SPATIAL.refDistance,
      maxDistance: merged.maxDistance ?? DEFAULT_SPATIAL.maxDistance,
      rolloffFactor: merged.rolloffFactor ?? DEFAULT_SPATIAL.rolloffFactor,
      distanceModel: merged.distanceModel ?? DEFAULT_SPATIAL.distanceModel,
      orientation: orientation ?? (directional ? [0, 0, -1] : undefined),
      coneInnerAngle: merged.coneInnerAngle ?? 360,
      coneOuterAngle: merged.coneOuterAngle ?? 360,
      coneOuterGain: merged.coneOuterGain ?? 0,
    },
  };
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(value) as Array<keyof T>) {
    if (value[key] !== undefined) out[key] = value[key];
  }
  return out;
}

export function distanceBetween(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
