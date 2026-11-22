import { AnimationClip, BoxGeometry, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mixamoRig, rootMotionWalk } from './testing/rootMotionRig';
import type { FirstPersonController } from '@lai/game-engine/movement';
import { AVATAR_ROOT_NAME } from '../playerAvatar';
import type { LoadedModel } from './createLocationEngine';
import type { ThreeLocationManifest } from './locationManifest';
import { WELCOME_HARBOR_MANIFEST } from './manifests/welcomeHarbor';
import { FACE_NORTH, mount, type Harness } from './testing/engineHarness';

/**
 * Defect 1 through the shared runtime: the child faces north and walks backwards (south, toward
 * the camera) into a wall, holding the key. The avatar's body
 * must stay on the controller's resolved position every frame, and come to rest idle.
 */

let harness: Harness | null = null;
afterEach(() => {
  harness?.engine.dispose();
  harness = null;
  vi.restoreAllMocks();
});

/** Inside Welcome Harbor's 12 m bounds, on the clear line south of the spawn (z = 8). */
const WALL_FACE = -6;
const MANIFEST: ThreeLocationManifest = {
  ...WELCOME_HARBOR_MANIFEST,
  colliders: [
    ...WELCOME_HARBOR_MANIFEST.colliders,
    { rect: { id: 'test-wall-behind', minX: -3, maxX: 3, minZ: WALL_FACE - 0.5, maxZ: WALL_FACE } },
  ],
};

function riggedHero(): LoadedModel {
  const { scene } = mixamoRig();
  const body = new Mesh(new BoxGeometry(0.5, 1.3, 0.4), new MeshBasicMaterial());
  body.name = 'hero-body';
  scene.add(body);
  const idle = new AnimationClip('Idle', 1, []);
  return { scene, animations: [idle, rootMotionWalk()] };
}

const PUBLISHED = {
  ref: 'player-fox@1',
  assetId: 'player-fox',
  version: 1,
  clips: ['Idle', 'Walk'],
  scale: 1,
  rotationOffset: 0,
  animationMap: { idle: 'Idle', walk: 'Walk' },
  customization: { colorMaterials: {}, attachPoints: {} },
};

describe('the avatar stays with the player when walking backwards into a wall', () => {
  it('body on the resolved position every frame; idle once blocked', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    harness = mount({
      manifest: MANIFEST,
      cameraMode: 'third-person',
      publishedAvatar: PUBLISHED,
      loadAvatarModel: async () => riggedHero(),
    });
    const h = harness;
    await h.engine.ready;
    await h.engine.avatar?.ready;
    expect(h.engine.avatar?.source()).toBe('model');

    let player: FirstPersonController | null = null;
    h.setDrive((controller, delta) => {
      player = controller;
      controller.yaw = FACE_NORTH;
      controller.update(delta, { forward: -1, strafe: 0 });
    });

    const hipsAt = new Vector3();
    let worstDrift = 0;
    for (let i = 0; i < 320; i += 1) {
      h.runFrames(1);
      const root = h.scene().getObjectByName(AVATAR_ROOT_NAME)!;
      const hips = root.getObjectByName('mixamorigHips')!;
      hips.getWorldPosition(hipsAt);
      const c = player as FirstPersonController | null;
      if (!c) continue;
      expect(root.position.x).toBeCloseTo(c.position.x, 9);
      expect(root.position.z).toBeCloseTo(c.position.z, 9);
      worstDrift = Math.max(
        worstDrift,
        Math.hypot(hipsAt.x - c.position.x, hipsAt.z - c.position.z),
      );
    }
    const c = player as FirstPersonController | null;
    expect(c).not.toBeNull();
    // The body never left the player (the defect drifted it by up to 1.5 m).
    expect(worstDrift).toBeLessThan(0.01);
    // Blocked: at the wall, not through it, and idle.
    expect(c!.position.z).toBeGreaterThanOrEqual(WALL_FACE);
    expect(c!.movementState).toBe('IDLE');
    expect(c!.locomotionSpeed).toBeLessThan(0.2);
    // The camera is never inside the 3 m wall: on the child's side of it, or lifted over its top
    // (looking down on the child) once they are flush against it.
    const camera = h.camera().position;
    expect(camera.z > WALL_FACE || camera.y > 3).toBe(true);
    expect(h.scene().getObjectByName(AVATAR_ROOT_NAME)!.visible).toBe(true);
  });
});
