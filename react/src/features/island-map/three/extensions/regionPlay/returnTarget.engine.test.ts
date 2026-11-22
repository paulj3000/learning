import { afterEach, describe, expect, it } from 'vitest';
import { read } from '../../../../../api/parse';
import * as parse from '../../../../../api/play/parse';
import {
  publishRegionCheckpoints,
  unpublishRegionCheckpoints,
} from '../../../../discovery/checkpoints';
import { buildRegionManifest } from '../../../../region-play/regionManifest';
import { parseEffects } from '../../../../region-play/regionPlayConfig';
import { toRegionSceneModel } from '../../../../region-play/sceneModel';
import { FIREPEAK, firepeakBootstrapJson } from '../../../../../test/firepeakFixtures';
import { mount } from '../../runtime/testing/engineHarness';
import { regionPlaySceneExtension, type RegionPlaySceneApi } from './regionPlayScene';

/**
 * GE-065: an Area whose checkpoint list moved to the engine bridge has no effects checkpoints, so
 * a way back (`effects.returns`) carries its own destination (`to`). With an effects checkpoint of
 * that id the old behaviour stands.
 */

const SOLVED = [
  'firepeak-telescope',
  'firepeak-crossing',
  'firepeak-steam',
  'firepeak-heart-crystal',
];

function withoutEffectsCheckpoints() {
  const json = firepeakBootstrapJson({ solved: SOLVED }) as {
    region: { scene: { effects: Record<string, unknown> } };
  };
  const effects = json.region.scene.effects;
  effects.checkpoints = [];
  effects.returns = (effects.returns as Record<string, unknown>[]).map((route) => ({
    ...route,
    to: { x: 3, z: 7, yaw: 0 },
  }));
  return json;
}

function mounted(json: unknown) {
  const model = toRegionSceneModel(read(json, parse.regionBootstrap));
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

afterEach(() => unpublishRegionCheckpoints(FIREPEAK));

describe('a way back with its own destination (GE-065)', () => {
  it('parses `to`, and null when it is absent or incomplete', () => {
    const parsed = parseEffects({
      returns: [
        {
          entityId: 'a',
          toCheckpoint: 'cp',
          whenChangeKey: 'K',
          label: 'Back',
          to: { x: 1, z: 2, yaw: 3 },
        },
        { entityId: 'b', toCheckpoint: 'cp', whenChangeKey: 'K', label: 'Back' },
        { entityId: 'c', toCheckpoint: 'cp', whenChangeKey: 'K', label: 'Back', to: { x: 1 } },
      ],
    });
    expect(parsed.returns.map((r) => r.to)).toEqual([{ x: 1, z: 2, yaw: 3 }, null, null]);
  });

  it('lands at `to` when the checkpoint is not an effects checkpoint', () => {
    const { api, harness, at } = mounted(withoutEffectsCheckpoints());
    expect(api().effects.useReturn('firepeak-return-lift')).toBe(true);
    harness.runFrames(1);
    expect(at()).toMatchObject({ x: 3, z: 7 });
  });

  it('still uses the effects checkpoint when there is one', () => {
    const { api, harness, at } = mounted(firepeakBootstrapJson({ solved: SOLVED }));
    expect(api().effects.useReturn('firepeak-return-lift')).toBe(true);
    harness.runFrames(1);
    expect(at()).toMatchObject({ x: 0, z: 28 });
  });
});
