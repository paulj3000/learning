import { describe, expect, it } from 'vitest';
import { PLAYER_ENTITY_ID, PlayerTransformComponent } from '../contracts/player';
import { REDUCED_MOTION_SPEED_SCALE } from '../components/common';
import { PlatformsService } from '../components/platforms';
import { createAabbPhysicsProvider } from '../physics/aabbProvider';
import { createStandardEngine, type StandardEngineHandle } from '../engine/standardEngine';
import type { MovementInputFrame } from '../movement/movementSystem';

/**
 * GE-L15: a turntable turns (yawOf, for the mesh) and carries the child round its centre at the
 * same rate and in the same direction, keeping their distance from the centre (no outward drift
 * off the edge), while walls still block the carry.
 */

const STILL: MovementInputFrame = { move: { forward: 0, strafe: 0 } };
const turntable = (extra: Record<string, unknown> = {}) => ({
  id: 'spin',
  position: { x: 0, y: 0, z: 0 },
  size: { x: 8, y: 0.5, z: 8 },
  route: 'OPTIONAL',
  spinDegreesPerSecond: 45,
  ...extra,
});

async function boot(
  platform: Record<string, unknown>,
  start: { x: number; z: number },
  options: { reducedMotion?: boolean; physics?: ReturnType<typeof createAabbPhysicsProvider> } = {},
) {
  return createStandardEngine({
    id: 'turntable',
    requests: [
      { id: 'movement.locomotion' },
      { id: 'gameplay.platforms', config: { platforms: [platform] } },
    ],
    input: () => STILL,
    startPosition: { x: start.x, y: 0.5, z: start.z },
    ...(options.physics ? { physics: options.physics } : {}),
    ...(options.reducedMotion ? { reducedMotion: true } : {}),
  });
}

const api = (h: StandardEngineHandle) => h.runtime.services.get(PlatformsService)!;
const radius = (h: StandardEngineHandle) =>
  Math.hypot(h.controller.position.x, h.controller.position.z);
const angle = (h: StandardEngineHandle) =>
  Math.atan2(-h.controller.position.z, h.controller.position.x);

describe('GE-L15 turntable rotation', () => {
  it('yawOf advances at the authored rate; 0 for a platform that does not spin; undefined if unknown', async () => {
    const h = await createStandardEngine({
      id: 'yaw',
      requests: [
        { id: 'movement.locomotion' },
        {
          id: 'gameplay.platforms',
          config: {
            platforms: [
              turntable(),
              { id: 'step', position: { x: 20, y: 0, z: 0 }, size: { x: 2, y: 0.5, z: 2 } },
            ],
          },
        },
      ],
      input: () => STILL,
      startPosition: { x: 40, y: 0, z: 0 },
    });
    for (let i = 0; i < 60; i += 1) h.runtime.tick(1 / 60);
    expect(api(h).yawOf('spin')).toBeCloseTo(Math.PI / 4, 6);
    expect(api(h).yawOf('step')).toBe(0);
    expect(api(h).yawOf('nope')).toBeUndefined();
    h.dispose();
  });

  it('carries the child round the centre at the turntable rate and direction (mesh and child agree)', async () => {
    const h = await boot(turntable(), { x: 2, z: 0 });
    for (let i = 0; i < 120; i += 1) h.runtime.tick(1 / 60);
    // Three.js rotation.y = yaw turns +x towards -z; the child's angle measured the same way.
    expect(angle(h)).toBeCloseTo(api(h).yawOf('spin')!, 3);
    expect(transformSupport(h)).toBe('spin');
    h.dispose();
  });

  it('keeps the child at the same distance from the centre (no drift off the edge) over a minute', async () => {
    const h = await boot(turntable(), { x: 3, z: 0 });
    for (let i = 0; i < 3600; i += 1) h.runtime.tick(1 / 60);
    expect(Math.abs(radius(h) - 3)).toBeLessThan(0.01);
    expect(transformSupport(h)).toBe('spin');
    h.dispose();
  });

  it('reduced motion turns the mesh and the child more slowly, still together', async () => {
    const h = await boot(turntable(), { x: 2, z: 0 }, { reducedMotion: true });
    for (let i = 0; i < 60; i += 1) h.runtime.tick(1 / 60);
    const yaw = api(h).yawOf('spin')!;
    expect(yaw).toBeCloseTo((Math.PI / 4) * REDUCED_MOTION_SPEED_SCALE, 6);
    expect(angle(h)).toBeCloseTo(yaw, 3);
    h.dispose();
  });

  it('a wall on the turntable blocks the carry (no tunnelling); the child is never pushed through', async () => {
    const physics = createAabbPhysicsProvider();
    physics.addCollider({
      id: 'post',
      kind: 'SOLID',
      min: { x: 1, y: 0, z: -3.5 },
      max: { x: 3, y: 3, z: -3.4 },
    });
    const h = await boot(turntable(), { x: 2, z: -1 }, { physics });
    for (let i = 0; i < 240; i += 1) {
      h.runtime.tick(1 / 60);
      expect(h.controller.position.z).toBeGreaterThan(-3.4);
    }
    h.dispose();
  });
});

function transformSupport(h: StandardEngineHandle): string | null {
  const entity = h.runtime.world.bySemanticId(PLAYER_ENTITY_ID)!;
  return h.runtime.world.get(entity, PlayerTransformComponent)!.supportId;
}
