import type { Object3D, Sprite } from 'three';
import { read } from '../../../../../api/parse';
import * as parse from '../../../../../api/play/parse';
import { coveSceneJson, pipsBootstrapJson } from '../../../../../test/playFixtures';
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
  type Drive,
} from '../../runtime/testing/engineHarness';
import {
  BEACON_NAME,
  KEY_NAME,
  RUNE_LABEL_NAME,
  regionPlaySceneExtension,
  type RegionPlaySceneApi,
} from './regionPlayScene';

/**
 * Pip's Missing Treasure (TR-14) on the real runtime: what the scene draws for each encounter
 * from the server's state, and only from it.
 */

const REGION = 'treasure-rush-cove';

async function cove(chests: Record<string, Record<string, unknown>> = {}) {
  const base = pipsBootstrapJson({}, chests);
  const data = read(
    { ...base, region: { ...base.region, scene: await coveSceneJson() } },
    parse.regionBootstrap,
  );
  const built = buildRegionManifest(toRegionSceneModel(data), {
    worldSlug: 'learning-adventure-island',
  });
  publishRegionCheckpoints(REGION, built.checkpoints);
  const harness = mount({
    manifest: built.manifest,
    extensions: [regionPlaySceneExtension],
    loadModel: async () => standingBox(),
  });
  await harness.engine.ready;
  harness.runFrames(1);
  const api = () => harness.engine.extensionApi('region-play') as RegionPlaySceneApi;
  const root = (id: string) => harness.scene().getObjectByName(labelOf(data, id)) as Object3D;
  const beacon = (id: string) => harness.scene().getObjectByName(`${BEACON_NAME}:${id}`);
  return { harness, api, root, beacon };
}

function labelOf(data: ReturnType<typeof read>, id: string): string {
  const bootstrap = data as {
    chests: { entityId: string; label: string }[];
    objects: { entityId: string; label: string }[];
  };
  return [...bootstrap.chests, ...bootstrap.objects].find((e) => e.entityId === id)!.label;
}

const at =
  (x: number, z: number, yaw = FACE_SOUTH): Drive =>
  (controller) => {
    controller.position.set(x, 0, z);
    controller.yaw = yaw;
    controller.pitch = 1.2; // looking up: only forgiving aim can find things
  };
const focused = (events: Parameters<typeof named>[0]) =>
  named(events, 'InteractableFocused').map((d) => (d as { entityId: string | null }).entityId);

afterEach(() => unpublishRegionCheckpoints(REGION));

describe("Pip's Missing Treasure in the scene (TR-14)", () => {
  it('hides the grove chest until the server says it may be found, then shows it', async () => {
    const { harness, api, root, beacon } = await cove({
      'cove-grove-chest': { locked: true, lockReason: 'PROGRESS' },
    });
    expect(root('cove-grove-chest').visible).toBe(false);
    expect(beacon('cove-grove-chest')?.visible).toBe(false);
    harness.setDrive(at(-30, 22.4));
    harness.runFrames(2);
    expect(focused(harness.events)).not.toContain('cove-grove-chest');

    api().setChestLock('cove-grove-chest', null);
    harness.runFrames(2);
    expect(root('cove-grove-chest').visible).toBe(true);
    expect(beacon('cove-grove-chest')?.visible).toBe(true);
    expect(focused(harness.events)).toContain('cove-grove-chest');
  });

  it('shows a beacon over a chest waiting for its key, but not over one further along', async () => {
    const { api, beacon, harness } = await cove();
    expect(beacon('cove-beach-chest')?.visible).toBe(false); // locked by progress
    api().setChestLock('cove-beach-chest', 'ITEM');
    harness.runFrames(1);
    expect(beacon('cove-beach-chest')?.visible).toBe(true);
  });

  it('draws no chest on the pedestal', async () => {
    const { root } = await cove();
    expect(root('cove-ruins-pedestal').getObjectByName('region-play:built-chest')).toBeUndefined();
  });

  it('draws the key until the server says it is picked up, then it cannot be found', async () => {
    const { harness, api, root, beacon } = await cove();
    expect(root('cove-brass-key').getObjectByName(KEY_NAME)).toBeDefined();
    api().setPickupCollected('cove-brass-key');
    harness.runFrames(1);
    expect(root('cove-brass-key').getObjectByName(KEY_NAME)).toBeUndefined();
    expect(beacon('cove-brass-key')?.visible).toBe(false);
    harness.setDrive(at(31, 2.4));
    harness.runFrames(2);
    expect(focused(harness.events)).not.toContain('cove-brass-key');
  });

  it('puts the puzzle’s numbers on the rune stones, and takes them away', async () => {
    const { api, root } = await cove();
    const label = (id: string) => root(id).getObjectByName(RUNE_LABEL_NAME) as Sprite;
    expect(label('cove-rune-stone-1').visible).toBe(false);
    api().setRuneNumbers(
      new Map([
        ['cove-rune-stone-1', 4],
        ['cove-rune-stone-2', 7],
        ['cove-rune-stone-3', 9],
      ]),
    );
    expect(label('cove-rune-stone-2').visible).toBe(true);
    expect(label('cove-rune-stone-2').userData.number).toBe(7);
    api().setRuneNumbers(null);
    expect(label('cove-rune-stone-2').visible).toBe(false);
  });

  it('lets a child walk up to a rune stone and touch it', async () => {
    const { harness } = await cove();
    harness.setDrive(at(-3, -21));
    harness.runFrames(2);
    expect(focused(harness.events)).toContain('cove-rune-stone-1');
    harness.pressInteractKey();
    expect(named(harness.events, 'ObjectInteracted')).toContainEqual(
      expect.objectContaining({ entityId: 'cove-rune-stone-1' }),
    );
  });
});
