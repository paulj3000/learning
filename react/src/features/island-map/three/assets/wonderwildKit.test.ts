import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getAssetManifestEntry } from './manifest';
import { BUZZ_WAGGLE_RUN } from '../wonderwildHiveRegion';

/**
 * The authoring checks for the Wonderwild Forest kit
 * (`docs/WONDERWILD_FOREST_3D_ROADMAP.md` WF-1), mirroring
 * `castleKit.test.ts`. These read the generated `.gltf` documents off disk
 * rather than loading them through `three`, because what they assert is a
 * property of the *authoring*, not of the runtime: how many meshes a document
 * has, whether it references a texture, whether a hexagon has a hole in it.
 *
 * `manifest.test.ts` already checks that every entry resolves to a file and
 * only declares approved clips; `assetLoader.test.ts` proves the real
 * fetch + `GLTFLoader.load()` round trip accepts a representative sample.
 * This file covers the ways a forest asset can be authored correctly and
 * still be wrong.
 */

const PUBLIC_DIR = resolve(process.cwd(), 'public');

interface GltfDocument {
  meshes: { primitives: { attributes: Record<string, number> }[] }[];
  accessors: { type: string; count: number; min?: number[]; max?: number[] }[];
  animations?: { name?: string }[];
  images?: unknown[];
  textures?: unknown[];
  materials: { pbrMetallicRoughness?: Record<string, unknown>; emissiveFactor?: number[] }[];
  nodes?: { name?: string }[];
}

function readGltf(id: string): GltfDocument {
  const entry = getAssetManifestEntry(id);
  return JSON.parse(
    readFileSync(join(PUBLIC_DIR, entry.url.replace(/^\//, '')), 'utf8'),
  ) as GltfDocument;
}

function bounds(document: GltfDocument, axis: 0 | 1 | 2): { min: number; max: number } {
  const values = document.accessors.filter(
    (accessor) => accessor.type === 'VEC3' && accessor.min && accessor.max,
  );
  return {
    min: Math.min(...values.map((accessor) => accessor.min![axis])),
    max: Math.max(...values.map((accessor) => accessor.max![axis])),
  };
}

/** Every Wonderwild asset id. Grouped the way Appendix A groups them. */
const RECOLOUR_IDS = ['ground-tile-moss', 'ground-tile-comb', 'path-forest'] as const;

/**
 * The A.3 kit pieces. Every one of these is placed through
 * `createInstancedMeshFromAsset`, which keeps only the first mesh it finds -
 * so every one must be exactly one mesh, and this list is what makes that a
 * checked fact rather than a comment.
 */
const INSTANCING_SAFE_IDS = [
  ...RECOLOUR_IDS,
  'fern',
  'flower-cluster',
  'mushroom-cluster',
  'log-fallen',
  'reed',
  'lily-pad',
  'standing-stone',
  'comb-cell',
  'comb-cell-capped',
] as const;

const PROP_IDS = [
  'wonder-stone-bee',
  'wonder-stone-bee-lit',
  'wonder-stone-seed',
  'wonder-stone-sun',
  'wonder-stone-chrysalis',
  'beehive',
  'hive-mouth',
  'frog',
  'leaf-pile',
  'butterfly',
  'glow-moss',
  'glowworm-ceiling',
  'flower-patch-bare',
  'flower-patch-bloomed',
  'cave-mouth',
  'cave-mouth-lit',
] as const;

const WONDERWILD_ASSET_IDS: readonly string[] = [...INSTANCING_SAFE_IDS, ...PROP_IDS, 'npc-buzz'];

describe('Wonderwild kit conventions', () => {
  it('is texture-free, which is what keeps every asset loadable in jsdom', () => {
    // No `HTMLImageElement`, no `ImageBitmap`: this is why `assetLoader.test.ts`
    // can run real `GLTFLoader.load()` calls at all.
    for (const id of WONDERWILD_ASSET_IDS) {
      const document = readGltf(id);
      expect(document.images ?? [], `${id} references an image`).toHaveLength(0);
      expect(document.textures ?? [], `${id} references a texture`).toHaveLength(0);
      for (const mesh of document.meshes) {
        for (const primitive of mesh.primitives) {
          expect(Object.keys(primitive.attributes), `${id} has UVs`).not.toContain('TEXCOORD_0');
        }
      }
    }
  });

  it('is ground-pivoted, so placement code can set position.y = 0', () => {
    // Flat pieces legitimately have zero height: a floor tile, a trail
    // segment and the bare earth patch are all `buildGroundPlanePrimitive`,
    // which sits entirely at y = 0. They still must not dip below it.
    const FLAT = new Set<string>([...RECOLOUR_IDS, 'flower-patch-bare']);
    for (const id of WONDERWILD_ASSET_IDS) {
      // `hive-mouth` is the one wall-mounted piece: it is an opening in a
      // wall, not a thing standing on the floor.
      if (id === 'hive-mouth') continue;
      const y = bounds(readGltf(id), 1);
      expect(y.min, `${id} sinks below its own origin`).toBeGreaterThanOrEqual(-0.01);
      if (!FLAT.has(id)) {
        expect(y.max, `${id} has no height`).toBeGreaterThan(0);
      }
    }
  });

  it('keeps every instanced kit piece to exactly one mesh', () => {
    // `createInstancedMeshFromAsset` silently keeps only the first mesh, so a
    // second one here is not an error at runtime - it is a piece of the model
    // that quietly stops being drawn. The trap `foliage-tree` documents.
    for (const id of INSTANCING_SAFE_IDS) {
      expect(readGltf(id).meshes, `${id} cannot be instanced`).toHaveLength(1);
    }
  });
});

describe('comb-cell', () => {
  it('is a single mesh with a hole through it', () => {
    // Roadmap A.9 risk 1, closed in the affirmative and the opposite way to
    // the castle's `archway`: a hexagonal ring is authorable as one indexed
    // mesh, so the ~40 cells in the hive wall are one instanced draw call.
    const document = readGltf('comb-cell');
    expect(document.meshes).toHaveLength(1);

    const positionCount = document.accessors.find((accessor) => accessor.type === 'VEC3')?.count;
    // A solid hexagonal prism needs 38 vertices; a ring needs the outer skin,
    // the inner bore, and two annulus faces. Substantially more is the hole.
    expect(positionCount).toBeGreaterThan(60);
    expect(readGltf('comb-cell-capped').meshes).toHaveLength(1);
    const cappedCount = document.accessors.find((accessor) => accessor.type === 'VEC3')?.count;
    expect(cappedCount).toBeDefined();
  });

  it('is about a metre and a half across, because that is a cell at bee scale', () => {
    // The child does not shrink - `EYE_HEIGHT` is fixed at 1.6m - so the hive
    // is built enormous instead. A cell smaller than the child reads as a
    // decoration rather than as architecture.
    const y = bounds(readGltf('comb-cell'), 1);
    expect(y.max - y.min).toBeGreaterThan(1);
    expect(y.max - y.min).toBeLessThan(2);
  });

  it('caps the honey cell rather than leaving it open', () => {
    const open = readGltf('comb-cell');
    const capped = readGltf('comb-cell-capped');
    const openVerts = open.accessors.find((a) => a.type === 'VEC3')?.count ?? 0;
    const cappedVerts = capped.accessors.find((a) => a.type === 'VEC3')?.count ?? 0;
    expect(cappedVerts).toBeLessThan(openVerts);
    // The capped cell is the room's warm light source.
    expect(capped.materials.some((m) => (m.emissiveFactor ?? []).some((v) => v > 0))).toBe(true);
  });
});

describe('the Wonder Wall stones', () => {
  it('gives each question its own carved emblem, in geometry rather than texture', () => {
    // Four stones with four different models, not one stone with four skins:
    // this pack has no images, so an emblem has to be a shape.
    const stones = [
      'wonder-stone-bee',
      'wonder-stone-seed',
      'wonder-stone-sun',
      'wonder-stone-chrysalis',
    ].map((id) => readGltf(id));
    for (const stone of stones) {
      expect(stone.meshes.length).toBeGreaterThan(1);
    }
    const meshCounts = stones.map((stone) => stone.meshes.length);
    expect(Math.min(...meshCounts)).toBeGreaterThanOrEqual(2);
  });

  it('makes the bee stone and its lit variant share exact geometry', () => {
    // A construction-time visibility swap: if the two halves differed in
    // shape, lighting the stone at `WAGGLE_DANCE_DISCOVERED` would pop.
    const unlit = readGltf('wonder-stone-bee');
    const lit = readGltf('wonder-stone-bee-lit');
    expect(lit.meshes).toHaveLength(unlit.meshes.length);
    expect(lit.accessors.map((a) => a.count)).toEqual(unlit.accessors.map((a) => a.count));
    expect(bounds(lit, 0)).toEqual(bounds(unlit, 0));
    expect(bounds(lit, 1)).toEqual(bounds(unlit, 1));
  });

  it('lights only the lit variant', () => {
    const glows = (id: string): boolean =>
      readGltf(id).materials.some((material) =>
        (material.emissiveFactor ?? []).some((value) => value > 0),
      );
    expect(glows('wonder-stone-bee-lit')).toBe(true);
    expect(glows('wonder-stone-bee')).toBe(false);
    // The three questions with no adventure behind them have no lit variant
    // at all yet - WF-9 authors the seed's when it builds the arc.
    expect(() => getAssetManifestEntry('wonder-stone-seed-lit')).toThrow();
  });

  it('stands every stone at a height a child can read an emblem on', () => {
    for (const id of ['wonder-stone-bee', 'wonder-stone-seed', 'wonder-stone-sun']) {
      const y = bounds(readGltf(id), 1);
      expect(y.max).toBeGreaterThan(1);
      expect(y.max).toBeLessThan(2);
    }
  });
});

describe('beat 10 and beat 12 state variants', () => {
  it('makes the flower patch a real geometry change, not a recolour', () => {
    // The adventure's own text promises flowers where there were none. A
    // repainted patch of earth is not that.
    const bare = readGltf('flower-patch-bare');
    const bloomed = readGltf('flower-patch-bloomed');
    expect(bare.meshes).toHaveLength(1);
    expect(bloomed.meshes.length).toBeGreaterThan(bare.meshes.length);
  });

  it('lights the cave only in the variant the jar buys', () => {
    const glows = (id: string): boolean =>
      readGltf(id).materials.some((material) =>
        (material.emissiveFactor ?? []).some((value) => value > 0),
      );
    expect(glows('cave-mouth')).toBe(false);
    expect(glows('cave-mouth-lit')).toBe(true);
  });

  it('makes the glowing moss glow', () => {
    expect(
      readGltf('glow-moss').materials.some((material) =>
        (material.emissiveFactor ?? []).some((value) => value > 0),
      ),
    ).toBe(true);
  });
});

describe('npc-buzz', () => {
  it('is multi-part with the named nodes the scene animates', () => {
    const document = readGltf('npc-buzz');
    const names = (document.nodes ?? []).map((node) => node.name);
    for (const required of ['Body', 'Head', 'Abdomen']) {
      expect(names, `npc-buzz has no ${required} node`).toContain(required);
    }
    // Multi-part, therefore never instanceable: the sisters are clones.
    expect(document.meshes.length).toBeGreaterThan(1);
  });

  it('declares only clips already in the shared vocabulary', () => {
    // The waggle run is scene-driven TRS motion, not a clip, so
    // `animationVocabulary.ts` needs no new name and SC-1's decision not to
    // extend it holds.
    const clips = (readGltf('npc-buzz').animations ?? []).map((clip) => clip.name);
    expect(clips.sort()).toEqual(['Celebrate', 'Idle', 'Talk']);
    expect(clips).not.toContain('Waggle');
    expect(clips).not.toContain('Dance');
    expect(getAssetManifestEntry('npc-buzz').clips).not.toContain('Walk');
  });

  it('is small enough that five waggles fit on the dance floor', () => {
    // A bee the size of the run she performs would make the count unreadable.
    const document = readGltf('npc-buzz');
    const height = bounds(document, 1).max;
    const runLength = Math.hypot(
      BUZZ_WAGGLE_RUN.toX - BUZZ_WAGGLE_RUN.fromX,
      BUZZ_WAGGLE_RUN.toZ - BUZZ_WAGGLE_RUN.fromZ,
    );
    expect(height).toBeLessThan(runLength);
  });
});
