import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { AnimationClip, Group } from 'three';

/**
 * A hand-built, minimal, untextured glTF 2.0 asset standing in for "Pip"
 * until `docs/ROADMAP.md` Phase 34 (3D Art and Asset Pipeline) commissions
 * real art. Its only job is to exercise the real `GLTFLoader` pipeline
 * (mesh geometry + a named `AnimationClip`) that Phase 31 requires
 * ("GLB loading ... one animated GLB NPC"), not to look like anything.
 *
 * Embedded as JSON with a base64 data-URI buffer rather than a binary
 * `.glb` file, so there is no external asset to check in and this parses
 * cleanly wherever `GLTFLoader.parse` runs, including jsdom (no texture,
 * so no `Image`/canvas dependency). The buffer layout: 3 vec3 float32
 * positions (0-36), 3 uint16 indices (36-42), 2 bytes padding (42-44), 2
 * float32 animation-time keyframes (44-52), 2 vec4 float32 rotation
 * keyframes (52-84) — a small triangle that nods via a Y-axis rotation.
 */
const PLACEHOLDER_NPC_BUFFER_BASE64 =
  'AAAAAAAAAAAAAAAAzczMPgAAAAAAAAAAzcxMPpqZGT8AAAAAAAABAAIAAAAAAAAAAACAPwAAAAAAAAAAAAAAAAAAgD8AAAAAx0uXPgAAAACKjnQ/';

const PLACEHOLDER_NPC_GLTF = {
  asset: { version: '2.0' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ name: 'Pip', mesh: 0, rotation: [0, 0, 0, 1] }],
  meshes: [
    {
      name: 'PipPlaceholder',
      primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4 }],
    },
  ],
  animations: [
    {
      name: 'Nod',
      channels: [{ sampler: 0, target: { node: 0, path: 'rotation' } }],
      samplers: [{ input: 2, output: 3, interpolation: 'LINEAR' }],
    },
  ],
  buffers: [
    {
      uri: `data:application/octet-stream;base64,${PLACEHOLDER_NPC_BUFFER_BASE64}`,
      byteLength: 84,
    },
  ],
  bufferViews: [
    { buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 },
    { buffer: 0, byteOffset: 36, byteLength: 6, target: 34963 },
    { buffer: 0, byteOffset: 44, byteLength: 8 },
    { buffer: 0, byteOffset: 52, byteLength: 32 },
  ],
  accessors: [
    {
      bufferView: 0,
      componentType: 5126,
      count: 3,
      type: 'VEC3',
      min: [0, 0, 0],
      max: [0.4, 0.6, 0],
    },
    { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
    { bufferView: 2, componentType: 5126, count: 2, type: 'SCALAR', min: [0], max: [1] },
    { bufferView: 3, componentType: 5126, count: 2, type: 'VEC4' },
  ],
} as const;

export interface PlaceholderNpc {
  scene: Group;
  clip: AnimationClip;
}

/** Parses the embedded placeholder glTF via the real `GLTFLoader`. No network fetch. */
export function loadPlaceholderNpc(): Promise<PlaceholderNpc> {
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(
      JSON.stringify(PLACEHOLDER_NPC_GLTF),
      '',
      (gltf: GLTF) => {
        const clip = gltf.animations[0];
        if (!clip) {
          reject(new Error('placeholder NPC glTF has no animation clip'));
          return;
        }
        resolve({ scene: gltf.scene, clip });
      },
      (error: unknown) => reject(error instanceof Error ? error : new Error(String(error))),
    );
  });
}
