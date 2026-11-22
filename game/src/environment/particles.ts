/**
 * Particle emitter descriptors, budgets and a pure, deterministic CPU simulation.
 *
 * Budget caps: a quality tier has a total particle budget (0 / 600 / 1200 as the island-map
 * atmosphere uses) shared across emitters in proportion to their requested size, so a weak
 * device never gets more than it can draw. Reduced motion scales an emitter down: fewer
 * particles, slower, and `stillWhenReduced` emitters (a steam plume) freeze into a still cone.
 * The simulation uses a seeded generator, so a given emitter looks identical in tests; it is
 * decoration only and never feeds gameplay.
 */

import type { Vec3Like } from '../contracts/player';
import { Issues, isRecord } from '../components/validate';

export type ParticleMotion = 'FALL' | 'RISE' | 'DRIFT';
export type QualityTier = 'OFF' | 'LOW' | 'MEDIUM' | 'HIGH';

export const PARTICLE_TIER_BUDGET: Readonly<Record<QualityTier, number>> = Object.freeze({
  OFF: 0,
  LOW: 300,
  MEDIUM: 600,
  HIGH: 1200,
});
export const REDUCED_MOTION_PARTICLE_COUNT_SCALE = 0.4;
export const REDUCED_MOTION_PARTICLE_SPEED_SCALE = 0.3;
export const MAX_PARTICLES_PER_EMITTER = 2000;

export interface ParticleEmitterSpec {
  id: string;
  motion: ParticleMotion;
  /** Requested live particle count (before the budget). */
  maxParticles: number;
  ratePerSecond: number;
  lifetime: number;
  speed: number;
  size: number;
  color: number;
  origin: Vec3Like;
  /** Half extents of the spawn box on x and z, and its height (y above origin). */
  halfX: number;
  halfZ: number;
  height: number;
  /** Under reduced motion, freeze into a still arrangement instead of animating. */
  stillWhenReduced: boolean;
}

export interface EffectiveEmitter {
  spec: ParticleEmitterSpec;
  cap: number;
  rate: number;
  speed: number;
  /** Frozen into a still cone/cloud (no stepping). */
  still: boolean;
}

/** Shares the tier budget across emitters in proportion to what each asked for. */
export function allocateParticleBudget(
  specs: readonly ParticleEmitterSpec[],
  tier: QualityTier | number,
): Map<string, number> {
  const budget =
    typeof tier === 'number' ? Math.max(0, Math.floor(tier)) : PARTICLE_TIER_BUDGET[tier];
  const requested = specs.reduce((sum, s) => sum + s.maxParticles, 0);
  const out = new Map<string, number>();
  for (const spec of specs) {
    const share =
      requested <= budget
        ? spec.maxParticles
        : Math.floor((spec.maxParticles / requested) * budget);
    out.set(spec.id, Math.min(spec.maxParticles, share));
  }
  return out;
}

export function effectiveEmitter(
  spec: ParticleEmitterSpec,
  cap: number,
  reducedMotion: boolean,
  rateMultiplier = 1,
): EffectiveEmitter {
  if (!reducedMotion) {
    return {
      spec,
      cap,
      rate: spec.ratePerSecond * rateMultiplier,
      speed: spec.speed,
      still: false,
    };
  }
  return {
    spec,
    cap: Math.floor(cap * REDUCED_MOTION_PARTICLE_COUNT_SCALE),
    rate: spec.ratePerSecond * rateMultiplier * REDUCED_MOTION_PARTICLE_COUNT_SCALE,
    speed: spec.speed * REDUCED_MOTION_PARTICLE_SPEED_SCALE,
    still: spec.stillWhenReduced,
  };
}

/** Mulberry32: a small seeded generator (deterministic decoration, never gameplay). */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  }
  return hash >>> 0;
}

export interface ParticlePool {
  readonly capacity: number;
  /** x, y, z per particle (first `alive` entries are live). */
  readonly positions: Float32Array;
  readonly ages: Float32Array;
  alive: number;
  spawnCarry: number;
  rng: () => number;
}

export function createParticlePool(capacity: number, seed: number): ParticlePool {
  const cap = Math.max(0, Math.min(MAX_PARTICLES_PER_EMITTER, Math.floor(capacity)));
  return {
    capacity: cap,
    positions: new Float32Array(cap * 3),
    ages: new Float32Array(cap),
    alive: 0,
    spawnCarry: 0,
    rng: createRng(seed),
  };
}

function spawn(pool: ParticlePool, spec: ParticleEmitterSpec, index: number, age: number): void {
  const r = pool.rng;
  pool.positions[index * 3] = spec.origin.x + (r() * 2 - 1) * spec.halfX;
  pool.positions[index * 3 + 1] =
    spec.origin.y +
    (spec.motion === 'FALL' ? spec.height : spec.motion === 'DRIFT' ? r() * spec.height : 0);
  pool.positions[index * 3 + 2] = spec.origin.z + (r() * 2 - 1) * spec.halfZ;
  pool.ages[index] = age;
}

/** Freezes the pool into a still arrangement (reduced motion): particles spread over their path. */
export function layoutStill(pool: ParticlePool, effective: EffectiveEmitter): void {
  const { spec } = effective;
  pool.alive = Math.min(effective.cap, pool.capacity);
  for (let i = 0; i < pool.alive; i += 1) {
    spawn(pool, spec, i, 0);
    const t = (i + 1) / Math.max(1, pool.alive);
    // A cone for rising emitters, a layered cloud otherwise.
    pool.positions[i * 3 + 1] = spec.origin.y + t * spec.height;
    if (spec.motion === 'RISE') {
      pool.positions[i * 3] = spec.origin.x + (pool.rng() * 2 - 1) * spec.halfX * t;
      pool.positions[i * 3 + 2] = spec.origin.z + (pool.rng() * 2 - 1) * spec.halfZ * t;
    }
    pool.ages[i] = 0;
  }
}

/** Advances the pool one step: ages and moves particles, recycles the dead, spawns by rate. */
export function stepParticles(
  pool: ParticlePool,
  effective: EffectiveEmitter,
  dt: number,
  wind: Vec3Like = { x: 0, y: 0, z: 0 },
): void {
  const { spec } = effective;
  const limit = Math.min(effective.cap, pool.capacity);
  if (effective.still) {
    if (pool.alive !== limit) {
      layoutStill(pool, effective);
    }
    return;
  }
  const dy =
    spec.motion === 'FALL'
      ? -effective.speed
      : spec.motion === 'RISE'
        ? effective.speed
        : -effective.speed * 0.2;
  let i = 0;
  while (i < pool.alive) {
    pool.ages[i] = pool.ages[i]! + dt;
    if (pool.ages[i]! >= spec.lifetime || i >= limit) {
      // Swap-remove: move the last live particle into this slot.
      const last = pool.alive - 1;
      pool.positions.copyWithin(i * 3, last * 3, last * 3 + 3);
      pool.ages[i] = pool.ages[last]!;
      pool.alive -= 1;
      continue;
    }
    pool.positions[i * 3] = pool.positions[i * 3]! + wind.x * dt;
    pool.positions[i * 3 + 1] = pool.positions[i * 3 + 1]! + dy * dt + wind.y * dt;
    pool.positions[i * 3 + 2] = pool.positions[i * 3 + 2]! + wind.z * dt;
    i += 1;
  }
  pool.spawnCarry += effective.rate * dt;
  while (pool.spawnCarry >= 1 && pool.alive < limit) {
    pool.spawnCarry -= 1;
    spawn(pool, spec, pool.alive, 0);
    pool.alive += 1;
  }
  pool.spawnCarry = Math.min(pool.spawnCarry, 1);
}

export interface ParticlesConfig {
  emitters: ParticleEmitterSpec[];
  tier: QualityTier;
}

export function validateParticlesConfig(input: unknown) {
  const issues = new Issues();
  const root = isRecord(input) ? input : {};
  const emitters = issues.records(
    root.emitters,
    'emitters',
    (item, path): ParticleEmitterSpec => ({
      id: issues.id(item.id, `${path}.id`),
      motion: issues.oneOf<ParticleMotion>(item.motion, `${path}.motion`, [
        'FALL',
        'RISE',
        'DRIFT',
      ]),
      maxParticles: issues.num(
        item.maxParticles,
        `${path}.maxParticles`,
        1,
        MAX_PARTICLES_PER_EMITTER,
      ),
      ratePerSecond: issues.num(item.ratePerSecond, `${path}.ratePerSecond`, 0.1, 2000),
      lifetime: issues.num(item.lifetime, `${path}.lifetime`, 0.2, 30),
      speed: issues.num(item.speed, `${path}.speed`, 0, 30),
      size: issues.num(item.size, `${path}.size`, 0.01, 1, 0.08),
      color: issues.num(item.color, `${path}.color`, 0, 0xffffff, 0xffffff),
      origin: issues.vec3(item.origin, `${path}.origin`),
      halfX: issues.num(item.halfX, `${path}.halfX`, 0, 100, 0.5),
      halfZ: issues.num(item.halfZ, `${path}.halfZ`, 0, 100, 0.5),
      height: issues.num(item.height, `${path}.height`, 0.1, 100, 3),
      stillWhenReduced: issues.bool(item.stillWhenReduced, `${path}.stillWhenReduced`, false),
    }),
    (e) => e.id,
    32,
  );
  const tier = issues.oneOf<QualityTier>(
    root.tier,
    'tier',
    ['OFF', 'LOW', 'MEDIUM', 'HIGH'],
    'MEDIUM',
  );
  return issues.result<ParticlesConfig>({ emitters, tier });
}
