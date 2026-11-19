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
      origin: { x: options.area.x, y: options.area.y, z: options.area.z },
      halfX: options.area.halfX,
      halfZ: options.area.halfZ,
      height: options.area.height,
      stillWhenReduced: false,
    });
  }
  const caps = allocateParticleBudget([...specs.values()], options.tier);
  const pools = new Map<string, { pool: ParticlePool; view: ParticleView; cap: number }>();
  for (const [id, spec] of specs) {
    const cap = caps.get(id) ?? 0;
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
      for (const [id, spec] of specs) {
        const entry = pools.get(id)!;
        const rate = snapshot.rates[id] ?? 0;
        const effective = effectiveEmitter({ ...spec, ratePerSecond: Math.max(0.0001, rate) }, entry.cap, options.reducedMotion());
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
