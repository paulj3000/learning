import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AnimationClip,
  BoxGeometry,
  Mesh,
  MeshBasicMaterial,
  NumberKeyframeTrack,
  type Object3D,
} from 'three';
import { PIRATE_BUILDER_BAY_MANIFEST } from './pirateBuilderBay';
import { CHANNEL_BED_Y, WATER_SURFACE_Y } from '../../pirateBuilderBayRegion';
import { SOURCE_WORLD_EXTENSIONS } from '../../extensions';
import {
  isTideTrialScene,
  tideTrialSceneExtension,
  type TideTrialScene,
} from '../../extensions/tideTrial/tideTrialScene';
import type { LoadedModel } from '../createLocationEngine';
import { mount, named, standAt, standingBox, walk } from '../testing/engineHarness';

/**
 * Pirate Builder Bay through the real generic runtime (engine Phase 7),
 * with only the renderer, assets, input and clock faked: the bridge built
 * broken or mended from world state, crossing it, props, the treasure
 * chest's one-shot clip, and the real `tide-trial` scene extension driven
 * through the API its panel uses.
 */

const FACE_EAST = Math.PI / 2;
const MENDED = { worldChangeKeys: ['BRIDGE_REPAIRED'] };

/** A chest whose `Open` clip lifts it 1 m over 1 s, so playing it is observable. */
function chestWithOpenClip(): LoadedModel {
  const geometry = new BoxGeometry(0.6, 1.8, 0.6);
  geometry.translate(0, 0.9, 0);
  return {
    scene: new Mesh(geometry, new MeshBasicMaterial()),
    animations: [
      new AnimationClip('Open', 1, [new NumberKeyframeTrack('.position[y]', [0, 1], [0, 1])]),
    ],
  };
}

const loadModel = async (assetId: string): Promise<LoadedModel> =>
  assetId === 'treasure-chest' ? chestWithOpenClip() : standingBox();

function mountBay(
  options: { worldState?: { worldChangeKeys: string[] }; startCheckpointId?: string } = {},
) {
  return mount({
    manifest: PIRATE_BUILDER_BAY_MANIFEST,
    extensions: [tideTrialSceneExtension],
    loadModel,
    ...options,
  });
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  warn.mockRestore();
});

describe('Pirate Builder Bay on the generic runtime', () => {
  it('ships its tide trial through the source extension registry', () => {
    expect(SOURCE_WORLD_EXTENSIONS.get('tide-trial')).toBe(tideTrialSceneExtension);
  });

  it('stops a child at the gap while the bridge is broken', () => {
    const harness = mountBay();
    harness.setDrive(walk(FACE_EAST));
    harness.runFrames(300);
    expect(harness.camera().position.x).toBeLessThan(-3);
    expect(harness.camera().position.x).toBeGreaterThan(-3.3);
  });

  it('lets a child walk across once the bridge is mended', () => {
    const harness = mountBay({ worldState: MENDED });
    harness.setDrive(walk(FACE_EAST));
    harness.runFrames(300);
    expect(harness.camera().position.x).toBeGreaterThan(3);
  });

  it('builds the broken bridge or the mended deck from world state', () => {
    const broken = mountBay();
    broken.runFrames(1);
    expect(broken.scene().getObjectByName('bay-bridge-stubs')).toBeDefined();
    expect(broken.scene().getObjectByName('bay-bridge-fallen-plank')).toBeDefined();
    expect(broken.scene().getObjectByName('bay-bridge-deck')).toBeUndefined();

    const mended = mountBay({ worldState: MENDED });
    mended.runFrames(1);
    expect(mended.scene().getObjectByName('bay-bridge-stubs')).toBeUndefined();
    expect(mended.scene().getObjectByName('bay-bridge-deck')).toBeDefined();
  });

  it('builds the channel as a box from the bed to the water surface', () => {
    const harness = mountBay();
    harness.runFrames(1);
    const channel = harness.scene().getObjectByName('bay-channel');
    expect(channel?.position.y).toBeCloseTo(CHANNEL_BED_Y);
    const water = channel?.children[0] as Mesh;
    expect((water.geometry as BoxGeometry).parameters.height).toBeCloseTo(
      WATER_SURFACE_Y - CHANNEL_BED_Y,
    );
  });

  it('places a single model with its authored full rotation', async () => {
    const harness = mountBay();
    await harness.engine.ready;
    harness.runFrames(1);
    const plank = harness.scene().getObjectByName('bay-bridge-fallen-plank')?.children[0];
    expect(plank?.rotation.toArray().slice(0, 3)).toEqual([0.1, 1.15, 0.35]);
  });

  it('focuses and interacts with a prop by its entity id', async () => {
    const harness = mountBay();
    await harness.engine.ready;
    harness.setDrive(standAt(-9, 1, 0));
    harness.runFrames(1);
    expect(named(harness.events, 'InteractableFocused')).toEqual([{ entityId: 'bay-toolbox' }]);
    harness.engine.interact();
    expect(named(harness.events, 'ObjectInteracted')).toEqual([
      { entityId: 'bay-toolbox', interactionId: 'bay-toolbox:interact' },
    ]);
  });

  it('plays the treasure chest’s Open clip once, on the first interaction only', async () => {
    const harness = mountBay({ worldState: MENDED });
    await harness.engine.ready;
    harness.setDrive(standAt(9, 2, Math.PI));
    harness.runFrames(10);
    const chest = harness.scene().getObjectByName('A hidden treasure chest')
      ?.children[0] as Object3D;
    expect(chest.position.y).toBe(0);

    harness.engine.interact();
    harness.runFrames(30);
    const lifted = chest.position.y;
    expect(lifted).toBeGreaterThan(0.3);
    harness.engine.interact();
    harness.runFrames(1);
    expect(chest.position.y).toBeGreaterThanOrEqual(lifted);
  });
});

describe('the tide-trial extension on the generic runtime', () => {
  function tideApi(harness: ReturnType<typeof mountBay>): TideTrialScene {
    const api = harness.engine.extensionApi('tide-trial');
    if (!isTideTrialScene(api)) throw new Error('tide trial did not mount');
    return api;
  }

  it('hands its panel a working scene API', () => {
    expect(isTideTrialScene(mountBay().engine.extensionApi('tide-trial'))).toBe(true);
  });

  it('clears the broken bridge while a deck is built, and restores it on cancel', () => {
    const harness = mountBay();
    harness.runFrames(1);
    const stubs = harness.scene().getObjectByName('bay-bridge-stubs');
    tideApi(harness).begin(40);
    expect(stubs?.visible).toBe(false);
    tideApi(harness).cancel();
    expect(stubs?.visible).toBe(true);
  });

  it('runs a tide past the deck, reporting a rising level and moving the sea', async () => {
    const harness = mountBay();
    harness.runFrames(1);
    const sea = harness.scene().getObjectByName('bay-sea');
    const seaBefore = sea?.position.y ?? 0;
    tideApi(harness).begin(40);
    harness.runFrames(200, 16);

    const levels: number[] = [];
    const tide = tideApi(harness).runTide((cm) => levels.push(cm));
    harness.runFrames(1000, 16);
    await tide;
    expect(levels.length).toBeGreaterThan(10);
    expect(Math.max(...levels)).toBeGreaterThan(levels[0] ?? 0);
    expect(sea?.position.y).not.toBe(seaBefore);
  });

  it('opens the bridge for walking once the deck stands', () => {
    const harness = mountBay();
    tideApi(harness).complete();
    harness.setDrive(walk(FACE_EAST));
    harness.runFrames(300);
    expect(harness.camera().position.x).toBeGreaterThan(3);
  });

  it('releases a waiting tide when the scene is torn down', async () => {
    const harness = mountBay();
    const tide = tideApi(harness).runTide(() => undefined);
    harness.engine.dispose();
    await expect(tide).resolves.toBeUndefined();
  });
});
