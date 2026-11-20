import { Scene } from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SURFACE, EnvironmentQueryService } from '../contracts/physics';
import { registerGameplayComponents, validateGameplayLayout } from '../components/registerGameplayComponents';
import { createHarness } from '../components/testHarness';
import { createResourceScope } from '../core/resources';
import { LightingService, ParticlesService, WeatherService } from './atmosphere';
import { createEnvironmentQuery } from './environmentQuery';
import { createLightingState, LIGHTING_PRESETS, setLightingTarget, stepLighting, validateLightingConfig } from './lighting';
import { allocateParticleBudget, createParticlePool, effectiveEmitter, PARTICLE_TIER_BUDGET, stepParticles, validateParticlesConfig, type ParticleEmitterSpec } from './particles';
import { createLightingView } from './presentation/lightingPresentation';
import { createParticleView } from './presentation/particlePresentation';
import { createWeatherView } from './presentation/weatherPresentation';
import { forceHazardIssues, validateEnvironmentVolumesConfig, type EnvironmentVolumesConfig } from './volumes';
import { ASH_WEATHER_KIND, createWeatherState, setWeather, stepWeather, validateWeatherConfig, WEATHER_KINDS } from './weather';

const box = (minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number) => ({ min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } });

function volumes(input: unknown): EnvironmentVolumesConfig {
  const result = validateEnvironmentVolumesConfig(input);
  if (!result.ok) {
    throw new Error(JSON.stringify(result.issues));
  }
  return result.value;
}

describe('surface precedence', () => {
  const config = volumes({
    surfaces: [
      { id: 'big.snow', surfaceId: 'snow', box: box(0, 0, 0, 20, 0.2, 20) },
      { id: 'small.ice', surfaceId: 'ice', box: box(5, 0, 5, 8, 0.2, 8) },
      { id: 'hi.mud', surfaceId: 'mud', priority: 5, box: box(6, 0, 6, 7, 0.2, 7) },
    ],
  });

  it('uses priority, then the smaller volume, and falls back to ground', () => {
    const query = createEnvironmentQuery(config);
    expect(query.surfaceAt(6.5, 0.1, 6.5).id).toBe('mud');
    expect(query.surfaceAt(5.5, 0.1, 5.5).id).toBe('ice');
    expect(query.surfaceAt(1, 0.1, 1).id).toBe('snow');
    expect(query.surfaceAt(50, 0, 50)).toBe(DEFAULT_SURFACE);
  });

  it('is independent of declaration order', () => {
    const reversed = createEnvironmentQuery({ ...config, surfaces: [...config.surfaces].reverse() });
    const forward = createEnvironmentQuery(config);
    for (const [x, z] of [[6.5, 6.5], [5.5, 5.5], [1, 1], [19, 19]] as const) {
      expect(reversed.surfaceAt(x, 0.1, z).id).toBe(forward.surfaceAt(x, 0.1, z).id);
    }
  });

  it('carries footstep cues per surface and caps friction at a stoppable floor', () => {
    const query = createEnvironmentQuery(config);
    expect(query.surfaceAt(1, 0.1, 1).footstepCue).toBe('snowStep');
    expect(query.surfaceAt(5.5, 0.1, 5.5).footstepCue).toBe('iceStep');
    expect(validateEnvironmentVolumesConfig({ surfaces: [{ id: 'x', surfaceId: 'ice', friction: 0.01, box: box(0, 0, 0, 1, 1, 1) }] }).ok).toBe(false);
  });

  it('only counts the feet near the surface slab', () => {
    const query = createEnvironmentQuery(config);
    expect(query.surfaceAt(1, 5, 1)).toBe(DEFAULT_SURFACE);
  });
});

describe('force volumes', () => {
  const wind = {
    id: 'wind.a',
    kind: 'WIND',
    box: box(0, 0, 0, 10, 4, 10),
    direction: { x: 1, y: 0, z: 0 },
    strength: 4,
    maxAcceleration: 3,
    rampInSeconds: 1,
  };

  it('ramps in, clamps per volume, halves under reduced motion and gates on a signal', () => {
    let reduced = false;
    let on = true;
    const config = volumes({ forces: [{ ...wind, signalId: 'wind.on' }] });
    const query = createEnvironmentQuery(config, { isReducedMotion: () => reduced, isSignalOn: () => on });
    expect(query.forcesAt(50, 1, 5)).toEqual([]);
    expect(query.forcesAt(5, 1, 5)[0]!.acceleration.x).toBe(0);
    query.tick(0.5, { x: 5, y: 1, z: 5 });
    expect(query.forcesAt(5, 1, 5)[0]!.acceleration.x).toBeCloseTo(2, 5);
    query.tick(1, { x: 5, y: 1, z: 5 });
    expect(query.forcesAt(5, 1, 5)[0]!.acceleration.x).toBe(3);
    reduced = true;
    expect(query.forcesAt(5, 1, 5)[0]!.acceleration.x).toBe(2);
    on = false;
    expect(query.forcesAt(5, 1, 5)).toEqual([]);
    on = true;
    query.tick(0.1, undefined);
    expect(query.rampOf('wind.a')).toBe(0);
  });

  it('inactiveWhenSignalId switches a force off, and is validated (GE-066)', () => {
    let off = false;
    const config = volumes({ forces: [{ ...wind, rampInSeconds: 0, inactiveWhenSignalId: 'wind.off' }] });
    const query = createEnvironmentQuery(config, { isSignalOn: (id) => id === 'wind.off' && off });
    expect(query.forcesAt(5, 1, 5)).toHaveLength(1);
    off = true;
    expect(query.forcesAt(5, 1, 5)).toEqual([]);
    expect(validateEnvironmentVolumesConfig({ forces: [{ ...wind, inactiveWhenSignalId: 'bad id' }] }).ok).toBe(false);
    expect(validateEnvironmentVolumesConfig({ forces: [{ ...wind, signalId: 'x', inactiveWhenSignalId: 'x' }] }).ok).toBe(false);
    expect(createEnvironmentQuery(config).forcesAt(5, 1, 5)).toHaveLength(1);
  });

  it('orders forces by priority then id and normalises direction', () => {
    const config = volumes({
      forces: [
        { ...wind, id: 'b', rampInSeconds: 0, direction: { x: 0, y: 1, z: 0 }, kind: 'UPDRAFT', priority: 1 },
        { ...wind, id: 'a', rampInSeconds: 0, direction: { x: 5, y: 0, z: 0 }, priority: 1 },
        { ...wind, id: 'c', rampInSeconds: 0, priority: 9, kind: 'CURRENT' },
      ],
    });
    const forces = createEnvironmentQuery(config).forcesAt(5, 1, 5);
    expect(forces.map((f) => f.id)).toEqual(['c', 'a', 'b']);
    expect(forces[1]!.acceleration.x).toBe(3);
    expect(forces[2]!.acceleration.y).toBe(3);
  });

  it('never pushes into a hazard: rejected at definition and omitted at query time', () => {
    const hazard = { minX: 11, maxX: 14, minZ: 0, maxZ: 10 };
    const result = validateEnvironmentVolumesConfig({ forces: [wind], hazardRects: [hazard] });
    expect(result.ok).toBe(false);
    expect(result.issues[0]!.message).toMatch(/pushes toward hazard/);
    const sideways = { ...wind, direction: { x: 0, y: 0, z: -1 } };
    expect(validateEnvironmentVolumesConfig({ forces: [sideways], hazardRects: [hazard] }).ok).toBe(true);
    expect(validateEnvironmentVolumesConfig({ forces: [{ ...wind, neverPushIntoHazard: false }], hazardRects: [hazard] }).ok).toBe(true);
    expect(validateEnvironmentVolumesConfig({ forces: [{ ...wind, runOut: 0.2 }], hazardRects: [hazard] }).ok).toBe(true);

    const config = volumes({ forces: [{ ...wind, neverPushIntoHazard: false, rampInSeconds: 0 }] });
    const strict = { ...config, forces: config.forces.map((f) => ({ ...f, neverPushIntoHazard: true })) };
    const query = createEnvironmentQuery(strict, { hazardRects: () => [hazard] });
    expect(query.forcesAt(9.5, 1, 5)).toEqual([]);
    expect(query.forcesAt(2, 1, 5)).toHaveLength(1);
    expect(forceHazardIssues(strict.forces, [hazard])).toHaveLength(1);
  });

  it('validates direction and limits', () => {
    expect(validateEnvironmentVolumesConfig({ forces: [{ ...wind, direction: { x: 0, y: 0, z: 0 } }] }).ok).toBe(false);
    expect(validateEnvironmentVolumesConfig({ forces: [{ ...wind, strength: 99 }] }).ok).toBe(false);
    expect(validateEnvironmentVolumesConfig({ forces: [{ ...wind, kind: 'TORNADO' }] }).ok).toBe(false);
  });
});

describe('water and ladders', () => {
  const config = volumes({
    waters: [
      { id: 'pond', box: box(0, -2, 0, 10, 0.5, 10) },
      { id: 'deep', box: box(2, -4, 2, 4, 1, 4) },
    ],
    ladders: [{ id: 'ladder.b', x: 20, z: 0, bottomY: 0, topY: 4, facingYaw: 1, exitTop: { x: 20, y: 4, z: -1 } }],
  });
  const query = createEnvironmentQuery(config);

  it('reports medium and the highest water surface', () => {
    expect(query.mediumAt(5, 0, 5)).toBe('WATER');
    expect(query.mediumAt(5, 0.6, 5)).toBe('AIR');
    expect(query.mediumAt(50, 0, 50)).toBe('AIR');
    expect(query.waterSurfaceAt(5, 5)).toBe(0.5);
    expect(query.waterSurfaceAt(3, 3)).toBe(1);
    expect(query.waterSurfaceAt(50, 50)).toBeNull();
  });

  it('finds a ladder by position and height', () => {
    expect(query.climbableAt(20, 1, 0)).toMatchObject({ id: 'ladder.b', topY: 4, facingYaw: 1 });
    expect(query.climbableAt(20, 5, 0)).toBeNull();
    expect(query.climbableAt(25, 1, 0)).toBeNull();
  });

  it('rejects a ladder whose top is below its bottom', () => {
    expect(validateEnvironmentVolumesConfig({ ladders: [{ id: 'l', x: 0, z: 0, bottomY: 3, topY: 1, exitTop: { x: 0, y: 1, z: 0 } }] }).ok).toBe(false);
  });
});

describe('environment capability', () => {
  it('provides the query, ticks ramps from the player position and emits footstep surface ids', async () => {
    const h = createHarness(registerGameplayComponents);
    await h.start([
      {
        id: 'environment.volumes',
        config: {
          surfaces: [{ id: 'lake.ice', surfaceId: 'ice', box: box(0, 0, 0, 10, 0.2, 10) }],
          forces: [{ id: 'gust', kind: 'WIND', box: box(0, 0, 0, 10, 4, 10), direction: { x: 1, y: 0, z: 0 }, strength: 2, rampInSeconds: 1 }],
        },
      },
    ]);
    const query = h.runtime.services.require(EnvironmentQueryService);
    h.setPlayer({ x: 5, y: 0, z: 5 });
    h.advance(1.1);
    expect(query.forcesAt(5, 0, 5)[0]!.acceleration.x).toBeCloseTo(2, 3);
    h.runtime.events.emit('PlayerFootstep', { gait: 'walk' });
    expect(h.eventsNamed('SurfaceFootstep')).toEqual([{ surfaceId: 'ice', footstepCue: 'iceStep' }]);
    h.setPlayer({ x: 50, y: 0, z: 50 });
    h.runtime.events.emit('PlayerFootstep', { gait: 'walk' });
    expect(h.eventsNamed('SurfaceFootstep').at(-1)).toEqual({ surfaceId: 'ground', footstepCue: null });
    h.dispose();
    expect(h.runtime.services.has(EnvironmentQueryService)).toBe(false);
  });

  it('the layout check sees hazards declared in the hazards capability', () => {
    const volumesConfig = volumes({ forces: [{ id: 'w', kind: 'WIND', box: box(0, 0, 0, 10, 4, 10), direction: { x: 1, y: 0, z: 0 }, strength: 2 }] });
    const issues = validateGameplayLayout({
      volumes: volumesConfig,
      hazards: { hazards: [{ id: 'h', kind: 'LAVA', rect: { minX: 11, maxX: 13, minZ: 0, maxZ: 10 }, belowY: 0.05, checkpointId: 'c', messageKey: 'k' }], telegraphed: [], recoveryCooldownSeconds: 1 },
    });
    expect(issues.some((i) => i.path === 'forces[0]')).toBe(true);
  });
});

describe('lighting', () => {
  it('transitions smoothly between presets and ends exactly on the target', () => {
    const state = createLightingState(LIGHTING_PRESETS, 'DAY');
    expect(setLightingTarget(state, 'NIGHT', 4)).toBe(true);
    expect(setLightingTarget(state, 'NOPE', 4)).toBe(false);
    const samples: number[] = [];
    for (let i = 0; i < 300; i += 1) {
      stepLighting(state, 1 / 60);
      samples.push(state.values.ambientIntensity);
    }
    expect(state.values).toEqual(LIGHTING_PRESETS.NIGHT);
    const day = LIGHTING_PRESETS.DAY!.ambientIntensity;
    expect(samples[10]).toBeLessThan(day);
    expect(samples.every((v, i) => i === 0 || v <= samples[i - 1]! + 1e-9)).toBe(true);
    expect(stepLighting(state, 1)).toBe(false);
  });

  it('retargeting mid-transition continues from the current values (no pop)', () => {
    const state = createLightingState(LIGHTING_PRESETS, 'DAY');
    setLightingTarget(state, 'NIGHT', 4);
    for (let i = 0; i < 120; i += 1) {
      stepLighting(state, 1 / 60);
    }
    const mid = state.values.ambientIntensity;
    setLightingTarget(state, 'DAWN', 4);
    stepLighting(state, 1 / 600);
    expect(Math.abs(state.values.ambientIntensity - mid)).toBeLessThan(0.01);
  });

  it('validates custom presets and the capability drives AtmosphereChanged', async () => {
    expect(validateLightingConfig({ initial: 'NOPE' }).ok).toBe(false);
    expect(validateLightingConfig({ presets: { LANTERN: { ambientColor: 1 } } }).ok).toBe(false);
    const h = createHarness(registerGameplayComponents);
    await h.start([{ id: 'environment.lighting', config: { initial: 'DAWN' } }]);
    const api = h.runtime.services.require(LightingService);
    expect(api.set('DUSK', 1)).toBe(true);
    h.advance(1.2);
    expect(api.values()).toEqual(LIGHTING_PRESETS.DUSK);
    expect(h.eventsNamed('AtmosphereChanged')).toEqual([{ kind: 'LIGHTING', id: 'DUSK' }]);
    h.dispose();
  });
});

describe('weather', () => {
  it('ships CLEAR, RAIN, SNOW, FOG and WIND as data and accepts authored kinds', () => {
    expect(Object.keys(WEATHER_KINDS)).toEqual(['CLEAR', 'RAIN', 'SNOW', 'FOG', 'WIND']);
    const result = validateWeatherConfig({ kinds: [ASH_WEATHER_KIND], initial: 'ASH' });
    expect(result.ok && result.value.kinds.ASH?.precipitation?.motion).toBe('DRIFT');
    expect(validateWeatherConfig({ initial: 'HAIL' }).ok).toBe(false);
    expect(validateWeatherConfig({ kinds: [{ id: 'BAD', fogDensity: 4 }] }).ok).toBe(false);
  });

  it('blends smoothly, fading precipitation out and in, and never jumps when retargeted', () => {
    const state = createWeatherState(WEATHER_KINDS, 'RAIN');
    setWeather(state, 'SNOW', 4);
    stepWeather(state, 2);
    expect(state.snapshot.rates.RAIN).toBeGreaterThan(0);
    expect(state.snapshot.rates.SNOW).toBeGreaterThan(0);
    const mid = state.snapshot.fogDensity;
    setWeather(state, 'CLEAR', 4);
    stepWeather(state, 0.01);
    expect(Math.abs(state.snapshot.fogDensity - mid)).toBeLessThan(0.01);
    stepWeather(state, 10);
    expect(state.snapshot.rates).toEqual({});
    expect(state.snapshot.fogDensity).toBe(0);
    expect(setWeather(state, 'HAIL', 1)).toBe(false);
  });

  it('the capability changes weather and announces it', async () => {
    const h = createHarness(registerGameplayComponents);
    await h.start([{ id: 'environment.weather', config: { initial: 'CLEAR' } }]);
    const api = h.runtime.services.require(WeatherService);
    api.set('FOG', 1);
    h.advance(1.1);
    expect(api.snapshot().fogDensity).toBeCloseTo(WEATHER_KINDS.FOG!.fogDensity, 5);
    expect(h.eventsNamed('AtmosphereChanged')).toEqual([{ kind: 'WEATHER', id: 'FOG' }]);
    h.dispose();
  });
});

describe('particles', () => {
  const emitter = (id: string, maxParticles: number, extra: Partial<ParticleEmitterSpec> = {}): ParticleEmitterSpec => ({
    id,
    motion: 'RISE',
    maxParticles,
    ratePerSecond: 100,
    lifetime: 2,
    speed: 1,
    size: 0.1,
    color: 0xffffff,
    origin: { x: 0, y: 0, z: 0 },
    halfX: 1,
    halfZ: 1,
    height: 3,
    stillWhenReduced: false,
    ...extra,
  });

  it('shares a tier budget across emitters and never exceeds it', () => {
    const specs = [emitter('a', 1000), emitter('b', 1000)];
    const caps = allocateParticleBudget(specs, 'MEDIUM');
    expect([...caps.values()].reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(PARTICLE_TIER_BUDGET.MEDIUM);
    expect([...allocateParticleBudget(specs, 'OFF').values()]).toEqual([0, 0]);
    expect(allocateParticleBudget([emitter('c', 50)], 'HIGH').get('c')).toBe(50);
  });

  it('simulates deterministically within its capacity', () => {
    const run = () => {
      const spec = emitter('fumes', 40);
      const pool = createParticlePool(40, 7);
      const effective = effectiveEmitter(spec, 40, false);
      for (let i = 0; i < 300; i += 1) {
        stepParticles(pool, effective, 1 / 60);
        expect(pool.alive).toBeLessThanOrEqual(40);
      }
      return Array.from(pool.positions.subarray(0, 6));
    };
    expect(run()).toEqual(run());
  });

  it('reduced motion scales count and speed, and a still emitter freezes in a cone', () => {
    const spec = emitter('steam', 100, { stillWhenReduced: true });
    const normal = effectiveEmitter(spec, 100, false);
    const reduced = effectiveEmitter(spec, 100, true);
    expect(reduced.cap).toBe(40);
    expect(reduced.speed).toBeCloseTo(0.3, 5);
    expect(reduced.still).toBe(true);
    const pool = createParticlePool(100, 1);
    stepParticles(pool, reduced, 1 / 60);
    const before = Array.from(pool.positions.subarray(0, 12));
    stepParticles(pool, reduced, 1);
    expect(Array.from(pool.positions.subarray(0, 12))).toEqual(before);
    expect(pool.alive).toBe(40);
    expect(normal.still).toBe(false);
  });

  it('validates descriptors and the capability allocates within the tier', async () => {
    expect(validateParticlesConfig({ emitters: [{ id: 'e', motion: 'SIDEWAYS' }] }).ok).toBe(false);
    const h = createHarness(registerGameplayComponents);
    const e = (id: string) => ({ id, motion: 'FALL', maxParticles: 1500, ratePerSecond: 400, lifetime: 3, speed: 2, origin: { x: 0, y: 0, z: 0 } });
    await h.start([{ id: 'environment.particles', config: { tier: 'LOW', emitters: [e('one'), e('two')] } }]);
    const api = h.runtime.services.require(ParticlesService);
    h.advance(2);
    expect(api.allocatedCapacity()).toBeLessThanOrEqual(PARTICLE_TIER_BUDGET.LOW);
    expect(api.liveCount()).toBeGreaterThan(0);
    expect(api.liveCount()).toBeLessThanOrEqual(PARTICLE_TIER_BUDGET.LOW);
    h.dispose();
  });
});

describe('presentation helpers', () => {
  it('create and dispose their Three.js objects through a ResourceScope', async () => {
    const scene = new Scene();
    const scope = createResourceScope('presentation');
    const h = createHarness(registerGameplayComponents);
    await h.start([{ id: 'environment.lighting' }, { id: 'environment.weather', config: { initial: 'SNOW' } }]);
    const lighting = createLightingView(scene, scope, h.runtime.services.require(LightingService));
    const weatherApi = h.runtime.services.require(WeatherService);
    const weather = createWeatherView(scene, scope, weatherApi, { tier: 'LOW', reducedMotion: () => false, area: { x: 0, y: 0, z: 0, halfX: 10, halfZ: 10, height: 8 } });
    const pool = createParticlePool(10, 1);
    const view = createParticleView(scene, scope, 10, { name: 'steam', color: 0xffffff, size: 0.1 });
    view.update(pool);
    for (let i = 0; i < 120; i += 1) {
      weather.update(1 / 60);
    }
    lighting.update();
    expect(scene.children.length).toBeGreaterThanOrEqual(5);
    expect(scene.fog).not.toBeNull();
    expect(scope.count()).toBeGreaterThan(0);
    scope.dispose();
    expect(scene.children).toHaveLength(0);
    expect(scene.fog).toBeNull();
    h.dispose();
  });
});

describe('weather view budget (GE-L14, North Pole parity)', () => {
  const live = (scene: Scene, prefix: string) =>
    scene.children
      .filter((o) => o.name.startsWith(prefix))
      .reduce((sum, o) => sum + (o as unknown as { geometry: { drawRange: { count: number } } }).geometry.drawRange.count, 0);

  it('the falling kind gets the whole tier budget; unused kinds (built-in RAIN) take none of it', async () => {
    const scene = new Scene();
    const scope = createResourceScope('weather-budget');
    const h = createHarness(registerGameplayComponents);
    // Steady snow above the MEDIUM budget: 600/s for 20 s would be 12000 without a cap.
    await h.start([{ id: 'environment.weather', config: { initial: 'SNOW', kinds: [{ id: 'SNOW', precipitation: { motion: 'FALL', ratePerSecond: 600, fallSpeed: 0.5, size: 0.08 } }] } }]);
    const weather = createWeatherView(scene, scope, h.runtime.services.require(WeatherService), { tier: 'MEDIUM', reducedMotion: () => false, area: { x: 0, y: 0, z: 0, halfX: 20, halfZ: 20, height: 24 } });
    for (let i = 0; i < 600; i += 1) weather.update(1 / 60);
    expect(live(scene, 'engine.weather.SNOW')).toBe(600); // the whole MEDIUM budget
    expect(live(scene, 'engine.weather.RAIN')).toBe(0);
    scope.dispose();
    h.dispose();
  });

  it('shares the budget only while two kinds fall at once, and never goes over it', async () => {
    const scene = new Scene();
    const scope = createResourceScope('weather-share');
    const h = createHarness(registerGameplayComponents);
    await h.start([{ id: 'environment.weather', config: { initial: 'RAIN', transitionSeconds: 30 } }]);
    const api = h.runtime.services.require(WeatherService);
    const weather = createWeatherView(scene, scope, api, { tier: 'LOW', reducedMotion: () => false, area: { x: 0, y: 0, z: 0, halfX: 20, halfZ: 20, height: 15 } });
    for (let i = 0; i < 300; i += 1) weather.update(1 / 60);
    api.set('SNOW', 30);
    for (let i = 0; i < 300; i += 1) {
      h.advance(1 / 60);
      weather.update(1 / 60);
      expect(live(scene, 'engine.weather.')).toBeLessThanOrEqual(300);
    }
    scope.dispose();
    h.dispose();
  });
});

describe('weather budget share (GE-L14, atmosphere density parity)', () => {
  const settle = async (tier: 'LOW' | 'MEDIUM' | 'HIGH', budgetShare?: number) => {
    const scene = new Scene();
    const scope = createResourceScope('share');
    const h = createHarness(registerGameplayComponents);
    const precipitation = { motion: 'DRIFT', ratePerSecond: 48, fallSpeed: 1.6, size: 0.08, ...(budgetShare !== undefined ? { budgetShare } : {}) };
    await h.start([{ id: 'environment.weather', config: { initial: 'SNOW', kinds: [{ id: 'SNOW', precipitation }] } }]);
    const weather = createWeatherView(scene, scope, h.runtime.services.require(WeatherService), { tier, reducedMotion: () => false, area: { x: 0, y: 0, z: 0, halfX: 20, halfZ: 20, height: 24 } });
    for (let i = 0; i < 60 * 30; i += 1) weather.update(1 / 60);
    const count = scene.children.filter((o) => o.name === 'engine.weather.SNOW').reduce((n, o) => n + (o as unknown as { geometry: { drawRange: { count: number } } }).geometry.drawRange.count, 0);
    scope.dispose();
    h.dispose();
    return count;
  };

  it('0.6 of the budget gives the atmosphere density 0.6 counts on every tier', async () => {
    expect(await settle('LOW', 0.6)).toBe(180);
    expect(await settle('MEDIUM', 0.6)).toBe(360);
    expect(await settle('HIGH', 0.6)).toBeGreaterThanOrEqual(700); // 48/s x 15 s lifetime: about 720, under the 720 cap
    expect(await settle('HIGH', 0.6)).toBeLessThanOrEqual(720);
  });

  it('defaults to the whole budget, and is bounded', async () => {
    expect(await settle('MEDIUM')).toBe(600);
    expect(validateWeatherConfig({ kinds: [{ id: 'SNOW', precipitation: { ratePerSecond: 10, fallSpeed: 1, budgetShare: 0 } }] }).ok).toBe(false);
    expect(validateWeatherConfig({ kinds: [{ id: 'SNOW', precipitation: { ratePerSecond: 10, fallSpeed: 1, budgetShare: 1.5 } }] }).ok).toBe(false);
  });
});
