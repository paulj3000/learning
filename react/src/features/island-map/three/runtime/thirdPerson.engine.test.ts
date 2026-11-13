import {
  Box3,
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Vector3,
  type PerspectiveCamera,
} from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EYE_HEIGHT } from '../sceneKit';
import { AVATAR_ROOT_NAME, PLACEHOLDER_NAME } from '../playerAvatar';
import { DEFAULT_PLAYER_CAMERA } from '../playerPresentation';
import type { LoadedModel } from './createLocationEngine';
import type { ThreeLocationManifest } from './locationManifest';
import { solidColliders } from './sceneLayout';
import { PIRATE_BUILDER_BAY_MANIFEST } from './manifests/pirateBuilderBay';
import { STORYKEEPER_CASTLE_MANIFEST } from './manifests/storykeeperCastle';
import { WELCOME_HARBOR_MANIFEST } from './manifests/welcomeHarbor';
import {
  FACE_NORTH,
  FACE_SOUTH,
  mount,
  named,
  standAt,
  walk,
  type Drive,
  type Harness,
} from './testing/engineHarness';

/**
 * LAI-JMP-01a through the shared location runtime: the same controller,
 * camera controller and avatar in every manifest-driven location. `cameraMode:
 * null` means "the child saved nothing", so the location's default applies.
 */

let harness: Harness | null = null;
afterEach(() => {
  harness?.engine.dispose();
  harness = null;
  vi.restoreAllMocks();
});

function quiet() {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
}

function third(options: Parameters<typeof mount>[0] = {}): Harness {
  quiet();
  harness = mount({ cameraMode: null, ...options });
  return harness;
}

function avatarRoot(h: Harness) {
  const root = h.scene().getObjectByName(AVATAR_ROOT_NAME);
  if (!root) throw new Error('no avatar in the scene');
  return root;
}

/** Observes the controller each frame while driving it. */
function observing(drive: Drive, seen: { x: number; y: number; z: number; yaw: number }): Drive {
  return (controller, delta) => {
    drive(controller, delta);
    seen.x = controller.position.x;
    seen.y = controller.position.y;
    seen.z = controller.position.z;
    seen.yaw = controller.yaw;
  };
}

const PIP = WELCOME_HARBOR_MANIFEST.npcs[0]!;

describe('third-person in the shared location runtime (LAI-JMP-01a)', () => {
  it('is the default where a location says nothing, with the child’s avatar in the scene', async () => {
    const h = third({ avatarKey: 'FOX' });
    await h.engine.ready;
    // Not `standAt`, which forces a level look: keep the default gentle look down.
    h.setDrive((controller, delta) => {
      controller.yaw = FACE_NORTH;
      controller.update(delta, { forward: 0, strafe: 0 });
    });
    h.runFrames(2);
    expect(h.engine.cameraMode()).toBe('third-person');
    const root = avatarRoot(h);
    expect(root.visible).toBe(true);
    expect(root.getObjectByName(PLACEHOLDER_NAME)).toBeDefined();
    // Facing north (+Z): the camera is behind (south) and above the avatar's head.
    const camera = h.camera();
    expect(camera.position.z).toBeLessThan(root.position.z - 2);
    expect(camera.position.y).toBeGreaterThan(1.5);
  });

  it('keeps the avatar exactly where the controller is, and turned toward where it walks', async () => {
    const h = third();
    await h.engine.ready;
    const seen = { x: 0, y: 0, z: 0, yaw: 0 };
    h.setDrive(observing(walk(FACE_SOUTH), seen));
    h.runFrames(60);
    const root = avatarRoot(h);
    expect(root.position.x).toBeCloseTo(seen.x, 9);
    expect(root.position.z).toBeCloseTo(seen.z, 9);
    // Walking south (-Z): the avatar faces yaw PI.
    expect(Math.abs(Math.cos(root.rotation.y) + 1)).toBeLessThan(0.01);
  });

  it('shows the jump: the avatar’s feet leave the ground and come back, and the camera follows', async () => {
    const h = third();
    await h.engine.ready;
    h.setDrive((controller, delta) => controller.update(delta, { forward: 0, strafe: 0 }));
    h.runFrames(30);
    const groundCameraY = h.camera().position.y;
    h.engine.pressJump();
    h.runFrames(12);
    expect(avatarRoot(h).position.y).toBeGreaterThan(0.5);
    expect(h.camera().position.y).toBeGreaterThan(groundCameraY);
    h.runFrames(90);
    expect(avatarRoot(h).position.y).toBe(0);
    expect(named(h.events, 'PlayerLanded')).toHaveLength(1);
  });

  it('switches to first-person and back with V, saving each change', async () => {
    const onCameraModeChange = vi.fn();
    const h = third({ onCameraModeChange });
    await h.engine.ready;
    h.setDrive(standAt(2, 3, FACE_NORTH));
    h.runFrames(2);

    h.pressCameraKey();
    h.runFrames(1);
    expect(h.engine.cameraMode()).toBe('first-person');
    expect(h.camera().position.toArray()).toEqual([2, EYE_HEIGHT, 3]);
    expect(avatarRoot(h).visible).toBe(false);

    h.pressCameraKey();
    h.runFrames(1);
    expect(h.engine.cameraMode()).toBe('third-person');
    expect(avatarRoot(h).visible).toBe(true);
    expect(onCameraModeChange.mock.calls.map(([mode]) => mode)).toEqual([
      'first-person',
      'third-person',
    ]);
  });

  it('starts in the child’s saved first-person view', async () => {
    const h = third({ cameraMode: 'first-person' });
    await h.engine.ready;
    h.setDrive(standAt(0, 0, FACE_NORTH));
    h.runFrames(1);
    expect(h.engine.cameraMode()).toBe('first-person');
    expect(avatarRoot(h).visible).toBe(false);
    expect(h.camera().position.y).toBeCloseTo(EYE_HEIGHT);
  });

  it('keeps a location’s fixed perspective: no switching and no saved choice where it says so', async () => {
    const manifest: ThreeLocationManifest = {
      ...WELCOME_HARBOR_MANIFEST,
      player: { camera: { defaultMode: 'first-person', allowModeSwitch: false } },
    };
    const onCameraModeChange = vi.fn();
    const h = third({ manifest, cameraMode: 'third-person', onCameraModeChange });
    expect(h.engine.cameraMode()).toBe('first-person');
    expect(h.engine.setCameraMode('third-person')).toBe(false);
    h.pressCameraKey();
    expect(h.engine.cameraMode()).toBe('first-person');
    expect(onCameraModeChange).not.toHaveBeenCalled();
  });

  it('uses Storykeeper Castle’s closer indoor camera, held under the ceiling', async () => {
    const h = third({ manifest: STORYKEEPER_CASTLE_MANIFEST });
    expect(h.engine.camera.distance).toBe(2.6);
    expect(h.engine.camera.maxHeight).toBe(2.95);
    await h.engine.ready;
    h.setDrive((controller, delta) => {
      controller.pitch = -1.5; // looking right down: the orbit climbs as high as it can
      controller.update(delta, { forward: 0, strafe: 0 });
    });
    h.runFrames(5);
    h.engine.pressJump();
    for (let i = 0; i < 40; i += 1) {
      h.runFrames(1);
      expect(h.camera().position.y).toBeLessThanOrEqual(2.8 + 1e-9);
    }
  });

  it('pulls the camera in front of a wall behind the child', async () => {
    const manifest: ThreeLocationManifest = {
      ...WELCOME_HARBOR_MANIFEST,
      colliders: [
        ...WELCOME_HARBOR_MANIFEST.colliders,
        { rect: { id: 'test-wall-behind', minX: -3, maxX: 3, minZ: -19.5, maxZ: -19 } },
      ],
    };
    const h = third({ manifest });
    await h.engine.ready;
    h.setDrive(standAt(0, -18, FACE_NORTH)); // the wall is 1 m behind
    h.runFrames(2);
    expect(h.camera().position.z).toBeGreaterThan(-19);
  });

  it('measures interaction reach from the child, not from the camera behind them', async () => {
    const h = third();
    await h.engine.ready;
    // 3.2 m from Pip, facing him: within reach of the child, ~7 m from the camera.
    const z = PIP.position.z + 3.2;
    h.setDrive(standAt(PIP.position.x, z, FACE_SOUTH));
    h.runFrames(2);
    const camera: PerspectiveCamera = h.camera();
    expect(
      Math.hypot(camera.position.x - PIP.position.x, camera.position.z - PIP.position.z),
    ).toBeGreaterThan(5);
    expect(named(h.events, 'InteractableFocused')).toEqual([{ entityId: PIP.entityId }]);
    h.pressInteractKey();
    expect(named(h.events, 'ObjectInteracted')).toEqual([
      { entityId: PIP.entityId, interactionId: `${PIP.entityId}:talk` },
    ]);
  });

  it('focuses the same things in both perspectives', async () => {
    for (const cameraMode of ['first-person', 'third-person'] as const) {
      const h = third({ cameraMode });
      await h.engine.ready;
      h.setDrive(standAt(1.5, 1, FACE_SOUTH));
      h.runFrames(1);
      expect(named(h.events, 'InteractableFocused'), cameraMode).toEqual([
        { entityId: 'pirate-pip' },
      ]);
      h.engine.dispose();
    }
  });

  it('never lets third-person jumping cross Pirate Builder Bay’s broken bridge', async () => {
    const h = third({ manifest: PIRATE_BUILDER_BAY_MANIFEST });
    await h.engine.ready;
    const seen = { x: 0, y: 0, z: 0, yaw: 0 };
    h.setDrive(standAt(-8, 0, Math.PI / 2));
    h.runFrames(1);
    h.setDrive(observing(walk(Math.PI / 2), seen));
    for (let i = 0; i < 10; i += 1) {
      h.engine.pressJump();
      h.runFrames(40);
    }
    const startX = -8;
    // Walking east from the dock: the channel stops the child well before the far bank.
    expect(seen.x).toBeGreaterThan(startX);
    expect(seen.x).toBeLessThan(0);
  });

  it('loads a location’s avatar costume through the location’s own asset loader', async () => {
    const scene = new Group();
    scene.add(new Mesh(new BoxGeometry(0.5, 1.4, 0.4), new MeshBasicMaterial()));
    scene.children[0]!.name = 'costume-body';
    const loadModel = vi.fn(async (): Promise<LoadedModel> => ({ scene, animations: [] }));
    const manifest: ThreeLocationManifest = {
      ...WELCOME_HARBOR_MANIFEST,
      player: { avatar: { assetKey: 'npc-harbor-master' } },
    };
    const h = third({ manifest, loadModel });
    await h.engine.ready;
    expect(loadModel).toHaveBeenCalledWith('npc-harbor-master');
    expect(h.engine.avatar?.source()).toBe('model');
  });

  it('draws no avatar where a location turns it off, and the camera still works', async () => {
    const manifest: ThreeLocationManifest = {
      ...WELCOME_HARBOR_MANIFEST,
      player: { avatar: { enabled: false } },
    };
    const h = third({ manifest });
    h.setDrive(standAt(0, 0, FACE_NORTH));
    h.runFrames(2);
    expect(h.engine.avatar).toBeNull();
    expect(h.scene().getObjectByName(AVATAR_ROOT_NAME)).toBeUndefined();
    expect(h.camera().position.z).toBeLessThan(-2);
  });

  it('removes the avatar when the child leaves', async () => {
    const h = third();
    await h.engine.ready;
    h.runFrames(1);
    const root = avatarRoot(h);
    h.engine.dispose();
    harness = null;
    expect(root.parent).toBeNull();
  });

  it('defaults every shipped outdoor location to the standard third-person camera', () => {
    quiet();
    for (const manifest of [WELCOME_HARBOR_MANIFEST, PIRATE_BUILDER_BAY_MANIFEST]) {
      const h = mount({ manifest, cameraMode: null });
      expect(h.engine.camera).toEqual(DEFAULT_PLAYER_CAMERA);
      expect(h.engine.cameraMode()).toBe('third-person');
      h.engine.dispose();
    }
  });
});

describe('third-person camera indoors: Storykeeper Castle (LAI-JMP-01a)', () => {
  const walls = solidColliders(STORYKEEPER_CASTLE_MANIFEST).map(
    ({ box }) =>
      new Box3(
        new Vector3(box.minX, box.minY, box.minZ),
        new Vector3(box.maxX, box.maxY, box.maxZ),
      ),
  );
  const insideAWall = (point: Vector3) => walls.some((wall) => wall.containsPoint(point));

  it('never puts the camera inside a wall or above the ceiling: through the archway, turning in every room it passes', async () => {
    const h = third({ manifest: STORYKEEPER_CASTLE_MANIFEST });
    await h.engine.ready;
    let heading = Math.PI / 2;
    let turning = false;
    h.setDrive((controller, delta) => {
      controller.yaw = heading;
      controller.update(delta, { forward: turning ? 0 : 1, strafe: 0 });
    });
    const check = () => {
      const position = h.camera().position;
      expect(
        insideAWall(position),
        `camera at ${position.toArray().map((n) => n.toFixed(2))}`,
      ).toBe(false);
      expect(position.y).toBeLessThanOrEqual(2.8 + 1e-9);
    };
    // Walk east through the entry archway, stopping every 40 frames to look all the way round
    // (beside walls, in the doorway, in the hall, at corners).
    for (let leg = 0; leg < 8; leg += 1) {
      turning = false;
      heading = Math.PI / 2;
      for (let i = 0; i < 40; i += 1) {
        h.runFrames(1);
        check();
      }
      turning = true;
      for (let step = 0; step < 24; step += 1) {
        heading = Math.PI / 2 + (step / 24) * Math.PI * 2;
        h.runFrames(2);
        check();
      }
    }
  });
});
