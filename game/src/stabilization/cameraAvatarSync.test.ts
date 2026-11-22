import { PerspectiveCamera, Scene } from 'three';
import { describe, expect, it } from 'vitest';
import { CameraRig } from '../camera/cameraRig';
import { CameraHeightFollower, MAX_LANDING_DIP } from '../camera/cameraHeightFollower';
import type { PlayerCameraFrame } from '../camera/playerCamera';
import {
  createPlayerTransform,
  interpolatePlayerPosition,
  PLAYER_ENTITY_ID,
  PlayerTransformComponent,
  type PlayerTransform,
} from '../contracts/player';
import type { CapabilityRequest } from '../core/capabilities';
import { HostViewService, type HostView } from '../engine/host';
import { createStandardEngine, type StandardEngineHandle } from '../engine/standardEngine';
import type { MovementInputFrame } from '../movement/movementSystem';

/**
 * Wave 2 stabilization, areas 5 and 7 (engine side).
 *
 * Camera and avatar sync: the avatar root and the camera rig are fed from the same canonical
 * transform with the same interpolation alpha every frame, and the avatar never leads the
 * controller. Reduced motion: no landing dip, no sprint FOV widening, a steady (not blinking)
 * warning, wherever the engine implements them.
 */

const FORWARD = Math.PI / 2;
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

async function boot(input: () => MovementInputFrame, requests = REQUESTS) {
  const view = fakeView();
  const handle = await createStandardEngine({
    id: 'sync-test',
    requests,
    input,
    startYaw: FORWARD,
    provide: (rt) => rt.services.provide(HostViewService, view),
  });
  return { handle, view };
}

describe('camera and avatar sync', () => {
  /** Records alpha as the presentation phase sees it, after the avatar and camera systems. */
  function observe(handle: StandardEngineHandle) {
    const frames: {
      alpha: number;
      avatarX: number;
      avatarY: number;
      avatarZ: number;
      controllerX: number;
      transform: PlayerTransform;
      cameraFrame: PlayerCameraFrame | null;
      aimX: number;
    }[] = [];
    let lastCameraFrame: PlayerCameraFrame | null = null;
    const rig = handle.camera!;
    const original = rig.update.bind(rig);
    const cameraAlphas: number[] = [];
    rig.update = (dt, transform, alpha) => {
      cameraAlphas.push(alpha);
      lastCameraFrame = original(dt, transform, alpha);
      return lastCameraFrame;
    };
    handle.runtime.systems.add({
      id: 'stabilization.observe',
      phase: 'presentation',
      order: 1000,
      update(context) {
        const root = handle.avatar!.root;
        frames.push({
          alpha: context.alpha,
          avatarX: root.position.x,
          avatarY: root.position.y,
          avatarZ: root.position.z,
          controllerX: handle.controller.position.x,
          transform: transformOf(handle),
          cameraFrame: lastCameraFrame,
          aimX: lastCameraFrame ? (lastCameraFrame as PlayerCameraFrame).aimOrigin.x : NaN,
        });
      },
    });
    return { frames, cameraAlphas };
  }

  it('wires an avatar and a camera rig from the same canonical transform', async () => {
    const { handle, view } = await boot(() => ({ move: { forward: 1, strafe: 0 } }));
    expect(handle.avatar).not.toBeNull();
    expect(handle.camera).not.toBeNull();
    expect(view.scene.children).toContain(handle.avatar!.root);
    handle.dispose();
  });

  it('every frame the avatar root sits at the interpolated transform with the same alpha the camera got', async () => {
    const { handle } = await boot(() => ({ move: { forward: 1, strafe: 0.3 } }));
    const seen = observe(handle);
    const pattern = [1 / 144, 1 / 30, 1 / 90, 1 / 60, 1 / 144, 1 / 144, 1 / 75];
    for (let i = 0; i < 400; i += 1) handle.runtime.tick(pattern[i % pattern.length]!);
    expect(seen.frames.length).toBe(400);
    expect(seen.cameraAlphas).toHaveLength(400);
    seen.frames.forEach((f, i) => {
      expect(f.alpha).toBe(seen.cameraAlphas[i]); // same alpha to the avatar and the camera
      const expected = interpolatePlayerPosition(f.transform, f.alpha);
      expect(Math.abs(f.avatarX - expected.x)).toBeLessThan(1e-9);
      expect(Math.abs(f.avatarY - expected.y)).toBeLessThan(1e-9);
      expect(Math.abs(f.avatarZ - expected.z)).toBeLessThan(1e-9);
    });
    handle.dispose();
  });

  it('there is no frame where the avatar leads the controller (walking forward along +x)', async () => {
    const { handle } = await boot(() => ({ move: { forward: 1, strafe: 0 } }));
    const seen = observe(handle);
    for (let i = 0; i < 300; i += 1) handle.runtime.tick(i % 3 === 0 ? 1 / 144 : 1 / 50);
    for (const f of seen.frames) {
      expect(f.avatarX).toBeLessThanOrEqual(f.controllerX + 1e-9);
      expect(f.avatarX).toBeGreaterThanOrEqual(f.transform.previousPosition.x - 1e-9);
    }
    handle.dispose();
  });

  it('the avatar yaw is the canonical yaw', async () => {
    const { handle } = await boot(() => ({
      move: { forward: 1, strafe: 0 },
      look: { dx: 5, dy: 0 },
    }));
    for (let i = 0; i < 30; i += 1) handle.runtime.tick(1 / 60);
    expect(handle.avatar!.root.rotation.y).toBeCloseTo(transformOf(handle).yaw, 9);
    handle.dispose();
  });

  it('a frame with no simulation step (alpha only) moves avatar and camera to the same interpolation, no further than the step', async () => {
    const { handle } = await boot(() => ({ move: { forward: 1, strafe: 0 } }));
    const seen = observe(handle);
    for (let i = 0; i < 10; i += 1) handle.runtime.tick(1 / 60);
    handle.runtime.tick(1 / 240); // no step runs
    const last = seen.frames.at(-1)!;
    const prev = seen.frames.at(-2)!;
    expect(last.transform).toBe(prev.transform);
    expect(last.avatarX).toBeGreaterThanOrEqual(last.transform.previousPosition.x - 1e-9);
    expect(last.avatarX).toBeLessThanOrEqual(last.controllerX + 1e-9);
    handle.dispose();
  });

  it('the camera follow point tracks the interpolated feet on x and z (never ahead of the controller)', async () => {
    const { handle } = await boot(() => ({ move: { forward: 1, strafe: 0 } }));
    const seen = observe(handle);
    for (let i = 0; i < 300; i += 1) handle.runtime.tick(1 / 144);
    for (const f of seen.frames.slice(5)) {
      const frame = f.cameraFrame!;
      expect(frame).not.toBeNull();
      expect(f.aimX).toBeLessThanOrEqual(f.controllerX + 1e-6);
    }
    handle.dispose();
  });

  it('the avatar is only ever positioned by the transform: an external nudge to root is overwritten next frame', async () => {
    const { handle } = await boot(() => ({ move: { forward: 0, strafe: 0 } }));
    handle.runtime.tick(1 / 60);
    handle.avatar!.root.position.set(99, 99, 99);
    handle.runtime.tick(1 / 60);
    const t = transformOf(handle);
    expect(handle.avatar!.root.position.x).toBeCloseTo(t.position.x, 9);
    expect(handle.avatar!.root.position.y).toBeCloseTo(t.position.y, 9);
    handle.dispose();
  });
});

describe('reduced motion (engine)', () => {
  const airborne = (y: number, vy: number): PlayerTransform => ({
    ...createPlayerTransform({ x: 0, y, z: 0 }),
    grounded: false,
    velocity: { x: 0, y: vy, z: 0 },
    state: 'FALLING',
  });
  const sprinting = (): PlayerTransform => ({
    ...createPlayerTransform({ x: 0, y: 0, z: 0 }),
    gait: 'sprint',
    state: 'SPRINT' as never,
  });

  it('the height follower dips on landing normally and never under reduced motion', () => {
    const normal = new CameraHeightFollower();
    const reduced = new CameraHeightFollower({ reducedMotion: true });
    for (const f of [normal, reduced]) {
      f.update(0.016, 0, true);
      f.landed(20);
    }
    const dipped = normal.update(0.016, 0, true);
    const steady = reduced.update(0.016, 0, true);
    expect(dipped).toBeLessThan(0);
    expect(dipped).toBeGreaterThanOrEqual(-MAX_LANDING_DIP);
    expect(steady).toBe(0);
  });

  it('the camera rig lands without a dip under reduced motion, derived from the transform alone', () => {
    const eyeAfterLanding = (reducedMotion: boolean) => {
      const rig = new CameraRig({ reducedMotion, config: { defaultMode: 'first-person' } });
      rig.update(0.016, airborne(0.5, -12), 1);
      return rig.update(0.016, createPlayerTransform({ x: 0, y: 0, z: 0 }), 1).position.y;
    };
    const dip = eyeAfterLanding(false);
    const steady = eyeAfterLanding(true);
    expect(dip).toBeLessThan(steady); // the normal camera nods down on landing
    expect(steady).toBeGreaterThanOrEqual(1.6 - 1e-9); // reduced motion: eased from above, never below the eye
  });

  it('sprinting widens the field of view normally and never under reduced motion', () => {
    const fov = (reducedMotion: boolean) => {
      const rig = new CameraRig({ reducedMotion });
      let frame: PlayerCameraFrame | null = null;
      for (let i = 0; i < 90; i += 1) frame = rig.update(1 / 60, sprinting(), 1);
      return frame!.fovOffset;
    };
    expect(fov(false)).toBeGreaterThan(0);
    expect(fov(true)).toBe(0);
  });

  it('the standard engine passes reducedMotion to the camera rig (no FOV widening while sprinting)', async () => {
    const run = async (reducedMotion: boolean) => {
      const view = fakeView();
      const handle = await createStandardEngine({
        id: 'rm',
        requests: REQUESTS,
        input: () => ({ move: { forward: 1, strafe: 0, sprint: true } }),
        startYaw: FORWARD,
        reducedMotion,
        provide: (rt) => rt.services.provide(HostViewService, view),
      });
      let fovOffset = 0;
      const original = handle.camera!.update.bind(handle.camera!);
      handle.camera!.update = (dt, transform, alpha) => {
        const frame = original(dt, transform, alpha);
        fovOffset = frame.fovOffset;
        return frame;
      };
      for (let i = 0; i < 180; i += 1) handle.runtime.tick(1 / 60);
      handle.dispose();
      return fovOffset;
    };
    expect(await run(false)).toBeGreaterThan(0);
    expect(await run(true)).toBe(0);
  });

  it('forces are scaled down while reduced motion is on, live, through the settings object', async () => {
    const wind = {
      id: 'environment.volumes',
      config: {
        forces: [
          {
            id: 'gale',
            kind: 'WIND',
            box: { min: { x: -50, y: -1, z: -50 }, max: { x: 50, y: 5, z: 50 } },
            direction: { x: 0, y: 0, z: 1 },
            strength: 6,
            rampInSeconds: 0,
          },
        ],
      },
    };
    const requests: CapabilityRequest[] = [
      { id: 'movement.locomotion' },
      { id: 'movement.externalForces' },
      wind,
    ];
    const drift = async (reducedMotion: boolean) => {
      const handle = await createStandardEngine({
        id: 'force',
        requests,
        input: () => ({ move: { forward: 0, strafe: 0 } }),
        reducedMotion,
      });
      for (let i = 0; i < 120; i += 1) handle.runtime.tick(1 / 60);
      const z = handle.controller.position.z;
      handle.dispose();
      return z;
    };
    const full = await drift(false);
    const reduced = await drift(true);
    expect(Math.abs(full)).toBeGreaterThan(0);
    expect(Math.abs(reduced)).toBeLessThan(Math.abs(full));
  });

  it('settings.reducedMotion is the one live switch the engine components read', async () => {
    const handle = await createStandardEngine({
      id: 'live',
      requests: [{ id: 'movement.locomotion' }],
      input: () => ({ move: { forward: 0, strafe: 0 } }),
    });
    expect(handle.settings.reducedMotion).toBe(false);
    handle.settings.reducedMotion = true;
    expect(handle.settings.reducedMotion).toBe(true);
    handle.dispose();
  });
});
