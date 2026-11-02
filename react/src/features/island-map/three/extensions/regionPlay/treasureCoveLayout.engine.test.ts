import { InstancedMesh, type Object3D } from 'three';
import { read } from '../../../../../api/parse';
import * as parse from '../../../../../api/play/parse';
import { bootstrapJson, coveSceneJson } from '../../../../../test/playFixtures';
import {
  publishRegionCheckpoints,
  unpublishRegionCheckpoints,
} from '../../../../discovery/checkpoints';
import { buildRegionManifest } from '../../../../region-play/regionManifest';
import { toRegionSceneModel } from '../../../../region-play/sceneModel';
import {
  FACE_SOUTH,
  mount,
  named,
  standingBox,
  walk,
  type Drive,
} from '../../runtime/testing/engineHarness';
import { GATE_BARS_NAME, PALM_TRUNKS_NAME, PROCEDURAL_NAME } from './proceduralScenery';
import { regionPlaySceneExtension } from './regionPlayScene';

/**
 * Treasure Cove's four-zone layout (TR-13) on the real runtime: the snapshot
 * Django serves, the manifest builder, the region-play extension, and the
 * engine harness. Checks what a child would meet: the zones announce
 * themselves, the walls and the channel hold, and the placeholders stand
 * where the layout puts them.
 */

const REGION = 'treasure-rush-cove';

async function cove() {
  const region = { ...bootstrapJson().region, scene: await coveSceneJson() };
  const model = toRegionSceneModel(read(bootstrapJson({ region }), parse.regionBootstrap));
  const built = buildRegionManifest(model, { worldSlug: 'learning-adventure-island' });
  publishRegionCheckpoints(REGION, built.checkpoints);
  const harness = mount({
    manifest: built.manifest,
    extensions: [regionPlaySceneExtension],
    loadModel: async () => standingBox(),
  });
  await harness.engine.ready;
  return harness;
}

const at =
  (x: number, z: number, yaw = FACE_SOUTH): Drive =>
  (controller) => {
    controller.position.set(x, 0, z);
    controller.yaw = yaw;
  };
const placeholder = (scene: Object3D, id: string) =>
  scene.getObjectByName(`${PROCEDURAL_NAME}:${id}`);

afterEach(() => unpublishRegionCheckpoints(REGION));

describe('the four-zone Treasure Cove on the engine (TR-13)', () => {
  it('announces each zone as the child walks into it', async () => {
    const harness = await cove();
    for (const [x, z] of [
      [0, 12],
      [-24, 6],
      [24, 0],
      [0, -22],
    ] as const) {
      harness.setDrive(at(x, z));
      harness.runFrames(1);
    }
    const entered = named(harness.events, 'PlayerEnteredZone').map(
      (detail) => (detail as { zoneId: string }).zoneId,
    );
    for (const zone of [
      'cove-zone-landing',
      'cove-zone-grove',
      'cove-zone-beach',
      'cove-zone-ruins',
    ]) {
      expect(entered).toContain(zone);
    }
  });

  it('keeps the child out of the channel: the ruins gate and the water both hold', async () => {
    const harness = await cove();
    harness.setDrive(at(0, -33));
    harness.runFrames(1);
    harness.setDrive(walk(FACE_SOUTH));
    harness.runFrames(240);
    expect(harness.camera().position.z).toBeGreaterThan(-35.4);

    harness.setDrive(at(20, -33));
    harness.runFrames(1);
    harness.setDrive(walk(FACE_SOUTH));
    harness.runFrames(240);
    expect(harness.camera().position.z).toBeGreaterThan(-36.4);
  });

  it('lets the child walk from the landing down the path into the ruins through the archway', async () => {
    const harness = await cove();
    harness.setDrive(at(0, 2));
    harness.runFrames(1);
    harness.setDrive(walk(FACE_SOUTH));
    harness.runFrames(400);
    expect(harness.camera().position.z).toBeLessThan(-20);
  });

  it('draws every placeholder the layout lists, and all the palms in three draw calls', async () => {
    const harness = await cove();
    harness.runFrames(1);
    const scene = harness.scene();
    for (const id of [
      'cove-tent',
      'cove-campfire',
      'cove-rowboat',
      'cove-pedestal',
      'cove-ruins-gate',
    ]) {
      expect(placeholder(scene, id)).toBeDefined();
    }
    expect(placeholder(scene, 'cove-ruins-gate')?.position.toArray()).toEqual([0, 0, -35.7]);
    expect(placeholder(scene, 'cove-ruins-gate')?.getObjectByName(GATE_BARS_NAME)).toBeDefined();
    const trunks = scene.getObjectByName(PALM_TRUNKS_NAME);
    expect(trunks).toBeInstanceOf(InstancedMesh);
    expect((trunks as InstancedMesh).count).toBeGreaterThan(20);
    expect(scene.getObjectByName('region-play:palm-crowns')).toBeInstanceOf(InstancedMesh);
  });

  it('holds the palms still when the device asks for reduced motion', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({ matches: query === '(prefers-reduced-motion: reduce)' })),
    );
    try {
      const harness = await cove();
      harness.runFrames(1);
      const trunks = harness.scene().getObjectByName(PALM_TRUNKS_NAME) as InstancedMesh;
      const before = trunks.instanceMatrix.array.slice();
      harness.runFrames(30, 50);
      expect(trunks.instanceMatrix.array).toEqual(before);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('sways the palms otherwise', async () => {
    const harness = await cove();
    harness.runFrames(1);
    const trunks = harness.scene().getObjectByName(PALM_TRUNKS_NAME) as InstancedMesh;
    const before = trunks.instanceMatrix.array.slice();
    harness.runFrames(30, 50);
    expect(trunks.instanceMatrix.array).not.toEqual(before);
  });

  it('frees the placeholders on dispose', async () => {
    const harness = await cove();
    harness.runFrames(1);
    const tent = placeholder(harness.scene(), 'cove-tent') as Object3D;
    harness.engine.dispose();
    expect(tent.parent?.parent ?? null).toBeNull();
  });
});
