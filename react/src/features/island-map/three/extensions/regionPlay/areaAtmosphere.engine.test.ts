import { afterEach, describe, expect, it } from 'vitest';
import { AmbientLight, DirectionalLight, type Object3D } from 'three';
import { read } from '../../../../../api/parse';
import * as parse from '../../../../../api/play/parse';
import {
  publishRegionCheckpoints,
  unpublishRegionCheckpoints,
} from '../../../../discovery/checkpoints';
import { buildRegionManifest } from '../../../../region-play/regionManifest';
import { toRegionSceneModel } from '../../../../region-play/sceneModel';
import { FIREPEAK, firepeakBootstrapJson } from '../../../../../test/firepeakFixtures';
import { mount } from '../../runtime/testing/engineHarness';
import { gateOpen } from './areaEffectsScene';
import { regionPlaySceneExtension, type RegionPlaySceneApi } from './regionPlayScene';

/**
 * Generic Area atmosphere on the real runtime: lighting colours, fog, falling particles, sky
 * ribbons and conditional lights and stand-ins, all from `scene` data. Absent keys change nothing.
 */

function build(
  patch: (scene: Record<string, unknown>) => void = () => undefined,
  options: { quality?: 'LOW' | 'MEDIUM' | 'HIGH'; reducedMotion?: boolean } = {},
) {
  const json = firepeakBootstrapJson();
  patch(json.region.scene as unknown as Record<string, unknown>);
  const model = toRegionSceneModel(read(json, parse.regionBootstrap));
  const built = buildRegionManifest(model, { worldSlug: 'learning-adventure-island' });
  publishRegionCheckpoints(FIREPEAK, built.checkpoints);
  const harness = mount({
    manifest: built.manifest,
    extensions: [regionPlaySceneExtension],
    quality: options.quality,
    reducedMotion: options.reducedMotion,
    loadModel: async () => {
      throw new Error('no model published');
    },
  });
  harness.runFrames(1);
  const api = () => harness.engine.extensionApi('region-play') as RegionPlaySceneApi;
  return { harness, api, manifest: built.manifest };
}

const ATMOSPHERE = {
  fog: { color: 0xdde8f5, near: 40, far: 170 },
  precipitation: { kind: 'SNOW', density: 1 },
  skyRibbons: [
    { id: 'aurora-1', colors: [0x5ec8b0, 0x8a6fee], x: 0, y: 60, z: -140, width: 220, height: 30 },
  ],
};

afterEach(() => unpublishRegionCheckpoints(FIREPEAK));

describe('Area atmosphere', () => {
  it('changes nothing when no new key is authored', () => {
    const { harness, manifest } = build();
    expect(manifest.atmosphere).toBeUndefined();
    expect(manifest.environment.lighting).toBeUndefined();
    expect(harness.scene().fog).toBeNull();
    expect(harness.scene().getObjectByName('atmosphere:precipitation')).toBeUndefined();
    const ambient = harness.scene().children.find((child) => child instanceof AmbientLight);
    expect((ambient as AmbientLight).color.getHex()).toBe(0xffffff);
  });

  it('passes lighting colours and intensities through, clamped', () => {
    const { harness, manifest } = build((scene) => {
      scene.environment = {
        backgroundColor: 0x1e2c58,
        lighting: {
          ambientColor: 0xcfe0ff,
          ambientIntensity: 9,
          sunColor: 0xfff0e0,
          sunIntensity: 0.9,
        },
      };
    });
    expect(manifest.environment.lighting).toEqual({
      ambientColor: 0xcfe0ff,
      ambientIntensity: 4,
      sunColor: 0xfff0e0,
      sunIntensity: 0.9,
    });
    const children = harness.scene().children;
    const ambient = children.find((child) => child instanceof AmbientLight) as AmbientLight;
    const sun = children.find((child) => child instanceof DirectionalLight) as DirectionalLight;
    expect(ambient.color.getHex()).toBe(0xcfe0ff);
    expect(ambient.intensity).toBe(4);
    expect(sun.color.getHex()).toBe(0xfff0e0);
  });

  it('draws fog, snow and ribbons at MEDIUM, and follows the camera', () => {
    const { harness } = build((scene) => (scene.atmosphere = ATMOSPHERE));
    expect(harness.scene().fog).not.toBeNull();
    const snow = harness.scene().getObjectByName('atmosphere:precipitation') as Object3D;
    expect(snow).toBeDefined();
    harness.runFrames(3);
    expect(snow.position.x).toBeCloseTo(harness.camera().position.x);
    expect(harness.scene().getObjectByName('atmosphere:ribbon:aurora-1')).toBeDefined();
  });

  it('skips snow and ribbons at LOW but keeps the fog', () => {
    const { harness } = build((scene) => (scene.atmosphere = ATMOSPHERE), { quality: 'LOW' });
    expect(harness.scene().fog).not.toBeNull();
    expect(harness.scene().getObjectByName('atmosphere:precipitation')).toBeUndefined();
    expect(harness.scene().getObjectByName('atmosphere:ribbon:aurora-1')).toBeUndefined();
  });

  it('holds ribbons still under reduced motion', () => {
    const time = (reduced: boolean) => {
      const { harness } = build((scene) => (scene.atmosphere = ATMOSPHERE), {
        reducedMotion: reduced,
      });
      harness.runFrames(20);
      const ribbon = harness.scene().getObjectByName('atmosphere:ribbon:aurora-1') as unknown as {
        material: { uniforms: { uTime: { value: number } } };
      };
      return ribbon.material.uniforms.uTime.value;
    };
    expect(time(false)).toBeGreaterThan(0);
    expect(time(true)).toBe(0);
  });

  it('shows and hides conditional lights and stand-ins with the change keys', async () => {
    const { harness, api } = build((scene) => {
      const effects = scene.effects as Record<string, unknown>;
      effects.lights = [
        ...((effects.lights as unknown[]) ?? []),
        {
          id: 'star-glow',
          x: 0,
          y: 4,
          z: 0,
          color: 0xfff2a8,
          intensity: 2,
          shownWhenChangeKey: 'STAR_DONE',
        },
      ];
      effects.standIns = [
        ...((effects.standIns as { entityId: string }[]) ?? []).map((entry) =>
          entry.entityId === 'firepeak-tent'
            ? { ...entry, hiddenWhenChangeKey: 'STAR_DONE' }
            : entry,
        ),
      ];
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const light = () => harness.scene().getObjectByName('star-glow') as Object3D;
    const tent = () => harness.scene().getObjectByName('stand-in:firepeak-tent') as Object3D;
    expect(light().visible).toBe(false);
    expect(tent().parent?.visible).toBe(true);
    api().effects.setChangeKeys(['STAR_DONE']);
    expect(light().visible).toBe(true);
    expect(tent().parent?.visible).toBe(false);
    api().effects.setChangeKeys([]);
    expect(light().visible).toBe(false);
  });

  it('gateOpen follows steam semantics', () => {
    const keys = new Set(['a']);
    expect(gateOpen({}, keys)).toBe(true);
    expect(gateOpen({ shownWhenChangeKey: 'a' }, keys)).toBe(true);
    expect(gateOpen({ shownWhenChangeKey: 'b' }, keys)).toBe(false);
    expect(gateOpen({ hiddenWhenChangeKey: 'a' }, keys)).toBe(false);
    expect(gateOpen({ hiddenWhenChangeKey: 'b' }, keys)).toBe(true);
  });
});
