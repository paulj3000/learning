/**
 * Capabilities for lighting, weather and particles: pure state plus services the host and the
 * optional Three.js presentation helpers read. Changing time of day or weather emits
 * `AtmosphereChanged` (presentation) once per change; nothing here touches progress.
 */

import { defineService } from '../core/services';
import type { CapabilityDefinition } from '../core/capabilities';
import { emitPresentation, isReducedMotion, type GameplayRuntime } from '../components/common';
import {
  createLightingState,
  LIGHTING_PRESETS,
  setLightingTarget,
  stepLighting,
  validateLightingConfig,
  type LightingConfig,
  type LightingState,
  type LightingValues,
} from './lighting';
import {
  allocateParticleBudget,
  createParticlePool,
  effectiveEmitter,
  hashSeed,
  stepParticles,
  validateParticlesConfig,
  type EffectiveEmitter,
  type ParticlePool,
  type ParticlesConfig,
  type QualityTier,
} from './particles';
import { createWeatherState, WEATHER_KINDS, setWeather, stepWeather, validateWeatherConfig, type WeatherConfig, type WeatherKindSpec, type WeatherSnapshot, type WeatherState } from './weather';

// --- lighting ----------------------------------------------------------------------------

export interface LightingApi {
  values(): LightingValues;
  targetId(): string;
  /** Smoothly changes to a preset. Returns false for an unknown id. */
  set(presetId: string, seconds?: number): boolean;
  readonly state: LightingState;
}
export const LightingService = defineService<LightingApi>('environment.lighting');

export const LIGHTING_CAPABILITY_ID = 'environment.lighting';

export const lightingCapability: CapabilityDefinition<LightingConfig, GameplayRuntime> = {
  id: LIGHTING_CAPABILITY_ID,
  version: '1.0.0',
  description: 'Time-of-day lighting presets with smooth transitions.',
  defaults: { initial: 'DAY', presets: { ...LIGHTING_PRESETS }, transitionSeconds: 4 },
  validate: validateLightingConfig,
  install(runtime, config) {
    const state = createLightingState(config.presets, config.initial);
    const api: LightingApi = {
      state,
      values: () => state.values,
      targetId: () => state.targetId,
      set(id, seconds = config.transitionSeconds) {
        const ok = setLightingTarget(state, id, seconds);
        if (ok) {
          emitPresentation(runtime, 'AtmosphereChanged', { kind: 'LIGHTING', id });
        }
        return ok;
      },
    };
    const removeService = runtime.services.provide(LightingService, api);
    runtime.systems.add({ id: 'environment.lighting', phase: 'simulation', update: (c) => void stepLighting(state, c.dt) });
    return () => {
      runtime.systems.remove('environment.lighting');
      removeService();
    };
  },
};

// --- weather -----------------------------------------------------------------------------

export interface WeatherApi {
  snapshot(): WeatherSnapshot;
  targetId(): string;
  kinds(): Readonly<Record<string, WeatherKindSpec>>;
  set(kindId: string, seconds?: number): boolean;
  readonly state: WeatherState;
}
export const WeatherService = defineService<WeatherApi>('environment.weather');

export const WEATHER_CAPABILITY_ID = 'environment.weather';

export const weatherCapability: CapabilityDefinition<WeatherConfig, GameplayRuntime> = {
  id: WEATHER_CAPABILITY_ID,
  version: '1.0.0',
  description: 'Weather kinds as data (CLEAR, RAIN, SNOW, FOG, WIND and authored kinds) with smooth transitions.',
  defaults: { initial: 'CLEAR', kinds: { ...WEATHER_KINDS }, transitionSeconds: 3 },
  validate: validateWeatherConfig,
  install(runtime, config) {
    const state = createWeatherState(config.kinds, config.initial);
    const api: WeatherApi = {
      state,
      snapshot: () => state.snapshot,
      targetId: () => state.targetId,
      kinds: () => state.kinds,
      set(id, seconds = config.transitionSeconds) {
        const ok = setWeather(state, id, seconds);
        if (ok) {
          emitPresentation(runtime, 'AtmosphereChanged', { kind: 'WEATHER', id });
        }
        return ok;
      },
    };
    const removeService = runtime.services.provide(WeatherService, api);
    runtime.systems.add({ id: 'environment.weather', phase: 'simulation', update: (c) => void stepWeather(state, c.dt) });
    return () => {
      runtime.systems.remove('environment.weather');
      removeService();
    };
  },
};

// --- particles (see also `atmosphereCapabilities` at the end) --------------------------------

export interface ParticleEmitterHandle {
  readonly id: string;
  readonly pool: ParticlePool;
  effective(): EffectiveEmitter;
}
export interface ParticlesApi {
  tier(): QualityTier;
  emitters(): readonly ParticleEmitterHandle[];
  /** Total live particles, for budget tests and diagnostics. */
  liveCount(): number;
  /** Total capacity actually allocated after the budget (never above the tier budget). */
  allocatedCapacity(): number;
}
export const ParticlesService = defineService<ParticlesApi>('environment.particles');

export const PARTICLES_CAPABILITY_ID = 'environment.particles';

export const particlesCapability: CapabilityDefinition<ParticlesConfig, GameplayRuntime> = {
  id: PARTICLES_CAPABILITY_ID,
  version: '1.0.0',
  description: 'Particle emitter descriptors with tier budget caps and reduced-motion scaling.',
  defaults: { emitters: [], tier: 'MEDIUM' },
  validate: validateParticlesConfig,
  install(runtime, config) {
    const caps = allocateParticleBudget(config.emitters, config.tier);
    const handles: ParticleEmitterHandle[] = config.emitters.map((spec) => {
      const cap = caps.get(spec.id) ?? 0;
      const pool = createParticlePool(cap, hashSeed(spec.id));
      return { id: spec.id, pool, effective: () => effectiveEmitter(spec, cap, isReducedMotion(runtime)) };
    });
    const api: ParticlesApi = {
      tier: () => config.tier,
      emitters: () => handles,
      liveCount: () => handles.reduce((sum, h) => sum + h.pool.alive, 0),
      allocatedCapacity: () => handles.reduce((sum, h) => sum + h.pool.capacity, 0),
    };
    const removeService = runtime.services.provide(ParticlesService, api);
    runtime.systems.add({
      id: 'environment.particles',
      phase: 'simulation',
      update(context) {
        for (const handle of handles) {
          stepParticles(handle.pool, handle.effective(), context.dt);
        }
      },
    });
    return () => {
      runtime.systems.remove('environment.particles');
      removeService();
    };
  },
};

/** The three atmosphere capabilities, for registration. */
export const atmosphereCapabilities = [lightingCapability, weatherCapability, particlesCapability] as const;
