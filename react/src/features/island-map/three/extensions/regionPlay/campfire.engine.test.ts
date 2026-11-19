import type { InstancedMesh, Object3D } from 'three';
import { read } from '../../../../../api/parse';
import * as parse from '../../../../../api/play/parse';
import { bootstrapJson, coveSceneJson } from '../../../../../test/playFixtures';
import {
  publishRegionCheckpoints,
  unpublishRegionCheckpoints,
} from '../../../../discovery/checkpoints';
import { buildRegionManifest } from '../../../../region-play/regionManifest';
import { toRegionSceneModel } from '../../../../region-play/sceneModel';
import { DEFAULT_PLAYER_COLLISION } from '@lai/game-engine/movement';
import type { LoadedModel } from '../../runtime/extensionRegistry';
import { mount, standingBox, type Harness } from '../../runtime/testing/engineHarness';
import { CAMPFIRE_BASE_NAME, CAMPFIRE_FLAMES_NAME, PROCEDURAL_NAME } from './proceduralScenery';
import { CAMPFIRE_MODEL_NAME, regionPlaySceneExtension } from './regionPlayScene';

/**
 * The campfire at Pip's camp (2026-11-15): Treasure Cove's `cove-campfire` names the `campfire`
 * asset library model (Kenney Survival Kit). Published, it replaces the primitive stones and
 * logs and keeps the primitive flame (the model has none). Unpublished or broken, the primitive
 * campfire stays. Either way the campfire is solid and never jumpable.
 */

const REGION = 'treasure-rush-cove';
const CAMPFIRE = { x: -5, z: 9.5 };
const REACH = DEFAULT_PLAYER_COLLISION.radius + DEFAULT_PLAYER_COLLISION.skin;

let harness: Harness | null = null;
afterEach(() => {
  harness?.engine.dispose();
  harness = null;
  unpublishRegionCheckpoints(REGION);
  vi.restoreAllMocks();
});

async function coveWithCampfire(
  deliverable: boolean,
  loadModel: (assetId: string) => Promise<LoadedModel> = async () => standingBox(),
) {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const region = { ...bootstrapJson().region, scene: await coveSceneJson() };
  const catalog = {
    worldSlug: 'learning-adventure-island',
    assets: [{ assetId: 'campfire', kind: 'prop', clips: [], deliverable }],
  };
  const model = toRegionSceneModel(read(bootstrapJson({ region, catalog }), parse.regionBootstrap));
  const built = buildRegionManifest(model, { worldSlug: 'learning-adventure-island' });
  publishRegionCheckpoints(REGION, built.checkpoints);
  harness = mount({
    manifest: built.manifest,
    extensions: [regionPlaySceneExtension],
    loadModel,
  });
  await harness.engine.ready;
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  harness.runFrames(1);
  return harness;
}

function campfireGroup(h: Harness): Object3D {
  const group = h.scene().getObjectByName(`${PROCEDURAL_NAME}:cove-campfire`);
  if (!group) throw new Error('no campfire');
  return group;
}

const modelMeshes = (scene: Object3D) => {
  const found: InstancedMesh[] = [];
  scene.traverse((node) => {
    if (node.name.startsWith(`${CAMPFIRE_MODEL_NAME}:`)) found.push(node as InstancedMesh);
  });
  return found;
};

describe('the Treasure Cove campfire', () => {
  it('names the campfire model in the layout and keeps its id', async () => {
    const scene = (await coveSceneJson()) as {
      layout: { procedural: { id: string; shape: string; assetId?: string }[] };
    };
    const entry = scene.layout.procedural.find((item) => item.id === 'cove-campfire');
    expect(entry).toMatchObject({ shape: 'CAMPFIRE', assetId: 'campfire' });
  });

  it('keeps the primitive campfire, and asks for no model, while it is not published', async () => {
    const loadModel = vi.fn(async (_assetId: string) => standingBox());
    const h = await coveWithCampfire(false, loadModel);
    expect(loadModel.mock.calls.map(([id]) => id)).not.toContain('campfire');
    const group = campfireGroup(h);
    expect(group.getObjectByName(CAMPFIRE_BASE_NAME)?.visible).toBe(true);
    expect(group.getObjectByName(CAMPFIRE_FLAMES_NAME)?.visible).toBe(true);
    expect(modelMeshes(h.scene())).toHaveLength(0);
  });

  it('draws the published model in place of the stones and logs, keeping the flame', async () => {
    const loadModel = vi.fn(async (_assetId: string) => standingBox());
    const h = await coveWithCampfire(true, loadModel);
    expect(loadModel).toHaveBeenCalledWith('campfire');
    const meshes = modelMeshes(h.scene());
    expect(meshes).toHaveLength(1);
    expect(meshes[0]!.count).toBe(1);
    const group = campfireGroup(h);
    expect(group.getObjectByName(CAMPFIRE_BASE_NAME)?.visible).toBe(false);
    expect(group.getObjectByName(CAMPFIRE_FLAMES_NAME)?.visible).toBe(true);
  });

  it('falls back to the primitive campfire when the model cannot be loaded', async () => {
    const h = await coveWithCampfire(true, async (assetId) => {
      if (assetId === 'campfire') throw new Error('storage unavailable');
      return standingBox();
    });
    expect(modelMeshes(h.scene())).toHaveLength(0);
    expect(campfireGroup(h).getObjectByName(CAMPFIRE_BASE_NAME)?.visible).toBe(true);
  });

  for (const deliverable of [false, true]) {
    it(`is solid and not jumpable (${deliverable ? 'model' : 'primitive'}): no walking or jumping through`, async () => {
      const h = await coveWithCampfire(deliverable);
      let z = 0;
      let x = 0;
      // From 3 m north, walk south into the fire, jumping as we go.
      let frame = 0;
      h.setDrive((controller, delta) => {
        if (frame === 0) controller.teleport(CAMPFIRE.x, CAMPFIRE.z + 3, Math.PI);
        if (frame % 20 === 5) controller.pressJump();
        frame += 1;
        controller.update(delta, { forward: 1, strafe: 0 });
        x = controller.position.x;
        z = controller.position.z;
      });
      h.runFrames(150);
      expect(Math.abs(x - CAMPFIRE.x)).toBeLessThan(0.01);
      // Stopped at the 0.6 m collider plus the child's body: never over the stones.
      expect(z).toBeGreaterThanOrEqual(CAMPFIRE.z + 0.6 + REACH - 1e-6);
    });
  }

  it('holds the flame still when the device asks for reduced motion, and flickers otherwise', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({ matches: query === '(prefers-reduced-motion: reduce)' })),
    );
    try {
      const h = await coveWithCampfire(true);
      const flames = campfireGroup(h).getObjectByName(CAMPFIRE_FLAMES_NAME)!;
      const before = flames.scale.clone();
      h.runFrames(30, 50);
      expect(flames.scale.equals(before)).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
    harness?.engine.dispose();
    const moving = await coveWithCampfire(true);
    const flames = campfireGroup(moving).getObjectByName(CAMPFIRE_FLAMES_NAME)!;
    const before = flames.scale.clone();
    moving.runFrames(30, 50);
    expect(flames.scale.equals(before)).toBe(false);
  });
});
