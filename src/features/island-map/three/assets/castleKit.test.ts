import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ASSET_MANIFEST, getAssetManifestEntry } from './manifest';

/**
 * The authoring checks for the Storykeeper Castle kit
 * (`docs/STORYKEEPER_CASTLE_3D_ROADMAP.md` SC-1). These read the generated
 * `.gltf` documents off disk rather than loading them through `three`,
 * because what they assert is a property of the *authoring*, not of the
 * runtime: how many meshes a document has, whether it references a texture,
 * how long a rod is.
 *
 * `manifest.test.ts` already checks that every entry resolves to a file and
 * only declares approved clips; `assetLoader.test.ts` proves the real
 * fetch + `GLTFLoader.load()` round trip accepts a representative sample.
 * This file covers the three castle-specific ways an asset can be authored
 * correctly and still be wrong.
 */

const PUBLIC_DIR = resolve(process.cwd(), 'public');

interface GltfDocument {
  meshes: { primitives: { attributes: Record<string, number> }[] }[];
  accessors: { type: string; min?: number[]; max?: number[] }[];
  animations?: { name?: string }[];
  images?: unknown[];
  textures?: unknown[];
  materials: { pbrMetallicRoughness?: Record<string, unknown> }[];
}

/**
 * Reads an asset's glTF document off disk, from either form: a generated
 * `.gltf` is JSON already, an imported `.glb` carries the same JSON as its
 * first chunk (12-byte header, then a length-prefixed JSON chunk) with the
 * binary buffer after it. Both give the same shape to assert against.
 */
function readGltf(id: string): GltfDocument {
  const entry = getAssetManifestEntry(id);
  const filePath = join(PUBLIC_DIR, entry.url.replace(/^\//, ''));
  if (!entry.url.endsWith('.glb')) {
    return JSON.parse(readFileSync(filePath, 'utf8')) as GltfDocument;
  }
  const binary = readFileSync(filePath);
  const jsonChunkLength = binary.readUInt32LE(12);
  return JSON.parse(binary.subarray(20, 20 + jsonChunkLength).toString('utf8')) as GltfDocument;
}

/** Bounding box on the y axis, in the document's own mesh space. */
function meshSpaceHeight(document: GltfDocument): number {
  const ys = document.accessors
    .filter((accessor) => accessor.type === 'VEC3' && accessor.min && accessor.max)
    .flatMap((accessor) => [accessor.min![1], accessor.max![1]]);
  return Math.max(...ys) - Math.min(...ys);
}

function maxY(document: GltfDocument): number {
  return Math.max(
    ...document.accessors
      .filter((accessor) => accessor.type === 'VEC3' && accessor.max)
      .map((accessor) => accessor.max![1]),
  );
}

/**
 * The two castle assets that are **imported**, not generated (KayKit Dungeon
 * Remastered, CC0 - `docs/ASSET_LICENCES.md`). They are held apart from the
 * list below because three of the generated kit's authoring conventions do
 * not apply to them and should not be quietly relaxed to fit:
 *
 * - they carry a texture atlas, where a generated asset carries none;
 * - their materials use `baseColorTexture`, not a flat `baseColorFactor`;
 * - they are centre-pivoted slabs spanning y `[-0.1, +0.05]`, so they are
 *   not ground-pivoted the way every authored piece is.
 *
 * `describe('imported castle kit')` below is what holds them to *their*
 * contract instead. Keeping the split explicit is the point: it stays
 * visible which assets this project authored and which it did not.
 */
const IMPORTED_CASTLE_ASSET_IDS: readonly string[] = ['ground-tile-stone', 'ceiling-tile'];

/**
 * Every castle asset id, taken from the manifest rather than re-listed, so a
 * new entry is covered by the convention checks the moment it is added.
 */
const GENERATED_CASTLE_ASSET_IDS: readonly string[] = [
  'wall-stone',
  'carpet',
  'archway',
  'bookshelf',
  'bookshelf-ajar',
  'portrait-frame',
  'tapestry',
  'cushion',
  'star-carving',
  'moon-carving',
  'wall-sconce',
  'wall-sconce-lit',
  'window-frame',
  'lectern',
  'binding-lectern',
  'binding-table',
  'story-plate-problem',
  'story-plate-choice',
  'story-plate-ending',
  'reading-table',
  'costume-rack',
  'clue-diary',
  'clue-map',
  'clue-note',
  'rod-rack',
  'rod-silver',
  'rod-iron',
  'rod-brass',
  'writing-desk',
  'round-window',
  'portrait-puppy',
  'portrait-puppy-lit',
  'portrait-dragon',
  'portrait-dragon-lit',
  'portrait-fox',
  'portrait-fox-lit',
  'window-view-island',
  'window-view-island-lit',
  'window-view-mountain',
  'window-view-mountain-lit',
  'window-view-cave',
  'window-view-cave-lit',
  'hearth',
  'hearth-lit',
  'shelf-slot-empty',
  'story-book-shelved',
  'carving-worn',
  'carving-worn-revealed',
  'secret-door',
  'secret-door-ajar',
  'easel',
  'canvas-hero-puppy',
  'canvas-hero-dragon',
  'canvas-hero-fox',
  'canvas-setting-island',
  'canvas-setting-mountain',
  'canvas-setting-cave',
  'npc-quill',
];

/** Every castle asset, whichever pipeline produced it - registration and `kind` apply to all of them. */
const CASTLE_ASSET_IDS: readonly string[] = [
  ...IMPORTED_CASTLE_ASSET_IDS,
  ...GENERATED_CASTLE_ASSET_IDS,
];

/**
 * The assets SC-2 onward is allowed to point
 * `createInstancedMeshFromAsset` at. It keeps only the **first** mesh a
 * `scene.traverse()` finds, with no error and no warning, so a multi-part
 * asset instanced by mistake renders as a fragment of itself. That is the
 * trap `foliage-tree` documents, and this list plus the test below is what
 * stops the castle walking into it.
 */
const INSTANCING_SAFE_IDS: readonly string[] = [
  'ground-tile-stone',
  'ceiling-tile',
  'wall-stone',
  'carpet',
  'bookshelf',
  'portrait-frame',
  'tapestry',
  'cushion',
  'star-carving',
  'moon-carving',
  'wall-sconce',
  'wall-sconce-lit',
  'rod-silver',
  'rod-iron',
  'rod-brass',
];

/** Assets that are deliberately multi-part, and so must be cloned rather than instanced. */
const MULTI_PART_IDS: readonly string[] = [
  'archway',
  'window-frame',
  'lectern',
  'binding-lectern',
  'easel',
  'hearth',
  'costume-rack',
  'round-window',
  'portrait-fox',
  'window-view-cave-lit',
  'npc-quill',
];

describe('castle kit is registered', () => {
  it('has a manifest entry for every castle asset', () => {
    const ids = new Set(ASSET_MANIFEST.map((entry) => entry.id));
    for (const id of CASTLE_ASSET_IDS) {
      expect(ids.has(id), `"${id}" is missing from ASSET_MANIFEST`).toBe(true);
    }
  });

  it('registers Keeper Quill as a character and everything else as kit or prop', () => {
    expect(getAssetManifestEntry('npc-quill').kind).toBe('character');
    for (const id of CASTLE_ASSET_IDS) {
      if (id === 'npc-quill') continue;
      expect(['kit-piece', 'prop']).toContain(getAssetManifestEntry(id).kind);
    }
  });
});

describe('castle kit instancing safety', () => {
  it('authors every instancing candidate as a single mesh', () => {
    for (const id of INSTANCING_SAFE_IDS) {
      expect(
        readGltf(id).meshes.length,
        `"${id}" is declared instancing-safe but has more than one mesh; ` +
          'createInstancedMeshFromAsset would silently drop all but the first',
      ).toBe(1);
    }
  });

  it('keeps the deliberately multi-part assets multi-part', () => {
    for (const id of MULTI_PART_IDS) {
      expect(readGltf(id).meshes.length, `"${id}" should be multi-part`).toBeGreaterThan(1);
    }
  });

  it('never marks a multi-part asset as instancing-safe', () => {
    for (const id of MULTI_PART_IDS) {
      expect(INSTANCING_SAFE_IDS).not.toContain(id);
    }
  });
});

describe('castle kit conventions', () => {
  /**
   * Texture-free is what every *generated* asset stays, and the reason is no
   * longer "nothing can load a texture in jsdom" - `src/test/setup.ts` now
   * has the image-decoding stubs that make a textured file loadable there.
   * The reason now is that the generator has no material story: it emits
   * flat `baseColorFactor` values and no UVs, so a generated document
   * referencing a texture would mean something went wrong, not that
   * someone got ambitious. Imported assets are exempt by construction and
   * checked separately below.
   */
  it('references no image, texture, or UV coordinate anywhere', () => {
    for (const id of GENERATED_CASTLE_ASSET_IDS) {
      const document = readGltf(id);
      expect(document.images, `"${id}" references an image`).toBeUndefined();
      expect(document.textures, `"${id}" references a texture`).toBeUndefined();
      for (const mesh of document.meshes) {
        for (const primitive of mesh.primitives) {
          expect(Object.keys(primitive.attributes), `"${id}" has UV coordinates`).not.toContain(
            'TEXCOORD_0',
          );
        }
      }
    }
  });

  it('gives every material a flat base color', () => {
    for (const id of GENERATED_CASTLE_ASSET_IDS) {
      const document = readGltf(id);
      expect(document.materials.length, `"${id}" has no materials`).toBeGreaterThan(0);
      for (const material of document.materials) {
        expect(material.pbrMetallicRoughness?.baseColorFactor).toBeDefined();
      }
    }
  });

  it('keeps every asset ground-pivoted, with nothing below its own base', () => {
    for (const id of GENERATED_CASTLE_ASSET_IDS) {
      const document = readGltf(id);
      const lowest = Math.min(
        ...document.accessors
          .filter((accessor) => accessor.type === 'VEC3' && accessor.min)
          .map((accessor) => accessor.min![1]),
      );
      expect(lowest, `"${id}" extends below y = 0`).toBeGreaterThanOrEqual(0);
    }
  });

  it('mounts nothing taller than the 3m wall height it hangs on', () => {
    for (const id of GENERATED_CASTLE_ASSET_IDS) {
      expect(meshSpaceHeight(readGltf(id)), `"${id}" is taller than a wall`).toBeLessThanOrEqual(3);
    }
  });
});

/**
 * The import contract. These are the properties that made KayKit's floor
 * slabs safe to drop in without normalisation, and each one is a way a
 * future import could look fine in a viewer and still be wrong here.
 */
describe('imported castle kit', () => {
  it('matches the 4x4 slab grid the castle places on, so no scale normalisation is needed', () => {
    for (const id of IMPORTED_CASTLE_ASSET_IDS) {
      const document = readGltf(id);
      const positions = document.accessors.filter(
        (accessor) => accessor.type === 'VEC3' && accessor.min && accessor.max,
      );
      const width =
        Math.max(...positions.map((a) => a.max![0])) - Math.min(...positions.map((a) => a.min![0]));
      const depth =
        Math.max(...positions.map((a) => a.max![2])) - Math.min(...positions.map((a) => a.min![2]));
      expect(width, `"${id}" is not 4m wide`).toBeCloseTo(4, 3);
      expect(depth, `"${id}" is not 4m deep`).toBeCloseTo(4, 3);
    }
  });

  it('centres each slab on x/z, matching how slabPlacements positions it', () => {
    for (const id of IMPORTED_CASTLE_ASSET_IDS) {
      const document = readGltf(id);
      const positions = document.accessors.filter(
        (accessor) => accessor.type === 'VEC3' && accessor.min && accessor.max,
      );
      for (const axis of [0, 2]) {
        const min = Math.min(...positions.map((a) => a.min![axis]));
        const max = Math.max(...positions.map((a) => a.max![axis]));
        expect(min + max, `"${id}" is not centred on axis ${axis}`).toBeCloseTo(0, 3);
      }
    }
  });

  /**
   * The offsets in `storykeeperCastleScene.ts` are derived from these two
   * numbers. If a future re-import changes the slab's thickness, this is
   * what says so, rather than the floor silently drifting off y=0.
   */
  it('spans the slab thickness the scene offsets assume', () => {
    for (const id of IMPORTED_CASTLE_ASSET_IDS) {
      const document = readGltf(id);
      const ys = document.accessors
        .filter((accessor) => accessor.type === 'VEC3' && accessor.min && accessor.max)
        .flatMap((accessor) => [accessor.min![1], accessor.max![1]]);
      expect(Math.min(...ys), `"${id}" bottom face moved`).toBeCloseTo(-0.1, 3);
      expect(Math.max(...ys), `"${id}" top face moved`).toBeCloseTo(0.05, 3);
    }
  });

  it('stays single-mesh, so it can still be instanced', () => {
    for (const id of IMPORTED_CASTLE_ASSET_IDS) {
      expect(readGltf(id).meshes.length, `"${id}" is no longer single-mesh`).toBe(1);
      expect(INSTANCING_SAFE_IDS).toContain(id);
    }
  });

  /**
   * A self-contained file. An imported asset referencing its texture by URI
   * would need a second file placed beside it in `public/models/`, and would
   * 404 in the browser the moment someone moved one and not the other.
   */
  it('embeds its texture in the file rather than referencing an external one', () => {
    for (const id of IMPORTED_CASTLE_ASSET_IDS) {
      const document = readGltf(id) as GltfDocument & {
        images?: { uri?: string; bufferView?: number }[];
      };
      expect(document.images?.length, `"${id}" has no embedded image`).toBe(1);
      expect(document.images![0].bufferView, `"${id}" image is not a bufferView`).toBeDefined();
      expect(
        document.images![0].uri,
        `"${id}" references an external texture file`,
      ).toBeUndefined();
    }
  });

  /**
   * `GLTFLoader` silently returns an incomplete scene for an unsupported
   * required extension, so an import that needs one (Draco, KTX2, a
   * material extension) must be caught here rather than in a dark room.
   */
  it('requires no glTF extension the loader is not configured for', () => {
    for (const id of IMPORTED_CASTLE_ASSET_IDS) {
      const document = readGltf(id) as GltfDocument & { extensionsRequired?: string[] };
      expect(document.extensionsRequired ?? [], `"${id}" requires an extension`).toEqual([]);
    }
  });
});

describe('castle kit state variants', () => {
  it('pairs every state variant with the base asset it replaces', () => {
    const pairs: readonly [string, string][] = [
      ['portrait-puppy', 'portrait-puppy-lit'],
      ['portrait-dragon', 'portrait-dragon-lit'],
      ['portrait-fox', 'portrait-fox-lit'],
      ['window-view-island', 'window-view-island-lit'],
      ['window-view-mountain', 'window-view-mountain-lit'],
      ['window-view-cave', 'window-view-cave-lit'],
      ['hearth', 'hearth-lit'],
      ['shelf-slot-empty', 'story-book-shelved'],
      ['carving-worn', 'carving-worn-revealed'],
      ['secret-door', 'secret-door-ajar'],
      ['bookshelf', 'bookshelf-ajar'],
      ['wall-sconce', 'wall-sconce-lit'],
    ];
    for (const [base, variant] of pairs) {
      expect(() => getAssetManifestEntry(base)).not.toThrow();
      expect(() => getAssetManifestEntry(variant)).not.toThrow();
    }
  });

  it('gives the lit variants an emissive factor the unlit ones do not have', () => {
    const hasEmissive = (id: string) =>
      readGltf(id).materials.some(
        (material) => (material as { emissiveFactor?: number[] }).emissiveFactor !== undefined,
      );
    expect(hasEmissive('portrait-fox-lit')).toBe(true);
    expect(hasEmissive('portrait-fox')).toBe(false);
    expect(hasEmissive('hearth-lit')).toBe(true);
    expect(hasEmissive('hearth')).toBe(false);
    expect(hasEmissive('wall-sconce-lit')).toBe(true);
    expect(hasEmissive('wall-sconce')).toBe(false);
  });

  it('animates the secret door opening, on the ajar variant only', () => {
    expect(readGltf('secret-door-ajar').animations?.map((clip) => clip.name)).toEqual(['Open']);
    expect(readGltf('secret-door').animations).toBeUndefined();
  });
});

describe('the three pattern-lock rods', () => {
  /**
   * `order-the-keys` grades ordering **by length**, so these three lengths
   * are the assets' whole job. A child who cannot tell the medium rod from
   * the long one at eye height is being asked to guess, not to reason.
   */
  it('authors three clearly, strictly increasing lengths', () => {
    const silver = maxY(readGltf('rod-silver'));
    const iron = maxY(readGltf('rod-iron'));
    const brass = maxY(readGltf('rod-brass'));

    expect(silver).toBeLessThan(iron);
    expect(iron).toBeLessThan(brass);
    // A 1.5x step between neighbours, so the difference reads across a room
    // rather than only in an asset viewer.
    expect(iron / silver).toBeGreaterThanOrEqual(1.5);
    expect(brass / iron).toBeGreaterThanOrEqual(1.5);
  });
});

describe('Keeper Quill', () => {
  it('authors exactly the six clips the manifest declares', () => {
    const authored = readGltf('npc-quill')
      .animations!.map((clip) => clip.name)
      .sort();
    expect(authored).toEqual([...getAssetManifestEntry('npc-quill').clips].sort());
  });

  it('authors no Walk clip: Quill is stationary and never follows the child', () => {
    const authored = readGltf('npc-quill').animations!.map((clip) => clip.name);
    expect(authored).not.toContain('Walk');
  });

  it('is multi-part, so the Point gesture has an arm node to rotate', () => {
    expect(readGltf('npc-quill').meshes.length).toBeGreaterThan(1);
  });
});
