import { afterEach, describe, expect, it, vi } from 'vitest';
import { read } from '../../../../../api/parse';
import * as parse from '../../../../../api/play/parse';
import {
  publishRegionCheckpoints,
  unpublishRegionCheckpoints,
} from '../../../../discovery/checkpoints';
import { buildRegionManifest } from '../../../../region-play/regionManifest';
import { toRegionSceneModel } from '../../../../region-play/sceneModel';
import {
  FIREPEAK,
  FIREPEAK_KEYS,
  firepeakBootstrapJson,
} from '../../../../../test/firepeakFixtures';
import { FACE_SOUTH, mount, walk, type Drive } from '../../runtime/testing/engineHarness';
import { regionPlaySceneExtension, type RegionPlaySceneApi } from './regionPlayScene';

/**
 * Firepeak's environment on the real runtime (FP-6, FP-10, FP-D10): lava returns the child to the
 * last safe checkpoint without losing anything, the repaired crossing is safe, the sealed passage
 * opens only from server state, a returning child resumes at the furthest section, and the rope
 * lift brings them back. Only the renderer and asset loading are stand-ins.
 */

function volcano(solved: string[] = []) {
  const model = toRegionSceneModel(read(firepeakBootstrapJson({ solved }), parse.regionBootstrap));
  const built = buildRegionManifest(model, { worldSlug: 'learning-adventure-island' });
  publishRegionCheckpoints(FIREPEAK, built.checkpoints);
  const harness = mount({
    manifest: built.manifest,
    extensions: [regionPlaySceneExtension],
    loadModel: async () => {
      throw new Error('no model published');
    },
  });
  harness.runFrames(1);
  const api = () => harness.engine.extensionApi('region-play') as RegionPlaySceneApi;
  const at = () => ({ x: harness.camera().position.x, z: harness.camera().position.z });
  return { harness, api, at };
}

/** Puts the player somewhere once, then lets the engine (and the lava) do what it does. */
function placeOnce(x: number, z: number): Drive {
  let done = false;
  return (controller) => {
    if (done) return;
    done = true;
    controller.position.set(x, 0, z);
  };
}

afterEach(() => unpublishRegionCheckpoints(FIREPEAK));

describe('Firepeak effects', () => {
  it('returns a child who steps into lava to the last safe checkpoint they reached', () => {
    const { harness, api, at } = volcano(['firepeak-telescope']);
    const respawned = vi.fn();
    api().effects.subscribe({ respawned });

    harness.setDrive(placeOnce(0, 13)); // the near bank: a checkpoint
    harness.runFrames(3);
    harness.setDrive(placeOnce(6, 6)); // into the lava
    harness.runFrames(3);

    expect(at()).toMatchObject({ x: 0, z: 13 });
    expect(respawned).toHaveBeenCalledWith(expect.objectContaining({ id: 'near-bank' }));
  });

  it('lets the child walk on the repaired crossing, but not off it', () => {
    const { harness, at } = volcano(['firepeak-telescope', 'firepeak-crossing']);
    harness.setDrive(placeOnce(0, 6));
    harness.runFrames(3);
    expect(at().z).toBeCloseTo(6);

    harness.setDrive(placeOnce(6, 6));
    harness.runFrames(3);
    expect(at().z).not.toBeCloseTo(6);
  });

  it('keeps the passage sealed until the server says the steam is redirected', () => {
    const sealed = volcano(['firepeak-telescope', 'firepeak-crossing']);
    sealed.harness.setDrive(placeOnce(0, -11));
    sealed.harness.runFrames(2);
    sealed.harness.setDrive(walk(FACE_SOUTH));
    sealed.harness.runFrames(120);
    expect(sealed.at().z).toBeGreaterThan(-12.6);

    // The scene opens it only when given the server's change key.
    sealed
      .api()
      .effects.setChangeKeys([FIREPEAK_KEYS.observed, FIREPEAK_KEYS.crossing, FIREPEAK_KEYS.steam]);
    sealed.harness.runFrames(120);
    expect(sealed.at().z).toBeLessThan(-14);
  });

  it('resumes a returning child at the furthest section they reached', () => {
    const { at } = volcano(['firepeak-telescope', 'firepeak-crossing']);
    expect(at()).toMatchObject({ x: 0, z: 0 });
  });

  it('starts a new explorer at Base Camp', () => {
    const { at } = volcano();
    expect(at()).toMatchObject({ x: 0, z: 28 });
  });

  it('opens the rope lift back to Base Camp only after the crystal is found', () => {
    const before = volcano(['firepeak-telescope', 'firepeak-crossing', 'firepeak-steam']);
    expect(before.api().effects.useReturn('firepeak-return-lift')).toBe(false);

    const after = volcano([
      'firepeak-telescope',
      'firepeak-crossing',
      'firepeak-steam',
      'firepeak-heart-crystal',
    ]);
    expect(after.api().effects.useReturn('firepeak-return-lift')).toBe(true);
    after.harness.runFrames(1);
    expect(after.at()).toMatchObject({ x: 0, z: 28 });
  });

  it('draws labelled stand-ins while models are not published', async () => {
    const { harness } = volcano();
    await new Promise((resolve) => setTimeout(resolve, 0));
    harness.runFrames(1);
    expect(harness.scene().getObjectByName('stand-in:firepeak-tent')).toBeDefined();
    expect(harness.scene().getObjectByName('stand-in:firepeak-telescope')).toBeDefined();
    expect(harness.scene().getObjectByName('lava:firepeak-lava-river')).toBeDefined();
    expect(harness.scene().getObjectByName('backdrop')).toBeDefined();
  });
});
