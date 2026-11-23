import { PerspectiveCamera, Scene } from 'three';
import { describe, expect, it } from 'vitest';
import {
  interpolatePlayerPosition,
  PLAYER_ENTITY_ID,
  PlayerTransformComponent,
  type PlayerTransform,
} from '../contracts/player';
import type { CapabilityRequest } from '../core/capabilities';
import { HostViewService, type HostView } from '../engine/host';
import { createStandardEngine, type StandardEngineHandle } from '../engine/standardEngine';
import { createAabbPhysicsProvider } from '../physics/aabbProvider';

/**
 * GE-L16 on the engine path: `SOLID` colliders authored above the ground were ignored by the
 * controller (they did not contain y 0). Now a raised one with walk-under clearance is an overhead
 * passage and a lower one blocks like a wall; the camera and avatar stay on the controller when
 * it is blocked.
 */

const FORWARD = Math.PI / 2; // +x
const REQUESTS: CapabilityRequest[] = [
  { id: 'movement.locomotion' },
  { id: 'movement.jump' },
  { id: 'camera.thirdPerson' },
  { id: 'character.avatar' },
];

function fakeView(): HostView {
  return {
    renderer: {
      info: { render: { calls: 0, triangles: 0 }, memory: { geometries: 0, textures: 0 } },
    } as unknown as HostView['renderer'],
    scene: new Scene(),
    camera: new PerspectiveCamera(60, 1, 0.1, 100),
    canvas: {} as HTMLCanvasElement,
    size: () => ({ width: 800, height: 600 }),
  };
}

function transformOf(handle: StandardEngineHandle): PlayerTransform {
  const entity = handle.runtime.world.bySemanticId(PLAYER_ENTITY_ID)!;
  return handle.runtime.world.get(entity, PlayerTransformComponent)!;
}

/** Boots the standard engine with one SOLID part across the +x path, from x 3 to 4. */
async function bootWith(minY: number, maxY: number) {
  const physics = createAabbPhysicsProvider();
  physics.addCollider({
    id: 'raised-part',
    kind: 'SOLID',
    min: { x: 3, y: minY, z: -3 },
    max: { x: 4, y: maxY, z: 3 },
  });
  const view = fakeView();
  const handle = await createStandardEngine({
    id: 'raised-solid-test',
    requests: REQUESTS,
    input: () => ({ move: { forward: 1, strafe: 0 } }),
    startYaw: FORWARD,
    physics,
    provide: (rt) => rt.services.provide(HostViewService, view),
  });
  return handle;
}

describe('raised SOLID colliders on the standard engine (GE-L16)', () => {
  it('walks under a raised SOLID with clearance', async () => {
    const handle = await bootWith(2, 2.4);
    for (let i = 0; i < 180; i += 1) handle.runtime.tick(1 / 60);
    expect(handle.controller.position.x).toBeGreaterThan(5);
    handle.dispose();
  });

  it('is blocked by a raised SOLID without clearance, and the avatar and camera stay on the controller', async () => {
    const handle = await bootWith(1.2, 2.4);
    const rig = handle.camera!;
    const original = rig.update.bind(rig);
    const aims: number[] = [];
    rig.update = (dt, transform, alpha) => {
      const frame = original(dt, transform, alpha);
      if (frame) aims.push(frame.aimOrigin.x);
      return frame;
    };
    for (let i = 0; i < 180; i += 1) {
      handle.runtime.tick(1 / 60);
      const transform = transformOf(handle);
      const root = handle.avatar!.root;
      // The avatar sits on the interpolated canonical transform, never past the controller.
      expect(root.position.x).toBeLessThanOrEqual(handle.controller.position.x + 1e-9);
      expect(transform.position.x).toBeCloseTo(handle.controller.position.x, 9);
      const latest = interpolatePlayerPosition(transform, 1);
      expect(latest.x).toBeCloseTo(handle.controller.position.x, 9);
    }
    const stopped = handle.controller.position.x;
    expect(stopped).toBeLessThan(3);
    expect(stopped).toBeGreaterThan(2.5);
    // Settled: the camera's aim and the avatar hold still against the part.
    expect(Math.max(...aims.slice(-30)) - Math.min(...aims.slice(-30))).toBeLessThan(1e-6);
    expect(handle.avatar!.root.position.x).toBeCloseTo(stopped, 6);
    handle.dispose();
  });
});
