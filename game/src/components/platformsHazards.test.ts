import { describe, expect, it } from 'vitest';
import { signalBoard } from './common';
import { MIN_TELEGRAPH_SECONDS, telegraphPhaseAt, validateHazardsConfig } from './hazards';
import { createFallingModel, PlatformsService, stepFallingModel, validatePlatformsConfig, type FallingSpec } from './platforms';
import { registerGameplayComponents, validateGameplayLayout } from './registerGameplayComponents';
import { validateCheckpointsConfig } from './checkpoints';
import { createHarness } from './testHarness';

const harness = () => createHarness(registerGameplayComponents);
const size = { x: 3, y: 0.4, z: 3 };

const moving = {
  id: 'plat.move',
  position: { x: 0, y: 1, z: 0 },
  size,
  route: 'OPTIONAL',
  moving: { path: [{ x: 4, y: 0, z: 0 }], mode: 'PING_PONG', speed: 2, pauseSeconds: 0 },
};

describe('platform validation', () => {
  it('enforces tops, speeds, route and the area limit', () => {
    expect(validatePlatformsConfig({ platforms: [{ id: 'p', position: { x: 0, y: 0, z: 0 }, size: { x: 0.5, y: 0.4, z: 3 } }] }).ok).toBe(false);
    expect(validatePlatformsConfig({ platforms: [{ ...moving, moving: { ...moving.moving, speed: 0.1 } }] }).ok).toBe(false);
    expect(validatePlatformsConfig({ platforms: [{ ...moving, moving: { ...moving.moving, speed: 4.5 } }] }).ok).toBe(false);
    expect(validatePlatformsConfig({ platforms: [{ ...moving, route: 'REQUIRED' }] }).ok).toBe(false);
    expect(validatePlatformsConfig({ platforms: [moving] }).ok).toBe(true);
    const many = Array.from({ length: 65 }, (_, i) => ({ id: `p${i}`, position: { x: i * 4, y: 0, z: 0 }, size }));
    expect(validatePlatformsConfig({ platforms: many }).ok).toBe(false);
    expect(validatePlatformsConfig({ platforms: many.slice(0, 64) }).ok).toBe(true);
  });

  it('falling platforms are optional-route only and need a real warning', () => {
    const falling = { mode: 'STAND', visibleSeconds: 2, hiddenSeconds: 3, warningSeconds: 1 };
    expect(validatePlatformsConfig({ platforms: [{ id: 'f', position: { x: 0, y: 0, z: 0 }, size, falling }] }).ok).toBe(false);
    expect(validatePlatformsConfig({ platforms: [{ id: 'f', position: { x: 0, y: 0, z: 0 }, size, route: 'OPTIONAL', falling }] }).ok).toBe(true);
    expect(validatePlatformsConfig({ platforms: [{ id: 'f', position: { x: 0, y: 0, z: 0 }, size, route: 'OPTIONAL', falling: { ...falling, visibleSeconds: 1 } }] }).ok).toBe(false);
    expect(validatePlatformsConfig({ platforms: [{ id: 'f', position: { x: 0, y: 0, z: 0 }, size, route: 'OPTIONAL', falling: { ...falling, visibleSeconds: 1.2, warningSeconds: 1 } }] }).ok).toBe(false);
  });

  it('bounce height and spin rate are bounded', () => {
    expect(validatePlatformsConfig({ platforms: [{ id: 'b', position: { x: 0, y: 0, z: 0 }, size, bounceHeight: 9 }] }).ok).toBe(false);
    expect(validatePlatformsConfig({ platforms: [{ id: 's', position: { x: 0, y: 0, z: 0 }, size, spinDegreesPerSecond: 90 }] }).ok).toBe(false);
  });
});

describe('moving and rotating platforms', () => {
  it('moves along its path, updates its collider and exposes carry velocity', async () => {
    const h = harness();
    await h.start([{ id: 'gameplay.platforms', config: { platforms: [moving] } }]);
    const api = h.runtime.services.require(PlatformsService);
    expect(h.physics.getCollider('plat.move')!.kind).toBe('JUMPABLE');
    h.advance(1);
    expect(api.positionOf('plat.move')!.x).toBeCloseTo(2, 1);
    expect(h.physics.getCollider('plat.move')!.min.x).toBeCloseTo(0.5, 1);
    expect(api.carryVelocityAt('plat.move', 0, 0).x).toBeCloseTo(2, 1);
    h.advance(2);
    expect(api.positionOf('plat.move')!.x).toBeCloseTo(2, 0.5);
    expect(api.carryVelocityAt('plat.move', 0, 0).x).toBeLessThan(0);
    expect(api.carryVelocityAt(null, 0, 0)).toEqual({ x: 0, y: 0, z: 0 });
    h.dispose();
    expect(h.physics.hasCollider('plat.move')).toBe(false);
  });

  it('reduced motion slows it to 60 percent', async () => {
    const h = harness();
    h.settings.reducedMotion = true;
    await h.start([{ id: 'gameplay.platforms', config: { platforms: [moving] } }]);
    h.advance(1);
    expect(h.runtime.services.require(PlatformsService).positionOf('plat.move')!.x).toBeCloseTo(1.2 + 0, 1);
    h.dispose();
  });

  it('waits for its signal and can return when it lets go', async () => {
    const h = harness();
    const platform = { ...moving, moving: { ...moving.moving, activeSignalId: 'plate.a', returnWhenInactive: true } };
    await h.start([{ id: 'gameplay.platforms', config: { platforms: [platform] } }]);
    const api = h.runtime.services.require(PlatformsService);
    h.advance(1);
    expect(api.positionOf('plat.move')!.x).toBeCloseTo(0, 5);
    signalBoard(h.runtime).set('plate.a', true);
    h.advance(1);
    expect(api.positionOf('plat.move')!.x).toBeGreaterThan(1.5);
    signalBoard(h.runtime).set('plate.a', false);
    h.advance(3);
    expect(api.positionOf('plat.move')!.x).toBeCloseTo(0, 1);
    h.dispose();
  });

  it('turntables carry a rider tangentially, scaled under reduced motion', async () => {
    const h = harness();
    const spin = { id: 'plat.spin', position: { x: 0, y: 0, z: 0 }, size, spinDegreesPerSecond: 30 };
    await h.start([{ id: 'gameplay.platforms', config: { platforms: [spin] } }]);
    const api = h.runtime.services.require(PlatformsService);
    const rate = (30 * Math.PI) / 180;
    expect(api.carryVelocityAt('plat.spin', 0, 1).x).toBeCloseTo(rate, 5);
    h.settings.reducedMotion = true;
    expect(api.carryVelocityAt('plat.spin', 0, 1).x).toBeCloseTo(rate * 0.6, 5);
    h.dispose();
  });

  it('appearing platforms get a collider when their signal first fires', async () => {
    const h = harness();
    await h.start([{ id: 'gameplay.platforms', config: { platforms: [{ id: 'bridge', position: { x: 0, y: 0, z: 0 }, size, appearSignalId: 'puzzle.done' }] } }]);
    expect(h.physics.hasCollider('bridge')).toBe(false);
    signalBoard(h.runtime).set('puzzle.done', true);
    h.advance(0.1);
    expect(h.physics.hasCollider('bridge')).toBe(true);
    h.dispose();
  });
});

describe('bounce platforms', () => {
  it('emits one launch per landing', async () => {
    const h = harness();
    await h.start([{ id: 'gameplay.platforms', config: { platforms: [{ id: 'pad', position: { x: 0, y: 0, z: 0 }, size, bounceHeight: 2.5, bounceCue: 'boing' }] } }]);
    const api = h.runtime.services.require(PlatformsService);
    h.setPlayer({ x: 0, y: 0.4, z: 0 }, 'pad');
    h.advance(0.2);
    expect(api.consumeLaunch()).toEqual({ platformId: 'pad', height: 2.5 });
    expect(api.consumeLaunch()).toBeNull();
    expect(h.eventsNamed('PlayerBounced')).toEqual([{ platformId: 'pad', cue: 'boing' }]);
    h.setPlayer({ x: 10, y: 3, z: 0 });
    h.advance(0.1);
    h.setPlayer({ x: 0, y: 0.4, z: 0 }, 'pad');
    h.advance(0.1);
    expect(h.eventsNamed('PlayerBounced')).toHaveLength(2);
    h.dispose();
  });
});

describe('falling platforms', () => {
  const spec: FallingSpec = { mode: 'STAND', visibleSeconds: 2, hiddenSeconds: 2, warningSeconds: 1, fallSeconds: 0.6, offsetSeconds: 0 };

  it('model: waits until stood on, crumbles, falls, is gone, then respawns when clear', () => {
    const model = createFallingModel(spec);
    for (let i = 0; i < 120; i += 1) {
      expect(stepFallingModel(model, 1 / 60, false, true)).toBeNull();
    }
    const phases: string[] = [];
    let blockedRespawn = true;
    for (let i = 0; i < 60 * 10; i += 1) {
      const changed = stepFallingModel(model, 1 / 60, true, !blockedRespawn || i > 400);
      if (changed) {
        phases.push(changed);
      }
      if (model.phase === 'GONE' && model.timer > 3) {
        blockedRespawn = false;
      }
    }
    expect(phases.slice(0, 4)).toEqual(['CRUMBLING', 'FALLING', 'GONE', 'STABLE']);
  });

  it('model: respawn waits while the child is in the way', () => {
    const model = createFallingModel(spec);
    model.armed = true;
    model.phase = 'GONE';
    expect(stepFallingModel(model, 5, false, false)).toBeNull();
    expect(model.phase).toBe('GONE');
    expect(stepFallingModel(model, 0.1, false, true)).toBe('STABLE');
  });

  it('system: crumble shows a blink, or a steady dim under reduced motion, then drops the collider and respawns it', async () => {
    const h = harness();
    const platform = { id: 'crumble', position: { x: 0, y: 0, z: 0 }, size, route: 'OPTIONAL', falling: spec };
    await h.start([{ id: 'gameplay.platforms', config: { platforms: [platform] } }]);
    const api = h.runtime.services.require(PlatformsService);
    h.advance(1);
    expect(api.phaseOf('crumble')).toBe('STABLE');
    h.setPlayer({ x: 0, y: 0.4, z: 0 }, 'crumble');
    h.advance(1.2);
    expect(api.phaseOf('crumble')).toBe('CRUMBLING');
    expect(h.eventsNamed('PlatformPhaseChanged')[0]).toEqual({ platformId: 'crumble', phase: 'CRUMBLING', warning: 'BLINK' });
    expect(h.physics.hasCollider('crumble')).toBe(true);
    h.advance(1);
    expect(h.physics.hasCollider('crumble')).toBe(false);
    h.setPlayer({ x: 20, y: 0, z: 0 });
    h.advance(3);
    expect(api.phaseOf('crumble')).toBe('STABLE');
    expect(h.physics.hasCollider('crumble')).toBe(true);
    h.dispose();

    const reduced = harness();
    reduced.settings.reducedMotion = true;
    await reduced.start([{ id: 'gameplay.platforms', config: { platforms: [platform] } }]);
    reduced.setPlayer({ x: 0, y: 0.4, z: 0 }, 'crumble');
    reduced.advance(1.2);
    expect(reduced.eventsNamed('PlatformPhaseChanged')[0]).toMatchObject({ warning: 'STEADY_DIM' });
    reduced.dispose();
  });

  it('TIMED platforms start part-way round their cycle', async () => {
    const h = harness();
    const timed = { id: 't', position: { x: 0, y: 0, z: 0 }, size, route: 'OPTIONAL', falling: { ...spec, mode: 'TIMED', offsetSeconds: 1.5 } };
    await h.start([{ id: 'gameplay.platforms', config: { platforms: [timed] } }]);
    expect(h.runtime.services.require(PlatformsService).phaseOf('t')).toBe('CRUMBLING');
    h.dispose();
  });
});

const checkpointConfig = { checkpoints: [{ id: 'cp.dock', courseId: 'course.a', position: { x: 0, y: 0, z: 0 }, label: 'the old dock' }] };
const waterHazard = { id: 'hz.water', kind: 'WATER', rect: { minX: 5, maxX: 15, minZ: -5, maxZ: 5 }, checkpointId: 'cp.dock', messageKey: 'hazard.water.kind' };

describe('static hazards', () => {
  it('request recovery to the latest checkpoint with the hazard id and message key (no damage)', async () => {
    const h = harness();
    await h.start([
      { id: 'gameplay.checkpoints', config: { checkpoints: [...checkpointConfig.checkpoints, { id: 'cp.far', courseId: 'course.a', position: { x: 20, y: 0, z: 0 }, label: 'the far bank' }] } },
      { id: 'gameplay.hazards', config: { hazards: [waterHazard] } },
    ]);
    h.setPlayer({ x: 10, y: -0.5, z: 0 });
    h.advance(0.1);
    const first = h.eventsNamed('HazardRecoveryRequested')[0];
    expect(first).toMatchObject({ hazardId: 'hz.water', hazardKind: 'WATER', reason: 'HAZARD', checkpointId: 'cp.dock', messageKey: 'hazard.water.kind' });
    h.setPlayer({ x: 20, y: 0, z: 0 });
    h.advance(0.1);
    h.setPlayer({ x: 10, y: -0.5, z: 0 });
    h.advance(2);
    expect(h.eventsNamed('HazardRecoveryRequested').at(-1)).toMatchObject({ checkpointId: 'cp.far' });
    expect(h.claims.every((c) => c.type === 'course.checkpoint.reached')).toBe(true);
    h.dispose();
  });

  it('standing safely above the hazard (on a platform) requests nothing, and a cooldown stops spam', async () => {
    const h = harness();
    await h.start([
      { id: 'gameplay.checkpoints', config: checkpointConfig },
      { id: 'gameplay.hazards', config: { hazards: [waterHazard], recoveryCooldownSeconds: 1 } },
    ]);
    h.setPlayer({ x: 10, y: 1, z: 0 });
    h.advance(0.5);
    expect(h.eventsNamed('HazardRecoveryRequested')).toHaveLength(0);
    h.setPlayer({ x: 10, y: 0, z: 0 });
    h.advance(0.5);
    expect(h.eventsNamed('HazardRecoveryRequested')).toHaveLength(1);
    h.advance(2.2);
    expect(h.eventsNamed('HazardRecoveryRequested').length).toBeGreaterThanOrEqual(2);
    h.dispose();
  });

  it('requires the checkpoint capability and a message key', () => {
    const missingKey = validateHazardsConfig({ hazards: [{ ...waterHazard, messageKey: '' }] });
    expect(missingKey.ok).toBe(false);
    expect(validateHazardsConfig({ hazards: [waterHazard] }).ok).toBe(true);
  });
});

/** A telegraphed falling rock (module scope: the GE-066 tests reuse it). */
const rock = {
  id: 'hz.rock',
  kind: 'FALLING_ROCK',
  rect: { minX: -1, maxX: 1, minZ: -1, maxZ: 1 },
  route: 'OPTIONAL',
  checkpointId: 'cp.dock',
  messageKey: 'hazard.rock.kind',
  telegraphSeconds: 2,
  activeSeconds: 0.5,
  restSeconds: 3,
  offsetSeconds: 0,
};

describe('telegraphed hazards', () => {

  it('has a deterministic REST, WARN, ACTIVE schedule', () => {
    expect(telegraphPhaseAt(rock, 0).phase).toBe('REST');
    expect(telegraphPhaseAt(rock, 3.01).phase).toBe('WARN');
    expect(telegraphPhaseAt(rock, 3.01).secondsToImpact).toBeCloseTo(1.99, 2);
    expect(telegraphPhaseAt(rock, 5.2).phase).toBe('ACTIVE');
    expect(telegraphPhaseAt(rock, 5.5 + 0.1).phase).toBe('REST');
    expect(telegraphPhaseAt({ ...rock, offsetSeconds: 3 }, 0).phase).toBe('WARN');
  });

  it('validates the 1.5 s minimum warning and the safe lane on required routes', () => {
    expect(validateHazardsConfig({ telegraphed: [{ ...rock, telegraphSeconds: 1.2 }] }).ok).toBe(false);
    expect(MIN_TELEGRAPH_SECONDS).toBe(1.5);
    expect(validateHazardsConfig({ telegraphed: [{ ...rock, route: 'REQUIRED' }] }).ok).toBe(false);
    expect(validateHazardsConfig({ telegraphed: [{ ...rock, route: 'REQUIRED', safeLane: { minX: 0, maxX: 2, minZ: 0, maxZ: 2 } }] }).ok).toBe(false);
    expect(validateHazardsConfig({ telegraphed: [{ ...rock, route: 'REQUIRED', safeLane: { minX: 2, maxX: 4, minZ: -1, maxZ: 1 } }] }).ok).toBe(true);
  });

  it('warns first, only hits during ACTIVE, and never hits in the safe lane', async () => {
    const h = harness();
    await h.start([
      { id: 'gameplay.checkpoints', config: checkpointConfig },
      { id: 'gameplay.hazards', config: { telegraphed: [rock] } },
    ]);
    h.setPlayer({ x: 0, y: 0, z: 0 });
    h.advance(3.5);
    expect(h.eventsNamed('HazardTelegraph')[0]).toMatchObject({ hazardId: 'hz.rock', phase: 'WARN', steadyWarning: false });
    expect(h.eventsNamed('HazardRecoveryRequested')).toHaveLength(0);
    h.advance(2);
    expect(h.eventsNamed('HazardRecoveryRequested')).toHaveLength(1);
    h.dispose();

    const lane = harness();
    lane.settings.reducedMotion = true;
    await lane.start([
      { id: 'gameplay.checkpoints', config: checkpointConfig },
      { id: 'gameplay.hazards', config: { telegraphed: [rock] } },
    ]);
    lane.setPlayer({ x: 3, y: 0, z: 0 });
    lane.advance(12);
    expect(lane.eventsNamed('HazardRecoveryRequested')).toHaveLength(0);
    expect(lane.eventsNamed('HazardTelegraph')[0]).toMatchObject({ steadyWarning: true });
    lane.dispose();
  });
});

describe('layout cross-checks', () => {
  it('rejects a hazard with an unknown checkpoint and a checkpoint on a moving platform', () => {
    const checkpoints = validateCheckpointsConfig({ checkpoints: [{ id: 'cp.on.lift', courseId: 'c', position: { x: 0, y: 1.4, z: 0 }, label: 'x' }] });
    const hazards = validateHazardsConfig({ hazards: [waterHazard] });
    const platforms = validatePlatformsConfig({ platforms: [moving] });
    if (!checkpoints.ok || !hazards.ok || !platforms.ok) {
      throw new Error('fixtures must validate');
    }
    const issues = validateGameplayLayout({ checkpoints: checkpoints.value, hazards: hazards.value, platforms: platforms.value });
    expect(issues.map((i) => i.path).sort()).toEqual(['checkpoints.cp.on.lift', 'hazards.hz.water.checkpointId']);
  });
});

describe('inactiveWhenSignalId (GE-066)', () => {
  it('validates as a semantic id and refuses the same id as an activating signal', () => {
    expect(validateHazardsConfig({ telegraphed: [{ ...rock, inactiveWhenSignalId: 'not valid!' }] }).ok).toBe(false);
    expect(validateHazardsConfig({ telegraphed: [{ ...rock, inactiveWhenSignalId: 'valve.off' }] }).ok).toBe(true);
    const base = { id: 'p', position: { x: 0, y: 0, z: 0 }, size };
    expect(validatePlatformsConfig({ platforms: [{ ...base, inactiveWhenSignalId: 'bad id' }] }).ok).toBe(false);
    expect(validatePlatformsConfig({ platforms: [{ ...base, appearSignalId: 's', inactiveWhenSignalId: 's' }] }).ok).toBe(false);
    expect(validatePlatformsConfig({ platforms: [{ ...moving, moving: { ...moving.moving, activeSignalId: 's' }, inactiveWhenSignalId: 's' }] }).ok).toBe(false);
    expect(validatePlatformsConfig({ platforms: [{ ...base, appearSignalId: 's', inactiveWhenSignalId: 't' }] }).ok).toBe(true);
  });

  it('a static hazard stops asking for recovery while its signal is on', async () => {
    const h = harness();
    await h.start([
      { id: 'gameplay.checkpoints', config: checkpointConfig },
      { id: 'gameplay.hazards', config: { hazards: [{ ...waterHazard, inactiveWhenSignalId: 'drained' }] } },
    ]);
    signalBoard(h.runtime).set('drained', true);
    h.setPlayer({ x: 6, y: -1, z: 0 });
    h.advance(1);
    expect(h.eventsNamed('HazardRecoveryRequested')).toHaveLength(0);
    signalBoard(h.runtime).set('drained', false);
    h.advance(0.2);
    expect(h.eventsNamed('HazardRecoveryRequested')).toHaveLength(1);
    h.dispose();
  });

  it('a telegraphed hazard shows REST and never hits while off', async () => {
    const h = harness();
    await h.start([
      { id: 'gameplay.checkpoints', config: checkpointConfig },
      { id: 'gameplay.hazards', config: { telegraphed: [{ ...rock, inactiveWhenSignalId: 'off' }] } },
    ]);
    h.setPlayer({ x: 0, y: 0, z: 0 });
    h.advance(3.5);
    expect(h.eventsNamed('HazardTelegraph').at(-1)).toMatchObject({ phase: 'WARN' });
    signalBoard(h.runtime).set('off', true);
    h.advance(0.1);
    expect(h.eventsNamed('HazardTelegraph').at(-1)).toMatchObject({ phase: 'REST' });
    h.advance(10);
    expect(h.eventsNamed('HazardRecoveryRequested')).toHaveLength(0);
    h.dispose();
  });

  it('a platform loses its collider and presence while its signal is on', async () => {
    const h = harness();
    await h.start([{ id: 'gameplay.platforms', config: { platforms: [{ id: 'bridge', position: { x: 0, y: 1, z: 0 }, size, inactiveWhenSignalId: 'retract' }] } }]);
    const api = h.runtime.services.require(PlatformsService);
    expect(h.physics.hasCollider('bridge')).toBe(true);
    signalBoard(h.runtime).set('retract', true);
    h.advance(0.1);
    expect(h.physics.hasCollider('bridge')).toBe(false);
    expect(api.isPresent('bridge')).toBe(false);
    signalBoard(h.runtime).set('retract', false);
    h.advance(0.1);
    expect(h.physics.hasCollider('bridge')).toBe(true);
    expect(api.isPresent('bridge')).toBe(true);
    h.dispose();
  });

  it('accepts an engine: support id for carry', async () => {
    const h = harness();
    await h.start([{ id: 'gameplay.platforms', config: { platforms: [moving] } }]);
    h.advance(1);
    const api = h.runtime.services.require(PlatformsService);
    expect(api.carryVelocityAt('engine:plat.move', 0, 0).x).toBeCloseTo(2, 1);
    h.dispose();
  });
});
