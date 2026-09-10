/**
 * Imports rigged CC0 characters from the packs under `assets/*.zip` into
 * `public/models/`, keeping only the animation clips this project's closed
 * vocabulary actually names.
 *
 * The companion to `scripts/import-kenney-assets.ts`, and a different job.
 * The Kenney scenery needed scale, pivot and texture normalisation;
 * Quaternius's Ultimate Modular Men need none of those - measured before
 * use, they are already ~1.86m tall, ground-pivoted, single-root, and carry
 * **no textures at all**, which makes them a closer style match to this
 * project's untextured generated kit than any textured pack. What they need
 * instead is subtraction.
 *
 * ## Why clips are dropped rather than carried
 *
 * Each character ships 24 clips, and most of them are combat: `Gun_Shoot`,
 * `Sword_Slash`, `Punch_Left`, `Punch_Right`, `Kick_Left`, `Kick_Right`,
 * `Death`, `HitRecieve`, `Idle_Gun*`. This is a product for children aged
 * 3 to 8. A `Death` clip that never plays is still a `Death` clip in the
 * bundle, so these are removed from the file rather than left unreferenced.
 *
 * The rest are dropped for a duller reason: `docs/ASSET_SOURCING.md` section
 * 4 holds that an imported character has its clips **renamed to
 * `animationVocabulary.ts`, not the vocabulary widened to the import**. Only
 * three of the 24 map onto that vocabulary without inventing a meaning, so
 * only three are kept.
 *
 * `Interact` is the one judgement call worth recording. It is plainly useful
 * and plainly *something*, but whether it reads as `Point`, `Talk` or
 * `Activate` cannot be decided without watching it play, and this
 * environment has no viewer. Guessing would put a wrong name into a closed
 * vocabulary, which is worse than one fewer clip, so it is dropped. If
 * someone opens it in a viewer and it reads as one of the three, adding it
 * here is a one-line change.
 *
 * ## What "pruned" means
 *
 * Dropping 21 of 24 clips leaves most of the document unreachable: these
 * files carry ~2805 accessors and ~2805 bufferViews, the large majority of
 * them animation keyframe data. Deleting only the `animations` entries would
 * shrink the JSON's clip list and leave every byte of that data in the
 * buffer, so the importer walks reachability from meshes, skins and the
 * surviving clips, rebuilds the binary buffer from just those bufferViews,
 * and renumbers every reference. That is where the size actually goes.
 *
 * Output is a single self-contained `.gltf` with its buffer embedded as a
 * base64 data URI - the same shape `generate-world-assets.ts` produces, so
 * these need no `assetLoader` change and no `vite.config.ts` change.
 *
 * Run via `npm run assets:import-characters`. Output is checked in.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANIMATION_CLIP_NAMES } from '../src/features/island-map/three/assets/animationVocabulary';
import { listZipEntries, readZipEntry } from './assets/zipReader';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ZIP_DIR = resolve(REPO_ROOT, 'assets');
const OUTPUT_DIR = resolve(REPO_ROOT, 'public', 'models');

/**
 * Source clip name -> vocabulary name. Every value must be in
 * `ANIMATION_CLIP_NAMES`; the importer asserts it rather than trusting this
 * table, so widening the vocabulary by typo is not possible.
 *
 * Deliberately small. See the header for why `Interact` is not here and why
 * nothing maps to `Talk`, `Point`, `Celebrate` or the `React*` pair.
 */
const CLIP_MAP: Readonly<Record<string, string>> = {
  Idle: 'Idle',
  Walk: 'Walk',
  Wave: 'Wave',
};

interface CharacterSpec {
  /** Zip under `assets/`. */
  zip: string;
  /** The `.gltf` basename inside the pack, e.g. `Worker`. */
  sourceName: string;
  /** Output basename under `public/models/`, without extension. */
  out: string;
  /** Manifest id this file is imported to serve, for the log line. */
  servesId: string;
}

const MODULAR_MEN_ZIP = 'Ultimate Modular Men- Feb 2022-20260910T014617Z-1-001.zip';

const CHARACTERS: readonly CharacterSpec[] = [
  {
    // The Harbor Master is a dock official, and `Worker` is the only one of
    // the eleven with a hi-vis vest and work clothes. He also has to read as
    // clearly *not* Pirate Pip from across the harbor, since until now both
    // Clockwork NPCs were Pip's model.
    zip: MODULAR_MEN_ZIP,
    sourceName: 'Worker',
    out: 'npc-harbor-master',
    servesId: 'npc-harbor-master',
  },
  {
    // A **stand-in, not the answer.** `docs/MODELS_NEEDED.md` section 7 lists
    // Professor Ticktock as bespoke - he is a named clockwork character no
    // pack contains - and `Suit` is simply the closest of the eleven to a
    // professor. It replaces a worse stand-in (Pip, a pirate) rather than
    // closing the row.
    zip: MODULAR_MEN_ZIP,
    sourceName: 'Suit',
    out: 'npc-professor-ticktock',
    servesId: 'npc-professor-ticktock',
  },
];

/** Characters in the pack that this project will not import, and why. */
const EXCLUDED = {
  Swat: 'tactical/police militarised, wrong for ages 3-8',
  Punk: 'off-theme for the island',
  Spacesuit: 'no region needs it; would be hoarding ahead of a scene',
  King: 'no named role waiting for it',
  Adventurer: 'no named role waiting for it',
  Farmer: 'no named role waiting for it',
  Beach: 'no named role waiting for it',
  Casual_2: 'no named role waiting for it',
  Casual_Hoodie: 'no named role waiting for it',
} as const;

// --- glTF shapes ------------------------------------------------------

interface Gltf {
  asset: { version: string; generator?: string };
  scene?: number;
  scenes: { nodes: number[]; name?: string }[];
  nodes: {
    mesh?: number;
    skin?: number;
    children?: number[];
    matrix?: number[];
    translation?: number[];
    rotation?: number[];
    scale?: number[];
    name?: string;
  }[];
  meshes: {
    primitives: {
      attributes: Record<string, number>;
      indices?: number;
      material?: number;
      targets?: Record<string, number>[];
    }[];
    name?: string;
  }[];
  skins?: { inverseBindMatrices?: number; joints: number[]; skeleton?: number }[];
  animations?: {
    name?: string;
    samplers: { input: number; output: number; interpolation?: string }[];
    channels: { sampler: number; target: { node?: number; path: string } }[];
  }[];
  accessors: {
    bufferView?: number;
    byteOffset?: number;
    componentType: number;
    normalized?: boolean;
    count: number;
    type: string;
    min?: number[];
    max?: number[];
    sparse?: unknown;
  }[];
  bufferViews: {
    buffer: number;
    byteOffset?: number;
    byteLength: number;
    byteStride?: number;
    target?: number;
  }[];
  buffers: { byteLength: number; uri?: string }[];
  images?: { uri?: string; bufferView?: number }[];
  materials?: unknown[];
  extensionsRequired?: string[];
}

function decodeBuffer(gltf: Gltf): Buffer {
  const uri = gltf.buffers[0]?.uri;
  if (!uri) {
    throw new Error('expected a single embedded buffer');
  }
  const comma = uri.indexOf(',');
  if (!uri.startsWith('data:') || comma < 0) {
    throw new Error('buffer is an external file; only embedded data uris are supported');
  }
  return Buffer.from(uri.slice(comma + 1), 'base64');
}

// --- the transform ----------------------------------------------------

/**
 * Drops UV attributes when nothing in the document samples a texture.
 *
 * These characters are untextured - every material is a flat
 * `baseColorFactor`, which is exactly why they sit well beside the
 * generated kit - so `TEXCOORD_0` is provably unread: with no `*Texture`
 * anywhere in `materials` there is no sampler to feed. It is not free
 * weight either, about 12% of the buffer.
 *
 * Guarded on the whole document rather than assumed, so a future textured
 * character in the same pack keeps its UVs instead of rendering untextured.
 * Only the attribute references are removed; the prune below is what
 * actually reclaims the bytes.
 */
function dropUvsIfUntextured(gltf: Gltf): boolean {
  const textured = JSON.stringify(gltf.materials ?? []).includes('Texture');
  if (textured) {
    return false;
  }
  for (const mesh of gltf.meshes) {
    for (const primitive of mesh.primitives) {
      for (const name of Object.keys(primitive.attributes)) {
        if (name.startsWith('TEXCOORD_')) {
          delete primitive.attributes[name];
        }
      }
    }
  }
  return true;
}

/**
 * Rewrites the document to the kept clips only, then rebuilds the buffer
 * from whatever is still reachable and renumbers every index into the
 * accessor and bufferView arrays.
 */
function keepOnlyMappedClips(gltf: Gltf, source: Buffer): { gltf: Gltf; buffer: Buffer } {
  const kept = (gltf.animations ?? []).filter(
    (animation) => animation.name !== undefined && animation.name in CLIP_MAP,
  );
  for (const animation of kept) {
    animation.name = CLIP_MAP[animation.name as string];
  }
  gltf.animations = kept;

  // Reachable accessors: mesh data, skin bind matrices, surviving clips.
  const usedAccessors = new Set<number>();
  for (const mesh of gltf.meshes) {
    for (const primitive of mesh.primitives) {
      for (const accessor of Object.values(primitive.attributes)) {
        usedAccessors.add(accessor);
      }
      if (primitive.indices !== undefined) {
        usedAccessors.add(primitive.indices);
      }
      for (const target of primitive.targets ?? []) {
        for (const accessor of Object.values(target)) {
          usedAccessors.add(accessor);
        }
      }
    }
  }
  for (const skin of gltf.skins ?? []) {
    if (skin.inverseBindMatrices !== undefined) {
      usedAccessors.add(skin.inverseBindMatrices);
    }
  }
  for (const animation of kept) {
    for (const sampler of animation.samplers) {
      usedAccessors.add(sampler.input);
      usedAccessors.add(sampler.output);
    }
  }

  for (const index of usedAccessors) {
    if (gltf.accessors[index]?.sparse) {
      throw new Error(`accessor ${index} is sparse; pruning it is not supported`);
    }
  }

  // Reachable bufferViews: those the surviving accessors point at, plus any
  // embedded image (these characters have none, but do not assume it).
  const usedViews = new Set<number>();
  for (const index of usedAccessors) {
    const view = gltf.accessors[index]?.bufferView;
    if (view !== undefined) {
      usedViews.add(view);
    }
  }
  for (const image of gltf.images ?? []) {
    if (image.bufferView !== undefined) {
      usedViews.add(image.bufferView);
    }
  }

  // Rebuild the binary buffer from the surviving views, in a stable order.
  const viewOrder = [...usedViews].sort((a, b) => a - b);
  const viewRemap = new Map<number, number>();
  const chunks: Buffer[] = [];
  const newViews: Gltf['bufferViews'] = [];
  let cursor = 0;
  for (const original of viewOrder) {
    const view = gltf.bufferViews[original];
    const start = view.byteOffset ?? 0;
    const slice = source.subarray(start, start + view.byteLength);
    // glTF requires an accessor's byteOffset to be a multiple of its
    // component size; keeping every view 4-byte aligned satisfies that for
    // every component type this pack uses.
    const padding = (4 - (cursor % 4)) % 4;
    if (padding > 0) {
      chunks.push(Buffer.alloc(padding, 0));
      cursor += padding;
    }
    viewRemap.set(original, newViews.length);
    newViews.push({
      buffer: 0,
      byteOffset: cursor,
      byteLength: view.byteLength,
      ...(view.byteStride !== undefined ? { byteStride: view.byteStride } : {}),
      ...(view.target !== undefined ? { target: view.target } : {}),
    });
    chunks.push(Buffer.from(slice));
    cursor += view.byteLength;
  }

  // Compact the accessor array and renumber every reference to it.
  const accessorOrder = [...usedAccessors].sort((a, b) => a - b);
  const accessorRemap = new Map<number, number>();
  const newAccessors: Gltf['accessors'] = [];
  for (const original of accessorOrder) {
    const accessor = { ...gltf.accessors[original] };
    if (accessor.bufferView !== undefined) {
      accessor.bufferView = viewRemap.get(accessor.bufferView);
    }
    accessorRemap.set(original, newAccessors.length);
    newAccessors.push(accessor);
  }

  const remap = (index: number): number => {
    const next = accessorRemap.get(index);
    if (next === undefined) {
      throw new Error(`accessor ${index} survived a reference but not the prune`);
    }
    return next;
  };

  for (const mesh of gltf.meshes) {
    for (const primitive of mesh.primitives) {
      for (const [name, accessor] of Object.entries(primitive.attributes)) {
        primitive.attributes[name] = remap(accessor);
      }
      if (primitive.indices !== undefined) {
        primitive.indices = remap(primitive.indices);
      }
      for (const target of primitive.targets ?? []) {
        for (const [name, accessor] of Object.entries(target)) {
          target[name] = remap(accessor);
        }
      }
    }
  }
  for (const skin of gltf.skins ?? []) {
    if (skin.inverseBindMatrices !== undefined) {
      skin.inverseBindMatrices = remap(skin.inverseBindMatrices);
    }
  }
  for (const animation of kept) {
    for (const sampler of animation.samplers) {
      sampler.input = remap(sampler.input);
      sampler.output = remap(sampler.output);
    }
  }
  for (const image of gltf.images ?? []) {
    if (image.bufferView !== undefined) {
      image.bufferView = viewRemap.get(image.bufferView);
    }
  }

  gltf.accessors = newAccessors;
  gltf.bufferViews = newViews;
  const buffer = Buffer.concat(chunks);
  gltf.buffers = [{ byteLength: buffer.length }];
  return { gltf, buffer };
}

/** World-space bounding box, so the assertions below measure the posed rig. */
function boundingBox(gltf: Gltf): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const mesh of gltf.meshes) {
    for (const primitive of mesh.primitives) {
      const accessor = gltf.accessors[primitive.attributes.POSITION];
      if (!accessor?.min || !accessor.max) {
        continue;
      }
      for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis], accessor.min[axis]);
        max[axis] = Math.max(max[axis], accessor.max[axis]);
      }
    }
  }
  return { min, max };
}

// --- run --------------------------------------------------------------

const VOCABULARY = new Set<string>(ANIMATION_CLIP_NAMES);
for (const [source, mapped] of Object.entries(CLIP_MAP)) {
  if (!VOCABULARY.has(mapped)) {
    throw new Error(`CLIP_MAP maps "${source}" to "${mapped}", which is not in the vocabulary`);
  }
}

mkdirSync(OUTPUT_DIR, { recursive: true });

for (const spec of CHARACTERS) {
  const zipPath = resolve(ZIP_DIR, spec.zip);
  // The pack's top folder carries a scrape timestamp, so match on the tail
  // rather than hard-coding a prefix that changes per download.
  const entry = listZipEntries(zipPath).find((name) =>
    name.endsWith(`/glTF/${spec.sourceName}.gltf`),
  );
  if (!entry) {
    throw new Error(`${spec.zip}: no glTF named "${spec.sourceName}"`);
  }

  const raw = readZipEntry(zipPath, entry);
  const parsed = JSON.parse(raw.toString('utf8')) as Gltf;
  if (parsed.extensionsRequired?.length) {
    throw new Error(`${entry}: requires glTF extensions ${parsed.extensionsRequired.join(', ')}`);
  }

  const sourceClips = (parsed.animations ?? []).length;
  const sourceBuffer = decodeBuffer(parsed);
  const sourceAccessors = parsed.accessors.length;

  const droppedUvs = dropUvsIfUntextured(parsed);
  const { gltf, buffer } = keepOnlyMappedClips(parsed, sourceBuffer);

  const box = boundingBox(gltf);
  const height = box.max[1] - box.min[1];
  if (Math.abs(box.min[1]) > 0.02) {
    throw new Error(`${spec.out}: not ground-pivoted, y starts at ${box.min[1].toFixed(3)}`);
  }
  if (height < 1.4 || height > 2.2) {
    throw new Error(`${spec.out}: ${height.toFixed(2)}m is not a plausible adult height`);
  }
  if ((gltf.animations ?? []).length !== Object.keys(CLIP_MAP).length) {
    throw new Error(
      `${spec.out}: kept ${(gltf.animations ?? []).length} clips, expected ${Object.keys(CLIP_MAP).length}`,
    );
  }

  gltf.buffers[0].uri = `data:application/octet-stream;base64,${buffer.toString('base64')}`;
  const outPath = resolve(OUTPUT_DIR, `${spec.out}.gltf`);
  const serialised = JSON.stringify(gltf);
  writeFileSync(outPath, serialised);

  const kb = (bytes: number): string => `${Math.round(bytes / 1024)} KB`;
  console.log(
    `${spec.out}.gltf  from ${spec.sourceName}  serves "${spec.servesId}"  ` +
      `clips ${sourceClips} -> ${(gltf.animations ?? []).length} ` +
      `(${(gltf.animations ?? []).map((a) => a.name).join(', ')})  ` +
      `accessors ${sourceAccessors} -> ${gltf.accessors.length}  ` +
      `${kb(raw.length)} -> ${kb(serialised.length)}  height ${height.toFixed(2)}m` +
      `${droppedUvs ? '  (untextured, uvs dropped)' : ''}`,
  );
}

console.log(
  `imported ${CHARACTERS.length} characters into ${OUTPUT_DIR}; ` +
    `${Object.keys(EXCLUDED).length} left in the pack (see EXCLUDED)`,
);
