import type { Object3D } from 'three';
import { read } from '../../../../../api/parse';
import * as parse from '../../../../../api/play/parse';
import { coveSceneJson, pipsBootstrapJson } from '../../../../../test/playFixtures';
import {
  publishRegionCheckpoints,
  unpublishRegionCheckpoints,
} from '../../../../discovery/checkpoints';
import { buildRegionManifest } from '../../../../region-play/regionManifest';
import { toRegionSceneModel } from '../../../../region-play/sceneModel';
import type { LoadedModel } from '../../runtime/extensionRegistry';
import { mount, standingBox, type Harness } from '../../runtime/testing/engineHarness';
import {
  FEATHER_NAME,
  KEY_NAME,
  PICKUP_MODEL_NAME,
  PICKUP_NAME,
  SHELL_NAME,
  regionPlaySceneExtension,
  type RegionPlaySceneApi,
} from './regionPlayScene';

/**
 * The Feather defect (owner QA): the Pirate's Leap Parrot Feather appeared as a gold key.
 * Root cause: the region-play scene drew every pickup with `builtKey`, written when the beach
 * key was the only pickup. Each pickup is now drawn as what it is; real keys stay keys.
 */

const REGION = 'treasure-rush-cove';
const FEATHER = 'cove-leap-feather';
const SHELL = 'cove-leap-shell';
const KEY = 'cove-brass-key';

let harness: Harness | null = null;
afterEach(() => {
  harness?.engine.dispose();
  harness = null;
  unpublishRegionCheckpoints(REGION);
  vi.restoreAllMocks();
});

async function cove(
  options: {
    featherAsset?: string;
    deliverable?: boolean;
    loadModel?: (assetId: string) => Promise<LoadedModel>;
  } = {},
) {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const base = pipsBootstrapJson();
  const leap = (entityId: string, label: string, x: number, z: number, assetId = '') => ({
    ...base.objects[0]!,
    entityId,
    label,
    x,
    z,
    elevation: 0.9,
    assetId,
    kind: 'COLLECTIBLE',
    pickup: true,
    collected: false,
    placeholder: { width: 0.4, height: 0.3, depth: 0.4 },
  });
  const catalog = {
    worldSlug: 'learning-adventure-island',
    assets: [
      { assetId: 'feather', kind: 'prop', clips: [], deliverable: options.deliverable ?? false },
    ],
  };
  const data = read(
    {
      ...base,
      catalog,
      region: { ...base.region, scene: await coveSceneJson() },
      objects: [
        ...base.objects,
        leap(SHELL, 'Sparkly shell', -24.4, -19),
        leap(FEATHER, 'Parrot feather', -29, -29, options.featherAsset ?? ''),
      ],
    },
    parse.regionBootstrap,
  );
  const built = buildRegionManifest(toRegionSceneModel(data), {
    worldSlug: 'learning-adventure-island',
  });
  publishRegionCheckpoints(REGION, built.checkpoints);
  harness = mount({
    manifest: built.manifest,
    extensions: [regionPlaySceneExtension],
    loadModel: options.loadModel ?? (async () => standingBox()),
  });
  await harness.engine.ready;
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  harness.runFrames(1);
  const h = harness;
  const holder = (id: string) => h.scene().getObjectByName(`${PICKUP_NAME}:${id}`) as Object3D;
  const api = () => h.engine.extensionApi('region-play') as RegionPlaySceneApi;
  return { harness: h, holder, api, built };
}

describe('pickups look like what they are', () => {
  it('draws the Parrot Feather as a feather, never a key, while it has no model', async () => {
    const { holder } = await cove();
    expect(holder(FEATHER).getObjectByName(FEATHER_NAME)).toBeDefined();
    expect(holder(FEATHER).getObjectByName(KEY_NAME)).toBeUndefined();
  });

  it('still draws the brass key as a key, and the shell as a shell', async () => {
    const { holder } = await cove();
    expect(holder(KEY).getObjectByName(KEY_NAME)).toBeDefined();
    expect(holder(SHELL).getObjectByName(SHELL_NAME)).toBeDefined();
    expect(holder(SHELL).getObjectByName(KEY_NAME)).toBeUndefined();
  });

  it('draws the published feather model in the feather’s place', async () => {
    const loadModel = vi.fn(async (_assetId: string) => standingBox());
    const { holder, built } = await cove({ featherAsset: 'feather', deliverable: true, loadModel });
    expect(loadModel).toHaveBeenCalledWith('feather');
    expect(holder(FEATHER).getObjectByName(`${PICKUP_MODEL_NAME}:feather`)).toBeDefined();
    expect(holder(FEATHER).getObjectByName(FEATHER_NAME)).toBeUndefined();
    expect(holder(FEATHER).getObjectByName(KEY_NAME)).toBeUndefined();
    // The key never asks for a model, and is still a key.
    expect(loadModel.mock.calls.map(([id]) => id)).not.toContain('old-brass-key');
    expect(holder(KEY).getObjectByName(KEY_NAME)).toBeDefined();
    const config = built.manifest.extensions?.[0]?.config as {
      pickups: { entityId: string; assetId?: string; look?: string }[];
    };
    expect(config.pickups.find((p) => p.entityId === FEATHER)).toEqual({
      entityId: FEATHER,
      assetId: 'feather',
      look: 'FEATHER',
    });
  });

  it('keeps the primitive feather while the model is not published, and asks for nothing', async () => {
    const loadModel = vi.fn(async (_assetId: string) => standingBox());
    const { holder } = await cove({ featherAsset: 'feather', deliverable: false, loadModel });
    expect(loadModel.mock.calls.map(([id]) => id)).not.toContain('feather');
    expect(holder(FEATHER).getObjectByName(FEATHER_NAME)).toBeDefined();
  });

  it('keeps the primitive feather when the model fails to load (storage missing)', async () => {
    const { holder } = await cove({
      featherAsset: 'feather',
      deliverable: true,
      loadModel: async (assetId) => {
        if (assetId === 'feather') throw new Error('storage unavailable');
        return standingBox();
      },
    });
    expect(holder(FEATHER).getObjectByName(FEATHER_NAME)).toBeDefined();
    expect(holder(FEATHER).getObjectByName(KEY_NAME)).toBeUndefined();
  });

  it('is picked up exactly as before: gone once the server says so, by its own id', async () => {
    const { harness: h, holder, api } = await cove({ featherAsset: 'feather', deliverable: true });
    api().setPickupCollected(FEATHER);
    h.runFrames(1);
    expect(holder(FEATHER)).toBeUndefined();
    // The others are untouched.
    expect(holder(KEY).getObjectByName(KEY_NAME)).toBeDefined();
    expect(holder(SHELL).getObjectByName(SHELL_NAME)).toBeDefined();
  });

  it('never blocks the child: they walk straight through the feather’s spot', async () => {
    const { harness: h } = await cove({ featherAsset: 'feather', deliverable: true });
    let z = 0;
    let frame = 0;
    h.setDrive((controller, delta) => {
      if (frame++ === 0) controller.teleport(-29, -27, Math.PI); // 2 m north, facing south
      controller.update(delta, { forward: 1, strafe: 0 });
      z = controller.position.z;
    });
    h.runFrames(60);
    expect(z).toBeLessThan(-30);
  });
});
