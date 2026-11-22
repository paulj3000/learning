import {
  AnimationClip,
  Bone,
  Group,
  Mesh,
  Object3D,
  Scene,
  VectorKeyframeTrack,
  type Camera,
} from 'three';
import { describe, expect, it } from 'vitest';
import {
  interpolatePlayerPosition,
  PLAYER_ENTITY_ID,
  PlayerTransformComponent,
  type PlayerTransform,
} from '../contracts/player';
import type { CapabilityRequest } from '../core/capabilities';
import { PLACEHOLDER_NAME, type AvatarLoaderPort } from '../character/avatar';
import type { MovementInputFrame } from '../movement/movementSystem';
import { createAabbPhysicsProvider } from '../physics/aabbProvider';
import { HostViewService, type HostView } from './host';
import { createStandardEngine, type StandardEngineHandle } from './standardEngine';

/**
 * GE-064 avatar wiring: `character.avatar` and `character.animation` through the standard
 * assembly. The avatar mirrors the canonical transform only (P0 drift fix), the animation
 * follows achieved speed (idle into a wall), and everything disposes through the runtime.
 */

const DT = 1 / 60;
const FORWARD = Math.PI / 2; // the controller's +x

/** Hips > Spine; Walk travels on the root bone (root motion the wiring must strip). */
function rigAsset() {
  const scene = new Group();
  const armature = new Object3D();
  armature.name = 'Armature';
  const hips = new Bone();
  hips.name = 'Hips';
  hips.position.set(0, 1, 0);
  const spine = new Bone();
  spine.name = 'Spine';
  hips.add(spine);
  armature.add(hips);
  scene.add(armature, new Mesh());
  const walk = new AnimationClip('Walk', 1, [
    new VectorKeyframeTrack('Hips.position', [0, 1], [0, 1, 0, 0, 1, 5]),
  ]);
  const idle = new AnimationClip('Idle', 1, [
    new VectorKeyframeTrack('Spine.position', [0, 1], [0, 0, 0, 0, 0.1, 0]),
  ]);
  return { scene, animations: [walk, idle], hips };
}

function fakeView(): HostView {
  return {
    renderer: {
      info: { render: { calls: 0, triangles: 0 }, memory: { geometries: 0, textures: 0 } },
    } as unknown as HostView['renderer'],
    scene: new Scene(),
    camera: new Object3D() as unknown as Camera,
    canvas: {} as HTMLCanvasElement,
    size: () => ({ width: 800, height: 600 }),
  };
}

async function engine(
  requests: CapabilityRequest[],
  options: { loader?: AvatarLoaderPort; wall?: boolean } = {},
) {
  let frame: MovementInputFrame = { move: { forward: 0, strafe: 0 } };
  const physics = createAabbPhysicsProvider();
  if (options.wall) {
    physics.addCollider({
      id: 'wall',
      kind: 'SOLID',
      min: { x: 2, y: 0, z: -3 },
      max: { x: 3, y: 3, z: 3 },
    });
  }
  const view = fakeView();
  const handle: StandardEngineHandle = await createStandardEngine({
    id: 'avatar-test',
    requests,
    input: () => frame,
    physics,
    startYaw: FORWARD,
    provide: (rt) => rt.services.provide(HostViewService, view),
    ...(options.loader ? { avatar: { loader: options.loader } } : {}),
  });
  const tick = (seconds: number) => {
    for (let t = 0; t < seconds - 1e-9; t += DT) handle.runtime.tick(DT);
  };
  const transform = (): PlayerTransform => {
    const entity = handle.runtime.world.bySemanticId(PLAYER_ENTITY_ID)!;
    return handle.runtime.world.get(entity, PlayerTransformComponent)!;
  };
  return {
    handle,
    view,
    tick,
    transform,
    walk: () => (frame = { move: { forward: 1, strafe: 0 } }),
  };
}

const MOVE: CapabilityRequest[] = [{ id: 'movement.locomotion' }];

describe('standard engine avatar wiring', () => {
  it('creates no avatar without character.avatar', async () => {
    const e = await engine(MOVE);
    expect(e.handle.avatar).toBeNull();
    expect(e.view.scene.children).toHaveLength(0);
    e.handle.dispose();
  });

  it('places the avatar root exactly at the interpolated canonical transform, in the scene, as a placeholder without a loader', async () => {
    const e = await engine([...MOVE, { id: 'character.avatar' }]);
    const avatar = e.handle.avatar!;
    expect(e.view.scene.children).toContain(avatar.root);
    expect(avatar.root.getObjectByName(PLACEHOLDER_NAME)).toBeDefined();
    e.walk();
    e.tick(0.5);
    const t = e.transform();
    expect(t.position.x).toBeGreaterThan(0.5);
    // The root is set every rendered frame from the transform; the last frame's alpha is unknown
    // here, so check it lies on the segment between the previous and current step.
    const p0 = interpolatePlayerPosition(t, 0);
    const p1 = interpolatePlayerPosition(t, 1);
    expect(avatar.root.position.x).toBeGreaterThanOrEqual(Math.min(p0.x, p1.x) - 1e-9);
    expect(avatar.root.position.x).toBeLessThanOrEqual(Math.max(p0.x, p1.x) + 1e-9);
    expect(avatar.root.position.z).toBeCloseTo(t.position.z, 9);
    expect(avatar.root.rotation.y).toBeCloseTo(t.yaw, 9);
    e.handle.dispose();
  });

  it('settles to idle against a wall (achieved speed 0), never walking in place', async () => {
    const rig = rigAsset();
    const e = await engine([...MOVE, { id: 'character.avatar' }, { id: 'character.animation' }], {
      loader: { load: async () => rig },
      wall: true,
    });
    await e.handle.avatar!.ready;
    expect(e.handle.avatar!.source()).toBe('model');
    e.walk();
    e.tick(1.5); // reach the wall at x = 2 and keep pushing
    const pressed = e.transform();
    expect(pressed.velocity.x).toBeCloseTo(0, 6);
    const before = e.handle.avatar!.root.position.x;
    e.tick(0.3);
    const weights = e.handle.avatar!.animationFrame()!.weights;
    expect(weights.Idle ?? 0).toBeGreaterThan(weights.Walk ?? 0);
    // The avatar did not creep into the wall.
    expect(e.handle.avatar!.root.position.x).toBeCloseTo(before, 6);
    e.handle.dispose();
  });

  it('strips root motion from clips loaded through the loader', async () => {
    const rig = rigAsset();
    const e = await engine([...MOVE, { id: 'character.avatar' }, { id: 'character.animation' }], {
      loader: { load: async () => rig },
    });
    await e.handle.avatar!.ready;
    e.walk();
    e.tick(1);
    // The walk clip moves Hips 5 m forward over a second; with root motion stripped the bone
    // keeps its horizontal rest position.
    expect(rig.hips.position.z).toBeCloseTo(0, 6);
    expect(rig.hips.position.x).toBeCloseTo(0, 6);
    e.handle.dispose();
  });

  it('shows the model without animating when character.animation is not requested', async () => {
    const e = await engine([...MOVE, { id: 'character.avatar' }], {
      loader: { load: async () => rigAsset() },
    });
    await e.handle.avatar!.ready;
    e.walk();
    e.tick(0.5);
    expect(e.handle.avatar!.source()).toBe('model');
    expect(e.handle.avatar!.animationFrame()).toBeNull();
    e.handle.dispose();
  });

  it('respects character.avatar enabled:false', async () => {
    const e = await engine([...MOVE, { id: 'character.avatar', config: { enabled: false } }]);
    expect(e.handle.avatar).toBeNull();
    e.handle.dispose();
  });

  it('removes the avatar from the scene and leaves zero resources on dispose', async () => {
    const e = await engine([...MOVE, { id: 'character.avatar' }, { id: 'character.animation' }]);
    const root = e.handle.avatar!.root;
    expect(root.parent).toBe(e.view.scene);
    e.handle.dispose();
    expect(root.parent).toBeNull();
    expect(e.handle.runtime.resources.count()).toBe(0);
    expect(e.handle.runtime.world.size).toBe(0);
    expect(e.handle.runtime.systems.ids()).toEqual([]);
  });
});
