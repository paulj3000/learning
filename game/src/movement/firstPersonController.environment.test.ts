import { Box3, Vector3 } from 'three';
import {
  NEUTRAL_ENVIRONMENT,
  type ClimbableInfo,
  type EnvironmentQuery,
  type ExternalForce,
  type SurfaceProfile,
} from '../contracts/physics';
import { FirstPersonController, MAX_EXTERNAL_FORCE, type MoveInput } from './firstPersonController';

const DT = 1 / 60;
const FORWARD_X: number = -Math.PI / 2; // forward is -x
const FORWARD_PLUS_X: number = Math.PI / 2;

function env(parts: Partial<EnvironmentQuery>): EnvironmentQuery {
  return { ...NEUTRAL_ENVIRONMENT, ...parts };
}

function run(c: FirstPersonController, frames: number, input: MoveInput, dt = DT): void {
  for (let i = 0; i < frames; i += 1) c.update(dt, input);
}

const WALK: MoveInput = { forward: 1, strafe: 0 };
const IDLE: MoveInput = { forward: 0, strafe: 0 };

function ice(friction: number, speedMultiplier = 1): EnvironmentQuery {
  const surface: SurfaceProfile = { id: 'ice', friction, speedMultiplier };
  return env({ surfaceAt: () => surface });
}

describe('default-off: a neutral environment changes nothing', () => {
  it('matches a controller with no environment frame for frame', () => {
    const wall = new Box3(new Vector3(3, 0, -2), new Vector3(4, 3, 2));
    const a = new FirstPersonController({ colliders: [wall] });
    const b = new FirstPersonController({ colliders: [wall], environment: NEUTRAL_ENVIRONMENT });
    a.yaw = b.yaw = FORWARD_PLUS_X;
    for (let i = 0; i < 200; i += 1) {
      const input = i % 90 < 60 ? WALK : IDLE;
      a.update(DT, input);
      b.update(DT, input);
      expect(b.position.x).toBe(a.position.x);
      expect(b.position.z).toBe(a.position.z);
      expect(b.horizontalSpeed).toBe(a.horizontalSpeed);
    }
    expect(b.playerState).toBe(b.movementState);
  });
});

describe('surface friction and ice', () => {
  function topSpeedAndStop(friction: number, dt = DT) {
    const c = new FirstPersonController({ environment: ice(friction) });
    c.yaw = FORWARD_PLUS_X;
    run(c, Math.round(3 / dt), WALK, dt);
    const top = c.horizontalSpeed;
    const start = c.position.x;
    let slid = false;
    let frames = 0;
    while (c.horizontalSpeed >= 0.2 && frames < 600) {
      c.update(dt, IDLE);
      slid ||= c.playerState === 'SLIDING';
      frames += 1;
    }
    return { top, distance: c.position.x - start, slid };
  }

  it('never raises top speed on ice', () => {
    expect(topSpeedAndStop(0.05).top).toBeLessThanOrEqual(4 + 1e-6);
  });

  it('stops within about a metre of letting go from walking speed on the slipperiest surface', () => {
    for (const dt of [1 / 30, 1 / 60, 1 / 144]) {
      const { top, distance } = topSpeedAndStop(0.05, dt);
      expect(top).toBeGreaterThan(3.5);
      expect(distance).toBeLessThanOrEqual(1);
    }
    expect(topSpeedAndStop(0.2).distance).toBeLessThanOrEqual(1);
  });

  it('keeps sliding with momentum compared with normal ground and reports SLIDING', () => {
    const grippy = topSpeedAndStop(1);
    const slippery = topSpeedAndStop(0.05);
    expect(slippery.distance).toBeGreaterThan(grippy.distance * 3);
    expect(slippery.slid).toBe(true);
    expect(grippy.slid).toBe(false);
  });

  it('starts and steers slowly on ice but can always get going', () => {
    const slow = new FirstPersonController({ environment: ice(0.05) });
    const normal = new FirstPersonController({ environment: ice(1) });
    slow.yaw = normal.yaw = FORWARD_PLUS_X;
    run(slow, 30, WALK);
    run(normal, 30, WALK);
    expect(slow.horizontalSpeed).toBeLessThan(normal.horizontalSpeed);
    expect(slow.horizontalSpeed).toBeGreaterThan(1.5);
  });

  it('scales top speed with speedMultiplier only', () => {
    const mud = new FirstPersonController({ environment: ice(1, 0.5) });
    mud.yaw = FORWARD_PLUS_X;
    run(mud, 180, WALK);
    expect(mud.horizontalSpeed).toBeCloseTo(2, 1);
  });

  it('clamps nonsense friction into range instead of freezing or running away', () => {
    for (const friction of [-5, 0, Number.NaN, 99]) {
      const c = new FirstPersonController({ environment: ice(friction) });
      c.yaw = FORWARD_PLUS_X;
      run(c, 120, WALK);
      expect(c.horizontalSpeed).toBeGreaterThan(1);
      expect(c.horizontalSpeed).toBeLessThanOrEqual(4 + 1e-6);
    }
  });
});

describe('external forces', () => {
  const wind = (_x: number, a = MAX_EXTERNAL_FORCE * 5): ExternalForce => ({ id: 'w', kind: 'WIND', acceleration: { x: a, y: 0, z: 0 } });

  it('caps the horizontal force at 12 m/s2 (and by the walking limit)', () => {
    const c = new FirstPersonController({ environment: env({ forcesAt: () => [wind(0)] }) });
    run(c, 240, IDLE);
    // Drift under a huge force stays under 40% of walking speed.
    expect(c.horizontalSpeed).toBeLessThanOrEqual(0.4 * 4 + 1e-6);
    expect(c.position.x).toBeGreaterThan(1);
  });

  it('never pushes the child through a collider', () => {
    const wall = new Box3(new Vector3(2, 0, -5), new Vector3(2.5, 3, 5));
    const c = new FirstPersonController({ colliders: [wall], environment: env({ forcesAt: () => [wind(0)] }) });
    run(c, 600, IDLE);
    expect(c.position.x).toBeLessThanOrEqual(2 - c.collision.radius + 1e-6);
  });

  it('lets the child always walk out of a force volume at walk pace, even on ice', () => {
    for (const friction of [1, 0.05]) {
      // A volume x 0..10 pushing toward a hazard beyond x = 10.
      const surface: SurfaceProfile = { id: 's', friction, speedMultiplier: 1 };
      const environment = env({
        surfaceAt: () => surface,
        forcesAt: (x) => (x >= 0 && x <= 10 ? [wind(x)] : []),
      });
      const c = new FirstPersonController({ environment, startPosition: new Vector3(8, 0, 0) });
      c.yaw = FORWARD_X;
      run(c, 120, WALK); // 2 s
      expect(c.position.x).toBeLessThan(5.5);
      expect(c.position.x).toBeLessThan(8 - 0.5 * 4);
    }
  });

  it('can be switched off for grounded children', () => {
    const grounded: ExternalForce = { ...wind(0, 8), affectsGrounded: false };
    const c = new FirstPersonController({ environment: env({ forcesAt: () => [grounded] }) });
    run(c, 120, IDLE);
    expect(c.position.x).toBe(0);
  });

  it('lets an updraft stronger than gravity lift the child, and only that', () => {
    const lift = (a: number): ExternalForce => ({ id: 'u', kind: 'UPDRAFT', acceleration: { x: 0, y: a, z: 0 } });
    const weak = new FirstPersonController({ environment: env({ forcesAt: () => [lift(10)] }) });
    run(weak, 60, IDLE);
    expect(weak.position.y).toBe(0);
    const strong = new FirstPersonController({ environment: env({ forcesAt: () => [lift(60)] }) });
    run(strong, 30, IDLE);
    expect(strong.position.y).toBeGreaterThan(0.2);
    expect(strong.grounded).toBe(false);
  });

  it('ignores non-finite forces', () => {
    const bad: ExternalForce = { id: 'n', kind: 'WIND', acceleration: { x: Number.NaN, y: 0, z: 0 } };
    const c = new FirstPersonController({ environment: env({ forcesAt: () => [bad] }) });
    run(c, 30, IDLE);
    expect(Number.isFinite(c.position.x)).toBe(true);
    expect(c.position.x).toBe(0);
  });
});

describe('swimming', () => {
  const WATER_TOP = 2;
  const pool = env({
    mediumAt: (_x, y) => (y < WATER_TOP ? 'WATER' : 'AIR'),
    waterSurfaceAt: () => WATER_TOP,
  });

  it('floats at a comfortable depth with reduced gravity and never drowns', () => {
    const c = new FirstPersonController({ environment: pool });
    run(c, 60 * 30, IDLE);
    expect(c.playerState).toBe('SWIMMING');
    expect(c.swimming).toBe(true);
    expect(c.grounded).toBe(false);
    // Head (1.7 m tall) stays above the surface.
    expect(c.position.y + 1.7).toBeGreaterThan(WATER_TOP);
    expect(c.position.y).toBeLessThan(WATER_TOP);
    expect(c.consumeEvents().filter((e) => e.type === 'RECOVERED')).toEqual([]);
  });

  it('turns jump into a swim stroke, not a leap', () => {
    const c = new FirstPersonController({ environment: pool });
    run(c, 240, IDLE);
    const floatY = c.position.y;
    c.pressJump();
    let peak = floatY;
    for (let i = 0; i < 60; i += 1) {
      c.update(DT, IDLE);
      peak = Math.max(peak, c.position.y);
    }
    expect(peak - floatY).toBeGreaterThan(0.5);
    expect(c.consumeEvents().filter((e) => e.type === 'JUMPED')).toEqual([]);
  });

  it('swims slower than it walks and leaves swimming when the water is gone', () => {
    const c = new FirstPersonController({ environment: pool });
    c.yaw = FORWARD_PLUS_X;
    run(c, 180, WALK);
    expect(c.horizontalSpeed).toBeLessThanOrEqual(4 * 0.6 + 1e-6);
    expect(c.horizontalSpeed).toBeGreaterThan(1.5);
    const dry = new FirstPersonController({ environment: NEUTRAL_ENVIRONMENT });
    run(dry, 10, IDLE);
    expect(dry.swimming).toBe(false);
  });

  it('rests on the bed in shallow water instead of swimming', () => {
    const shallow = env({ mediumAt: (_x, y) => (y < 0.5 ? 'WATER' : 'AIR'), waterSurfaceAt: () => 0.5 });
    const c = new FirstPersonController({ environment: shallow });
    run(c, 120, IDLE);
    expect(c.swimming).toBe(false);
    expect(c.grounded).toBe(true);
  });
});

describe('climbing', () => {
  const ladder: ClimbableInfo = {
    id: 'ladder',
    bottomY: 0,
    topY: 3,
    facingYaw: 0,
    exitTop: { x: 0, y: 3, z: 1.5 },
  };
  const environment = env({ climbableAt: (_x, y, z) => (y >= 0 && y <= 3 && z < 1 ? ladder : null) });
  const landing = new Box3(new Vector3(-2, 0, 1), new Vector3(2, 3, 3));
  const make = () =>
    new FirstPersonController({
      environment,
      colliders: [landing],
      jumpableColliders: new Set([landing]),
      startPosition: new Vector3(0, 0, -0.2),
    });
  const UP: MoveInput = { forward: 1, strafe: 0 };

  it('climbs without gravity and holds still when the child stops', () => {
    const c = make();
    run(c, 60, UP);
    expect(c.playerState).toBe('CLIMBING');
    expect(c.position.y).toBeGreaterThan(1);
    const held = c.position.y;
    run(c, 120, IDLE);
    expect(c.position.y).toBe(held);
    expect(c.climbableId).toBe('ladder');
  });

  it('puts the feet at exitTop on reaching the top', () => {
    const c = make();
    let frames = 0;
    do {
      c.update(DT, UP);
      frames += 1;
    } while (c.climbing && frames < 600);
    expect(frames).toBeGreaterThan(100);
    expect(c.climbing).toBe(false);
    expect(c.position.x).toBe(0);
    expect(c.position.y).toBe(3);
    expect(c.position.z).toBe(1.5);
    expect(c.grounded).toBe(true);
  });

  it('lets go with back at the bottom, and with jump anywhere', () => {
    const c = make();
    run(c, 30, UP);
    run(c, 60, { forward: -1, strafe: 0 });
    expect(c.climbing).toBe(false);
    expect(c.position.y).toBe(0);
    expect(c.grounded).toBe(true);

    const j = make();
    run(j, 40, UP);
    j.pressJump();
    j.update(DT, IDLE);
    expect(j.climbing).toBe(false);
    run(j, 120, IDLE);
    expect(j.position.y).toBe(0);
    expect(j.grounded).toBe(true);
  });

  it('does not climb facing away or without pushing forward', () => {
    const away = make();
    away.yaw = Math.PI;
    run(away, 30, UP);
    expect(away.climbing).toBe(false);
    const idle = make();
    run(idle, 30, IDLE);
    expect(idle.climbing).toBe(false);
  });
});

describe('maxWalkableSlope', () => {
  const ramp = (_x: number, z: number) => (z > 0 ? z * 0.5 : 0);
  const UP_RAMP: MoveInput = { forward: 1, strafe: 0 };

  it('blocks ground rising faster than the limit and allows gentler ground', () => {
    const steep = new FirstPersonController({ groundHeightAt: ramp, maxWalkableSlope: 0.3 });
    steep.yaw = 0; // forward is +z
    run(steep, 120, UP_RAMP);
    expect(steep.position.z).toBeLessThan(0.3);
    const gentle = new FirstPersonController({ groundHeightAt: ramp, maxWalkableSlope: 0.6 });
    run(gentle, 120, UP_RAMP);
    expect(gentle.position.z).toBeGreaterThan(5);
    expect(gentle.position.y).toBeCloseTo(gentle.position.z * 0.5, 1);
  });

  it('never blocks walking down, and defaults to unlimited', () => {
    const down = new FirstPersonController({ groundHeightAt: ramp, maxWalkableSlope: 0.3, startPosition: new Vector3(0, 2.5, 5) });
    down.yaw = Math.PI;
    run(down, 120, UP_RAMP);
    expect(down.position.z).toBeLessThan(1);
    const free = new FirstPersonController({ groundHeightAt: ramp });
    run(free, 120, UP_RAMP);
    expect(free.position.z).toBeGreaterThan(5);
  });

  it('ignores a nonsense limit', () => {
    for (const slope of [0, -1, Number.NaN]) {
      const c = new FirstPersonController({ groundHeightAt: ramp, maxWalkableSlope: slope });
      run(c, 120, UP_RAMP);
      expect(c.position.z).toBeGreaterThan(5);
    }
  });
});

describe('setEnvironment (GE-065: an environment arriving after construction)', () => {
  it('neutral then null leaves movement identical to never setting one', () => {
    const wall = new Box3(new Vector3(3, 0, -2), new Vector3(4, 3, 2));
    const a = new FirstPersonController({ colliders: [wall] });
    const b = new FirstPersonController({ colliders: [wall] });
    a.yaw = b.yaw = FORWARD_PLUS_X;
    for (let i = 0; i < 200; i += 1) {
      if (i === 30) b.setEnvironment(NEUTRAL_ENVIRONMENT);
      if (i === 120) b.setEnvironment(null);
      const input = i % 90 < 60 ? WALK : IDLE;
      a.update(DT, input);
      b.update(DT, input);
      expect(b.position.x).toBe(a.position.x);
      expect(b.position.z).toBe(a.position.z);
      expect(b.horizontalSpeed).toBe(a.horizontalSpeed);
    }
  });

  it('an ice environment set mid-run changes friction from the next update, and null restores grip', () => {
    const c = new FirstPersonController();
    c.yaw = FORWARD_PLUS_X;
    run(c, 30, WALK);
    expect(c.friction).toBe(1);
    c.setEnvironment(ice(0.1));
    run(c, 1, WALK);
    expect(c.friction).toBeCloseTo(0.1);
    c.setEnvironment(null);
    expect(c.friction).toBe(1);
    run(c, 1, WALK);
    expect(c.friction).toBe(1);
  });

  it('clearing the environment ends a climb at once', () => {
    const ladder: ClimbableInfo = { id: 'ladder', bottomY: 0, topY: 3, facingYaw: FORWARD_PLUS_X, exitTop: { x: 1, y: 3, z: 0 } };
    const c = new FirstPersonController({ environment: env({ climbableAt: () => ladder }) });
    c.yaw = FORWARD_PLUS_X;
    run(c, 20, WALK);
    expect(c.climbing).toBe(true);
    c.setEnvironment(null);
    expect(c.climbing).toBe(false);
    run(c, 60, IDLE);
    expect(c.grounded).toBe(true);
  });
});
