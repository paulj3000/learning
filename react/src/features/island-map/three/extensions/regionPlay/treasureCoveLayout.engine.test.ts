import { InstancedMesh, Matrix4, type Mesh, type Object3D } from 'three';
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
import type { LoadedModel } from '../../runtime/extensionRegistry';
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

/** TR-PALM-05 and TR-ENV-06: the cove with asset library palms, barrels and logs published. */
const LIBRARY_MODELS = [
  'nature-palm-tree-small',
  'nature-palm-tree-standard',
  'nature-palm-tree-tall',
  'nature-palm-tree-curved',
  'prop-wooden-barrel',
  'nature-wood-log',
  'nature-wood-log-moss',
  'prop-wood-pile',
];

async function libraryCove(
  deliverable: readonly string[],
  loadModel: (assetId: string) => Promise<LoadedModel> = async () => standingBox(),
) {
  const region = { ...bootstrapJson().region, scene: await coveSceneJson() };
  const catalog = {
    worldSlug: 'learning-adventure-island',
    assets: LIBRARY_MODELS.map((assetId) => ({
      assetId,
      kind: assetId.startsWith('prop-') ? 'prop' : 'kit-piece',
      clips: [],
      deliverable: deliverable.includes(assetId),
    })),
  };
  const model = toRegionSceneModel(read(bootstrapJson({ region, catalog }), parse.regionBootstrap));
  const built = buildRegionManifest(model, { worldSlug: 'learning-adventure-island' });
  publishRegionCheckpoints(REGION, built.checkpoints);
  const harness = mount({
    manifest: built.manifest,
    extensions: [regionPlaySceneExtension],
    loadModel,
  });
  await harness.engine.ready;
  // Let the extension's own model loads settle.
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  harness.runFrames(1);
  return { harness, built };
}

const instanced = (scene: Object3D, name: string) =>
  scene.children
    .flatMap((child) => child.children)
    .filter((child): child is InstancedMesh => child.name === name);

describe('Treasure Cove with asset library palms, barrels and logs (TR-PALM-05, TR-ENV-06)', () => {
  it('asks for no library model the catalog cannot deliver, and changes nothing then', async () => {
    const loadModel = vi.fn(async (_assetId: string) => standingBox());
    const { harness, built } = await libraryCove([], loadModel);
    const requested = loadModel.mock.calls.map(([id]) => id);
    for (const id of LIBRARY_MODELS) expect(requested).not.toContain(id);
    const config = built.manifest.extensions?.[0]?.config as { props?: unknown[] };
    expect(config.props ?? []).toEqual([]);
    expect(harness.scene().getObjectByName('cove-beach-barrels')?.visible).toBe(true);
  });

  it('draws every palm from its model, one instanced mesh per model part, and hides the primitives', async () => {
    const { harness } = await libraryCove(LIBRARY_MODELS);
    const scene = harness.scene();
    const tall = instanced(scene, 'region-play:palm-model:nature-palm-tree-tall');
    expect(tall).toHaveLength(1); // the box stand-in has one part
    expect(tall[0]!.count).toBeGreaterThan(5);
    const trunks = scene.getObjectByName(PALM_TRUNKS_NAME) as InstancedMesh;
    const matrix = new Matrix4();
    for (let i = 0; i < trunks.count; i += 1) {
      trunks.getMatrixAt(i, matrix);
      expect(matrix.determinant()).toBe(0); // every primitive palm is replaced
    }
  });

  it('draws the barrels and logs, hides the bundled ones they replace, and is the same every visit', async () => {
    const first = await libraryCove(LIBRARY_MODELS);
    const scene = first.harness.scene();
    expect(instanced(scene, 'region-play:prop-model:prop-wooden-barrel')[0]!.count).toBe(19);
    expect(instanced(scene, 'region-play:prop-model:nature-wood-log-moss')[0]!.count).toBe(4);
    for (const id of ['cove-beach-barrels', 'cove-landing-barrels', 'cove-grove-logs']) {
      expect(scene.getObjectByName(id)?.visible).toBe(false);
    }
    const second = await libraryCove(LIBRARY_MODELS);
    const barrels = (harness: typeof first.harness) =>
      instanced(harness.scene(), 'region-play:prop-model:prop-wooden-barrel')[0]!.instanceMatrix
        .array;
    expect(barrels(second.harness)).toEqual(barrels(first.harness));
  });

  it('makes a drawn barrel solid, and leaves no invisible wall where a barrel is not drawn', async () => {
    const towardsBarrel = async (deliverable: readonly string[]) => {
      const { harness } = await libraryCove(deliverable);
      harness.setDrive(at(33, 15));
      harness.runFrames(1);
      harness.setDrive(walk(FACE_SOUTH));
      harness.runFrames(120);
      return harness.camera().position.z;
    };
    // cove-beach-barrel-3 stands at (33, 12), 0.77 m wide.
    expect(await towardsBarrel(LIBRARY_MODELS)).toBeGreaterThan(12.38);
    expect(await towardsBarrel([])).toBeLessThan(11);
  });

  it('keeps a model that fails out of the way: the stand-ins stay and nothing turns solid', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { harness } = await libraryCove(LIBRARY_MODELS, async (assetId) => {
        if (LIBRARY_MODELS.includes(assetId)) throw new Error('unavailable');
        return standingBox();
      });
      expect(harness.scene().getObjectByName('cove-beach-barrels')?.visible).toBe(true);
      harness.setDrive(at(33, 15));
      harness.runFrames(1);
      harness.setDrive(walk(FACE_SOUTH));
      harness.runFrames(120);
      expect(harness.camera().position.z).toBeLessThan(11);
      const trunks = harness.scene().getObjectByName(PALM_TRUNKS_NAME) as InstancedMesh;
      const matrix = new Matrix4();
      trunks.getMatrixAt(0, matrix);
      expect(matrix.determinant()).not.toBe(0); // the primitive palm still stands
    } finally {
      warn.mockRestore();
    }
  });

  it('still lets the child walk the paths from the landing to the ruins, grove and beach', async () => {
    const { harness } = await libraryCove(LIBRARY_MODELS);
    harness.setDrive(at(0, 2));
    harness.runFrames(1);
    harness.setDrive(walk(FACE_SOUTH));
    harness.runFrames(400);
    expect(harness.camera().position.z).toBeLessThan(-20);
    for (const [path, x0, z0, x1, z1] of [
      ['grove', -9, 8, -23, 12],
      ['beach', 9, 8, 23, 4],
    ] as const) {
      harness.setDrive(at(x0, z0));
      harness.runFrames(1);
      const yaw = Math.atan2(x1 - x0, z1 - z0); // forward is (sin yaw, cos yaw)
      harness.setDrive(walk(yaw));
      harness.runFrames(300);
      const { x, z } = harness.camera().position;
      expect(Math.hypot(x - x1, z - z1), path).toBeLessThan(Math.hypot(x0 - x1, z0 - z1));
    }
  });

  it('frees its instanced models on dispose, and keeps the shared materials', async () => {
    const model = standingBox();
    const materialDispose = vi.spyOn(model.scene as Mesh, 'removeFromParent');
    const { harness } = await libraryCove(LIBRARY_MODELS, async () => model);
    const barrels = instanced(harness.scene(), 'region-play:prop-model:prop-wooden-barrel')[0]!;
    const geometryDispose = vi.spyOn(barrels.geometry, 'dispose');
    harness.engine.dispose();
    expect(geometryDispose).toHaveBeenCalled();
    expect(barrels.parent?.parent ?? null).toBeNull();
    expect(materialDispose).not.toHaveBeenCalled();
  });
});
