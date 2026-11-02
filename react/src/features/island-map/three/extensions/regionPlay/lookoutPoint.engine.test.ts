import { read } from '../../../../../api/parse';
import * as parse from '../../../../../api/play/parse';
import { bootstrapJson, coveSceneJson } from '../../../../../test/playFixtures';
import {
  publishRegionCheckpoints,
  unpublishRegionCheckpoints,
} from '../../../../discovery/checkpoints';
import { buildRegionManifest } from '../../../../region-play/regionManifest';
import { toRegionSceneModel } from '../../../../region-play/sceneModel';
import { REGION_PLAY_EXTENSION_ID } from '../../../../region-play/regionPlayConfig';
import {
  FACE_NORTH,
  FACE_SOUTH,
  mount,
  standingBox,
  walk,
  type Drive,
} from '../../runtime/testing/engineHarness';
import { GATE_BARS_NAME, PROCEDURAL_NAME } from './proceduralScenery';
import { regionPlaySceneExtension, type RegionPlaySceneApi } from './regionPlayScene';

/**
 * The way to Lookout Point (TR-17) on the real runtime: the snapshot Django serves, the manifest
 * builder, the region-play extension and the engine's own collision. Proves what a child meets:
 * the gate and the water hold until the quest is complete, then the bridge is the only way
 * across, it can be crossed both ways, nobody can step off it into the water or out of the
 * world, and a child who comes back later finds it already open.
 */

const REGION = 'treasure-rush-cove';
const QUEST_COMPLETE = 'TREASURE_COVE_QUEST_COMPLETE';

async function cove(options: { unlocked?: boolean } = {}) {
  const region = { ...bootstrapJson().region, scene: await coveSceneJson() };
  const worldChanges = options.unlocked
    ? [
        {
          locationSlug: 'pirate-builder-bay',
          changeType: 'UNLOCK',
          changeKey: QUEST_COMPLETE,
          payload: {},
          createdAt: '2026-11-02T18:00:00.000000Z',
        },
      ]
    : [];
  const model = toRegionSceneModel(
    read(bootstrapJson({ region, worldChanges }), parse.regionBootstrap),
  );
  const built = buildRegionManifest(model, { worldSlug: 'learning-adventure-island' });
  publishRegionCheckpoints(REGION, built.checkpoints);
  const harness = mount({
    manifest: built.manifest,
    extensions: [regionPlaySceneExtension],
    loadModel: async () => standingBox(),
  });
  await harness.engine.ready;
  harness.runFrames(1);
  const api = harness.engine.extensionApi(REGION_PLAY_EXTENSION_ID) as RegionPlaySceneApi;
  return { harness, api };
}

type Cove = Awaited<ReturnType<typeof cove>>['harness'];

const at =
  (x: number, z: number, yaw = FACE_SOUTH): Drive =>
  (controller) => {
    controller.position.set(x, 0, z);
    controller.yaw = yaw;
  };

function place(harness: Cove, x: number, z: number, yaw = FACE_SOUTH) {
  harness.setDrive(at(x, z, yaw));
  harness.runFrames(1);
}

/** Walks `frames` frames in `yaw` (forward) or sideways (strafe) from where the child stands. */
function go(harness: Cove, yaw: number, frames: number, strafe = 0) {
  harness.setDrive((controller, delta) => {
    controller.yaw = yaw;
    controller.update(delta, { forward: strafe === 0 ? 1 : 0, strafe });
  });
  harness.runFrames(frames);
}

const where = (harness: Cove) => harness.camera().position;
const visible = (harness: Cove, id: string) =>
  harness.scene().getObjectByName(`${PROCEDURAL_NAME}:${id}`)?.visible;

afterEach(() => unpublishRegionCheckpoints(REGION));

describe('Lookout Point before the quest is complete', () => {
  it('keeps the gate shut, the bridge unlaid and the sinking planks showing', async () => {
    const { harness, api } = await cove();
    expect(api.isUnlocked()).toBe(false);
    expect(visible(harness, 'cove-bridge')).toBe(false);
    expect(visible(harness, 'cove-lookout-lanterns')).toBe(false);
    expect(visible(harness, 'cove-broken-bridge')).toBe(true);
    const bars = harness.scene().getObjectByName(GATE_BARS_NAME);
    expect(bars?.visible).toBe(true);
  });

  it('stops the child at the gate, and at the water on either side of the bridge', async () => {
    const { harness } = await cove();
    place(harness, 0, -33);
    go(harness, FACE_SOUTH, 300);
    expect(where(harness).z).toBeGreaterThan(-35.4);
    // The edge of the channel, east and west of where the bridge will be.
    for (const x of [-20, -3, 3, 20]) {
      place(harness, x, -34.8);
      go(harness, FACE_SOUTH, 300);
      expect(where(harness).z).toBeGreaterThan(-36.4);
    }
  });
});

describe('opening the way, live (the quest just completed)', () => {
  it('lifts the gate, lays the bridge and lets the child walk to the flag', async () => {
    const { harness, api } = await cove();
    expect(api.setUnlocked(true)).toBe(true);
    expect(api.isUnlocked()).toBe(true);
    expect(visible(harness, 'cove-bridge')).toBe(true);
    expect(visible(harness, 'cove-lookout-lanterns')).toBe(true);
    expect(visible(harness, 'cove-broken-bridge')).toBe(false);

    harness.runFrames(120, 16); // the bars rise for a second or so, then are gone
    expect(harness.scene().getObjectByName(GATE_BARS_NAME)?.visible).toBe(false);

    place(harness, 0, -33);
    go(harness, FACE_SOUTH, 400);
    // Past the gate, over the channel, onto Lookout Point (the flag is at z -42.5).
    expect(where(harness).z).toBeLessThan(-41);
    expect(Math.abs(where(harness).x)).toBeLessThan(1.6);
  });

  it('is told twice and opens once', async () => {
    const { api } = await cove();
    expect(api.setUnlocked(true)).toBe(true);
    expect(api.setUnlocked(true)).toBe(false);
    expect(api.setUnlocked(false)).toBe(false); // a world change is never undone
    expect(api.isUnlocked()).toBe(true);
  });

  it('can be crossed back again, so nobody is stranded on Lookout Point', async () => {
    const { harness, api } = await cove();
    api.setUnlocked(true);
    place(harness, 0, -42, FACE_NORTH);
    go(harness, FACE_NORTH, 500);
    expect(where(harness).z).toBeGreaterThan(-33);
  });

  it('keeps the child on the bridge: the water on both sides still holds', async () => {
    const { harness, api } = await cove();
    api.setUnlocked(true);
    for (const direction of [-1, 1]) {
      place(harness, 0, -38, FACE_SOUTH);
      go(harness, FACE_SOUTH, 400, direction);
      expect(Math.abs(where(harness).x)).toBeLessThan(1.7);
      expect(where(harness).z).toBeGreaterThan(-40.4);
    }
  });

  it('keeps the child out of the sea beyond Lookout Point and inside the island', async () => {
    const { harness, api } = await cove();
    api.setUnlocked(true);
    place(harness, 0, -42, FACE_SOUTH);
    go(harness, FACE_SOUTH, 400);
    expect(where(harness).z).toBeGreaterThan(-44);
    place(harness, 0, -42, FACE_SOUTH);
    go(harness, FACE_SOUTH, 600, 1);
    expect(Math.abs(where(harness).x)).toBeLessThan(36);
  });
});

describe('coming back later', () => {
  it('builds the cove open for a child who finished the quest, with no animation to wait for', async () => {
    const { harness, api } = await cove({ unlocked: true });
    expect(api.isUnlocked()).toBe(true);
    expect(visible(harness, 'cove-bridge')).toBe(true);
    expect(visible(harness, 'cove-broken-bridge')).toBe(false);
    expect(harness.scene().getObjectByName(GATE_BARS_NAME)?.visible).toBe(false);
    place(harness, 0, -33);
    go(harness, FACE_SOUTH, 400);
    expect(where(harness).z).toBeLessThan(-41);
  });

  it('does not report a change when the scene was already open, so no second celebration', async () => {
    const { api } = await cove({ unlocked: true });
    expect(api.setUnlocked(true)).toBe(false);
  });
});

describe('walking helpers', () => {
  it('walk() and go() agree on the closed gate', async () => {
    const { harness } = await cove();
    place(harness, 0, -33);
    harness.setDrive(walk(FACE_SOUTH));
    harness.runFrames(300);
    expect(where(harness).z).toBeGreaterThan(-35.4);
  });
});
