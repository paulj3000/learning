import { describe, expect, it } from 'vitest';
import { Box3 } from 'three';
import { FirstPersonController, type MoveInput } from '../firstPersonController';
import { NO_WORLD_STATE } from '../runtime/sceneLayout';
import { PlatformSystem } from './platformSystem';
import { applyTuning, validatePlatforming, type PlatformingSpec, type PlatformSpec } from './platformSpec';
import { checkpointReachedText, recoveredText } from './platformCopy';

/**
 * The shared platform runtime against the real movement controller (no Three.js scene): the
 * controller stays authoritative, the platforms only carry, bounce and send back.
 */

const FRAME = 1 / 60;
const STILL: MoveInput = { forward: 0, strafe: 0 };
const NORTH: MoveInput = { forward: 1, strafe: 0 };

function rig(spec: PlatformingSpec, extra: { colliders?: Box3[]; reducedMotion?: boolean; zones?: Map<string, { id: string; minX: number; maxX: number; minZ: number; maxZ: number }> } = {}) {
  const colliders: Box3[] = [...(extra.colliders ?? [])];
  const jumpable = new Set<Box3>();
  const system = new PlatformSystem(spec, {
    colliders,
    jumpable,
    worldState: NO_WORLD_STATE,
    zones: extra.zones ?? new Map(),
    ...(extra.reducedMotion ? { reducedMotion: true } : {}),
  });
  const controller = new FirstPersonController({
    colliders,
    jumpableColliders: jumpable,
    isSafeGround: (x, y, z) => system.isSafeGround(x, y, z),
    recoveryPoint: () => system.recoveryPoint(),
  });
  const run = (seconds: number, input: MoveInput = STILL, yaw = 0) => {
    const events: string[] = [];
    for (let t = 0; t < seconds - 1e-9; t += FRAME) {
      system.update(FRAME, controller);
      for (const event of system.consumeEvents()) events.push(event.type);
      controller.yaw = yaw;
      controller.update(FRAME, input);
    }
    return events;
  };
  return { system, controller, colliders, jumpable, run };
}

const dock = (overrides: Partial<PlatformSpec> = {}): PlatformSpec => ({
  id: 'dock',
  size: { width: 2, height: 0.5, depth: 2 },
  position: { x: 0, y: 0, z: 5 },
  ...overrides,
});

/** Puts the child on top of a platform at (x, z). */
function standOn(controller: FirstPersonController, x: number, y: number, z: number) {
  controller.position.set(x, y, z);
  controller.update(FRAME, STILL);
}

describe('static platforms', () => {
  it('are jumpable boxes the child stands on, and are removed on dispose', () => {
    const { system, controller, colliders, jumpable } = rig({ platforms: [dock()] });
    expect(colliders).toHaveLength(1);
    expect(jumpable.has(colliders[0]!)).toBe(true);
    standOn(controller, 0, 0.5, 5);
    expect(controller.grounded).toBe(true);
    expect(system.platformOf(controller.supportingBox())?.spec.id).toBe('dock');
    system.dispose();
    expect(colliders).toHaveLength(0);
  });
});

describe('moving platforms carry their rider', () => {
  const ferry = dock({ id: 'ferry', motion: { path: [{ x: 6, y: 0, z: 0 }], speed: 2, pauseSeconds: 0.5 } });

  it('moves a standing child sideways with the platform', () => {
    const { controller, run, system } = rig({ platforms: [ferry] });
    standOn(controller, 0, 0.5, 5);
    const events = run(1.5);
    const platform = system.platforms[0]!;
    expect(platform.position.x).toBeCloseTo(3, 1);
    expect(controller.position.x).toBeCloseTo(platform.position.x, 1);
    expect(controller.position.y).toBeCloseTo(0.5, 2);
    expect(events).toContain('MOVING');
  });

  it('lifts a rider up a vertical lift and down again', () => {
    const lift = dock({ id: 'lift', motion: { path: [{ x: 0, y: 3, z: 0 }], speed: 1, pauseSeconds: 1 } });
    const { controller, run } = rig({ platforms: [lift] });
    standOn(controller, 0, 0.5, 5);
    run(3.2);
    expect(controller.position.y).toBeCloseTo(3.5, 1);
    expect(controller.grounded).toBe(true);
    run(4);
    expect(controller.position.y).toBeCloseTo(0.5, 1);
  });

  it('lets the child jump off a moving platform keeping their own momentum, and land on it again', () => {
    const { controller, run, system } = rig({ platforms: [ferry] });
    standOn(controller, 0, 0.5, 5);
    run(0.5);
    controller.pressJump();
    run(0.2);
    expect(controller.grounded).toBe(false);
    run(1);
    // Landed back on the ferry, which kept moving underneath.
    expect(controller.grounded).toBe(true);
    expect(system.platformOf(controller.supportingBox())?.spec.id).toBe('ferry');
  });

  it('lets the child walk off the edge onto the ground', () => {
    const { controller, run, system } = rig({ platforms: [dock()] });
    standOn(controller, 0, 0.5, 5);
    run(1, NORTH); // north is +Z
    expect(system.platformOf(controller.supportingBox())).toBeNull();
    expect(controller.position.y).toBeCloseTo(0, 2);
  });

  it('waits rather than moving into a child standing in its way', () => {
    const { controller, run, system } = rig({ platforms: [ferry] });
    controller.position.set(2, 0, 5); // on the ground, in the ferry's path
    run(3);
    const platform = system.platforms[0]!;
    expect(platform.position.x + 1).toBeLessThanOrEqual(2 + 1e-6); // its edge stops at the child
    expect(controller.position.x).toBeCloseTo(2, 5); // never pushed
  });

  it('never lifts a rider into something above them', () => {
    const roof = new Box3();
    roof.min.set(-1, 3, 4);
    roof.max.set(1, 3.5, 6);
    const lift = dock({ id: 'lift', motion: { path: [{ x: 0, y: 3, z: 0 }], speed: 1 } });
    const { controller, run, jumpable } = rig({ platforms: [lift] }, { colliders: [roof] });
    jumpable.add(roof);
    standOn(controller, 0, 0.5, 5);
    run(3);
    expect(controller.position.y + 1.7).toBeLessThanOrEqual(3 + 1e-3);
  });

  it('moves slower under reduced motion', () => {
    const fast = rig({ platforms: [ferry] });
    const slow = rig({ platforms: [ferry] }, { reducedMotion: true });
    fast.run(1);
    slow.run(1);
    expect(slow.system.platforms[0]!.position.x).toBeLessThan(fast.system.platforms[0]!.position.x);
  });
});

describe('interactive platforms', () => {
  it('runs while a pressure plate is pressed, then returns when released', () => {
    const bridge = dock({
      id: 'bridge',
      position: { x: 10, y: 0, z: 0 },
      motion: { path: [{ x: 4, y: 0, z: 0 }], speed: 2, mode: 'ONCE' },
      activation: { trigger: 'PLATE', source: 'plate', reset: 'RETURN' },
    });
    const { controller, run, system } = rig({
      platforms: [bridge],
      pressurePlates: [{ id: 'plate', position: { x: 0, z: 0 } }],
    });
    controller.position.set(-5, 0, 0);
    expect(run(0.5)).not.toContain('ACTIVATED');
    controller.position.set(0, 0, 0);
    const events = run(1); // standing on the plate at (0, 0)
    expect(events).toContain('PLATE_PRESSED');
    expect(events).toContain('ACTIVATED');
    expect(system.platforms[0]!.position.x).toBeGreaterThan(10.5);
    controller.position.set(-5, 0, 0);
    run(4);
    expect(system.platforms[0]!.position.x).toBeCloseTo(10, 2);
  });

  it('is toggled by a switch, started by a signal, by a zone, and after a delay', () => {
    const { system, run, controller } = rig(
      {
        platforms: [
          dock({ id: 'a', motion: { path: [{ x: 3, y: 0, z: 0 }], speed: 1 }, activation: { trigger: 'SWITCH', source: 'lever' } }),
          dock({ id: 'b', position: { x: 10, y: 0, z: 5 }, motion: { path: [{ x: 3, y: 0, z: 0 }], speed: 1 }, activation: { trigger: 'SIGNAL', source: 'quiz:lift', delaySeconds: 1 } }),
          dock({ id: 'c', position: { x: -10, y: 0, z: 5 }, motion: { path: [{ x: 0, y: 2, z: 0 }], speed: 1 }, activation: { trigger: 'ZONE', source: 'pad' } }),
        ],
      },
      { zones: new Map([['pad', { id: 'pad', minX: -1, maxX: 1, minZ: -1, maxZ: 1 }]]) },
    );
    controller.position.set(30, 0, 30);
    run(1);
    expect(system.platforms.map((p) => p.active)).toEqual([false, false, false]);
    expect(system.isSwitch('lever')).toBe(true);
    system.toggleSwitch('lever');
    system.signal('quiz:lift');
    controller.position.set(0, 0, 0);
    run(0.5);
    expect(system.platforms.map((p) => p.active)).toEqual([true, false, true]); // b waits 1 s
    run(0.6);
    expect(system.platforms[1]!.active).toBe(true);
  });

  it('a hidden bridge appears when activated, not inside the child', () => {
    const { system, controller, run } = rig({
      platforms: [dock({ id: 'bridge', activation: { trigger: 'SIGNAL', source: 'solved', hiddenUntilActive: true } })],
    });
    expect(system.platforms[0]!.present).toBe(false);
    expect(system.platforms[0]!.box.isEmpty()).toBe(true);
    controller.position.set(0, 0, 5); // standing where it would appear
    system.signal('solved');
    run(0.2);
    expect(system.platforms[0]!.present).toBe(false);
    controller.position.set(0, 0, 0);
    run(0.2);
    expect(system.platforms[0]!.present).toBe(true);
  });
});

describe('vanishing platforms', () => {
  it('blink, vanish leaving no collision, and come back', () => {
    const { system, run } = rig({
      platforms: [dock({ id: 'cloud', vanish: { mode: 'TIMED', visibleSeconds: 2, hiddenSeconds: 1, warningSeconds: 0.5 } })],
    });
    run(1.7);
    expect(system.platforms[0]!.warning).toBe(true);
    run(0.5);
    expect(system.platforms[0]!.present).toBe(false);
    expect(system.platforms[0]!.box.isEmpty()).toBe(true);
    run(1);
    expect(system.platforms[0]!.present).toBe(true);
    expect(system.platforms[0]!.box.isEmpty()).toBe(false);
  });

  it('a STAND platform drops a child who stays on it, onto the ground below', () => {
    const { system, controller, run } = rig({
      platforms: [dock({ id: 'barrel', position: { x: 0, y: 1, z: 5 }, vanish: { mode: 'STAND', visibleSeconds: 2, hiddenSeconds: 2 } })],
    });
    standOn(controller, 0, 1.5, 5);
    run(2.5);
    expect(system.platforms[0]!.present).toBe(false);
    expect(controller.position.y).toBeLessThan(1.5);
  });
});

describe('bounce pads', () => {
  it('throw the child up to about their height, with the jump physics', () => {
    const { controller, run } = rig({ platforms: [dock({ id: 'pad', bounce: { height: 2 } })] });
    standOn(controller, 0, 0.5, 5);
    let top = 0;
    for (let i = 0; i < 60; i += 1) {
      run(FRAME);
      top = Math.max(top, controller.position.y);
    }
    expect(top - 0.5).toBeGreaterThan(1.7);
    expect(top - 0.5).toBeLessThan(2.3);
  });
});

describe('checkpoints, hazards and recovery', () => {
  const course: PlatformingSpec = {
    platforms: [dock({ id: 'ferry', motion: { path: [{ x: 6, y: 0, z: 0 }], speed: 2 } })],
    checkpoints: [{ id: 'start', x: 0, z: 0, label: 'the old dock' }],
    hazards: [{ id: 'water', rect: { id: 'water', minX: -1, maxX: 10, minZ: 3, maxZ: 8 } }],
    goals: [{ id: 'end', rect: { id: 'end', minX: 20, maxX: 22, minZ: -1, maxZ: 1 } }],
  };

  it('a missed jump into water goes back to the latest checkpoint, without a lives system', () => {
    const { controller, run, system } = rig(course);
    const reached = run(0.2);
    expect(reached).toContain('CHECKPOINT');
    controller.position.set(8, 0, 6); // fell in the water beside the ferry
    const events = run(0.1);
    expect(events).toContain('RECOVERED_TO');
    expect(controller.position.x).toBeCloseTo(0);
    expect(controller.position.z).toBeCloseTo(0);
    expect(controller.consumeEvents().some((e) => e.type === 'RECOVERED' && e.reason === 'HAZARD')).toBe(true);
    expect(system.latestCheckpointId()).toBe('start');
  });

  it('never remembers a moving platform as safe ground', () => {
    const { controller, system } = rig(course);
    standOn(controller, 0, 0.5, 5);
    expect(system.isSafeGround(0, 0.5, 5)).toBe(false);
    expect(system.isSafeGround(0, 0, 0)).toBe(true);
    expect(system.isSafeGround(5, 0, 5)).toBe(false); // the water
  });

  it('reports a goal once per visit', () => {
    const { controller, run } = rig(course);
    controller.position.set(21, 0, 0);
    expect(run(0.1)).toContain('GOAL');
    controller.position.set(30, 0, 0);
    run(0.1);
    controller.position.set(21, 0, 0);
    expect(run(0.1)).not.toContain('GOAL');
  });

  it('speaks kindly', () => {
    expect(checkpointReachedText('the old dock')).toBe('Safe spot: the old dock. If you slip, you will come back here.');
    expect(recoveredText(course, 'start')).toBe('Splash! Back to the old dock. Have another go!');
    expect(recoveredText(course, null)).toContain('Have another go!');
  });
});

describe('platforming validation and staff tuning', () => {
  const context = { propIds: new Set(['lever']), zoneIds: new Set(['pad']), bounds: { halfExtentX: 30, halfExtentZ: 30 }, solids: [{ minX: 10, maxX: 12, minZ: 10, maxZ: 12 }] };

  it('accepts a forgiving course', () => {
    expect(
      validatePlatforming(
        {
          platforms: [
            dock(),
            dock({ id: 'ferry', motion: { path: [{ x: 4, y: 0, z: 0 }], speed: 1.5, pauseSeconds: 1 } }),
            dock({ id: 'lever-lift', activation: { trigger: 'SWITCH', source: 'lever' }, motion: { path: [{ x: 0, y: 2, z: 0 }], speed: 1 } }),
          ],
          checkpoints: [{ id: 'cp', x: -5, z: 0, label: 'the beach' }],
        },
        context,
      ),
    ).toEqual([]);
  });

  it('refuses narrow tops, fast or long paths, unknown sources and unsafe checkpoints', () => {
    const issues = validatePlatforming(
      {
        platforms: [
          dock({ size: { width: 0.4, height: 0.5, depth: 2 } }),
          dock({ id: 'zoom', motion: { path: [{ x: 4, y: 0, z: 0 }], speed: 9 } }),
          dock({ id: 'ghost', activation: { trigger: 'PLATE', source: 'nope' } }),
          dock({ id: 'blink', vanish: { mode: 'TIMED', visibleSeconds: 0.5, hiddenSeconds: 1 } }),
          dock({ id: 'dock' }),
        ],
        checkpoints: [
          { id: 'in-wall', x: 11, z: 11, label: 'wall' },
          { id: 'on-ferry', x: 2, z: 5, label: 'ferry' },
        ],
        hazards: [{ id: 'sea', rect: { id: 'sea', minX: 0, maxX: 1, minZ: 0, maxZ: 1 } }],
      },
      context,
    ).map((issue) => issue.path);
    expect(issues).toEqual(
      expect.arrayContaining([
        'platforming.platforms[0].size',
        'platforming.platforms[1].motion.speed',
        'platforming.platforms[2].activation.source',
        'platforming.platforms[3].vanish.visibleSeconds',
        'platforming.platforms[4].id',
        'platforming.checkpoints[0]',
        'platforming.checkpoints[1]',
      ]),
    );
  });

  it('merges staff tuning over the authored platforms and leaves out disabled ones', () => {
    const tuned = applyTuning({
      platforms: [
        dock({ id: 'ferry', motion: { path: [{ x: 4, y: 0, z: 0 }], speed: 1 } }),
        dock({ id: 'pad', bounce: { height: 1 } }),
        dock({ id: 'spare' }),
        dock({ id: 'odd', motion: { path: [{ x: 4, y: 0, z: 0 }], speed: 1 } }),
      ],
      tuning: { ferry: { speed: 2, pauseSeconds: 3 }, pad: { bounceHeight: 2 }, spare: { enabled: false }, odd: { speed: 99 } },
    });
    expect(tuned.map((p) => p.id)).toEqual(['ferry', 'pad', 'odd']);
    expect(tuned[0]!.motion).toMatchObject({ speed: 2, pauseSeconds: 3 });
    expect(tuned[1]!.bounce).toEqual({ height: 2 });
    expect(tuned[2]!.motion!.speed).toBe(1); // invalid tuning is ignored, never applied
  });
});
