import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AnimationClip,
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  NumberKeyframeTrack,
  type Object3D,
} from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { read } from '../../api/parse';
import * as parse from '../../api/play/parse';
import type { ApiClient } from '../../api/client';
import { ApiError } from '../../api/errors';
import { createDjangoAssetResolver } from '../../api/assets/djangoAssetResolver';
import { createAssetLoader } from '../island-map/three/assets/assetLoader';
import { BUNDLED_ASSET_RESOLVER } from '../island-map/three/assets/assetResolver';
import { DEFAULT_LOCATION_ENGINE_DEPS } from '../island-map/three/runtime/createLocationEngine';
import type { LocationManifestRepository } from '../island-map/three/runtime/locationManifestRepository';
import { mount } from '../island-map/three/runtime/testing/engineHarness';
import {
  regionPlaySceneExtension,
  type RegionPlaySceneApi,
} from '../island-map/three/extensions/regionPlay/regionPlayScene';
import { publishRegionCheckpoints, unpublishRegionCheckpoints } from '../discovery/checkpoints';
import { bootstrapJson } from '../../test/playFixtures';
import { engineAssetsFrom, regionAssetsFor } from './regionAssets';
import { buildRegionManifest } from './regionManifest';
import { toRegionSceneModel } from './sceneModel';

/**
 * TR-10: Treasure Cove's models come from the Django asset manager. The
 * engine, the region-play extension, the shared loader and the Django
 * resolver are the production code; only the HTTP client and the GLTF fetch
 * are fakes, so no browser is involved.
 */

const REGION = 'treasure-rush-cove';
const NOW = Date.parse('2026-10-30T12:00:00Z');
const EXPIRES = '2026-10-30T13:00:00Z';
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const SOURCE: LocationManifestRepository = {
  getPublished: () => Promise.reject(new Error('not used')),
  listRegionIds: () => ['welcome-harbor'],
};

/** What Django publishes, by asset id: the delivery URL of the default version. */
type Published = Record<string, string>;

function djangoClient(published: Published) {
  const request = vi.fn(async (_method: string, path: string) => {
    const ids = decodeURIComponent(path.split('?ids=')[1] ?? '').split(',');
    return {
      status: 200,
      data: {
        assets: ids.map((id) =>
          published[id]
            ? { ref: id, id, status: 'resolved', url: published[id], urlExpiresAt: EXPIRES }
            : { ref: id, id, status: 'unavailable' },
        ),
      },
    };
  });
  return { client: { request } as unknown as ApiClient, request };
}

/** A chest whose `Open` clip swings a node named `lid`, tagged with where it came from. */
function chest(from: string): GLTF {
  const scene = new Group();
  scene.name = from;
  const lid = new Mesh(new BoxGeometry(1, 0.3, 1), new MeshBasicMaterial());
  lid.name = 'lid';
  scene.add(new Mesh(new BoxGeometry(1, 0.6, 1), new MeshBasicMaterial()), lid);
  const open = new AnimationClip('Open', 1, [
    new NumberKeyframeTrack('lid.rotation[x]', [0, 1], [0, -1.5]),
  ]);
  return { scene, animations: [open] } as unknown as GLTF;
}

function figure(from: string): GLTF {
  const geometry = new BoxGeometry(0.6, 1.8, 0.6);
  geometry.translate(0, 0.9, 0);
  const scene = new Mesh(geometry, new MeshBasicMaterial());
  scene.name = from;
  return {
    scene,
    animations: ['Idle', 'Talk', 'Wave'].map((name) => new AnimationClip(name, 1, [])),
  } as unknown as GLTF;
}

/** The fixture's Pip, placed with the catalogue model as the Treasure Cove seed does. */
const PIP_WITH_MODEL = {
  entityId: 'cove-pip',
  label: 'Pirate Pip',
  x: 3,
  z: 6,
  elevation: 0,
  rotationY: 0,
  scale: 1,
  assetId: 'npc-pip',
  placeholder: { width: 1, height: 1.6, depth: 1 },
  npcId: 'pirate-pip',
  displayName: 'Pirate Pip',
  interactionId: 'meet-pirate-pip',
};

/** One visit: its own resolver and loader, as `regionAssetsFor` makes per visit. */
function visit(
  published: Published,
  options: { client?: ApiClient; chest?: Record<string, unknown> } = {},
) {
  const django = djangoClient(published);
  const client = options.client ?? django.client;
  const fetched: string[] = [];
  const loader = createAssetLoader(
    createDjangoAssetResolver({ client, childId: 'child-1', now: () => NOW }),
    async (url) => {
      fetched.push(url);
      if (url.includes('chest')) return chest(url);
      return figure(url); // Pip, and the ground tile the real instancing path needs a mesh from
    },
  );
  const assets = engineAssetsFrom(loader);
  const model = toRegionSceneModel(
    read(bootstrapJson({ npcs: [PIP_WITH_MODEL] }, options.chest ?? {}), parse.regionBootstrap),
  );
  const built = buildRegionManifest(model, {
    worldSlug: 'learning-adventure-island',
    assetClips: (id) => (id === 'npc-pip' ? ['Idle', 'Talk', 'Wave'] : []),
  });
  publishRegionCheckpoints(REGION, built.checkpoints);
  const harness = mount({
    manifest: built.manifest,
    extensions: [regionPlaySceneExtension],
    loadModel: assets.loadModel,
    instanced: assets.instanced,
  });
  const sceneApi = () => harness.engine.extensionApi('region-play') as RegionPlaySceneApi;
  const chestRoot = () => harness.scene().getObjectByName('Treasure chest') as Object3D;
  return { harness, fetched, loader, request: django.request, sceneApi, chestRoot };
}

const DJANGO_CHEST_V1 = '/api/v1/asset-files/chest-v1/model.glb';
const DJANGO_CHEST_V2 = '/api/v1/asset-files/chest-v2/model.glb';
const DJANGO_PIP = 'https://lai-assets.s3.example.test/assets/models/npc-pip/abc/model.glb?sig=1';

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  unpublishRegionCheckpoints(REGION);
  vi.restoreAllMocks();
});

describe('regionAssetsFor', () => {
  const enabled = { enabled: true as const, baseUrl: '' };

  it('keeps the bundled loader in a build without the Django API', () => {
    expect(regionAssetsFor('child-1', REGION, SOURCE, { enabled: false })).toBe(
      DEFAULT_LOCATION_ENGINE_DEPS.assets,
    );
  });

  it('keeps the bundled loader for a source-controlled region', () => {
    const resolverFor = vi.fn();
    expect(regionAssetsFor('child-1', 'welcome-harbor', SOURCE, enabled, resolverFor)).toBe(
      DEFAULT_LOCATION_ENGINE_DEPS.assets,
    );
    expect(resolverFor).not.toHaveBeenCalled();
  });

  it('resolves a Django region through this child’s asset resolver', async () => {
    const resolve = vi.fn(async (id: string) => ({
      id,
      url: `/api/v1/asset-files/${id}/model.glb`,
      source: 'PUBLISHED' as const,
    }));
    const resolverFor = vi.fn(() => ({ resolve }));
    const assets = regionAssetsFor('child-1', REGION, SOURCE, enabled, resolverFor);
    expect(assets).not.toBe(DEFAULT_LOCATION_ENGINE_DEPS.assets);
    expect(resolverFor).toHaveBeenCalledWith('child-1', enabled);
    // The real GLTF fetch is not available in jsdom; resolving is what this asserts.
    await assets.loadModel('npc-pip').catch(() => undefined);
    expect(resolve).toHaveBeenCalledWith('npc-pip');
  });

  it('gives every visit its own loader, so a new publication is picked up on re-entry', () => {
    const resolverFor = vi.fn(() => BUNDLED_ASSET_RESOLVER);
    regionAssetsFor('child-1', REGION, SOURCE, enabled, resolverFor);
    regionAssetsFor('child-1', REGION, SOURCE, enabled, resolverFor);
    expect(resolverFor).toHaveBeenCalledTimes(2);
  });
});

describe('Treasure Cove with the Django asset manager (TR-10)', () => {
  it('loads Pip and the chest from their published versions, in one request', async () => {
    const cove = visit({ 'npc-pip': DJANGO_PIP, 'treasure-chest': DJANGO_CHEST_V1 });
    await cove.harness.engine.ready;
    await flush();
    expect(cove.fetched).toContain(DJANGO_PIP);
    expect(cove.fetched.some((url) => url.endsWith(DJANGO_CHEST_V1))).toBe(true);
    expect(cove.request).toHaveBeenCalledTimes(1);
    expect(cove.request.mock.calls[0]?.[1]).toMatch(/^children\/child-1\/assets\/\?ids=/);
  });

  it('keeps the animation clips of a Django model: the chest opens with its own Open clip', async () => {
    const cove = visit({ 'treasure-chest': DJANGO_CHEST_V1 });
    await cove.loader.loadAsset('treasure-chest'); // the same cached load the chest is waiting on
    await flush();
    cove.harness.runFrames(1);
    expect(cove.chestRoot().getObjectByName('region-play:built-chest')).toBeUndefined();
    const lid = cove.chestRoot().getObjectByName('lid') as Object3D;
    expect(lid.rotation.x).toBeCloseTo(0);
    cove.sceneApi().setChestOpen('cove-chest', true);
    cove.harness.runFrames(90, 16);
    expect(lid.rotation.x).toBeCloseTo(-1.5);
    const pip = await cove.loader.loadAsset('npc-pip');
    expect(pip.animations.map((clip) => clip.name)).toEqual(['Idle', 'Talk', 'Wave']);
  });

  it('shows a newly published default on the next visit, with no rebuild', async () => {
    const first = visit({ 'treasure-chest': DJANGO_CHEST_V1 });
    await first.harness.engine.ready;
    await flush();
    first.harness.engine.dispose();
    // An administrator publishes version 2 and makes it the default.
    const second = visit({ 'treasure-chest': DJANGO_CHEST_V2 });
    await second.harness.engine.ready;
    await flush();
    expect(first.fetched.some((url) => url.endsWith(DJANGO_CHEST_V1))).toBe(true);
    expect(second.fetched.some((url) => url.endsWith(DJANGO_CHEST_V2))).toBe(true);
    expect(second.fetched.some((url) => url.endsWith(DJANGO_CHEST_V1))).toBe(false);
  });

  it('falls back to the bundled file for an id with nothing published, and says so', async () => {
    const cove = visit({ 'treasure-chest': DJANGO_CHEST_V1 });
    await cove.harness.engine.ready;
    await flush();
    expect(cove.fetched.some((url) => url.endsWith('/models/npc-pip.gltf'))).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"npc-pip" is unavailable'));
  });

  it('plays on bundled files when the asset request fails, and warns instead of hiding it', async () => {
    const request = vi.fn().mockRejectedValue(new ApiError('forbidden', { status: 403 }));
    const cove = visit({}, { client: { request } as unknown as ApiClient });
    await cove.harness.engine.ready;
    await flush();
    expect(cove.fetched.some((url) => url.endsWith('/models/treasure-chest.gltf'))).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('request failed (forbidden 403)'));
  });

  it('keeps the built chest, and reports why, when neither Django nor the bundle has the model', async () => {
    const cove = visit({}, { chest: { assetId: 'no-such-chest' } });
    await cove.harness.engine.ready;
    await flush();
    cove.harness.runFrames(1);
    expect(cove.chestRoot().getObjectByName('region-play:built-chest')).toBeDefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('could not load "no-such-chest"'),
      expect.any(Error),
    );
  });

  it('places the ground tiles from the asset manager too', async () => {
    const cove = visit({ 'ground-tile': '/api/v1/asset-files/ground-v1/model.glb' });
    await cove.harness.engine.ready;
    expect(
      cove.fetched.some((url) => url.endsWith('/api/v1/asset-files/ground-v1/model.glb')),
    ).toBe(true);
  });
});
