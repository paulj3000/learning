import { InstancedMesh, LOD, type Mesh, type MeshStandardMaterial } from 'three';
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

  /**
   * SC-1 added the Storykeeper Castle kit
   * (`docs/STORYKEEPER_CASTLE_3D_ROADMAP.md` Appendix A). One case per new
   * shape category, same representative-sample discipline as above rather
   * than a per-asset suite - the castle's own authoring checks live in
   * `castleKit.test.ts`.
   */
  it('loads a castle kit piece through the same real fetch path', async () => {
    const gltf = await loadAsset('wall-stone');
    expect(gltf.scene.getObjectByName('Wall')).toBeDefined();
  });

  it('loads a multi-part castle prop with every part intact', async () => {
    const gltf = await loadAsset('archway');
    for (const part of ['JambLeft', 'JambRight', 'Lintel']) {
      expect(gltf.scene.getObjectByName(part), `archway is missing "${part}"`).toBeDefined();
    }
  });

  /**
   * WF-1 added the Wonderwild Forest kit
   * (`docs/WONDERWILD_FOREST_3D_ROADMAP.md` Appendix A). One case for its one
   * genuinely new shape category - the hexagonal ring, which is the first
   * primitive in this pack with a hole through it - plus the character.
   * Wonderwild's own authoring checks live in `wonderwildKit.test.ts`.
   */
  it('loads the hexagonal comb cell, hole and all, through the real fetch path', async () => {
    const gltf = await loadAsset('comb-cell');
    expect(gltf.scene.getObjectByName('Cell')).toBeDefined();
  });

  /**
   * The first **imported**, binary, textured asset (KayKit Dungeon
   * Remastered, CC0 - `docs/ASSET_LICENCES.md`), which exercises three
   * things no generated `.gltf` did: the `.glb` container, a `bufferView`
   * PNG texture, and therefore the image-decoding stubs in
   * `src/test/setup.ts`. Without those stubs this call does not fail, it
   * hangs - `GLTFLoader` waits forever on a `load` event jsdom never fires -
   * which is the failure mode worth having a named test for.
   */
  it('loads an imported textured .glb, texture wired onto the mesh', async () => {
    const gltf = await loadAsset('ground-tile-stone');
    const mesh = gltf.scene.getObjectByName('floor_tile_large') as Mesh | undefined;
    expect(mesh).toBeDefined();
    const material = mesh!.material as MeshStandardMaterial;
    expect(material.map, 'the atlas texture did not reach the material').not.toBeNull();
  });
});

describe('instantiateAsset', () => {
  it('loads the animated NPC with its declared clips', async () => {
    const gltf = await loadAsset('npc-pip');
    expect(gltf.animations.map((clip) => clip.name).sort()).toEqual(['Idle', 'Talk', 'Wave']);
  });

  it('loads Keeper Quill with all six clips and an arm to point with', async () => {
    const gltf = await loadAsset('npc-quill');
    expect(gltf.animations.map((clip) => clip.name).sort()).toEqual([
      'Celebrate',
      'Idle',
      'Point',
      'ReactConcerned',
      'Talk',
      'Wave',
    ]);
    const clone = await instantiateAsset('npc-quill');
    expect(clone.getObjectByName('Body')).toBeDefined();
    expect(clone.getObjectByName('Arm')).toBeDefined();
  });

  it('loads Buzz with her three clips and the abdomen the scene waggles', async () => {
    const gltf = await loadAsset('npc-buzz');
    expect(gltf.animations.map((clip) => clip.name).sort()).toEqual(['Celebrate', 'Idle', 'Talk']);
    const clone = await instantiateAsset('npc-buzz');
    expect(clone.getObjectByName('Body')).toBeDefined();
    // Beat 7's five waggles are TRS motion the scene drives on this node, not
    // a clip - so the node has to survive cloning even though no animation in
    // the document targets it.
    expect(clone.getObjectByName('Abdomen')).toBeDefined();
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

  /**
   * The hive wall places roughly forty comb cells, so instancing them is not
   * optional. This is the runtime half of the claim `wonderwildKit.test.ts`
   * makes about the document: one mesh on disk, and one real `InstancedMesh`
   * with the hole intact after `createInstancedMeshFromAsset` has taken the
   * first mesh it found.
   */
  it('instances the comb cell, keeping the whole ring rather than a fragment', async () => {
    const placements = [{ position: { x: 0, y: 0, z: 0 } }, { position: { x: 1.3, y: 0, z: 0 } }];
    const instanced = await createInstancedMeshFromAsset('comb-cell', placements);
    expect(instanced).toBeInstanceOf(InstancedMesh);
    expect(instanced.count).toBe(placements.length);
    // 96 vertices is the whole ring; a fragment would be a fraction of that.
    expect(instanced.geometry.getAttribute('position').count).toBe(96);
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
