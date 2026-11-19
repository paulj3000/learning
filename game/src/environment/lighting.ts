/**
 * Lighting data and pure state: time-of-day presets and smooth transitions.
 *
 * Presets are data (an adventure can add its own ids, such as a "lantern night"), and the
 * state machine interpolates between them with a smoothstep so the light never pops or
 * flashes. No Three.js here; `presentation/lightingPresentation.ts` applies the values.
 */

import { Issues, isRecord } from '../components/validate';

export interface LightingValues {
  /** 0xRRGGBB. */
  ambientColor: number;
  ambientIntensity: number;
  sunColor: number;
  sunIntensity: number;
  /** Degrees above the horizon (negative: below it, effectively off). */
  sunElevation: number;
  /** Degrees clockwise from north. */
  sunAzimuth: number;
  skyColor: number;
}

export const LIGHTING_PRESETS: Readonly<Record<string, LightingValues>> = Object.freeze({
  DAWN: { ambientColor: 0xffd9c0, ambientIntensity: 0.55, sunColor: 0xffb27a, sunIntensity: 0.9, sunElevation: 12, sunAzimuth: 90, skyColor: 0xffc9a8 },
  DAY: { ambientColor: 0xffffff, ambientIntensity: 0.7, sunColor: 0xfff4d6, sunIntensity: 1.2, sunElevation: 55, sunAzimuth: 160, skyColor: 0x8fd3ff },
  DUSK: { ambientColor: 0xc9b3ff, ambientIntensity: 0.5, sunColor: 0xff8f5a, sunIntensity: 0.8, sunElevation: 10, sunAzimuth: 260, skyColor: 0xf09a7a },
  NIGHT: { ambientColor: 0x9db4ff, ambientIntensity: 0.35, sunColor: 0xa8bfff, sunIntensity: 0.25, sunElevation: 35, sunAzimuth: 200, skyColor: 0x1b2a55 },
});

const channel = (color: number, shift: number) => (color >> shift) & 0xff;
export function lerpColor(a: number, b: number, t: number): number {
  const mix = (shift: number) => Math.round(channel(a, shift) + (channel(b, shift) - channel(a, shift)) * t);
  return (mix(16) << 16) | (mix(8) << 8) | mix(0);
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

export function lerpLighting(a: LightingValues, b: LightingValues, t: number): LightingValues {
  return {
    ambientColor: lerpColor(a.ambientColor, b.ambientColor, t),
    ambientIntensity: lerp(a.ambientIntensity, b.ambientIntensity, t),
    sunColor: lerpColor(a.sunColor, b.sunColor, t),
    sunIntensity: lerp(a.sunIntensity, b.sunIntensity, t),
    sunElevation: lerp(a.sunElevation, b.sunElevation, t),
    sunAzimuth: lerp(a.sunAzimuth, b.sunAzimuth, t),
    skyColor: lerpColor(a.skyColor, b.skyColor, t),
  };
}

export interface LightingState {
  presets: Readonly<Record<string, LightingValues>>;
  /** Snapshot the transition started from. */
  from: LightingValues;
  targetId: string;
  /** 0 to 1 through the transition. */
  progress: number;
  transitionSeconds: number;
  values: LightingValues;
}

export function createLightingState(presets: Readonly<Record<string, LightingValues>>, initialId: string): LightingState {
  const initial = presets[initialId];
  if (!initial) {
    throw new RangeError(`Unknown lighting preset "${initialId}"`);
  }
  return { presets, from: initial, targetId: initialId, progress: 1, transitionSeconds: 1, values: initial };
}

/** Starts a smooth transition from the current values to a preset. */
export function setLightingTarget(state: LightingState, id: string, seconds: number): boolean {
  const target = state.presets[id];
  if (!target) {
    return false;
  }
  state.from = state.values;
  state.targetId = id;
  state.transitionSeconds = Math.max(0.5, seconds);
  state.progress = 0;
  return true;
}

export function stepLighting(state: LightingState, dt: number): boolean {
  if (state.progress >= 1) {
    return false;
  }
  state.progress = Math.min(1, state.progress + dt / state.transitionSeconds);
  state.values = lerpLighting(state.from, state.presets[state.targetId]!, smoothstep(state.progress));
  return true;
}

export interface LightingConfig {
  initial: string;
  presets: Record<string, LightingValues>;
  transitionSeconds: number;
}

export function validateLightingConfig(input: unknown) {
  const issues = new Issues();
  const root = isRecord(input) ? input : {};
  const presets: Record<string, LightingValues> = { ...LIGHTING_PRESETS };
  if (isRecord(root.presets)) {
    for (const [id, value] of Object.entries(root.presets)) {
      const path = `presets.${id}`;
      issues.id(id, path);
      if (!isRecord(value)) {
        issues.add(path, 'must be an object');
        continue;
      }
      const color = (key: string) => issues.num(value[key], `${path}.${key}`, 0, 0xffffff);
      presets[id] = {
        ambientColor: color('ambientColor'),
        ambientIntensity: issues.num(value.ambientIntensity, `${path}.ambientIntensity`, 0, 3),
        sunColor: color('sunColor'),
        sunIntensity: issues.num(value.sunIntensity, `${path}.sunIntensity`, 0, 4),
        sunElevation: issues.num(value.sunElevation, `${path}.sunElevation`, -90, 90),
        sunAzimuth: issues.num(value.sunAzimuth, `${path}.sunAzimuth`, 0, 360),
        skyColor: color('skyColor'),
      };
    }
  }
  const initial = typeof root.initial === 'string' ? root.initial : 'DAY';
  if (!presets[initial]) {
    issues.add('initial', `unknown lighting preset "${initial}"`);
  }
  return issues.result<LightingConfig>({ initial, presets, transitionSeconds: issues.num(root.transitionSeconds, 'transitionSeconds', 0.5, 60, 4) });
}
