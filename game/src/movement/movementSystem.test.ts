import { createEngineRuntime } from '../core/runtime';
import type { EnginePresentationEventMap } from '../contracts/engineEvents';
import { NEUTRAL_ENVIRONMENT, type ExternalForce } from '../contracts/physics';
import { PLAYER_ENTITY_ID, PlayerTransformComponent } from '../contracts/player';
import { createAabbPhysicsProvider } from '../physics/aabbProvider';
import { movementCapabilities, registerMovementCapabilities } from './capabilities';
import { FirstPersonController } from './firstPersonController';
import {
  gateEnvironment,
  installMovementSystem,
  installedMovementFeatures,
  type MovementInputFrame,
} from './movementSystem';

const DT = 1 / 60;

/** A stand-in for `CheckpointsService` (gameplay.checkpoints): the latest reached checkpoint. */
interface LatestCheckpoint {
  latest(): { id: string; position: { x: number; y: number; z: number }; yaw: number } | null;
}

function setup(options: { colliders?: boolean; checkpoints?: LatestCheckpoint } = {}) {
  const physics = createAabbPhysicsProvider();
  physics.addCollider({ id: 'wall', kind: 'SOLID', min: { x: 3, y: 0, z: -3 }, max: { x: 4, y: 3, z: 3 } });
  physics.addCollider({ id: 'crate', kind: 'JUMPABLE', min: { x: -3, y: 0, z: -1 }, max: { x: -2, y: 0.5, z: 1 } });
  const controller = new FirstPersonController({
    colliders: physics.boxes,
    jumpableColliders: physics.jumpableBoxes,
    ...(options.checkpoints
      ? {
          recoveryPoint: () => {
            const latest = options.checkpoints!.latest();
            return latest ? { x: latest.position.x, z: latest.position.z, yaw: latest.yaw } : null;
          },
        }
      : {}),
  });
  controller.yaw = Math.PI / 2; // forward is +x
  const runtime = createEngineRuntime<EnginePresentationEventMap>({ id: 'test' });
  let frame: MovementInputFrame = { move: { forward: 0, strafe: 0 } };
  const handle = installMovementSystem(runtime, {
    controller,
    input: () => {
      const current = frame;
      frame = { ...frame, jumpPressed: false };
      return current;
    },
    physics,
    ...(options.checkpoints ? { checkpoints: options.checkpoints } : {}),
  });
  const log: string[] = [];
  runtime.events.onAny((name) => log.push(name));
  const step = (input: MovementInputFrame, frames = 1) => {
    frame = input;
    for (let i = 0; i < frames; i += 1) {
      runtime.systems.runStep({ dt: DT, step: i, time: i * DT });
      frame = { ...frame, jumpPressed: false };
    }
  };
  const transform = () => runtime.world.require(runtime.world.bySemanticId(PLAYER_ENTITY_ID)!, PlayerTransformComponent);
  return { runtime, controller, handle, step, transform, log, physics };
}

const WALK: MovementInputFrame = { move: { forward: 1, strafe: 0 } };

describe('movement system', () => {
  it('writes the canonical player transform from the controller', () => {
    const { step, transform, controller } = setup();
    expect(transform()).toMatchObject({ grounded: true, state: 'IDLE', gait: 'idle', supportId: null });
    step(WALK, 30);
    const t = transform();
    expect(t.position.x).toBeCloseTo(controller.position.x);
    expect(t.previousPosition.x).toBeLessThan(t.position.x);
    expect(t.velocity.x).toBeGreaterThan(1);
    expect(t.gait).toBe('walk');
    expect(t.state).toBe('WALK');
  });

  it('reports the velocity actually achieved: zero into a wall, no drift', () => {
    const { step, transform } = setup();
    step(WALK, 240);
    const t = transform();
    expect(t.position.x).toBeLessThan(3);
    expect(t.velocity.x).toBeCloseTo(0, 5);
    expect(t.gait).toBe('idle');
  });

  it('maps jump, land, gait and footstep events to presentation events', () => {
    const { step, log, runtime } = setup();
    const gaits: string[] = [];
    runtime.events.on('PlayerGaitChanged', ({ gait }) => gaits.push(gait));
    step(WALK, 60);
    step({ move: { forward: 0, strafe: 0 }, jumpPressed: true }, 1);
    step({ move: { forward: 0, strafe: 0 } }, 80);
    expect(log).toContain('PlayerFootstep');
    expect(log).toContain('PlayerJumped');
    expect(log).toContain('PlayerLanded');
    expect(gaits[0]).toBe('walk');
  });

  it('names the support collider when standing on a crate', () => {
    const { step, transform, controller } = setup();
    controller.teleport(-2.5, 0, 0);
    controller.position.y = 0.5;
    step({ move: { forward: 0, strafe: 0 } }, 10);
    expect(transform().supportId).toBe('crate');
  });

  it('names the latest checkpoint on recovery and never reaches checkpoints itself', () => {
    const checkpoints: LatestCheckpoint = { latest: () => ({ id: 'cp1', position: { x: 1, y: 0, z: 0 }, yaw: 0 }) };
    const { step, runtime, controller } = setup({ checkpoints });
    const reached: string[] = [];
    const recovered: unknown[] = [];
    runtime.events.on('CourseCheckpointReached', (e) => reached.push(e.label));
    runtime.events.on('PlayerRecovered', (e) => recovered.push(e));
    step(WALK, 40);
    expect(reached).toEqual([]); // gameplay.checkpoints owns reaching and its events
    controller.recover('HAZARD');
    step({ move: { forward: 0, strafe: 0 } }, 1);
    expect(recovered).toEqual([{ reason: 'HAZARD', checkpointId: 'cp1' }]);
    expect(controller.position.x).toBe(1);
  });

  it('removes its system and entity on dispose', () => {
    const { handle, runtime } = setup();
    expect(runtime.systems.has('movement.player')).toBe(true);
    handle.dispose();
    expect(runtime.systems.has('movement.player')).toBe(false);
    expect(runtime.world.bySemanticId(PLAYER_ENTITY_ID)).toBeUndefined();
  });
});

describe('environment gating from installed capabilities', () => {
  const wind: ExternalForce = { id: 'w', kind: 'WIND', acceleration: { x: 8, y: 0, z: 0 } };
  const source = {
    ...NEUTRAL_ENVIRONMENT,
    forcesAt: () => [wind],
    mediumAt: () => 'WATER' as const,
    waterSurfaceAt: () => 2,
    surfaceAt: () => ({ id: 'ice', friction: 0.1, speedMultiplier: 1 }),
  };

  it('turns off features whose capability is not installed', async () => {
    const runtime = createEngineRuntime({ id: 'gate' });
    registerMovementCapabilities(runtime.capabilities);
    await runtime.start([{ id: 'movement.externalForces' }, { id: 'movement.swimming', config: { enabled: false } }]);
    const features = installedMovementFeatures(runtime);
    expect([...features]).toEqual(['movement.externalForces']);
    const gated = gateEnvironment(source, { features });
    expect(gated.forcesAt(0, 0, 0)).toEqual([wind]);
    expect(gated.mediumAt(0, 0, 0)).toBe('AIR');
    expect(gated.waterSurfaceAt(0, 0)).toBeNull();
    expect(gated.surfaceAt(0, 0, 0).friction).toBe(1);
    expect(gated.climbableAt(0, 0, 0)).toBeNull();
    runtime.dispose();
  });

  it('halves forces under reduced motion', () => {
    const features = new Set(movementCapabilities.map((c) => c.id));
    const gated = gateEnvironment(source, { features, reducedMotion: () => true });
    expect(gated.forcesAt(0, 0, 0)[0]!.acceleration.x).toBe(4);
    expect(gateEnvironment(source, { features, reducedMotion: () => false }).forcesAt(0, 0, 0)[0]!.acceleration.x).toBe(8);
  });
});
