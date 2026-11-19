import { describe, expect, it } from 'vitest';
import { PLAYER_ENTITY_ID, PlayerTransformComponent, type PlayerTransform } from '../contracts/player';
import type { CapabilityRequest } from '../core/capabilities';
import type { MovementInputFrame } from '../movement/movementSystem';
import { createAabbPhysicsProvider, type AabbPhysicsProvider } from '../physics/aabbProvider';
import { createStandardEngine, type StandardEngineHandle } from '../engine/standardEngine';

/**
 * Wave 2 stabilization, areas 3 and 4: the simulation is independent of display frame rate,
 * a long frame never tunnels the child through a wall, and the canonical PlayerTransform always
 * agrees with the controller (position every step, zero achieved velocity into a wall, idle gait
 * when blocked).
 */

const FORWARD = Math.PI / 2; // the controller's +x
const MOVE: CapabilityRequest[] = [{ id: 'movement.locomotion' }, { id: 'movement.jump' }];

function transformOf(handle: StandardEngineHandle): PlayerTransform {
  const entity = handle.runtime.world.bySemanticId(PLAYER_ENTITY_ID)!;
  return handle.runtime.world.get(entity, PlayerTransformComponent)!;
}

/** A scripted input: one frame per simulation step, keyed on the step number. */
function scripted(script: (step: number) => MovementInputFrame) {
  let step = 0;
  return {
    polls: () => step,
    source: (): MovementInputFrame => script(step++),
  };
}

async function boot(options: {
  requests?: CapabilityRequest[];
  input: () => MovementInputFrame;
  physics?: AabbPhysicsProvider;
  start?: { x: number; y: number; z: number };
  timestep?: { stepSeconds?: number; maxFrameSeconds?: number; maxStepsPerFrame?: number };
}) {
  return createStandardEngine({
    id: 'timestep-test',
    requests: options.requests ?? MOVE,
    input: options.input,
    startPosition: options.start ?? { x: 0, y: 0, z: 0 },
    startYaw: FORWARD,
    ...(options.physics ? { physics: options.physics } : {}),
    ...(options.timestep ? { timestep: options.timestep } : {}),
  });
}

describe('fixed timestep: frame-rate independent movement', () => {
  const STEPS = 240; // 4 simulated seconds

  const script = (step: number): MovementInputFrame => {
    if (step < 40) return { move: { forward: 1, strafe: 0 } };
    if (step === 40) return { move: { forward: 1, strafe: 0 }, jumpPressed: true };
    if (step < 100) return { move: { forward: 1, strafe: 0.5 } };
    if (step === 100) return { move: { forward: 0.5, strafe: 0 }, look: { dx: 60, dy: 0 } };
    if (step < 160) return { move: { forward: 1, strafe: -0.5, sprint: true } };
    return { move: { forward: 0, strafe: 0 } };
  };

  async function run(fps: number) {
    const input = scripted(script);
    const physics = createAabbPhysicsProvider();
    // A low step to hop over and a wall to slide along make the result depend on collision order.
    physics.addCollider({ id: 'step', kind: 'JUMPABLE', min: { x: 4, y: 0, z: -2 }, max: { x: 5, y: 0.5, z: 2 } });
    physics.addCollider({ id: 'wall', kind: 'SOLID', min: { x: 14, y: 0, z: -20 }, max: { x: 15, y: 3, z: 20 } });
    const handle = await boot({ input: input.source, physics });
    const frame = 1 / fps;
    let guard = 0;
    while (input.polls() < STEPS && guard < 100000) {
      handle.runtime.tick(frame);
      guard += 1;
    }
    const result = {
      steps: input.polls(),
      x: handle.controller.position.x,
      y: handle.controller.position.y,
      z: handle.controller.position.z,
      yaw: handle.controller.yaw,
      vy: handle.controller.verticalVelocity,
      simulated: handle.runtime.clock.simulatedSeconds,
    };
    handle.dispose();
    return result;
  }

  it('runs exactly the same number of steps for the same simulated time at 30, 60 and 144 fps', async () => {
    const [a, b, c] = [await run(30), await run(60), await run(144)];
    expect(a.steps).toBe(STEPS);
    expect(b.steps).toBe(STEPS);
    expect(c.steps).toBe(STEPS);
    expect(a.simulated).toBeCloseTo(b.simulated, 9);
    expect(c.simulated).toBeCloseTo(b.simulated, 9);
  });

  it('ends at the same position, yaw and vertical velocity (within 1e-9) at 30, 60 and 144 fps', async () => {
    const reference = await run(60);
    expect(reference.x).toBeGreaterThan(5); // it really travelled and jumped
    for (const fps of [30, 144]) {
      const other = await run(fps);
      expect(Math.abs(other.x - reference.x), `x at ${fps} fps`).toBeLessThan(1e-9);
      expect(Math.abs(other.y - reference.y), `y at ${fps} fps`).toBeLessThan(1e-9);
      expect(Math.abs(other.z - reference.z), `z at ${fps} fps`).toBeLessThan(1e-9);
      expect(Math.abs(other.yaw - reference.yaw), `yaw at ${fps} fps`).toBeLessThan(1e-9);
      expect(Math.abs(other.vy - reference.vy), `vy at ${fps} fps`).toBeLessThan(1e-9);
    }
  });

  it('an irregular frame pattern (jittery 144/30/60 mix) matches a steady 60 fps run', async () => {
    const reference = await run(60);
    const input = scripted(script);
    const physics = createAabbPhysicsProvider();
    physics.addCollider({ id: 'step', kind: 'JUMPABLE', min: { x: 4, y: 0, z: -2 }, max: { x: 5, y: 0.5, z: 2 } });
    physics.addCollider({ id: 'wall', kind: 'SOLID', min: { x: 14, y: 0, z: -20 }, max: { x: 15, y: 3, z: 20 } });
    const handle = await boot({ input: input.source, physics });
    const pattern = [1 / 144, 1 / 30, 1 / 60, 1 / 144, 1 / 144, 1 / 90];
    let i = 0;
    while (input.polls() < STEPS) {
      handle.runtime.tick(pattern[i % pattern.length]!);
      i += 1;
    }
    expect(input.polls()).toBe(STEPS);
    expect(Math.abs(handle.controller.position.x - reference.x)).toBeLessThan(1e-9);
    expect(Math.abs(handle.controller.position.y - reference.y)).toBeLessThan(1e-9);
    expect(Math.abs(handle.controller.position.z - reference.z)).toBeLessThan(1e-9);
    handle.dispose();
  });
});

describe('fixed timestep: a long frame never tunnels through a wall', () => {
  const sprint: MovementInputFrame = { move: { forward: 1, strafe: 0, sprint: true } };

  async function sprintAtThinWall(timestep?: { stepSeconds?: number; maxFrameSeconds?: number; maxStepsPerFrame?: number }) {
    const physics = createAabbPhysicsProvider();
    // Far thinner than any authored collider: a worst case for tunnelling.
    physics.addCollider({ id: 'thin', kind: 'SOLID', min: { x: 5, y: 0, z: -10 }, max: { x: 5.05, y: 3, z: 10 } });
    const handle = await boot({ input: () => sprint, physics, ...(timestep ? { timestep } : {}) });
    return { handle };
  }

  it('single huge frames (10 s, 60 s) are clamped and the child stays before the wall', async () => {
    const { handle } = await sprintAtThinWall();
    const start = handle.controller.position.x;
    for (const frame of [10, 60, 10, 10, 10]) {
      handle.runtime.tick(frame);
      expect(handle.controller.position.x).toBeLessThan(5);
    }
    // Each huge frame is clamped to a few fixed steps, so the child moves on (no freeze) but only
    // a little: five clamped frames are about 0.67 s of simulation, not 100 s.
    expect(handle.controller.position.x).toBeGreaterThan(start);
    handle.dispose();
  });

  it('a clamped frame advances at most maxStepsPerFrame steps of simulated time', async () => {
    const { handle } = await sprintAtThinWall();
    const before = handle.runtime.clock.simulatedSeconds;
    handle.runtime.tick(100);
    const advanced = handle.runtime.clock.simulatedSeconds - before;
    expect(advanced).toBeLessThanOrEqual(8 / 60 + 1e-9);
    handle.dispose();
  });

  it('the widest allowed step (1/15 s) and frame clamp still cannot cross a thin wall', async () => {
    const { handle } = await sprintAtThinWall({ stepSeconds: 1 / 15, maxFrameSeconds: 1, maxStepsPerFrame: 15 });
    for (let i = 0; i < 40; i += 1) {
      handle.runtime.tick(1);
      expect(handle.controller.position.x).toBeLessThan(5);
    }
    handle.dispose();
  });

  it('a very large frame after a pause (resume) is not replayed as a burst', async () => {
    const { handle } = await sprintAtThinWall();
    handle.runtime.tick(1 / 60);
    handle.runtime.pause();
    handle.runtime.resume();
    const before = handle.runtime.clock.simulatedSeconds;
    handle.runtime.tick(1 / 60);
    expect(handle.runtime.clock.simulatedSeconds - before).toBeLessThanOrEqual(1 / 60 + 1e-9);
    handle.dispose();
  });
});

describe('movement and collision consistency', () => {
  /** Records, at the end of every simulation step, how far the transform is from the controller. */
  function auditTransform(handle: StandardEngineHandle) {
    const mismatches: { step: number; dx: number; dy: number; dz: number }[] = [];
    let steps = 0;
    handle.runtime.systems.add({
      id: 'stabilization.audit',
      phase: 'postSimulation',
      order: 1000,
      update() {
        steps += 1;
        const t = transformOf(handle);
        const p = handle.controller.position;
        const dx = Math.abs(t.position.x - p.x);
        const dy = Math.abs(t.position.y - p.y);
        const dz = Math.abs(t.position.z - p.z);
        if (dx > 1e-9 || dy > 1e-9 || dz > 1e-9) mismatches.push({ step: steps, dx, dy, dz });
      },
    });
    return { mismatches, steps: () => steps };
  }

  it('the canonical transform equals the controller position after every step (walk, jump, wall)', async () => {
    const physics = createAabbPhysicsProvider();
    physics.addCollider({ id: 'wall', kind: 'SOLID', min: { x: 6, y: 0, z: -5 }, max: { x: 7, y: 3, z: 5 } });
    const input = scripted((step) => ({ move: { forward: 1, strafe: step % 90 < 45 ? 0 : 0.3 }, ...(step === 20 || step === 120 ? { jumpPressed: true } : {}) }));
    const handle = await boot({ input: input.source, physics });
    const audit = auditTransform(handle);
    for (let i = 0; i < 400; i += 1) handle.runtime.tick(1 / 60);
    expect(audit.steps()).toBe(400);
    expect(audit.mismatches).toEqual([]);
    handle.dispose();
  });

  it('the previousPosition is the position of the step before (interpolation source)', async () => {
    const handle = await boot({ input: () => ({ move: { forward: 1, strafe: 0 } }) });
    let last: { x: number; y: number; z: number } | null = null;
    for (let i = 0; i < 60; i += 1) {
      handle.runtime.tick(1 / 60);
      const t = transformOf(handle);
      if (last) {
        expect(t.previousPosition.x).toBeCloseTo(last.x, 12);
        expect(t.previousPosition.z).toBeCloseTo(last.z, 12);
      }
      last = { ...t.position };
    }
    handle.dispose();
  });

  it('achieved velocity is zero into a wall and the gait settles to idle (no walking in place)', async () => {
    const physics = createAabbPhysicsProvider();
    physics.addCollider({ id: 'wall', kind: 'SOLID', min: { x: 3, y: 0, z: -5 }, max: { x: 4, y: 3, z: 5 } });
    const handle = await boot({ input: () => ({ move: { forward: 1, strafe: 0 } }), physics });
    const gaits: string[] = [];
    handle.runtime.events.on('PlayerGaitChanged' as never, ((e: { gait: string }) => gaits.push(e.gait)) as never);
    for (let i = 0; i < 240; i += 1) handle.runtime.tick(1 / 60);
    const t = transformOf(handle);
    expect(t.position.x).toBeLessThan(3);
    expect(Math.abs(t.velocity.x)).toBeLessThan(1e-6);
    expect(Math.abs(t.velocity.z)).toBeLessThan(1e-6);
    expect(t.gait).toBe('idle');
    expect(handle.controller.gait).toBe('idle');
    expect(gaits.at(-1)).toBe('idle');
    // It did walk before it hit the wall.
    expect(gaits).toContain('walk');
    handle.dispose();
  });

  it('pressing diagonally into a wall slides along it with no drift into the wall', async () => {
    const physics = createAabbPhysicsProvider();
    physics.addCollider({ id: 'wall', kind: 'SOLID', min: { x: 3, y: 0, z: -50 }, max: { x: 4, y: 3, z: 50 } });
    const handle = await boot({ input: () => ({ move: { forward: 1, strafe: 1 } }), physics });
    for (let i = 0; i < 240; i += 1) {
      handle.runtime.tick(1 / 60);
      expect(handle.controller.position.x).toBeLessThan(3);
    }
    const t = transformOf(handle);
    expect(Math.abs(t.velocity.x)).toBeLessThan(1e-6);
    expect(Math.abs(t.velocity.z)).toBeGreaterThan(1); // sliding along the wall
    handle.dispose();
  });

  // GE-L10 (fixed 2026-11-19): the carry system re-publishes the transform after carrying, so
  // the canonical transform equals the controller in the same step. Was an expected failure.
  it('a platform carrying the child keeps the canonical transform equal to the controller after every step', async () => {
    const requests: CapabilityRequest[] = [
      ...MOVE,
      {
        id: 'gameplay.platforms',
        config: {
          platforms: [
            {
              id: 'ferry',
              position: { x: 0, y: 0, z: 0 },
              size: { x: 2, y: 0.5, z: 2 },
              route: 'OPTIONAL',
              moving: { path: [{ x: 0, y: 0, z: 0 }, { x: 6, y: 0, z: 0 }], mode: 'PING_PONG', speed: 1, pauseSeconds: 0 },
            },
          ],
        },
      },
    ];
    const handle = await boot({ requests, input: () => ({ move: { forward: 0, strafe: 0 } }), start: { x: 0, y: 0.5, z: 0 } });
    const mismatches: number[] = [];
    handle.runtime.systems.add({
      id: 'stabilization.audit',
      phase: 'postSimulation',
      order: 1000,
      update() {
        const t = transformOf(handle);
        const dx = Math.abs(t.position.x - handle.controller.position.x);
        if (dx > 1e-9) mismatches.push(dx);
      },
    });
    for (let i = 0; i < 120; i += 1) handle.runtime.tick(1 / 60);
    expect(transformOf(handle).supportId).toBe('ferry');
    expect(handle.controller.position.x).toBeGreaterThan(1);
    expect(mismatches).toEqual([]);
    handle.dispose();
  });
});
