/**
 * Weather as data, with smooth transitions.
 *
 * A weather kind is a record, not a code branch: CLEAR, RAIN, SNOW, FOG and WIND are built in,
 * and a realm may add more (for example ASH for summit embers) in its own data without
 * touching the engine. State is pure: `setWeather` starts a smoothstep transition from the
 * current blended snapshot, so changing weather mid-transition never jumps. The result is
 * decorative; weather never affects progress or a required route.
 */

import { Issues, isRecord } from '../components/validate';
import { lerpColor, smoothstep } from './lighting';

export interface PrecipitationSpec {
  /** Particle style for the presentation. */
  motion: 'FALL' | 'DRIFT';
  /** Particles per second at full strength (capped by the particle budget). */
  ratePerSecond: number;
  fallSpeed: number;
  /** Sideways drift, m/s (wind pushes snow and rain). */
  drift: number;
  size: number;
  color: number;
  /**
   * GE-L14: the share of the quality tier's particle budget this kind may use, 0.05 to 1
   * (default 1). Reproduces an atmosphere drawn at a density: 0.6 is 360 flakes on MEDIUM and
   * 720 on HIGH, with a rate high enough to fill it.
   */
  budgetShare?: number;
}

export interface WeatherKindSpec {
  id: string;
  precipitation: PrecipitationSpec | null;
  /** 0 (none) to 1 (thick). */
  fogDensity: number;
  fogColor: number;
  /** 0 to 1: how hard foliage and flags lean. Drives decoration only. */
  windStrength: number;
  /** 0 to 0.6: how much the scene dims under cloud. */
  ambientDim: number;
}

export const WEATHER_KINDS: Readonly<Record<string, WeatherKindSpec>> = Object.freeze({
  CLEAR: {
    id: 'CLEAR',
    precipitation: null,
    fogDensity: 0,
    fogColor: 0xcfe8ff,
    windStrength: 0.1,
    ambientDim: 0,
  },
  RAIN: {
    id: 'RAIN',
    precipitation: {
      motion: 'FALL',
      ratePerSecond: 600,
      fallSpeed: 9,
      drift: 1,
      size: 0.05,
      color: 0xaecbe8,
    },
    fogDensity: 0.15,
    fogColor: 0x9fb2c4,
    windStrength: 0.4,
    ambientDim: 0.25,
  },
  SNOW: {
    id: 'SNOW',
    precipitation: {
      motion: 'DRIFT',
      ratePerSecond: 300,
      fallSpeed: 1.2,
      drift: 0.4,
      size: 0.09,
      color: 0xffffff,
    },
    fogDensity: 0.1,
    fogColor: 0xe8f0fa,
    windStrength: 0.2,
    ambientDim: 0.1,
  },
  FOG: {
    id: 'FOG',
    precipitation: null,
    fogDensity: 0.6,
    fogColor: 0xd5dde5,
    windStrength: 0.05,
    ambientDim: 0.15,
  },
  WIND: {
    id: 'WIND',
    precipitation: null,
    fogDensity: 0.02,
    fogColor: 0xcfe8ff,
    windStrength: 0.9,
    ambientDim: 0.05,
  },
});

/** Reserved example of a realm-authored kind (summit embers), data only. */
export const ASH_WEATHER_KIND: WeatherKindSpec = Object.freeze({
  id: 'ASH',
  precipitation: {
    motion: 'DRIFT' as const,
    ratePerSecond: 120,
    fallSpeed: 0.6,
    drift: 0.8,
    size: 0.07,
    color: 0xffa566,
  },
  fogDensity: 0.2,
  fogColor: 0x6b5a55,
  windStrength: 0.3,
  ambientDim: 0.2,
});

export interface WeatherSnapshot {
  fogDensity: number;
  fogColor: number;
  windStrength: number;
  ambientDim: number;
  /** Particles per second by weather kind id (a fading kind keeps a falling rate). */
  rates: Record<string, number>;
}

export interface WeatherState {
  kinds: Readonly<Record<string, WeatherKindSpec>>;
  from: WeatherSnapshot;
  targetId: string;
  progress: number;
  transitionSeconds: number;
  snapshot: WeatherSnapshot;
}

function snapshotOf(kind: WeatherKindSpec): WeatherSnapshot {
  return {
    fogDensity: kind.fogDensity,
    fogColor: kind.fogColor,
    windStrength: kind.windStrength,
    ambientDim: kind.ambientDim,
    rates: kind.precipitation ? { [kind.id]: kind.precipitation.ratePerSecond } : {},
  };
}

function blend(a: WeatherSnapshot, b: WeatherSnapshot, t: number): WeatherSnapshot {
  const rates: Record<string, number> = {};
  for (const id of new Set([...Object.keys(a.rates), ...Object.keys(b.rates)])) {
    const value = (a.rates[id] ?? 0) + ((b.rates[id] ?? 0) - (a.rates[id] ?? 0)) * t;
    if (value > 0.001) {
      rates[id] = value;
    }
  }
  return {
    fogDensity: a.fogDensity + (b.fogDensity - a.fogDensity) * t,
    fogColor: lerpColor(a.fogColor, b.fogColor, t),
    windStrength: a.windStrength + (b.windStrength - a.windStrength) * t,
    ambientDim: a.ambientDim + (b.ambientDim - a.ambientDim) * t,
    rates,
  };
}

export function createWeatherState(
  kinds: Readonly<Record<string, WeatherKindSpec>>,
  initialId: string,
): WeatherState {
  const kind = kinds[initialId];
  if (!kind) {
    throw new RangeError(`Unknown weather kind "${initialId}"`);
  }
  const snapshot = snapshotOf(kind);
  return {
    kinds,
    from: snapshot,
    targetId: initialId,
    progress: 1,
    transitionSeconds: 1,
    snapshot,
  };
}

export function setWeather(state: WeatherState, id: string, seconds: number): boolean {
  const kind = state.kinds[id];
  if (!kind) {
    return false;
  }
  state.from = state.snapshot;
  state.targetId = id;
  state.transitionSeconds = Math.max(0.5, seconds);
  state.progress = 0;
  return true;
}

export function stepWeather(state: WeatherState, dt: number): boolean {
  if (state.progress >= 1) {
    return false;
  }
  state.progress = Math.min(1, state.progress + dt / state.transitionSeconds);
  state.snapshot = blend(
    state.from,
    snapshotOf(state.kinds[state.targetId]!),
    smoothstep(state.progress),
  );
  return true;
}

/**
 * GE-L14: where precipitation falls (presentation only). `AT_START`: a fixed box round where the
 * child starts (the default). `FOLLOW_PLAYER`: the box moves with the child every frame, like
 * the Area atmosphere's precipitation box, for Areas larger than the box.
 */
export interface WeatherArea {
  mode: 'AT_START' | 'FOLLOW_PLAYER';
  halfX: number;
  halfZ: number;
  height: number;
}

export const DEFAULT_WEATHER_AREA: WeatherArea = {
  mode: 'AT_START',
  halfX: 25,
  halfZ: 25,
  height: 15,
};

export interface WeatherConfig {
  initial: string;
  kinds: Record<string, WeatherKindSpec>;
  transitionSeconds: number;
  /** GE-L14: optional; defaults to `DEFAULT_WEATHER_AREA`. */
  area?: WeatherArea;
}

export function validateWeatherConfig(input: unknown) {
  const issues = new Issues();
  const root = isRecord(input) ? input : {};
  const kinds: Record<string, WeatherKindSpec> = { ...WEATHER_KINDS };
  if (Array.isArray(root.kinds)) {
    root.kinds.forEach((raw, index) => {
      const path = `kinds[${index}]`;
      if (!isRecord(raw)) {
        issues.add(path, 'must be an object');
        return;
      }
      const id = issues.id(raw.id, `${path}.id`);
      let precipitation: PrecipitationSpec | null = null;
      if (raw.precipitation !== undefined && raw.precipitation !== null) {
        if (!isRecord(raw.precipitation)) {
          issues.add(`${path}.precipitation`, 'must be an object or null');
        } else {
          const p = raw.precipitation;
          precipitation = {
            motion: issues.oneOf<'FALL' | 'DRIFT'>(
              p.motion,
              `${path}.precipitation.motion`,
              ['FALL', 'DRIFT'],
              'FALL',
            ),
            ratePerSecond: issues.num(
              p.ratePerSecond,
              `${path}.precipitation.ratePerSecond`,
              1,
              2000,
            ),
            fallSpeed: issues.num(p.fallSpeed, `${path}.precipitation.fallSpeed`, 0.1, 20),
            drift: issues.num(p.drift, `${path}.precipitation.drift`, -10, 10, 0),
            size: issues.num(p.size, `${path}.precipitation.size`, 0.01, 0.5, 0.06),
            color: issues.num(p.color, `${path}.precipitation.color`, 0, 0xffffff, 0xffffff),
            ...(p.budgetShare !== undefined
              ? {
                  budgetShare: issues.num(
                    p.budgetShare,
                    `${path}.precipitation.budgetShare`,
                    0.05,
                    1,
                  ),
                }
              : {}),
          };
        }
      }
      if (id) {
        kinds[id] = {
          id,
          precipitation,
          fogDensity: issues.num(raw.fogDensity, `${path}.fogDensity`, 0, 1, 0),
          fogColor: issues.num(raw.fogColor, `${path}.fogColor`, 0, 0xffffff, 0xcfe8ff),
          windStrength: issues.num(raw.windStrength, `${path}.windStrength`, 0, 1, 0),
          ambientDim: issues.num(raw.ambientDim, `${path}.ambientDim`, 0, 0.6, 0),
        };
      }
    });
  } else if (root.kinds !== undefined) {
    issues.add('kinds', 'must be a list');
  }
  const initial = typeof root.initial === 'string' ? root.initial : 'CLEAR';
  if (!kinds[initial]) {
    issues.add('initial', `unknown weather kind "${initial}"`);
  }
  let area: WeatherArea | undefined;
  if (root.area !== undefined) {
    if (!isRecord(root.area)) {
      issues.add('area', 'must be an object');
    } else {
      area = {
        mode: issues.oneOf<WeatherArea['mode']>(
          root.area.mode,
          'area.mode',
          ['AT_START', 'FOLLOW_PLAYER'],
          'AT_START',
        ),
        halfX: issues.num(root.area.halfX, 'area.halfX', 5, 60, DEFAULT_WEATHER_AREA.halfX),
        halfZ: issues.num(root.area.halfZ, 'area.halfZ', 5, 60, DEFAULT_WEATHER_AREA.halfZ),
        height: issues.num(root.area.height, 'area.height', 4, 40, DEFAULT_WEATHER_AREA.height),
      };
    }
  }
  return issues.result<WeatherConfig>({
    initial,
    kinds,
    transitionSeconds: issues.num(root.transitionSeconds, 'transitionSeconds', 0.5, 60, 3),
    ...(area ? { area } : {}),
  });
}
