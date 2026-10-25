import {
  AnimationClip,
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  NumberKeyframeTrack,
  type Object3D,
} from 'three';
import { read } from '../../../../../api/parse';
import * as parse from '../../../../../api/play/parse';
import {
  publishRegionCheckpoints,
  unpublishRegionCheckpoints,
} from '../../../../discovery/checkpoints';
import { buildRegionManifest } from '../../../../region-play/regionManifest';
import { toRegionSceneModel } from '../../../../region-play/sceneModel';
import { bootstrapJson } from '../../../../../test/playFixtures';
import type { LoadedModel } from '../../runtime/extensionRegistry';
import {
  FACE_SOUTH,
  mount,
  named,
  standingBox,
  walk,
  type Drive,
} from '../../runtime/testing/engineHarness';
import {
  OPEN_LID_ANGLE,
  regionPlaySceneExtension,
  type RegionPlaySceneApi,
} from './regionPlayScene';

/**
 * Treasure Cove on the real runtime (TR-7): a manifest built from a Django
 * bootstrap, the region-play scene extension, and the engine harness's
 * stand-ins for the renderer and asset loading. Everything else is the
 * production engine.
 */

const REGION = 'treasure-rush-cove';

function cove(
  options: {
    chest?: Record<string, unknown>;
    overrides?: Record<string, unknown>;
    loadModel?: (assetId: string) => Promise<LoadedModel>;
  } = {},
) {
  const model = toRegionSceneModel(
    read(bootstrapJson(options.overrides ?? {}, options.chest ?? {}), parse.regionBootstrap),
  );
  const built = buildRegionManifest(model, { worldSlug: 'learning-adventure-island' });
  publishRegionCheckpoints(REGION, built.checkpoints);
  const harness = mount({
    manifest: built.manifest,
    extensions: [regionPlaySceneExtension],
    loadModel: options.loadModel ?? (async () => standingBox()),
  });
  const api = () => harness.engine.extensionApi('region-play') as RegionPlaySceneApi;
  const chestRoot = () => harness.scene().getObjectByName('Treasure chest') as Object3D;
  return { harness, api, chestRoot };
}

/** A chest model whose `Open` clip swings a node named `lid`. */
function chestModel(clips = ['Open']): LoadedModel {
  const scene = new Group();
  const lid = new Mesh(new BoxGeometry(1, 0.3, 1), new MeshBasicMaterial());
  lid.name = 'lid';
  const body = new Mesh(new BoxGeometry(1, 0.6, 1), new MeshBasicMaterial());
  scene.add(body, lid);
  const animations = clips.map(
    (name) =>
      new AnimationClip(name, 1, [new NumberKeyframeTrack('lid.rotation[x]', [0, 1], [0, -1.5])]),
  );
  return { scene, animations };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const lookAt =
  (x: number, z: number, yaw: number, pitch: number): Drive =>
  (controller) => {
    controller.position.set(x, 0, z);
    controller.yaw = yaw;
    controller.pitch = pitch;
  };
const builtChest = (root: Object3D) => root.getObjectByName('region-play:built-chest');
const hinge = (root: Object3D) => root.getObjectByName('region-play:lid-hinge') as Object3D;

afterEach(() => unpublishRegionCheckpoints(REGION));

describe('Treasure Cove on the engine', () => {
  it('spawns the child at the spawn point Django published and reports the checkpoint', () => {
    const { harness } = cove();
    harness.runFrames(2);
    expect(harness.camera().position.toArray()).toEqual([0, 1.6, 10]);
    expect(named(harness.events, 'PlayerEnteredZone')).toContainEqual({
      zoneId: 'treasure-rush-cove:cove-landing',
    });
  });

  it('lets the child walk the cove', () => {
    const { harness } = cove();
    harness.setDrive(walk(FACE_SOUTH));
    harness.runFrames(60);
    expect(harness.camera().position.z).toBeLessThan(10);
  });

  it('places Pip, the chest, and the scenery where the admin put them', () => {
    const { harness, chestRoot } = cove();
    harness.runFrames(1);
    expect(chestRoot().position.toArray()).toEqual([0, 0, -6]);
    expect(harness.scene().getObjectByName('Pirate Pip')?.position.toArray()).toEqual([3, 0, 6]);
  });

  it('draws a closed chest when the server says closed, and an open one when it says open', () => {
    const closed = cove({ chest: { assetId: '' } });
    closed.harness.runFrames(1);
    expect(hinge(closed.chestRoot()).rotation.x).toBe(0);
    expect(closed.chestRoot().getObjectByName('region-play:gold')?.visible).toBe(false);
    closed.harness.engine.dispose();

    const open = cove({ chest: { assetId: '', isOpen: true } });
    open.harness.runFrames(1);
    expect(hinge(open.chestRoot()).rotation.x).toBe(OPEN_LID_ANGLE);
    expect(open.chestRoot().getObjectByName('region-play:gold')?.visible).toBe(true);
  });

  it('changes a chest only when told to by the companion, from server state', () => {
    const { harness, api, chestRoot } = cove({ chest: { assetId: '' } });
    harness.runFrames(1);
    expect(api().isChestOpen('cove-chest')).toBe(false);
    api().setChestOpen('cove-chest', true);
    expect(api().isChestOpen('cove-chest')).toBe(true);
    expect(hinge(chestRoot()).rotation.x).toBe(OPEN_LID_ANGLE);
    expect(api().isChestOpen('no-such-chest')).toBeUndefined();
  });

  it('uses the catalogue chest model and its Open clip when it loads', async () => {
    const { harness, api, chestRoot } = cove({
      loadModel: async (id) => (id === 'treasure-chest' ? chestModel() : standingBox()),
    });
    await flush();
    harness.runFrames(1);
    expect(builtChest(chestRoot())).toBeUndefined();
    const lid = chestRoot().getObjectByName('lid') as Object3D;
    expect(lid.rotation.x).toBeCloseTo(0);
    api().setChestOpen('cove-chest', true);
    harness.runFrames(90, 16);
    expect(lid.rotation.x).toBeCloseTo(-1.5);
  });

  it('shows a model chest that starts open already open', async () => {
    const { harness, chestRoot } = cove({
      chest: { isOpen: true },
      loadModel: async (id) => (id === 'treasure-chest' ? chestModel() : standingBox()),
    });
    await flush();
    harness.runFrames(1);
    expect((chestRoot().getObjectByName('lid') as Object3D).rotation.x).toBeCloseTo(-1.5);
  });

  it('keeps the built chest when the model fails to load or has no open clip', async () => {
    const failing = cove({
      loadModel: async (id) =>
        id === 'treasure-chest' ? Promise.reject(new Error('404')) : standingBox(),
    });
    await flush();
    failing.harness.runFrames(1);
    expect(builtChest(failing.chestRoot())).toBeDefined();
    failing.harness.engine.dispose();
    const noClip = cove({
      loadModel: async (id) => (id === 'treasure-chest' ? chestModel(['Wobble']) : standingBox()),
    });
    await flush();
    noClip.harness.runFrames(1);
    expect(builtChest(noClip.chestRoot())).toBeDefined();
  });

  it('draws a placeholder figure for an NPC published without a model', () => {
    const { harness } = cove();
    harness.runFrames(1);
    const figure = harness.scene().getObjectByName('Pirate Pip') as Object3D;
    expect(figure.children.length).toBe(2);
  });

  it('reports interacting with the chest by entity id, and opens nothing itself', () => {
    const { harness, api } = cove({ chest: { assetId: '' } });
    harness.setDrive(lookAt(0, -4.3, FACE_SOUTH, -0.6));
    harness.runFrames(2);
    expect(named(harness.events, 'InteractableFocused')).toContainEqual(
      expect.objectContaining({ entityId: 'cove-chest' }),
    );
    harness.pressInteractKey();
    expect(named(harness.events, 'ObjectInteracted')).toContainEqual(
      expect.objectContaining({ entityId: 'cove-chest' }),
    );
    expect(api().isChestOpen('cove-chest')).toBe(false);
  });

  it('frees everything it drew on dispose', () => {
    const { harness, chestRoot } = cove({ chest: { assetId: '' } });
    harness.runFrames(1);
    const root = chestRoot();
    harness.engine.dispose();
    expect(builtChest(root)).toBeUndefined();
  });
});
