import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ANIMATION_CLIP_NAMES } from './animationVocabulary';
import { loadAsset } from './assetLoader';
import { getAssetManifestEntry } from './manifest';

/**
 * The import contract for the rigged CC0 characters
 * `scripts/import-character-assets.ts` produces, alongside
 * `kenneyImports.test.ts` (scenery) and `describe('imported castle kit')`
 * in `castleKit.test.ts`.
 *
 * These check two different things and both matter.
 *
 * The **content** checks are the reason this file leads with them: the
 * source pack is built for combat, and a `Gun_Shoot` or `Death` clip in a
 * product for 3- to 8-year-olds is a defect whether or not anything ever
 * plays it. The importer strips them; this is what stops a future re-import
 * quietly putting them back.
 *
 * The **structural** checks exist because the importer does a genuinely
 * risky transform. Dropping 21 of 24 clips leaves ~85% of the document
 * unreachable, so it rebuilds the binary buffer and renumbers every index
 * into the accessor and bufferView arrays. Get that renumbering wrong by
 * one and the file still parses as JSON, still looks plausible, and renders
 * as garbage - so the real `GLTFLoader` round trip below is the check that
 * actually proves it.
 */

const PUBLIC_DIR = resolve(process.cwd(), 'public');

/** Clip names from the source pack that must never reach the bundle. */
const FORBIDDEN_CLIP_PATTERN = /gun|shoot|sword|punch|kick|death|hit|slash|weapon/i;

const CHARACTER_IDS = ['npc-harbor-master', 'npc-professor-ticktock'] as const;

interface GltfDocument {
  animations?: { name?: string; samplers: { input: number; output: number }[] }[];
  accessors: { bufferView?: number; type: string; min?: number[]; max?: number[] }[];
  bufferViews: { byteOffset?: number; byteLength: number }[];
  buffers: { byteLength: number; uri?: string }[];
  meshes: { primitives: { attributes: Record<string, number>; indices?: number }[] }[];
  materials?: unknown[];
  images?: unknown[];
  skins?: unknown[];
  extensionsRequired?: string[];
}

function readDocument(id: string): GltfDocument {
  const entry = getAssetManifestEntry(id);
  const filePath = join(PUBLIC_DIR, entry.url.replace(/^\//, ''));
  return JSON.parse(readFileSync(filePath, 'utf8')) as GltfDocument;
}

describe('imported characters — content', () => {
  it('ships no combat clip, whatever the source pack contained', () => {
    for (const id of CHARACTER_IDS) {
      for (const animation of readDocument(id).animations ?? []) {
        expect(animation.name, `"${id}" ships a combat clip: ${animation.name}`).not.toMatch(
          FORBIDDEN_CLIP_PATTERN,
        );
      }
    }
  });

  it('names every clip from the closed vocabulary, never widening it', () => {
    const vocabulary = new Set<string>(ANIMATION_CLIP_NAMES);
    for (const id of CHARACTER_IDS) {
      for (const animation of readDocument(id).animations ?? []) {
        expect(
          vocabulary.has(animation.name ?? ''),
          `"${id}" declares "${animation.name}", which is not in ANIMATION_CLIP_NAMES`,
        ).toBe(true);
      }
    }
  });

  it('declares in the manifest exactly the clips the file actually carries', () => {
    for (const id of CHARACTER_IDS) {
      const authored = (readDocument(id).animations ?? []).map((a) => a.name).sort();
      const declared = [...getAssetManifestEntry(id).clips].sort();
      expect(declared, `"${id}" manifest clips disagree with the file`).toEqual(authored);
    }
  });
});

describe('imported characters — structure', () => {
  it('needs no scale normalisation: each stands at a plausible adult height', () => {
    for (const id of CHARACTER_IDS) {
      const document = readDocument(id);
      const positions = new Set(
        document.meshes.flatMap((mesh) =>
          mesh.primitives.map((primitive) => primitive.attributes.POSITION),
        ),
      );
      const boxes = document.accessors.filter(
        (accessor, index) => positions.has(index) && accessor.min && accessor.max,
      );
      const minY = Math.min(...boxes.map((accessor) => accessor.min![1]));
      const maxY = Math.max(...boxes.map((accessor) => accessor.max![1]));
      expect(maxY - minY, `"${id}" is not adult-height`).toBeGreaterThan(1.4);
      expect(maxY - minY, `"${id}" is not adult-height`).toBeLessThan(2.2);
      // Ground-pivoted like every generated kit piece, so a scene places it
      // at y=0 with no offset.
      expect(Math.abs(minY), `"${id}" does not stand on y=0`).toBeLessThan(0.02);
    }
  });

  it('carries no texture, which is why it sits beside the generated kit', () => {
    for (const id of CHARACTER_IDS) {
      const document = readDocument(id);
      expect(document.images ?? [], `"${id}" gained a texture`).toEqual([]);
      expect(JSON.stringify(document.materials ?? []), `"${id}" samples a texture`).not.toMatch(
        /Texture/,
      );
    }
  });

  it('drops the uv attributes that an untextured material cannot read', () => {
    for (const id of CHARACTER_IDS) {
      for (const mesh of readDocument(id).meshes) {
        for (const primitive of mesh.primitives) {
          const uvs = Object.keys(primitive.attributes).filter((name) =>
            name.startsWith('TEXCOORD_'),
          );
          expect(uvs, `"${id}" still carries unread uvs`).toEqual([]);
        }
      }
    }
  });

  it('leaves no orphaned data behind: every bufferView is reachable and packed', () => {
    for (const id of CHARACTER_IDS) {
      const document = readDocument(id);
      const referenced = new Set(
        document.accessors
          .map((accessor) => accessor.bufferView)
          .filter((view): view is number => view !== undefined),
      );
      // The prune's whole point. An unreferenced bufferView means keyframe
      // data for a dropped clip is still shipping.
      expect(referenced.size, `"${id}" has orphaned bufferViews`).toBe(document.bufferViews.length);

      const end = Math.max(
        ...document.bufferViews.map((view) => (view.byteOffset ?? 0) + view.byteLength),
      );
      // Allow only 4-byte alignment padding at the tail.
      expect(document.buffers[0].byteLength - end).toBeLessThan(4);
    }
  });

  it('requires no glTF extension', () => {
    for (const id of CHARACTER_IDS) {
      expect(readDocument(id).extensionsRequired ?? []).toEqual([]);
    }
  });
});

/**
 * The renumbering check. Everything above reads the document as JSON, which
 * cannot tell a correctly renumbered accessor index from a plausible wrong
 * one - only the real loader can, by resolving each index against the
 * rebuilt buffer and producing a rig that binds.
 */
describe('imported characters — the real loader round trip', () => {
  it('loads each character with its skinned mesh and every declared clip bound', async () => {
    for (const id of CHARACTER_IDS) {
      const gltf = await loadAsset(id);

      let skinned = 0;
      let vertices = 0;
      gltf.scene.traverse((child) => {
        const mesh = child as {
          isSkinnedMesh?: boolean;
          geometry?: { attributes: { position: { count: number } } };
        };
        if (mesh.isSkinnedMesh) {
          skinned++;
          vertices += mesh.geometry?.attributes.position.count ?? 0;
        }
      });
      expect(skinned, `"${id}" lost its rig`).toBeGreaterThan(0);
      expect(vertices, `"${id}" has no vertices`).toBeGreaterThan(0);

      const names = gltf.animations.map((clip) => clip.name).sort();
      expect(names).toEqual([...getAssetManifestEntry(id).clips].sort());

      for (const clip of gltf.animations) {
        // A clip whose tracks failed to resolve parses fine and animates
        // nothing, which is exactly what a bad renumbering looks like.
        expect(clip.tracks.length, `"${id}" clip "${clip.name}" has no tracks`).toBeGreaterThan(0);
        expect(clip.duration, `"${id}" clip "${clip.name}" is zero-length`).toBeGreaterThan(0);
      }
    }
  });
});
