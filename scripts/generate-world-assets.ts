/**
 * The `docs/ROADMAP.md` Phase 34 asset generator: produces every file in
 * the first asset pack (terrain kit, one building kit, bridge plank
 * variants, one NPC, one companion asset, quest props, foliage kit, one
 * collectible) as single-file `.gltf` documents under `public/models/`.
 *
 * There is no artist and no 3D modeling tool in this environment, so "real
 * art" means real, checked-in, `GLTFLoader`-loadable glTF files built from
 * primitive geometry rather than a hand-modeled asset - see
 * `docs/THREE_WORLD_ASSET_CONVENTIONS.md` for the conventions this follows
 * and `docs/IMPLEMENTATION_STATUS.md`'s Phase 34 entry for why this
 * approach was chosen over `THREE.GLTFExporter` (browser-DOM-oriented,
 * risky in Node) or third-party asset packs (licensing, network
 * dependency, and a poor fit for this world's bespoke needs - a specific
 * broken/repaired bridge, a specific NPC).
 *
 * Run via `npm run assets:generate` (`tsx scripts/generate-world-assets.ts`).
 * Regenerate after changing any asset's authoring below; the output is
 * checked in, not built at deploy time.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assembleGltfDocument,
  hexToRgb01,
  type AnimationChannelDef,
  type AnimationClipDef,
  type MeshPart,
} from '../src/features/island-map/three/assets/gltfAssembler';
import {
  buildBoxPrimitive,
  buildConePrimitive,
  buildCylinderPrimitive,
  buildGroundPlanePrimitive,
  buildPlanePrimitive,
  buildTorusPrimitive,
} from '../src/features/island-map/three/assets/primitives';

const OUTPUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'models');

// --- small authoring helpers -----------------------------------------------

function track(
  targetPart: string,
  path: AnimationChannelDef['path'],
  keyframes: readonly (readonly number[])[],
): AnimationChannelDef {
  return {
    targetPart,
    path,
    times: keyframes.map((keyframe) => keyframe[0]),
    values: keyframes.flatMap((keyframe) => keyframe.slice(1)),
  };
}

function quat(axis: readonly [number, number, number], angleRadians: number): [number, number, number, number] {
  const half = angleRadians / 2;
  const s = Math.sin(half);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(half)];
}

const IDENTITY_QUAT: readonly [number, number, number, number] = [0, 0, 0, 1];

/** Hamilton product: rotating by `b` then by `a`. */
function multiplyQuat(
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number],
): [number, number, number, number] {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/**
 * Keyframes for a full turn around world Y, composed on top of a fixed
 * `base` orientation. A 2-keyframe 0->2*PI track is degenerate for
 * quaternion interpolation (both ends encode the same rotation, so slerp
 * has no defined path between them) - this samples enough waypoints for a
 * continuous spin instead.
 */
function spinYKeyframes(
  periodSeconds: number,
  base: readonly [number, number, number, number] = IDENTITY_QUAT,
  steps = 4,
): (readonly number[])[] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = (i / steps) * periodSeconds;
    const spin = quat([0, 1, 0], (i / steps) * Math.PI * 2);
    return [t, ...multiplyQuat(spin, base)];
  });
}

/** A gentle up/down breathing motion, looped - used by every character/collectible's Idle clip. */
function idleBob(part: string, amplitude: number, periodSeconds = 1.2): AnimationClipDef {
  return {
    name: 'Idle',
    channels: [track(part, 'translation', [
      [0, 0, 0, 0],
      [periodSeconds / 2, 0, amplitude, 0],
      [periodSeconds, 0, 0, 0],
    ])],
  };
}

// --- terrain kit -------------------------------------------------------------

function groundTile(): Record<string, unknown> {
  const part: MeshPart = { name: 'Tile', primitive: buildGroundPlanePrimitive(4, 4), color: hexToRgb01(0xd8c48a) };
  return assembleGltfDocument({ parts: [part] });
}

function rock(): Record<string, unknown> {
  const part: MeshPart = { name: 'Rock', primitive: buildBoxPrimitive(0.5, 0.35, 0.4), color: hexToRgb01(0x8c8c94) };
  return assembleGltfDocument({ parts: [part] });
}

// --- building kit --------------------------------------------------------

function wall(): Record<string, unknown> {
  const part: MeshPart = { name: 'Wall', primitive: buildPlanePrimitive(2, 3), color: hexToRgb01(0x9c7a54) };
  return assembleGltfDocument({ parts: [part] });
}

function roof(): Record<string, unknown> {
  const part: MeshPart = { name: 'Roof', primitive: buildConePrimitive(1.5, 1.4, 4), color: hexToRgb01(0x6b4a34) };
  return assembleGltfDocument({ parts: [part] });
}

function door(): Record<string, unknown> {
  const part: MeshPart = { name: 'Door', primitive: buildPlanePrimitive(0.9, 1.9), color: hexToRgb01(0x4a3423) };
  return assembleGltfDocument({ parts: [part] });
}

// --- fence / path kit ------------------------------------------------------

function fence(): Record<string, unknown> {
  const part: MeshPart = { name: 'Fence', primitive: buildPlanePrimitive(1.2, 0.9), color: hexToRgb01(0x8a7a5a) };
  return assembleGltfDocument({ parts: [part] });
}

function path(): Record<string, unknown> {
  const part: MeshPart = { name: 'Path', primitive: buildGroundPlanePrimitive(1.5, 1.5), color: hexToRgb01(0xb9ab8c) };
  return assembleGltfDocument({ parts: [part] });
}

// --- bridge --------------------------------------------------------------

function bridgePlank(repaired: boolean): Record<string, unknown> {
  const part: MeshPart = {
    name: 'Plank',
    primitive: buildBoxPrimitive(0.9, 0.15, 3),
    color: hexToRgb01(repaired ? 0xcaa768 : 0x8a6a45),
    ...(repaired ? { emissive: hexToRgb01(0x332711) } : {}),
  };
  return assembleGltfDocument({ parts: [part] });
}

// --- foliage kit -----------------------------------------------------------

function foliageTree(): Record<string, unknown> {
  const trunk: MeshPart = { name: 'Trunk', primitive: buildCylinderPrimitive(0.12, 0.16, 1.0, 6), color: hexToRgb01(0x5a3d28) };
  const canopy: MeshPart = {
    name: 'Canopy',
    primitive: buildConePrimitive(0.9, 1.6, 8),
    color: hexToRgb01(0x3f7d43),
    translation: [0, 1.0, 0],
  };
  return assembleGltfDocument({ parts: [trunk, canopy] });
}

function foliageTreeLod1(): Record<string, unknown> {
  const part: MeshPart = { name: 'Canopy', primitive: buildConePrimitive(0.7, 1.8, 5), color: hexToRgb01(0x3f7d43) };
  return assembleGltfDocument({ parts: [part] });
}

function foliageBush(): Record<string, unknown> {
  const color = hexToRgb01(0x4a8a4f);
  const parts: MeshPart[] = [
    { name: 'Clump1', primitive: buildBoxPrimitive(0.35, 0.3, 0.35), color },
    { name: 'Clump2', primitive: buildBoxPrimitive(0.28, 0.24, 0.28), color, translation: [0.12, 0.08, 0.05] },
    { name: 'Clump3', primitive: buildBoxPrimitive(0.28, 0.24, 0.28), color, translation: [-0.1, 0.05, -0.08] },
  ];
  return assembleGltfDocument({ parts });
}

// --- one NPC: Pirate Pip ---------------------------------------------------

function npcPip(): Record<string, unknown> {
  const bodyHeight = 0.7;
  const headSize = 0.32;
  const parts: MeshPart[] = [
    { name: 'Body', primitive: buildBoxPrimitive(0.5, bodyHeight, 0.35), color: hexToRgb01(0x7a5230) },
    { name: 'Head', primitive: buildBoxPrimitive(headSize, headSize, headSize), color: hexToRgb01(0xd9a670), translation: [0, bodyHeight, 0] },
    {
      name: 'Hat',
      primitive: buildConePrimitive(0.28, 0.22, 4),
      color: hexToRgb01(0x241d18),
      translation: [0, bodyHeight + headSize, 0],
    },
    { name: 'Arm', primitive: buildBoxPrimitive(0.1, 0.45, 0.1), color: hexToRgb01(0xd9a670), translation: [0.28, 0.2, 0] },
  ];

  const idle: AnimationClipDef = idleBob('Body', 0.03);
  const talk: AnimationClipDef = {
    name: 'Talk',
    channels: [track('Head', 'rotation', [
      [0, ...IDENTITY_QUAT],
      [0.15, ...quat([1, 0, 0], 0.12)],
      [0.3, ...IDENTITY_QUAT],
      [0.45, ...quat([1, 0, 0], 0.12)],
      [0.6, ...IDENTITY_QUAT],
    ])],
  };
  const wave: AnimationClipDef = {
    name: 'Wave',
    channels: [track('Arm', 'rotation', [
      [0, ...IDENTITY_QUAT],
      [0.3, ...quat([0, 0, 1], -Math.PI / 3)],
      [0.6, ...IDENTITY_QUAT],
      [0.9, ...quat([0, 0, 1], -Math.PI / 3)],
      [1.2, ...IDENTITY_QUAT],
    ])],
  };

  return assembleGltfDocument({ parts, animations: [idle, talk, wave] });
}

// --- one companion asset: Chatty the Parrot --------------------------------

function companionChatty(): Record<string, unknown> {
  const parts: MeshPart[] = [
    { name: 'Perch', primitive: buildCylinderPrimitive(0.05, 0.05, 0.15, 8), color: hexToRgb01(0x6b4a34) },
    { name: 'Body', primitive: buildBoxPrimitive(0.22, 0.32, 0.22), color: hexToRgb01(0x2f9e52), translation: [0, 0.15, 0] },
    { name: 'Wing', primitive: buildBoxPrimitive(0.05, 0.22, 0.16), color: hexToRgb01(0x1f7a3d), translation: [0.13, 0.3, 0] },
    { name: 'Tail', primitive: buildBoxPrimitive(0.06, 0.18, 0.06), color: hexToRgb01(0xc23b3b), translation: [0, 0.15, -0.14] },
    {
      name: 'Beak',
      primitive: buildConePrimitive(0.05, 0.12, 4),
      color: hexToRgb01(0xf0a63a),
      translation: [0, 0.4, 0.1],
      rotation: quat([1, 0, 0], Math.PI / 2),
    },
    { name: 'Eye', primitive: buildBoxPrimitive(0.04, 0.04, 0.04), color: hexToRgb01(0x1a1a1a), translation: [0.08, 0.42, 0.08] },
  ];

  const idle: AnimationClipDef = {
    name: 'Idle',
    channels: [
      ...idleBob('Body', 0.02).channels,
      track('Wing', 'translation', [
        [0, 0.13, 0.3, 0],
        [0.6, 0.13, 0.32, 0],
        [1.2, 0.13, 0.3, 0],
      ]),
    ],
  };

  return assembleGltfDocument({ parts, animations: [idle] });
}

// --- quest props -----------------------------------------------------------

function ropeCoil(): Record<string, unknown> {
  const part: MeshPart = { name: 'Coil', primitive: buildTorusPrimitive(0.22, 0.07, 8, 16), color: hexToRgb01(0xb0793a) };
  return assembleGltfDocument({ parts: [part] });
}

function toolbox(): Record<string, unknown> {
  const part: MeshPart = { name: 'Box', primitive: buildBoxPrimitive(0.5, 0.3, 0.3), color: hexToRgb01(0x555f6b) };
  return assembleGltfDocument({ parts: [part] });
}

function treasureChest(): Record<string, unknown> {
  const bodyHeight = 0.3;
  const body: MeshPart = { name: 'Body', primitive: buildBoxPrimitive(0.6, bodyHeight, 0.4), color: hexToRgb01(0xd4a63a) };
  const lid: MeshPart = {
    name: 'Lid',
    primitive: buildBoxPrimitive(0.6, 0.12, 0.4),
    color: hexToRgb01(0xb3872c),
    translation: [0, bodyHeight, 0],
  };
  const openClip: AnimationClipDef = {
    name: 'Open',
    channels: [track('Lid', 'rotation', [
      [0, ...IDENTITY_QUAT],
      [0.8, ...quat([1, 0, 0], -Math.PI / 2.2)],
    ])],
  };
  return assembleGltfDocument({ parts: [body, lid], animations: [openClip] });
}

function signpost(): Record<string, unknown> {
  const post: MeshPart = { name: 'Post', primitive: buildCylinderPrimitive(0.05, 0.05, 1.2, 8), color: hexToRgb01(0x6b4a34) };
  const plank: MeshPart = {
    name: 'Plank',
    primitive: buildBoxPrimitive(0.5, 0.15, 0.05),
    color: hexToRgb01(0xc9b48a),
    translation: [0, 0.9, 0],
  };
  return assembleGltfDocument({ parts: [post, plank] });
}

// --- one collectible ---------------------------------------------------

function collectibleGem(): Record<string, unknown> {
  const radius = 0.22;
  const height = 0.28;
  const segments = 6;
  const top: MeshPart = {
    name: 'Top',
    primitive: buildConePrimitive(radius, height, segments),
    color: hexToRgb01(0x5ad1e6),
    translation: [0, height, 0],
  };
  const bottom: MeshPart = {
    name: 'Bottom',
    primitive: buildConePrimitive(radius, height, segments),
    color: hexToRgb01(0x3fa8c2),
    translation: [0, height, 0],
    rotation: quat([1, 0, 0], Math.PI),
  };
  const spin: AnimationClipDef = {
    name: 'Idle',
    channels: [
      track('Top', 'rotation', spinYKeyframes(4)),
      track('Bottom', 'rotation', spinYKeyframes(4, quat([1, 0, 0], Math.PI))),
    ],
  };
  return assembleGltfDocument({ parts: [top, bottom], animations: [spin] });
}

// --- write everything --------------------------------------------------

const ASSETS: Record<string, () => Record<string, unknown>> = {
  'ground-tile': groundTile,
  rock,
  wall,
  roof,
  door,
  fence,
  path,
  'bridge-plank': () => bridgePlank(false),
  'bridge-plank-repaired': () => bridgePlank(true),
  'foliage-tree': foliageTree,
  'foliage-tree-lod1': foliageTreeLod1,
  'foliage-bush': foliageBush,
  'npc-pip': npcPip,
  'companion-chatty': companionChatty,
  'rope-coil': ropeCoil,
  toolbox,
  'treasure-chest': treasureChest,
  signpost,
  'collectible-gem': collectibleGem,
};

mkdirSync(OUTPUT_DIR, { recursive: true });
for (const [id, build] of Object.entries(ASSETS)) {
  const document = build();
  const filePath = resolve(OUTPUT_DIR, `${id}.gltf`);
  writeFileSync(filePath, JSON.stringify(document));
  console.log(`wrote ${filePath}`);
}
console.log(`generated ${Object.keys(ASSETS).length} assets into ${OUTPUT_DIR}`);
