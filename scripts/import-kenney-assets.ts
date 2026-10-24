/**
 * Imports the Kenney CC0 kits in `assets/*.zip` into `public/models/`,
 * normalising each file to this project's conventions on the way in.
 *
 * ADR-020 governs when a third-party file may be checked in;
 * `docs/ASSET_LICENCES.md` is the ledger of the ones that have been. This
 * script is the "import work each bought asset still needs" that
 * `docs/ASSET_SOURCING.md` section 6 names, done once and reproducibly
 * rather than by hand in a modeling tool this environment does not have.
 *
 * Three normalisations, all of which the source files need and the
 * KayKit floors in `4db7038` did not:
 *
 * 1. **Uniform downscale.** Kenney's Castle Kit is authored on a 1-unit
 *    module: its castle wall is 1.00 x 1.31 x 1.00, so at 1 unit = 1 metre
 *    a child at `EYE_HEIGHT` 1.6 would see over every wall in the box.
 *    Each import declares the generated asset whose id it takes over, and
 *    is scaled by the largest uniform factor that still fits inside that
 *    asset's bounding box on all three axes. Fitting inside rather than
 *    matching one axis is what keeps a swapped mesh from poking out of the
 *    `RectZone` collider authored around the generated original.
 * 2. **Scale baked into vertices, not the node.** A node transform would
 *    survive `createInstancedMeshFromAsset` (it bakes `matrixWorld`) but
 *    only because these happen to be single-node files; baking the
 *    positions keeps the root identity, which is what the import contract
 *    in `castleKit.test.ts` pins. Uniform scale leaves normals valid, so
 *    only POSITION is rewritten.
 * 3. **Texture embedded, not referenced.** Every Kenney GLB points at a
 *    shared `Textures/colormap.png` by relative uri, which
 *    `docs/THREE_WORLD_ASSET_CONVENTIONS.md` warns "404s the moment one
 *    moves and the other does not". The png is appended to the binary
 *    chunk as a `bufferView` image so each file stays self-contained.
 *
 * The zips are read in place by `scripts/assets/zipReader.ts`.
 * That is deliberate: it avoids both a new dependency and a checked-in
 * extracted copy of a 9 MB pack, and keeps the zip the single archive of
 * record for what was downloaded.
 *
 * Run via `npm run assets:import-kenney`. Output is checked in, not built
 * at deploy time - same as `assets:generate`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readZipEntry } from './assets/zipReader';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ZIP_DIR = resolve(REPO_ROOT, 'assets');
const OUTPUT_DIR = resolve(REPO_ROOT, 'public', 'models');

/** The bounding box of the generated asset an import takes over from. */
interface Envelope {
  x: number;
  y: number;
  z: number;
}

interface ImportSpec {
  /** Zip under `assets/`. */
  zip: string;
  /** Path of the `.glb` inside that zip. */
  entry: string;
  /** Path of the shared colormap inside that zip. */
  texture: string;
  /** Output basename under `public/models/`, without extension. */
  out: string;
  /** Manifest id this file is imported to serve, for the log line. */
  servesId: string;
  /**
   * The generated asset's bounding box the import must fit inside. For an
   * LOD level this is its *parent's* box, not its own: the collider a
   * child walks into belongs to the object, not to the detail level, and
   * sharing the parent's box is what makes both levels land on the same
   * height so the swap at `distanceMeters` has no vertical pop.
   */
  fitInside: Envelope;
}

const IMPORTS: readonly ImportSpec[] = [
  {
    // From the town kit rather than the castle kit, whose `rocks-small` is
    // a wide flat cluster: fitted to the same box it comes out 0.18m tall
    // against the generated boulder's 0.35m, where this one keeps its
    // height. Different kit, same artist and the same flat-palette style,
    // so the mix costs one extra 11 KB atlas and nothing visual.
    zip: 'kenney_fantasy-town-kit_2.0.zip',
    entry: 'Models/GLB format/rock-small.glb',
    texture: 'Models/GLB format/Textures/colormap.png',
    out: 'kenney-rock-small',
    servesId: 'rock',
    // rock.gltf
    fitInside: { x: 0.5, y: 0.35, z: 0.4 },
  },
  {
    zip: 'kenney_castle-kit.zip',
    entry: 'Models/GLB format/tree-large.glb',
    texture: 'Models/GLB format/Textures/colormap.png',
    out: 'kenney-tree-large',
    servesId: 'foliage-tree',
    // foliage-tree.gltf
    fitInside: { x: 1.8, y: 2.6, z: 1.8 },
  },
  {
    zip: 'kenney_castle-kit.zip',
    entry: 'Models/GLB format/tree-small.glb',
    texture: 'Models/GLB format/Textures/colormap.png',
    out: 'kenney-tree-small',
    servesId: 'foliage-tree-lod1',
    // foliage-tree.gltf, not foliage-tree-lod1.gltf - see `fitInside`.
    fitInside: { x: 1.8, y: 2.6, z: 1.8 },
  },
];

// --- glb container ----------------------------------------------------

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

/** The subset of glTF this script reads or rewrites. Not a full schema. */
interface Gltf {
  scenes: { nodes: number[] }[];
  scene?: number;
  nodes: {
    mesh?: number;
    children?: number[];
    matrix?: number[];
    translation?: number[];
    rotation?: number[];
    scale?: number[];
  }[];
  meshes: { primitives: { attributes: Record<string, number>; indices?: number }[] }[];
  accessors: {
    bufferView?: number;
    componentType: number;
    count: number;
    type: string;
    min?: number[];
    max?: number[];
  }[];
  bufferViews: {
    buffer: number;
    byteOffset?: number;
    byteLength: number;
    byteStride?: number;
    target?: number;
  }[];
  buffers: { byteLength: number; uri?: string }[];
  images?: { uri?: string; bufferView?: number; mimeType?: string; name?: string }[];
  extensionsRequired?: string[];
}

function parseGlb(bytes: Buffer): { json: Gltf; bin: Buffer } {
  if (bytes.readUInt32LE(0) !== GLB_MAGIC) {
    throw new Error('not a binary glTF');
  }
  let json: Gltf | undefined;
  let bin: Buffer | undefined;
  let offset = 12;
  while (offset < bytes.length) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === CHUNK_JSON) {
      json = JSON.parse(chunk.toString('utf8')) as Gltf;
    } else if (type === CHUNK_BIN) {
      bin = Buffer.from(chunk);
    }
    offset += 8 + length + ((4 - (length % 4)) % 4);
  }
  if (!json || !bin) {
    throw new Error('binary glTF is missing its JSON or BIN chunk');
  }
  return { json, bin };
}

function padTo4(length: number): number {
  return (4 - (length % 4)) % 4;
}

function serialiseGlb(json: Gltf, bin: Buffer): Buffer {
  const jsonBytes = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPad = Buffer.alloc(padTo4(jsonBytes.length), 0x20); // spaces
  const binPad = Buffer.alloc(padTo4(bin.length), 0x00);
  const jsonChunk = jsonBytes.length + jsonPad.length;
  const binChunk = bin.length + binPad.length;

  const header = Buffer.alloc(12);
  header.writeUInt32LE(GLB_MAGIC, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk + 8 + binChunk, 8);

  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonChunk, 0);
  jsonHeader.writeUInt32LE(CHUNK_JSON, 4);

  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binChunk, 0);
  binHeader.writeUInt32LE(CHUNK_BIN, 4);

  return Buffer.concat([header, jsonHeader, jsonBytes, jsonPad, binHeader, bin, binPad]);
}

// --- normalisation ----------------------------------------------------

const FLOAT32 = 5126;

/** Every POSITION accessor reachable from the scene, deduplicated. */
function positionAccessors(json: Gltf): number[] {
  const found = new Set<number>();
  for (const mesh of json.meshes) {
    for (const primitive of mesh.primitives) {
      const position = primitive.attributes.POSITION;
      if (position !== undefined) {
        found.add(position);
      }
    }
  }
  return [...found];
}

function measure(json: Gltf): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const index of positionAccessors(json)) {
    const accessor = json.accessors[index];
    if (!accessor.min || !accessor.max) {
      throw new Error(`accessor ${index} has no min/max, cannot measure`);
    }
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], accessor.min[axis]);
      max[axis] = Math.max(max[axis], accessor.max[axis]);
    }
  }
  return { min, max };
}

/**
 * The largest uniform factor that fits the mesh inside `fitInside` on every
 * axis. A zero-extent axis (a flat plane) cannot constrain the fit and is
 * skipped rather than producing a division by zero.
 */
function fitScale(size: number[], fitInside: Envelope): number {
  const limits = [fitInside.x, fitInside.y, fitInside.z]
    .map((limit, axis) => (size[axis] > 1e-6 ? limit / size[axis] : Infinity))
    .filter((factor) => Number.isFinite(factor));
  if (limits.length === 0) {
    throw new Error('mesh has no measurable extent on any axis');
  }
  return Math.min(...limits);
}

/** Scales POSITION data in place. Uniform scale leaves NORMAL/TANGENT valid. */
function scalePositions(json: Gltf, bin: Buffer, factor: number): void {
  for (const index of positionAccessors(json)) {
    const accessor = json.accessors[index];
    if (accessor.componentType !== FLOAT32 || accessor.type !== 'VEC3') {
      throw new Error(`accessor ${index}: POSITION must be float32 VEC3 to rescale`);
    }
    if (accessor.bufferView === undefined) {
      throw new Error(`accessor ${index}: sparse or bufferless POSITION is not supported`);
    }
    const view = json.bufferViews[accessor.bufferView];
    const stride = view.byteStride ?? 12;
    const base = view.byteOffset ?? 0;
    for (let i = 0; i < accessor.count; i++) {
      for (let axis = 0; axis < 3; axis++) {
        const at = base + i * stride + axis * 4;
        bin.writeFloatLE(bin.readFloatLE(at) * factor, at);
      }
    }
    accessor.min = accessor.min?.map((value) => value * factor);
    accessor.max = accessor.max?.map((value) => value * factor);
  }
}

/** Replaces every external image uri with the png embedded as a bufferView. */
function embedTexture(json: Gltf, bin: Buffer, png: Buffer): Buffer {
  const images = json.images ?? [];
  if (images.length === 0) {
    return bin;
  }
  if (images.every((image) => image.bufferView !== undefined)) {
    return bin;
  }

  const padding = Buffer.alloc(padTo4(bin.length), 0x00);
  const withImage = Buffer.concat([bin, padding, png]);
  json.bufferViews.push({
    buffer: 0,
    byteOffset: bin.length + padding.length,
    byteLength: png.length,
  });
  const bufferView = json.bufferViews.length - 1;

  for (const image of images) {
    if (image.bufferView !== undefined) {
      continue;
    }
    delete image.uri;
    image.bufferView = bufferView;
    image.mimeType = 'image/png';
  }
  json.buffers[0].byteLength = withImage.length;
  return withImage;
}

function assertIdentityRoots(json: Gltf): void {
  const scene = json.scenes[json.scene ?? 0];
  for (const index of scene.nodes) {
    const node = json.nodes[index];
    const moved =
      node.matrix !== undefined ||
      node.translation !== undefined ||
      node.rotation !== undefined ||
      node.scale !== undefined;
    if (moved) {
      throw new Error(
        `root node ${index} has a transform; baking scale into vertices assumes identity roots`,
      );
    }
  }
}

// --- run --------------------------------------------------------------

const round = (value: number): string => value.toFixed(3);

mkdirSync(OUTPUT_DIR, { recursive: true });

for (const spec of IMPORTS) {
  const zipPath = resolve(ZIP_DIR, spec.zip);
  const { json, bin } = parseGlb(readZipEntry(zipPath, spec.entry));

  if (json.extensionsRequired?.length) {
    // GLTFLoader returns an incomplete scene for an unsupported required
    // extension rather than throwing, so refuse the file here instead.
    throw new Error(
      `${spec.entry}: requires glTF extensions ${json.extensionsRequired.join(', ')}`,
    );
  }
  assertIdentityRoots(json);

  const before = measure(json);
  const size = [0, 1, 2].map((axis) => before.max[axis] - before.min[axis]);
  const factor = fitScale(size, spec.fitInside);

  scalePositions(json, bin, factor);
  const withTexture = embedTexture(json, bin, readZipEntry(zipPath, spec.texture));

  const after = measure(json);
  const outPath = resolve(OUTPUT_DIR, `${spec.out}.glb`);
  writeFileSync(outPath, serialiseGlb(json, withTexture));

  const dims = [0, 1, 2].map((axis) => round(after.max[axis] - after.min[axis])).join(' x ');
  console.log(
    `${spec.out}.glb  serves "${spec.servesId}"  scale ${round(factor)}  ` +
      `${size.map(round).join(' x ')} -> ${dims}  (fits ${round(spec.fitInside.x)} x ` +
      `${round(spec.fitInside.y)} x ${round(spec.fitInside.z)})`,
  );
}

console.log(`imported ${IMPORTS.length} Kenney assets into ${OUTPUT_DIR}`);
