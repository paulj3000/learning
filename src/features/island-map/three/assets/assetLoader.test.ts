import { InstancedMesh, LOD } from 'three';
import { describe, expect, it } from 'vitest';
import {
  createInstancedMeshFromAsset,
  instantiateAsset,
  instantiateWithLod,
  loadAsset,
} from './assetLoader';

/**
 * Integration smoke tests: these exercise the real `GLTFLoader.load()`
 * (fetch-based) path against real generated files, via the narrow `fetch`
 * polyfill in `src/test/setup.ts` - proof that
 * `scripts/generate-world-assets.ts`'s output is valid glTF a real fetch +
 * `GLTFLoader.load()` round trip accepts, not just `GLTFLoader.parse()`
 * (already covered per-document in `gltfAssembler.test.ts`). Kept to a
 * small representative set (one static kit piece, one animated character,
 * one instanced kit piece, one LOD pair), per
 * `docs/THREE_WORLD_ASSET_CONVENTIONS.md`'s testing section - not a
 * per-asset suite.
 */
describe('loadAsset', () => {
  it('loads a static kit piece via the real fetch-based GLTFLoader.load() path', async () => {
    const gltf = await loadAsset('wall');
    const mesh = gltf.scene.getObjectByName('Wall');
    expect(mesh).toBeDefined();
  });

  it('caches by id: a second load for the same id resolves without a second fetch', async () => {
    const first = await loadAsset('rock');
    const second = await loadAsset('rock');
    expect(second).toBe(first);
  });

  it('rejects for an unknown asset id', async () => {
    await expect(loadAsset('does-not-exist')).rejects.toThrow(/unknown asset id/);
  });
});

describe('instantiateAsset', () => {
  it('loads the animated NPC with its declared clips', async () => {
    const gltf = await loadAsset('npc-pip');
    expect(gltf.animations.map((clip) => clip.name).sort()).toEqual(['Idle', 'Talk', 'Wave']);
  });

  it('returns an independent clone each call', async () => {
    const first = await instantiateAsset('npc-pip');
    const second = await instantiateAsset('npc-pip');
    expect(first).not.toBe(second);
    expect(first.getObjectByName('Body')).toBeDefined();
  });
});

describe('createInstancedMeshFromAsset', () => {
  it('builds one InstancedMesh with one matrix per placement, from a loaded kit piece', async () => {
    const placements = [
      { position: { x: 0, y: 0, z: 0 } },
      { position: { x: 1, y: 0, z: 1 }, rotationY: Math.PI / 2 },
      { position: { x: -1, y: 0, z: 1 } },
    ];
    const instanced = await createInstancedMeshFromAsset('foliage-bush', placements);
    expect(instanced).toBeInstanceOf(InstancedMesh);
    expect(instanced.count).toBe(placements.length);
  });
});

describe('instantiateWithLod', () => {
  it('builds a THREE.LOD with two levels for an asset that declares one', async () => {
    const result = await instantiateWithLod('foliage-tree');
    expect(result).toBeInstanceOf(LOD);
    expect((result as LOD).levels).toHaveLength(2);
  });

  it('falls back to a plain instantiated asset for an asset with no lod entry', async () => {
    const result = await instantiateWithLod('wall');
    expect(result).not.toBeInstanceOf(LOD);
  });
});
