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

function readGltf(id: string): GltfDocument {
  const entry = getAssetManifestEntry(id);
  return JSON.parse(
    readFileSync(join(PUBLIC_DIR, entry.url.replace(/^\//, '')), 'utf8'),
  ) as GltfDocument;
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
 * Every castle asset id, taken from the manifest rather than re-listed, so a
 * new entry is covered by the convention checks the moment it is added.
 */
const CASTLE_ASSET_IDS: readonly string[] = [
  'ground-tile-stone',
  'ceiling-tile',
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
   * Texture-free is not a shortcut, it is what keeps every asset loadable in
   * Vitest's jsdom environment - no `HTMLImageElement`, no `ImageBitmap`.
   * One textured asset would need its own test strategy for the
   * texture-loading path, and nothing in this pipeline provides one.
   */
  it('references no image, texture, or UV coordinate anywhere', () => {
    for (const id of CASTLE_ASSET_IDS) {
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
    for (const id of CASTLE_ASSET_IDS) {
      const document = readGltf(id);
      expect(document.materials.length, `"${id}" has no materials`).toBeGreaterThan(0);
      for (const material of document.materials) {
        expect(material.pbrMetallicRoughness?.baseColorFactor).toBeDefined();
      }
    }
  });

  it('keeps every asset ground-pivoted, with nothing below its own base', () => {
    for (const id of CASTLE_ASSET_IDS) {
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
    for (const id of CASTLE_ASSET_IDS) {
      expect(meshSpaceHeight(readGltf(id)), `"${id}" is taller than a wall`).toBeLessThanOrEqual(3);
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
