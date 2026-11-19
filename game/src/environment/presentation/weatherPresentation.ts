/**
 * Thin Three.js view of the weather: exponential fog from the blended fog density and one
 * point cloud per precipitating kind, driven by the pure particle simulation. Optional
 * presentation; all objects are tracked in the caller's `ResourceScope`. Under reduced motion
 * the particle count and speed are scaled down (see `particles.ts`).
 */

import { FogExp2, type Scene } from 'three';
import type { ResourceScope } from '../../core/resources';
import type { WeatherApi } from '../atmosphere';
import {
  allocateParticleBudget,
  createParticlePool,
  effectiveEmitter,
  hashSeed,
  stepParticles,
  type ParticleEmitterSpec,
  type ParticlePool,
  type QualityTier,
} from '../particles';
import { createParticleView, type ParticleView } from './particlePresentation';

export interface WeatherViewOptions {
  tier: QualityTier;
  reducedMotion: () => boolean;
  /** The area precipitation covers around the camera or the centre. */
  area: { x: number; y: number; z: number; halfX: number; halfZ: number; height: number };
  /**
   * GE-L14: when given, the precipitation box follows this point every frame (the child or the
   * camera), so snow never stays behind in a large Area. `area.x` and `area.z` are then ignored.
   */
  follow?: () => { x: number; z: number } | null;
}

export interface WeatherView {
  /** Advances precipitation by `dt` and applies fog. Call once per rendered frame. */
  update(dt: number): void;
}

/** Fog density at 1.0 is thick but still readable: 0.04 per metre. */
export const FOG_DENSITY_SCALE = 0.04;

export function createWeatherView(scene: Scene, scope: ResourceScope, weather: WeatherApi, options: WeatherViewOptions): WeatherView {
  const kinds = Object.values(weather.kinds()).filter((k) => k.precipitation !== null);
  const specs = new Map<string, ParticleEmitterSpec>();
  for (const kind of kinds) {
    const p = kind.precipitation!;
    specs.set(kind.id, {
      id: kind.id,
      motion: p.motion === 'FALL' ? 'FALL' : 'DRIFT',
      maxParticles: 2000,
      ratePerSecond: p.ratePerSecond,
      lifetime: Math.max(0.5, options.area.height / Math.max(0.1, p.fallSpeed)),
      speed: p.fallSpeed,
      size: p.size,
      color: p.color,
      // Following: simulate round the origin and move the view (the box goes with the child).
      origin: options.follow ? { x: 0, y: options.area.y, z: 0 } : { x: options.area.x, y: options.area.y, z: options.area.z },
      halfX: options.area.halfX,
      halfZ: options.area.halfZ,
      height: options.area.height,
      stillWhenReduced: false,
    });
  }
  // GE-L14: each pool can hold the whole tier budget on its own; every frame the budget is shared
  // only across the kinds falling now, so an unused kind (the built-in RAIN in a snowy Area)
  // never takes half of it.
  const pools = new Map<string, { pool: ParticlePool; view: ParticleView; cap: number }>();
  for (const [id, spec] of specs) {
    const cap = allocateParticleBudget([spec], options.tier).get(id) ?? 0;
    pools.set(id, {
      pool: createParticlePool(cap, hashSeed(id)),
      view: createParticleView(scene, scope, cap, { name: `engine.weather.${id}`, color: spec.color, size: spec.size }),
      cap,
    });
  }
  const originalFog = scene.fog;
  scope.track(() => {
    scene.fog = originalFog;
  });
  return {
    update(dt) {
      const snapshot = weather.snapshot();
      const falling = [...specs.values()].filter((spec) => (snapshot.rates[spec.id] ?? 0) > 0);
      const shares = allocateParticleBudget(falling, options.tier);
      const centre = options.follow?.() ?? null;
      if (centre) {
        for (const entry of pools.values()) entry.view.points.position.set(centre.x, 0, centre.z);
      }
      for (const [id, spec] of specs) {
        const entry = pools.get(id)!;
        const rate = snapshot.rates[id] ?? 0;
        const cap = Math.min(entry.cap, shares.get(id) ?? 0);
        const effective = effectiveEmitter({ ...spec, ratePerSecond: Math.max(0.0001, rate) }, cap, options.reducedMotion());
        stepParticles(entry.pool, rate > 0 ? effective : { ...effective, rate: 0 }, dt, { x: weather.state.kinds[id]!.precipitation!.drift * snapshot.windStrength, y: 0, z: 0 });
        entry.view.update(entry.pool);
      }
      if (snapshot.fogDensity > 0.001) {
        const density = snapshot.fogDensity * FOG_DENSITY_SCALE;
        if (scene.fog instanceof FogExp2) {
          scene.fog.color.setHex(snapshot.fogColor);
          scene.fog.density = density;
        } else {
          scene.fog = new FogExp2(snapshot.fogColor, density);
        }
      } else {
        scene.fog = originalFog;
      }
    },
  };
}
