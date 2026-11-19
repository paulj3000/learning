import { validateGameplayEvent, type AnyGameplayEvent, type GameplayEventContext } from '../contracts/gameplayEvents';
import { PLAYER_ENTITY_ID, PlayerTransformComponent, type PlayerTransform } from '../contracts/player';
import type { CapabilityRequest } from '../core/capabilities';
import type { MovementInputFrame } from '../movement/movementSystem';
import { validateAdventure } from '../sdk/adventure';
import { validAdventure } from '../sdk/testFixtures';
import { createAabbPhysicsProvider } from '../physics/aabbProvider';
import { HOST_EVENTS } from './host';
import { createStandardEngine, type StandardEngineHandle, type StandardInput } from './standardEngine';
import { createStandardCapabilityRegistry } from './standardRegistry';

const DT = 1 / 60;
const FORWARD = Math.PI / 2; // the controller's +x
const CONTEXT: GameplayEventContext = { realmId: 'demo-realm', adventureId: 'demo-adventure', areaId: 'demo-cove', sessionRef: null };

let eventSeq = 0;
const claimOptions = { newEventId: () => `00000000-0000-4000-8000-${String(++eventSeq).padStart(12, '0')}`, now: () => Date.UTC(2026, 10, 18) };

class TestInput implements StandardInput {
  frame: MovementInputFrame = { move: { forward: 0, strafe: 0 } };
  resets = 0;
  walk(): void {
    this.frame = { move: { forward: 1, strafe: 0 } };
  }
  stop(): void {
    this.frame = { move: { forward: 0, strafe: 0 } };
  }
  jump(): void {
    this.frame = { ...this.frame, jumpPressed: true };
  }
  poll(): MovementInputFrame {
    const current = this.frame;
    this.frame = { ...this.frame, jumpPressed: false };
    return current;
  }
  reset(): void {
    this.resets += 1;
    this.stop();
  }
}

async function engine(requests: CapabilityRequest[], extra: { start?: { x: number; y: number; z: number }; physics?: ReturnType<typeof createAabbPhysicsProvider> } = {}) {
  const input = new TestInput();
  const handle = await createStandardEngine({
    id: 'test-area',
    requests,
    input,
    startPosition: extra.start ?? { x: 0, y: 0, z: 0 },
    startYaw: FORWARD,
    ...(extra.physics ? { physics: extra.physics } : {}),
    claims: { context: CONTEXT, options: claimOptions },
  });
  const claims: AnyGameplayEvent[] = [];
  const recovered: unknown[] = [];
  const jumped: unknown[] = [];
  handle.runtime.events.on('gameplay.event' as never, ((e: AnyGameplayEvent) => claims.push(e)) as never);
  handle.runtime.events.on('PlayerRecovered' as never, ((e: unknown) => recovered.push(e)) as never);
  handle.runtime.events.on('PlayerJumped' as never, ((e: unknown) => jumped.push(e)) as never);
  const tick = (seconds: number) => {
    for (let t = 0; t < seconds - 1e-9; t += DT) handle.runtime.tick(DT);
  };
  return { handle, input, claims, recovered, jumped, tick, transform: () => transformOf(handle) };
}

function transformOf(handle: StandardEngineHandle): PlayerTransform {
  const entity = handle.runtime.world.bySemanticId(PLAYER_ENTITY_ID)!;
  return handle.runtime.world.get(entity, PlayerTransformComponent)!;
}

const LOCOMOTION: CapabilityRequest = { id: 'movement.locomotion' };

describe('standard capability registry', () => {
  it('registers every engine capability once and resolves each at its defaults', () => {
    const registry = createStandardCapabilityRegistry();
    const ids = registry.list().map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const prefix of ['movement.', 'camera.', 'character.', 'gameplay.', 'environment.']) {
      expect(ids.some((id) => id.startsWith(prefix))).toBe(true);
    }
    for (const id of ids) {
      const resolution = registry.resolve([{ id }]);
      expect(resolution.issues, id).toEqual([]);
    }
    expect(registry.resolve(ids.map((id) => ({ id }))).ok).toBe(true);
  });

  it('validates an adventure with the same registry the runtime uses', () => {
    const registry = createStandardCapabilityRegistry();
    expect(validateAdventure(validAdventure(), registry as never).ok).toBe(true);
    const bad = validateAdventure(validAdventure({ capabilities: [{ id: 'movement.jump', config: { jumpHeight: 9 } }] }), registry as never);
    expect(bad.ok).toBe(false);
  });
});

describe('standard engine: movement invariants', () => {
  it('walking into a wall stops at the wall: no penetration, no drift', async () => {
    const physics = createAabbPhysicsProvider();
    physics.addCollider({ id: 'wall', kind: 'SOLID', min: { x: 3, y: 0, z: -3 }, max: { x: 4, y: 3, z: 3 } });
    const { handle, input, tick, transform } = await engine([LOCOMOTION], { physics });
    input.walk();
    tick(3);
    const t = transform();
    expect(t.position.x).toBeLessThan(3 - handle.controller.collision.radius + 1e-6);
    expect(t.position.x).toBeGreaterThan(2);
    expect(Math.abs(t.velocity.x)).toBeLessThan(1e-6);
    expect(Math.abs(t.velocity.z)).toBeLessThan(1e-6);
    handle.dispose();
  });

  it('jump input does nothing when movement.jump is not requested', async () => {
    const { handle, input, tick, transform, jumped } = await engine([LOCOMOTION]);
    tick(0.1);
    input.jump();
    tick(0.5);
    expect(jumped).toEqual([]);
    expect(transform().position.y).toBe(0);
    expect(handle.controller.jumpEnabled).toBe(false);
    handle.dispose();
  });

  it('jumps when movement.jump is requested', async () => {
    const { handle, input, tick, jumped } = await engine([LOCOMOTION, { id: 'movement.jump' }]);
    tick(0.1);
    input.jump();
    let peak = 0;
    for (let i = 0; i < 30; i += 1) {
      tick(DT);
      peak = Math.max(peak, handle.controller.position.y);
    }
    expect(jumped).toHaveLength(1);
    expect(peak).toBeGreaterThan(0.5);
    handle.dispose();
  });

  it('ice makes the child slide on, but stop within about a metre', async () => {
    const ice = {
      id: 'environment.volumes',
      config: { surfaces: [{ id: 'ice-patch', surfaceId: 'ice', box: { min: { x: -50, y: -1, z: -50 }, max: { x: 50, y: 1, z: 50 } } }] },
    };
    const stopDistance = async (requests: CapabilityRequest[]) => {
      const { handle, input, tick } = await engine(requests);
      input.walk();
      tick(1.5);
      input.stop();
      const released = handle.controller.position.x;
      tick(4);
      const distance = handle.controller.position.x - released;
      handle.dispose();
      return distance;
    };
    const onGround = await stopDistance([LOCOMOTION]);
    const onIce = await stopDistance([LOCOMOTION, { id: 'movement.surfaces' }, ice]);
    expect(onIce).toBeGreaterThan(onGround);
    expect(onIce).toBeGreaterThan(0.05);
    expect(onIce).toBeLessThan(1.05);
  });

  it('ignores an ice volume unless movement.surfaces is on', async () => {
    const ice = {
      id: 'environment.volumes',
      config: { surfaces: [{ id: 'ice-patch', surfaceId: 'ice', box: { min: { x: -50, y: -1, z: -50 }, max: { x: 50, y: 1, z: 50 } } }] },
    };
    const { handle } = await engine([LOCOMOTION, ice]);
    expect(handle.controller.friction).toBe(1);
    handle.dispose();
  });
});

describe('standard engine: gameplay wiring', () => {
  it('a jump challenge completed by its accessible route makes the same claim as the jump route', async () => {
    const challenge = (goalMinX: number) => ({
      id: 'gameplay.jumpChallenges',
      config: {
        challenges: [
          {
            challengeId: 'stones',
            routes: [
              { routeId: 'stones-hop', kind: 'JUMP', start: { minX: -1, maxX: 1, minZ: -1, maxZ: 1 }, goal: { minX: goalMinX, maxX: goalMinX + 1, minZ: 5, maxZ: 6 } },
              { routeId: 'stones-boardwalk', kind: 'ACCESSIBLE', start: { minX: -1, maxX: 1, minZ: -1, maxZ: 1 }, goal: { minX: 3, maxX: 4, minZ: -1, maxZ: 1 } },
            ],
          },
        ],
      },
    });
    const { handle, input, tick, claims } = await engine([LOCOMOTION, challenge(20)]);
    tick(0.1);
    input.walk();
    tick(2);
    const completed = claims.filter((c) => c.type === 'jump.challenge.completed');
    expect(completed).toHaveLength(1);
    expect(completed[0]!.payload).toEqual({ challengeId: 'stones', routeId: 'stones-boardwalk' });
    for (const claim of claims) {
      expect(validateGameplayEvent(claim).issues).toEqual([]);
    }
    handle.dispose();
  });

  it('a hazard sends the child to the latest checkpoint with exactly one PlayerRecovered naming both', async () => {
    const requests: CapabilityRequest[] = [
      LOCOMOTION,
      {
        id: 'gameplay.checkpoints',
        config: { checkpoints: [{ id: 'old-dock', courseId: 'cove-course', position: { x: 2, y: 0, z: 0 }, yaw: FORWARD, label: 'the old dock' }] },
      },
      {
        id: 'gameplay.hazards',
        config: {
          hazards: [{ id: 'pond', kind: 'WATER', rect: { minX: 5, maxX: 8, minZ: -3, maxZ: 3 }, checkpointId: 'old-dock', messageKey: 'hazard.water.splash' }],
        },
      },
    ];
    const { handle, input, tick, claims, recovered } = await engine(requests);
    input.walk();
    for (let i = 0; i < 400 && recovered.length === 0; i += 1) {
      tick(DT);
    }
    input.stop();
    tick(0.5);
    expect(recovered).toEqual([{ reason: 'HAZARD', checkpointId: 'old-dock', hazardId: 'pond' }]);
    // Back at the dock (one more walking step may follow before input stops).
    expect(Math.abs(handle.controller.position.x - 2)).toBeLessThan(0.1);
    expect(claims.map((c) => c.type)).toContain('course.checkpoint.reached');
    for (const claim of claims) {
      expect(validateGameplayEvent(claim).ok).toBe(true);
    }
    handle.dispose();
  });

  it('a moving platform carries the child standing on it', async () => {
    const requests: CapabilityRequest[] = [
      LOCOMOTION,
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
    const { handle, tick, transform } = await engine(requests, { start: { x: 0, y: 0.5, z: 0 } });
    tick(2);
    expect(transform().supportId).toBe('ferry');
    expect(handle.controller.position.x).toBeGreaterThan(1.5);
    expect(handle.controller.position.y).toBeCloseTo(0.5, 2);
    handle.dispose();
  });
});

describe('standard engine: host and lifecycle', () => {
  it('clears held input on host.inputReset', async () => {
    const { handle, input, tick } = await engine([LOCOMOTION]);
    input.walk();
    tick(0.2);
    handle.runtime.events.emit(HOST_EVENTS.inputReset as never, {} as never);
    expect(input.resets).toBe(1);
    handle.dispose();
  });

  it('dispose leaves no resources and no entities', async () => {
    const { handle, tick } = await engine([
      LOCOMOTION,
      { id: 'movement.jump' },
      { id: 'gameplay.checkpoints', config: { checkpoints: [{ id: 'cp', courseId: 'c', position: { x: 0, y: 0, z: 0 }, yaw: 0, label: 'start' }] } },
    ]);
    tick(0.2);
    expect(handle.runtime.world.size).toBeGreaterThan(0);
    handle.dispose();
    expect(handle.runtime.state).toBe('disposed');
    expect(handle.runtime.resources.count()).toBe(0);
    expect(handle.runtime.world.size).toBe(0);
    expect(handle.runtime.systems.ids()).toEqual([]);
  });

  it('rejects invalid requests and disposes', async () => {
    await expect(
      createStandardEngine({ id: 'bad', requests: [{ id: 'movement.jump', config: { jumpHeight: 99 } }], input: () => ({ move: { forward: 0, strafe: 0 } }) }),
    ).rejects.toThrow(/invalid/);
  });
});
