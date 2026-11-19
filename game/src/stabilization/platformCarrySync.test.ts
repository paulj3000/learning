import { describe, expect, it } from 'vitest';
import { PLAYER_ENTITY_ID, PlayerTransformComponent, type PlayerTransform } from '../contracts/player';
import type { CapabilityRequest } from '../core/capabilities';
import type { MovementInputFrame } from '../movement/movementSystem';
import { createAabbPhysicsProvider } from '../physics/aabbProvider';
import { createStandardEngine, type StandardEngineHandle } from '../engine/standardEngine';

/**
 * GE-L10 regression: platform carry reaches the canonical PlayerTransform in the same simulation
 * step (no one-step lag), with no teleport (each step's transform moves by at most the platform's
 * own step) and no tunnelling (carry is collision-tested). The transform's velocity stays the
 * child's own, so a carried child who is not walking keeps an idle gait and facing.
 */

const STILL: MovementInputFrame = { move: { forward: 0, strafe: 0 } };
const size = { x: 2, y: 0.5, z: 2 };

function transformOf(handle: StandardEngineHandle): PlayerTransform {
  const entity = handle.runtime.world.bySemanticId(PLAYER_ENTITY_ID)!;
  return handle.runtime.world.get(entity, PlayerTransformComponent)!;
}

function platformRequests(platform: Record<string, unknown>): CapabilityRequest[] {
  return [{ id: 'movement.locomotion' }, { id: 'gameplay.platforms', config: { platforms: [platform] } }];
}

/** Audits every step: transform vs controller, and the largest per-step transform jump. */
function audit(handle: StandardEngineHandle) {
  const result = { mismatch: 0, maxJump: 0, steps: 0 };
  let last: { x: number; y: number; z: number } | null = null;
  handle.runtime.systems.add({
    id: 'test.carryAudit',
    phase: 'postSimulation',
    order: 1000,
    update() {
      result.steps += 1;
      const t = transformOf(handle);
      const p = handle.controller.position;
      result.mismatch = Math.max(result.mismatch, Math.abs(t.position.x - p.x), Math.abs(t.position.y - p.y), Math.abs(t.position.z - p.z));
      if (last) result.maxJump = Math.max(result.maxJump, Math.hypot(t.position.x - last.x, t.position.y - last.y, t.position.z - last.z));
      last = { ...t.position };
    },
  });
  return result;
}

async function boot(platform: Record<string, unknown>, start: { x: number; y: number; z: number }, physics = createAabbPhysicsProvider(), input: () => MovementInputFrame = () => STILL) {
  return createStandardEngine({ id: 'carry-sync', requests: platformRequests(platform), input, startPosition: start, physics });
}

describe('GE-L10 platform carry is in the canonical transform the same step', () => {
  it('a sideways ferry: transform equals controller every step, moves smoothly, gait idle, velocity the child\'s own', async () => {
    const handle = await boot(
      { id: 'ferry', position: { x: 0, y: 0, z: 0 }, size, route: 'OPTIONAL', moving: { path: [{ x: 6, y: 0, z: 0 }], mode: 'PING_PONG', speed: 1, pauseSeconds: 0 } },
      { x: 0, y: 0.5, z: 0 },
    );
    const a = audit(handle);
    for (let i = 0; i < 180; i += 1) handle.runtime.tick(1 / 60);
    const t = transformOf(handle);
    expect(t.supportId).toBe('ferry');
    expect(handle.controller.position.x).toBeGreaterThan(2);
    expect(a.mismatch).toBeLessThan(1e-9);
    expect(a.maxJump).toBeLessThan(1 / 60 + 1e-6); // speed 1 m/s: never more than one platform step
    expect(t.gait).toBe('idle');
    expect(Math.hypot(t.velocity.x, t.velocity.z)).toBeLessThan(1e-6);
    // Interpolation source includes the carry: previous to current is exactly this step's motion.
    expect(t.position.x - t.previousPosition.x).toBeCloseTo(1 / 60, 6);
    handle.dispose();
  });

  it('a rising lift: the rider rises with it in the same step and stays on it', async () => {
    const handle = await boot(
      { id: 'lift', position: { x: 0, y: 0, z: 0 }, size, route: 'OPTIONAL', moving: { path: [{ x: 0, y: 3, z: 0 }], mode: 'ONCE', speed: 1, pauseSeconds: 0 } },
      { x: 0, y: 0.5, z: 0 },
    );
    const a = audit(handle);
    for (let i = 0; i < 240; i += 1) handle.runtime.tick(1 / 60);
    expect(a.mismatch).toBeLessThan(1e-9);
    expect(a.maxJump).toBeLessThan(1 / 60 + 1e-6);
    expect(handle.controller.position.y).toBeCloseTo(3.5, 3);
    expect(transformOf(handle).supportId).toBe('lift');
    handle.dispose();
  });

  it('a ferry into a wall never pushes the child through it (no tunnelling), still in sync', async () => {
    const physics = createAabbPhysicsProvider();
    physics.addCollider({ id: 'wall', kind: 'SOLID', min: { x: 2.5, y: 0, z: -5 }, max: { x: 2.6, y: 3, z: 5 } });
    const handle = await boot(
      { id: 'ferry', position: { x: 0, y: 0, z: 0 }, size: { x: 8, y: 0.5, z: 2 }, route: 'OPTIONAL', moving: { path: [{ x: 6, y: 0, z: 0 }], mode: 'ONCE', speed: 3, pauseSeconds: 0 } },
      { x: 0, y: 0.5, z: 0 },
      physics,
    );
    const a = audit(handle);
    for (let i = 0; i < 180; i += 1) {
      handle.runtime.tick(1 / 60);
      expect(handle.controller.position.x).toBeLessThan(2.5); // SOLID colliders block when they span ground level
    }
    expect(a.mismatch).toBeLessThan(1e-9);
    handle.dispose();
  });

  it('a turntable: the tangential carry is in the transform the same step', async () => {
    const handle = await boot(
      { id: 'spin', position: { x: 0, y: 0, z: 0 }, size: { x: 6, y: 0.5, z: 6 }, route: 'OPTIONAL', spinDegreesPerSecond: 45 },
      { x: 2, y: 0.5, z: 0 },
    );
    const a = audit(handle);
    for (let i = 0; i < 60; i += 1) handle.runtime.tick(1 / 60);
    expect(a.mismatch).toBeLessThan(1e-9);
    expect(Math.abs(handle.controller.position.z)).toBeGreaterThan(0.5); // it really carried
    handle.dispose();
  });

  it('walking on a moving ferry keeps the walking velocity and gait (carry is not walking)', async () => {
    const handle = await boot(
      { id: 'ferry', position: { x: 0, y: 0, z: 0 }, size: { x: 3, y: 0.5, z: 8 }, route: 'OPTIONAL', moving: { path: [{ x: 6, y: 0, z: 0 }], mode: 'PING_PONG', speed: 1, pauseSeconds: 0 } },
      { x: 0, y: 0.5, z: -3 },
      undefined,
      () => ({ move: { forward: 1, strafe: 0 } }),
    );
    const a = audit(handle);
    for (let i = 0; i < 40; i += 1) handle.runtime.tick(1 / 60);
    const t = transformOf(handle);
    expect(a.mismatch).toBeLessThan(1e-9);
    expect(t.gait).not.toBe('idle');
    handle.dispose();
  });
});
