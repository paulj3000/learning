import { ANIMATION_CLIP_NAMES, type AnimationClipName } from './animationVocabulary';
import type { PrimitiveMesh } from './primitives';

/**
 * Assembles a single-file glTF 2.0 JSON document from named primitive parts
 * and optional TRS keyframe animations, for `docs/ROADMAP.md` Phase 34 (3D
 * Art and Asset Pipeline). Generalizes the one existing hand-authored glTF
 * document in the codebase, `placeholderNpcGltf.ts`'s inline triangle, into
 * something `scripts/generate-world-assets.ts` can call for every asset in
 * the first pack - see `docs/THREE_WORLD_ASSET_CONVENTIONS.md` for the
 * conventions this follows (units, axes, pivots, animation vocabulary).
 *
 * No node hierarchy: every part becomes its own root node in the scene, and
 * animation channels target parts directly by name. None of the first
 * pack's assets need true parent-child skinning, so this stays simple
 * rather than building a general scene graph.
 *
 * Deliberately avoids `THREE.GLTFExporter` (browser-DOM-oriented: expects
 * `Blob`/canvas) so this runs anywhere - Node (the generator script),
 * jsdom (unit tests), or a browser - with no dependency beyond plain
 * JavaScript numbers and `ArrayBuffer`/`DataView`, which all three provide.
 */

export interface MeshPart {
  name: string;
  primitive: PrimitiveMesh;
  /** Flat base color, 0..1 RGB - no textures anywhere in this pack. */
  color: readonly [number, number, number];
  /** Optional emissive tint, 0..1 RGB (used for the repaired bridge deck's warm glow). */
  emissive?: readonly [number, number, number];
  translation?: readonly [number, number, number];
  /** Quaternion, xyzw. */
  rotation?: readonly [number, number, number, number];
  scale?: readonly [number, number, number];
}

export interface AnimationChannelDef {
  /** Must match a `MeshPart.name` in the same document. */
  targetPart: string;
  path: 'translation' | 'rotation' | 'scale';
  /** Seconds, strictly increasing. */
  times: readonly number[];
  /** Flattened keyframe values - 3 floats per sample for translation/scale, 4 for rotation. */
  values: readonly number[];
}

export interface AnimationClipDef {
  name: AnimationClipName;
  channels: readonly AnimationChannelDef[];
}

export interface GltfDocumentDef {
  parts: readonly MeshPart[];
  animations?: readonly AnimationClipDef[];
}

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** A portable base64 encoder - no dependency on Node's `Buffer` or the DOM's `btoa`, so this runs in Node, jsdom, and the browser alike. */
function bytesToBase64(bytes: Uint8Array): string {
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : undefined;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : undefined;
    const triplet = (b0 << 16) | ((b1 ?? 0) << 8) | (b2 ?? 0);
    result += BASE64_CHARS[(triplet >> 18) & 0x3f];
    result += BASE64_CHARS[(triplet >> 12) & 0x3f];
    result += b1 !== undefined ? BASE64_CHARS[(triplet >> 6) & 0x3f] : '=';
    result += b2 !== undefined ? BASE64_CHARS[triplet & 0x3f] : '=';
  }
  return result;
}

function pushFloat32LE(bytes: number[], value: number): void {
  const buffer = new ArrayBuffer(4);
  new DataView(buffer).setFloat32(0, value, true);
  bytes.push(...new Uint8Array(buffer));
}

function pushUint16LE(bytes: number[], value: number): void {
  bytes.push(value & 0xff, (value >> 8) & 0xff);
}

function align4(bytes: number[]): void {
  while (bytes.length % 4 !== 0) bytes.push(0);
}

interface BufferViewJson {
  buffer: 0;
  byteOffset: number;
  byteLength: number;
  target?: number;
}

function writeFloatBufferView(
  bytes: number[],
  bufferViews: BufferViewJson[],
  values: readonly number[],
  target?: number,
): number {
  align4(bytes);
  const byteOffset = bytes.length;
  for (const value of values) pushFloat32LE(bytes, value);
  bufferViews.push({
    buffer: 0,
    byteOffset,
    byteLength: values.length * 4,
    ...(target !== undefined ? { target } : {}),
  });
  return bufferViews.length - 1;
}

function writeUint16BufferView(
  bytes: number[],
  bufferViews: BufferViewJson[],
  values: readonly number[],
  target?: number,
): number {
  align4(bytes);
  const byteOffset = bytes.length;
  for (const value of values) pushUint16LE(bytes, value);
  bufferViews.push({
    buffer: 0,
    byteOffset,
    byteLength: values.length * 2,
    ...(target !== undefined ? { target } : {}),
  });
  return bufferViews.length - 1;
}

function positionBounds(positions: readonly number[]): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], positions[i + axis]);
      max[axis] = Math.max(max[axis], positions[i + axis]);
    }
  }
  return { min, max };
}

/** Converts a `0xRRGGBB` hex color into a 0..1 RGB triplet, for authoring assets with the same hex constants the old inline-primitive scene code used. */
export function hexToRgb01(hex: number): [number, number, number] {
  return [((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255];
}

const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;
const FLOAT = 5126;
const UNSIGNED_SHORT = 5123;

/** Assembles a complete, valid, single-file glTF 2.0 JSON document (base64-embedded buffer, no separate `.bin`). */
export function assembleGltfDocument(def: GltfDocumentDef): Record<string, unknown> {
  const bytes: number[] = [];
  const bufferViews: BufferViewJson[] = [];
  const accessors: Record<string, unknown>[] = [];
  const materials: Record<string, unknown>[] = [];
  const meshes: Record<string, unknown>[] = [];
  const nodes: Record<string, unknown>[] = [];
  const nodeIndexByPartName = new Map<string, number>();

  for (const part of def.parts) {
    const { positions, normals, indices } = part.primitive;

    const posView = writeFloatBufferView(bytes, bufferViews, positions, ARRAY_BUFFER);
    const { min, max } = positionBounds(positions);
    const posAccessor = accessors.length;
    accessors.push({
      bufferView: posView,
      componentType: FLOAT,
      count: positions.length / 3,
      type: 'VEC3',
      min,
      max,
    });

    const normView = writeFloatBufferView(bytes, bufferViews, normals, ARRAY_BUFFER);
    const normAccessor = accessors.length;
    accessors.push({
      bufferView: normView,
      componentType: FLOAT,
      count: normals.length / 3,
      type: 'VEC3',
    });

    const idxView = writeUint16BufferView(bytes, bufferViews, indices, ELEMENT_ARRAY_BUFFER);
    const idxAccessor = accessors.length;
    accessors.push({
      bufferView: idxView,
      componentType: UNSIGNED_SHORT,
      count: indices.length,
      type: 'SCALAR',
    });

    const materialIndex = materials.length;
    materials.push({
      name: `${part.name}Material`,
      pbrMetallicRoughness: {
        baseColorFactor: [...part.color, 1],
        metallicFactor: 0.1,
        roughnessFactor: 0.85,
      },
      ...(part.emissive ? { emissiveFactor: [...part.emissive] } : {}),
      // Every material in this pack is double-sided: a flat, untextured
      // color looks identical from either face, so this sidesteps needing
      // exactly-correct outward-facing winding/rotation for every wall,
      // fence, and door placement - a placement that ends up facing
      // "backwards" is still visible, not invisible.
      doubleSided: true,
    });

    const meshIndex = meshes.length;
    meshes.push({
      name: `${part.name}Mesh`,
      primitives: [
        {
          attributes: { POSITION: posAccessor, NORMAL: normAccessor },
          indices: idxAccessor,
          material: materialIndex,
          mode: 4,
        },
      ],
    });

    const nodeIndex = nodes.length;
    nodes.push({
      name: part.name,
      mesh: meshIndex,
      translation: part.translation ?? [0, 0, 0],
      rotation: part.rotation ?? [0, 0, 0, 1],
      scale: part.scale ?? [1, 1, 1],
    });
    nodeIndexByPartName.set(part.name, nodeIndex);
  }

  const animations: Record<string, unknown>[] = [];
  for (const clip of def.animations ?? []) {
    const channels: Record<string, unknown>[] = [];
    const samplers: Record<string, unknown>[] = [];

    for (const channel of clip.channels) {
      const nodeIndex = nodeIndexByPartName.get(channel.targetPart);
      if (nodeIndex === undefined) {
        throw new Error(`animation "${clip.name}" targets unknown part "${channel.targetPart}"`);
      }

      const inputView = writeFloatBufferView(bytes, bufferViews, channel.times);
      const inputAccessor = accessors.length;
      accessors.push({
        bufferView: inputView,
        componentType: FLOAT,
        count: channel.times.length,
        type: 'SCALAR',
        min: [Math.min(...channel.times)],
        max: [Math.max(...channel.times)],
      });

      const componentCount = channel.path === 'rotation' ? 4 : 3;
      const outputView = writeFloatBufferView(bytes, bufferViews, channel.values);
      const outputAccessor = accessors.length;
      accessors.push({
        bufferView: outputView,
        componentType: FLOAT,
        count: channel.values.length / componentCount,
        type: componentCount === 4 ? 'VEC4' : 'VEC3',
      });

      const samplerIndex = samplers.length;
      samplers.push({ input: inputAccessor, output: outputAccessor, interpolation: 'LINEAR' });
      channels.push({ sampler: samplerIndex, target: { node: nodeIndex, path: channel.path } });
    }

    animations.push({ name: clip.name, channels, samplers });
  }

  align4(bytes);
  const byteArray = new Uint8Array(bytes);
  const base64 = bytesToBase64(byteArray);

  return {
    asset: { version: '2.0', generator: 'learning-adventure-island world-asset-pipeline' },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, index) => index) }],
    nodes,
    meshes,
    materials,
    accessors,
    bufferViews,
    ...(animations.length > 0 ? { animations } : {}),
    buffers: [
      { uri: `data:application/octet-stream;base64,${base64}`, byteLength: byteArray.length },
    ],
  };
}

/** Re-exported so authoring code (the generator script) can validate clip names against the vocabulary without a second import. */
export { ANIMATION_CLIP_NAMES };
