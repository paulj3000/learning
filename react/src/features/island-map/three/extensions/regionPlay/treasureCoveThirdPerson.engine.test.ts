import { Box3, Vector3 } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { read } from '../../../../../api/parse';
import * as parse from '../../../../../api/play/parse';
import { bootstrapJson, coveSceneJson } from '../../../../../test/playFixtures';
import {
  publishRegionCheckpoints,
  unpublishRegionCheckpoints,
} from '../../../../discovery/checkpoints';
import { buildRegionManifest } from '../../../../region-play/regionManifest';
import { toRegionSceneModel } from '../../../../region-play/sceneModel';
import { AVATAR_ROOT_NAME } from '../../playerAvatar';
import { solidColliders } from '../../runtime/sceneLayout';
import { FACE_SOUTH, mount, named, standingBox } from '../../runtime/testing/engineHarness';
import { regionPlaySceneExtension } from './regionPlayScene';

/** LAI-JMP-01a: Treasure Cove (a Django region) in third-person, the default there. */

const REGION = 'treasure-rush-cove';

async function cove() {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const region = { ...bootstrapJson().region, scene: await coveSceneJson() };
  const model = toRegionSceneModel(read(bootstrapJson({ region }), parse.regionBootstrap));
  const built = buildRegionManifest(model, { worldSlug: 'learning-adventure-island' });
  publishRegionCheckpoints(REGION, built.checkpoints);
  const harness = mount({
    manifest: built.manifest,
    extensions: [regionPlaySceneExtension],
    loadModel: async () => standingBox(),
    cameraMode: null,
    avatarKey: 'OTTER',
  });
  await harness.engine.ready;
  return { harness, manifest: built.manifest };
}

afterEach(() => {
  unpublishRegionCheckpoints(REGION);
  vi.restoreAllMocks();
});

describe('Treasure Cove in third-person (LAI-JMP-01a)', () => {
  it('walks the child from the landing into the ruins with the camera never inside a wall', async () => {
    const { harness, manifest } = await cove();
    const walls = solidColliders(manifest).map(
      ({ box }) =>
        new Box3(
          new Vector3(box.minX, box.minY, box.minZ),
          new Vector3(box.maxX, box.maxY, box.maxZ),
        ),
    );
    expect(harness.engine.cameraMode()).toBe('third-person');
    let heading = FACE_SOUTH;
    let feetZ = 0;
    harness.setDrive((controller, delta) => {
      if (feetZ === 0) controller.position.set(0, 0, 2);
      controller.yaw = heading;
      controller.update(delta, { forward: 1, strafe: 0 });
      feetZ = controller.position.z;
    });
    for (let i = 0; i < 400; i += 1) {
      // Swing the view now and then, as a child does while walking.
      heading = FACE_SOUTH + Math.sin(i / 20) * 0.6;
      harness.runFrames(1);
      const camera = harness.camera().position;
      expect(
        walls.some((wall) => wall.containsPoint(camera)),
        `frame ${i}`,
      ).toBe(false);
    }
    expect(feetZ).toBeLessThan(-20);
    expect(harness.scene().getObjectByName(AVATAR_ROOT_NAME)?.visible).toBe(true);
  });

  it('lets the child open the first chest in third-person, from the child’s own reach', async () => {
    const { harness } = await cove();
    // The first chest is seeded at (0, -6); stand 2.5 m north of it, facing it.
    harness.setDrive((controller) => {
      controller.position.set(0, 0, -3.5);
      controller.yaw = FACE_SOUTH;
      controller.pitch = -0.3;
    });
    harness.runFrames(2);
    const focused = named(harness.events, 'InteractableFocused') as { entityId: string | null }[];
    expect(focused.at(-1)?.entityId).toBeTruthy();
    harness.pressInteractKey();
    expect(named(harness.events, 'ObjectInteracted').length).toBeGreaterThan(0);
  });

  it('cannot jump past the closed ruins gate in third-person', async () => {
    const { harness } = await cove();
    let z = 0;
    harness.setDrive((controller, delta) => {
      if (z === 0) controller.position.set(0, 0, -30);
      controller.yaw = FACE_SOUTH;
      controller.update(delta, { forward: 1, strafe: 0 });
      z = controller.position.z;
    });
    for (let i = 0; i < 12; i += 1) {
      harness.engine.pressJump();
      harness.runFrames(40);
    }
    // The gate's collider spans z -36 to -35.4: the child never gets past it.
    expect(z).toBeGreaterThan(-35.4);
  });
});
