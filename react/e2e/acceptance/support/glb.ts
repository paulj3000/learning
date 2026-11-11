import { readFileSync } from 'node:fs';

/**
 * Character GLB fixtures for the NPC Manager browser QA (docs/NPC_MANAGER_QA_REPORT.md).
 *
 * Built from the bundled Pirate Pip placeholder (`public/models/npc-pip.gltf`, three clips:
 * Idle, Talk, Wave) by packing its embedded buffer into a binary GLB and renaming the clips. The
 * Mixamo variant reproduces what a raw Mixamo FBX to GLB export carries: every take is called
 * `Armature|mixamo.com|Layer0`, with Blender's `.001` suffix on the repeats, so nothing in the
 * file says which clip is idle, walking, talking or waving.
 */

interface GltfJson {
  buffers: { uri?: string; byteLength: number }[];
  animations?: { name?: string }[];
  [key: string]: unknown;
}

export const MIXAMO_CLIPS = [
  'Armature|mixamo.com|Layer0',
  'Armature|mixamo.com|Layer0.001',
  'Armature|mixamo.com|Layer0.002',
];

function pad(buffer: Buffer, fill: number): Buffer {
  const extra = (4 - (buffer.length % 4)) % 4;
  return extra ? Buffer.concat([buffer, Buffer.alloc(extra, fill)]) : buffer;
}

/** A binary GLB of the Pip placeholder whose animations carry `clipNames`, in order. */
export function characterGlb(clipNames: readonly string[] = ['Idle', 'Talk', 'Wave']): Buffer {
  const gltf = JSON.parse(readFileSync('public/models/npc-pip.gltf', 'utf8')) as GltfJson;
  const [only] = gltf.buffers;
  if (!only?.uri?.startsWith('data:')) throw new Error('npc-pip.gltf must embed one buffer');
  const bin = Buffer.from(only.uri.slice(only.uri.indexOf(',') + 1), 'base64');
  gltf.buffers = [{ byteLength: bin.length }];
  const animations = gltf.animations ?? [];
  if (clipNames.length > animations.length) throw new Error('more names than clips');
  gltf.animations = animations.slice(0, clipNames.length).map((animation, index) => ({
    ...animation,
    name: clipNames[index],
  }));
  const json = pad(Buffer.from(JSON.stringify(gltf)), 0x20);
  const body = pad(bin, 0);
  const header = Buffer.alloc(12);
  header.write('glTF', 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + json.length + 8 + body.length, 8);
  const chunk = (data: Buffer, type: number) => {
    const head = Buffer.alloc(8);
    head.writeUInt32LE(data.length, 0);
    head.writeUInt32LE(type, 4);
    return Buffer.concat([head, data]);
  };
  return Buffer.concat([header, chunk(json, 0x4e4f534a), chunk(body, 0x004e4942)]);
}
