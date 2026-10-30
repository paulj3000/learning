import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BoxGeometry, Mesh, PlaneGeometry, type Object3D, type Scene } from 'three';
import {
  MISSING_GROUND_COLOR,
  MISSING_MODEL_COLOR,
  MISSING_MODEL_SIZE,
} from './createLocationEngine';
import type { ThreeLocationManifest } from './locationManifest';
import { WELCOME_HARBOR_MANIFEST } from './manifests/welcomeHarbor';
import { FACE_SOUTH, mount, named, standAt, standingBox } from './testing/engineHarness';

/**
 * TR-7a: a model that cannot be resolved or loaded still leaves something
 * visible and usable in its place, sized from the manifest, and the cause is
 * logged rather than swallowed. Generic: nothing here is about one region.
 */

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  warn.mockRestore();
});

const PROP_SIZE = { width: 1.2, height: 2, depth: 0.8 };

/** Welcome Harbor plus one of each kind of entity that loads a model, all named `missing-*`. */
const MANIFEST: ThreeLocationManifest = {
  ...WELCOME_HARBOR_MANIFEST,
  npcs: WELCOME_HARBOR_MANIFEST.npcs.map((npc) => ({
    ...npc,
    placeholderSize: { width: 0.7, height: 1.6, depth: 0.7 },
  })),
  props: [
    {
      entityId: 'missing-chest',
      assetId: 'missing-chest-model',
      position: { x: 0, z: 6.5 },
      label: 'Chest',
      placeholderSize: PROP_SIZE,
    },
  ],
  collectibles: [
    {
      entityId: 'missing-coin',
      assetId: 'missing-coin-model',
      position: { x: 3, z: 3 },
      label: 'Coin',
    },
  ],
  scenery: [
    ...WELCOME_HARBOR_MANIFEST.scenery,
    {
      kind: 'MODEL',
      id: 'missing-wreck',
      assetId: 'missing-wreck-model',
      position: { x: -4, y: 0, z: -4 },
      scale: { x: 2, y: 2, z: 2 },
      placeholderSize: { width: 1, height: 0.5, depth: 3 },
    },
  ],
};

function failMissing(assetId: string) {
  if (assetId.startsWith('missing-')) return Promise.reject(new Error(`404 ${assetId}`));
  return Promise.resolve(standingBox());
}

function standIns(scene: Scene): Mesh[] {
  const found: Mesh[] = [];
  scene.traverse((node: Object3D) => {
    if (node.name.startsWith('missing-model:')) found.push(node as Mesh);
  });
  return found;
}

function boxSize(mesh: Mesh) {
  const { width, height, depth } = (mesh.geometry as BoxGeometry).parameters;
  return { width, height, depth };
}

function colorOf(mesh: Mesh): number {
  return (mesh.material as unknown as { color: { getHex(): number } }).color.getHex();
}

describe('TR-7a: placeholders for models that fail to load', () => {
  it('draws a sized stand-in for a prop, a collectible and a scenery model, and logs each cause', async () => {
    const harness = mount({ manifest: MANIFEST, loadModel: failMissing });
    await expect(harness.engine.ready).resolves.toBeUndefined();
    harness.runFrames(1);
    const byAsset = new Map(standIns(harness.scene()).map((mesh) => [mesh.name, mesh]));

    const chest = byAsset.get('missing-model:missing-chest-model');
    expect(chest && boxSize(chest)).toEqual(PROP_SIZE);
    expect(chest?.position.y).toBe(PROP_SIZE.height / 2); // standing on its spot
    expect(chest?.parent?.name).toBe('Chest');
    expect(chest && colorOf(chest)).toBe(MISSING_MODEL_COLOR);

    const coin = byAsset.get('missing-model:missing-coin-model');
    expect(coin && boxSize(coin)).toEqual(MISSING_MODEL_SIZE); // no size authored: the default

    const wreck = byAsset.get('missing-model:missing-wreck-model');
    expect(wreck && boxSize(wreck)).toEqual({ width: 1, height: 0.5, depth: 3 });
    expect(wreck?.parent?.position.toArray()).toEqual([-4, 0, -4]);
    expect(wreck?.parent?.scale.toArray()).toEqual([2, 2, 2]);

    for (const what of [
      'prop missing-chest',
      'collectible missing-coin',
      'scenery missing-wreck',
    ]) {
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(what), expect.any(Error));
    }
  });

  it('keeps a stand-in focusable and interactive, so a missing model never blocks the game', async () => {
    const harness = mount({ manifest: MANIFEST, loadModel: failMissing });
    await harness.engine.ready;
    harness.setDrive(standAt(0, 8, FACE_SOUTH));
    harness.runFrames(2);
    harness.pressInteractKey();
    expect(named(harness.events, 'ObjectInteracted')).toContainEqual({
      entityId: 'missing-chest',
      interactionId: 'missing-chest:interact',
    });
  });

  it('keeps an NPC stand-in at the authored size when its model fails', async () => {
    const harness = mount({
      manifest: MANIFEST,
      loadModel: (assetId) =>
        assetId === 'npc-pip' ? failMissing('missing-pip') : failMissing(assetId),
    });
    await harness.engine.ready;
    harness.runFrames(1);
    const pip = harness.scene().getObjectByName('Pip');
    expect(pip?.children.map((child) => boxSize(child as Mesh))).toEqual([
      { width: 0.7, height: 1.6, depth: 0.7 },
    ]);
  });

  it('lays a plain floor over the area when the ground tiles fail to load', async () => {
    const harness = mount({
      manifest: MANIFEST,
      loadModel: failMissing,
      instanced: (assetId) =>
        assetId === 'ground-tile'
          ? Promise.reject(new Error('ground tiles unavailable'))
          : Promise.resolve(new Mesh(new BoxGeometry())),
    });
    await harness.engine.ready;
    harness.runFrames(1);
    const floor = standIns(harness.scene()).find(
      (mesh) => mesh.name === 'missing-model:ground-tile',
    );
    expect(floor?.geometry).toBeInstanceOf(PlaneGeometry);
    expect(floor && colorOf(floor)).toBe(MISSING_GROUND_COLOR);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('scenery harbor-ground'),
      expect.any(Error),
    );
  });

  it('draws no stand-ins at all when every model loads', async () => {
    const harness = mount({ manifest: MANIFEST, loadModel: async () => standingBox() });
    await harness.engine.ready;
    harness.runFrames(1);
    expect(standIns(harness.scene())).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('adds nothing for a model that fails after the region was left', async () => {
    let fail: (error: Error) => void = () => undefined;
    const harness = mount({
      manifest: MANIFEST,
      loadModel: (assetId) =>
        assetId === 'missing-chest-model'
          ? new Promise((_resolve, reject) => {
              fail = reject;
            })
          : Promise.resolve(standingBox()),
    });
    harness.runFrames(1);
    const scene = harness.scene();
    harness.engine.dispose();
    fail(new Error('late 404'));
    await harness.engine.ready;
    expect(standIns(scene)).toEqual([]);
  });
});
