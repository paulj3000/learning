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
  type PrimitiveMesh,
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

function quat(
  axis: readonly [number, number, number],
  angleRadians: number,
): [number, number, number, number] {
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
    channels: [
      track(part, 'translation', [
        [0, 0, 0, 0],
        [periodSeconds / 2, 0, amplitude, 0],
        [periodSeconds, 0, 0, 0],
      ]),
    ],
  };
}

// --- terrain kit -------------------------------------------------------------

function groundTile(): Record<string, unknown> {
  const part: MeshPart = {
    name: 'Tile',
    primitive: buildGroundPlanePrimitive(4, 4),
    color: hexToRgb01(0xd8c48a),
  };
  return assembleGltfDocument({ parts: [part] });
}

function rock(): Record<string, unknown> {
  const part: MeshPart = {
    name: 'Rock',
    primitive: buildBoxPrimitive(0.5, 0.35, 0.4),
    color: hexToRgb01(0x8c8c94),
  };
  return assembleGltfDocument({ parts: [part] });
}

// --- building kit --------------------------------------------------------

function wall(): Record<string, unknown> {
  const part: MeshPart = {
    name: 'Wall',
    primitive: buildPlanePrimitive(2, 3),
    color: hexToRgb01(0x9c7a54),
  };
  return assembleGltfDocument({ parts: [part] });
}

function roof(): Record<string, unknown> {
  const part: MeshPart = {
    name: 'Roof',
    primitive: buildConePrimitive(1.5, 1.4, 4),
    color: hexToRgb01(0x6b4a34),
  };
  return assembleGltfDocument({ parts: [part] });
}

function door(): Record<string, unknown> {
  const part: MeshPart = {
    name: 'Door',
    primitive: buildPlanePrimitive(0.9, 1.9),
    color: hexToRgb01(0x4a3423),
  };
  return assembleGltfDocument({ parts: [part] });
}

// --- fence / path kit ------------------------------------------------------

function fence(): Record<string, unknown> {
  const part: MeshPart = {
    name: 'Fence',
    primitive: buildPlanePrimitive(1.2, 0.9),
    color: hexToRgb01(0x8a7a5a),
  };
  return assembleGltfDocument({ parts: [part] });
}

function path(): Record<string, unknown> {
  const part: MeshPart = {
    name: 'Path',
    primitive: buildGroundPlanePrimitive(1.5, 1.5),
    color: hexToRgb01(0xb9ab8c),
  };
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
  const trunk: MeshPart = {
    name: 'Trunk',
    primitive: buildCylinderPrimitive(0.12, 0.16, 1.0, 6),
    color: hexToRgb01(0x5a3d28),
  };
  const canopy: MeshPart = {
    name: 'Canopy',
    primitive: buildConePrimitive(0.9, 1.6, 8),
    color: hexToRgb01(0x3f7d43),
    translation: [0, 1.0, 0],
  };
  return assembleGltfDocument({ parts: [trunk, canopy] });
}

function foliageTreeLod1(): Record<string, unknown> {
  const part: MeshPart = {
    name: 'Canopy',
    primitive: buildConePrimitive(0.7, 1.8, 5),
    color: hexToRgb01(0x3f7d43),
  };
  return assembleGltfDocument({ parts: [part] });
}

function foliageBush(): Record<string, unknown> {
  const color = hexToRgb01(0x4a8a4f);
  const parts: MeshPart[] = [
    { name: 'Clump1', primitive: buildBoxPrimitive(0.35, 0.3, 0.35), color },
    {
      name: 'Clump2',
      primitive: buildBoxPrimitive(0.28, 0.24, 0.28),
      color,
      translation: [0.12, 0.08, 0.05],
    },
    {
      name: 'Clump3',
      primitive: buildBoxPrimitive(0.28, 0.24, 0.28),
      color,
      translation: [-0.1, 0.05, -0.08],
    },
  ];
  return assembleGltfDocument({ parts });
}

// --- one NPC: Pirate Pip ---------------------------------------------------

function npcPip(): Record<string, unknown> {
  const bodyHeight = 0.7;
  const headSize = 0.32;
  const parts: MeshPart[] = [
    {
      name: 'Body',
      primitive: buildBoxPrimitive(0.5, bodyHeight, 0.35),
      color: hexToRgb01(0x7a5230),
    },
    {
      name: 'Head',
      primitive: buildBoxPrimitive(headSize, headSize, headSize),
      color: hexToRgb01(0xd9a670),
      translation: [0, bodyHeight, 0],
    },
    {
      name: 'Hat',
      primitive: buildConePrimitive(0.28, 0.22, 4),
      color: hexToRgb01(0x241d18),
      translation: [0, bodyHeight + headSize, 0],
    },
    {
      name: 'Arm',
      primitive: buildBoxPrimitive(0.1, 0.45, 0.1),
      color: hexToRgb01(0xd9a670),
      translation: [0.28, 0.2, 0],
    },
  ];

  const idle: AnimationClipDef = idleBob('Body', 0.03);
  const talk: AnimationClipDef = {
    name: 'Talk',
    channels: [
      track('Head', 'rotation', [
        [0, ...IDENTITY_QUAT],
        [0.15, ...quat([1, 0, 0], 0.12)],
        [0.3, ...IDENTITY_QUAT],
        [0.45, ...quat([1, 0, 0], 0.12)],
        [0.6, ...IDENTITY_QUAT],
      ]),
    ],
  };
  const wave: AnimationClipDef = {
    name: 'Wave',
    channels: [
      track('Arm', 'rotation', [
        [0, ...IDENTITY_QUAT],
        [0.3, ...quat([0, 0, 1], -Math.PI / 3)],
        [0.6, ...IDENTITY_QUAT],
        [0.9, ...quat([0, 0, 1], -Math.PI / 3)],
        [1.2, ...IDENTITY_QUAT],
      ]),
    ],
  };

  return assembleGltfDocument({ parts, animations: [idle, talk, wave] });
}

// --- one companion asset: Chatty the Parrot --------------------------------

function companionChatty(): Record<string, unknown> {
  const parts: MeshPart[] = [
    {
      name: 'Perch',
      primitive: buildCylinderPrimitive(0.05, 0.05, 0.15, 8),
      color: hexToRgb01(0x6b4a34),
    },
    {
      name: 'Body',
      primitive: buildBoxPrimitive(0.22, 0.32, 0.22),
      color: hexToRgb01(0x2f9e52),
      translation: [0, 0.15, 0],
    },
    {
      name: 'Wing',
      primitive: buildBoxPrimitive(0.05, 0.22, 0.16),
      color: hexToRgb01(0x1f7a3d),
      translation: [0.13, 0.3, 0],
    },
    {
      name: 'Tail',
      primitive: buildBoxPrimitive(0.06, 0.18, 0.06),
      color: hexToRgb01(0xc23b3b),
      translation: [0, 0.15, -0.14],
    },
    {
      name: 'Beak',
      primitive: buildConePrimitive(0.05, 0.12, 4),
      color: hexToRgb01(0xf0a63a),
      translation: [0, 0.4, 0.1],
      rotation: quat([1, 0, 0], Math.PI / 2),
    },
    {
      name: 'Eye',
      primitive: buildBoxPrimitive(0.04, 0.04, 0.04),
      color: hexToRgb01(0x1a1a1a),
      translation: [0.08, 0.42, 0.08],
    },
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
  const part: MeshPart = {
    name: 'Coil',
    primitive: buildTorusPrimitive(0.22, 0.07, 8, 16),
    color: hexToRgb01(0xb0793a),
  };
  return assembleGltfDocument({ parts: [part] });
}

function toolbox(): Record<string, unknown> {
  const part: MeshPart = {
    name: 'Box',
    primitive: buildBoxPrimitive(0.5, 0.3, 0.3),
    color: hexToRgb01(0x555f6b),
  };
  return assembleGltfDocument({ parts: [part] });
}

function treasureChest(): Record<string, unknown> {
  const bodyHeight = 0.3;
  const body: MeshPart = {
    name: 'Body',
    primitive: buildBoxPrimitive(0.6, bodyHeight, 0.4),
    color: hexToRgb01(0xd4a63a),
  };
  const lid: MeshPart = {
    name: 'Lid',
    primitive: buildBoxPrimitive(0.6, 0.12, 0.4),
    color: hexToRgb01(0xb3872c),
    translation: [0, bodyHeight, 0],
  };
  const openClip: AnimationClipDef = {
    name: 'Open',
    channels: [
      track('Lid', 'rotation', [
        [0, ...IDENTITY_QUAT],
        [0.8, ...quat([1, 0, 0], -Math.PI / 2.2)],
      ]),
    ],
  };
  return assembleGltfDocument({ parts: [body, lid], animations: [openClip] });
}

function signpost(): Record<string, unknown> {
  const post: MeshPart = {
    name: 'Post',
    primitive: buildCylinderPrimitive(0.05, 0.05, 1.2, 8),
    color: hexToRgb01(0x6b4a34),
  };
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

// ===========================================================================
// Storykeeper Castle kit (`docs/STORYKEEPER_CASTLE_3D_ROADMAP.md` SC-1)
// ===========================================================================
//
// Appendix A of that roadmap is the inventory this section implements. Every
// asset below follows the same conventions as the Phase 34 pack above and in
// `docs/THREE_WORLD_ASSET_CONVENTIONS.md`: ground-pivoted, 1 unit = 1 metre,
// texture-free flat `baseColorFactor` (plus `emissiveFactor` where something
// is lit), TRS-only clips, and single-mesh for anything meant to be
// instanced.
//
// **Wall-mounted assets are ground-pivoted too**, exactly like everything
// else - a portrait's origin is the bottom of its frame, not its centre.
// `storykeeperCastleRegion.ts`'s `WallMountedSpot.y` is a *centre* height, so
// SC-2's placement code subtracts half the asset's height. One pivot
// convention for the whole pack beats a second one that only wall props obey.

/** A castle palette, named once so a recolour is a one-line change. */
const CASTLE = {
  stoneFloor: 0x8f95a1,
  stoneWall: 0x9aa0ab,
  stoneDark: 0x6d7380,
  ceiling: 0x555b66,
  carpet: 0x8c3b3b,
  woodDark: 0x5a4030,
  woodMid: 0x7a5a3c,
  woodLight: 0xa88a5c,
  brass: 0xc9a227,
  iron: 0x6b6f76,
  silver: 0xc8ccd4,
  parchment: 0xe6dcc0,
  ink: 0x2f3a4a,
  gold: 0xd4a63a,
  cloth: 0x4a5b8c,
  clothWarm: 0x8c4a3b,
  fur: 0xc08a4a,
  scale: 0x4f8f5a,
  snow: 0xe8eef5,
  leaf: 0x3f7d43,
  caveGlow: 0x5ad1e6,
  flame: 0xff9c3a,
  unlit: 0x3a3f48,
} as const;

/** Warm emissive tints. Anything that "lights up" in the castle uses one of these. */
const GLOW = { warm: 0x4a2f0c, bright: 0x6b4410, cool: 0x0d3a45 } as const;

function castlePart(
  name: string,
  primitive: PrimitiveMesh,
  color: number,
  extra: Partial<Omit<MeshPart, 'name' | 'primitive' | 'color'>> = {},
): MeshPart {
  return { name, primitive, color: hexToRgb01(color), ...extra };
}

/** A single-mesh asset - the only shape `createInstancedMeshFromAsset` may be pointed at. */
function singleMeshAsset(
  name: string,
  primitive: PrimitiveMesh,
  color: number,
  emissive?: number,
): Record<string, unknown> {
  return assembleGltfDocument({
    parts: [
      {
        name,
        primitive,
        color: hexToRgb01(color),
        ...(emissive === undefined ? {} : { emissive: hexToRgb01(emissive) }),
      },
    ],
  });
}

// --- A.2 recolours of existing geometry ------------------------------------

/**
 * The ceiling is the one piece neither existing region needed: Welcome
 * Harbor and Pirate Builder Bay are outdoors, so looking up has always shown
 * `scene.background`. Indoors that reads as a hole in the roof.
 */
const groundTileStone = () =>
  singleMeshAsset('Tile', buildGroundPlanePrimitive(4, 4), CASTLE.stoneFloor);
const ceilingTile = () => singleMeshAsset('Tile', buildGroundPlanePrimitive(4, 4), CASTLE.ceiling);
const wallStone = () => singleMeshAsset('Wall', buildPlanePrimitive(2, 3), CASTLE.stoneWall);
const carpet = () => singleMeshAsset('Carpet', buildGroundPlanePrimitive(1.5, 1.5), CASTLE.carpet);

// --- A.3 kit pieces --------------------------------------------------------

/**
 * Single-mesh on purpose: the Great Library places roughly sixteen of these
 * and they are the pack's main instancing candidate. A shelved-books look
 * would need sub-meshes, and `createInstancedMeshFromAsset` keeps only the
 * first mesh it finds - the trap `foliage-tree` already documents. A plain
 * slab silhouette in the right colour is the correct trade here.
 */
const bookshelf = () => singleMeshAsset('Shelf', buildBoxPrimitive(1.8, 2.4, 0.4), CASTLE.woodDark);

const tapestry = () => singleMeshAsset('Tapestry', buildPlanePrimitive(1.2, 2), CASTLE.cloth);
const portraitFrame = () => singleMeshAsset('Frame', buildPlanePrimitive(0.7, 0.9), CASTLE.woodMid);
const cushion = () =>
  singleMeshAsset('Cushion', buildBoxPrimitive(0.5, 0.18, 0.5), CASTLE.clothWarm);

/**
 * Star and moon carvings. Texture-free means a star is a five-sided pointed
 * stud and a moon is a disc: two silhouettes a child can tell apart at a
 * glance, which is all beats 9 and 10 need them to do.
 */
const starCarving = () =>
  singleMeshAsset('Star', buildConePrimitive(0.09, 0.035, 5), CASTLE.gold, GLOW.warm);
const moonCarving = () =>
  singleMeshAsset('Moon', buildCylinderPrimitive(0.08, 0.08, 0.03, 12), CASTLE.silver, GLOW.warm);

/**
 * Multi-part, so **never instanced** - `placeWithLod`/`instantiateAsset`
 * only. Seven placements, so there is nothing to gain from instancing it
 * anyway, and a one-mesh archway cannot have a hole in it.
 */
function archway(): Record<string, unknown> {
  const jamb = buildBoxPrimitive(0.3, 2.6, 0.6);
  return assembleGltfDocument({
    parts: [
      castlePart('JambLeft', jamb, CASTLE.stoneDark, { translation: [-1.15, 0, 0] }),
      castlePart('JambRight', jamb, CASTLE.stoneDark, { translation: [1.15, 0, 0] }),
      castlePart('Lintel', buildBoxPrimitive(2.6, 0.4, 0.6), CASTLE.stoneDark, {
        translation: [0, 2.6, 0],
      }),
    ],
  });
}

/** Optional warm-up lighting: `wall-sconce-lit` swaps in on `FIRST_STORY_TOLD`. */
const wallSconce = (lit: boolean) =>
  singleMeshAsset(
    'Sconce',
    buildConePrimitive(0.11, 0.26, 6),
    lit ? CASTLE.flame : CASTLE.unlit,
    lit ? GLOW.bright : undefined,
  );

// --- A.4 props -------------------------------------------------------------

function lectern(): Record<string, unknown> {
  return assembleGltfDocument({
    parts: [
      castlePart('Post', buildCylinderPrimitive(0.12, 0.16, 1.05, 8), CASTLE.woodDark),
      castlePart('Desk', buildBoxPrimitive(0.6, 0.08, 0.45), CASTLE.woodMid, {
        translation: [0, 1.05, 0],
        rotation: quat([1, 0, 0], -0.35),
      }),
      castlePart('Page', buildBoxPrimitive(0.42, 0.02, 0.3), CASTLE.parchment, {
        translation: [0, 1.14, 0.02],
        rotation: quat([1, 0, 0], -0.35),
      }),
    ],
  });
}

/**
 * The three story-beat plates of beat 6. The carved marks are *counted*
 * notches - one, two, three - rather than three different pictures, because
 * a five-year-old can compare one notch against two far more reliably than
 * they can read three untextured silhouettes apart. The HUD list names them
 * in words as well; the notches only have to make the three plates
 * distinguishable in the hand.
 */
function storyPlate(notches: number, color: number): Record<string, unknown> {
  const parts: MeshPart[] = [castlePart('Plate', buildBoxPrimitive(0.34, 0.05, 0.24), color)];
  for (let i = 0; i < notches; i += 1) {
    parts.push(
      castlePart(`Notch${i + 1}`, buildBoxPrimitive(0.04, 0.02, 0.14), CASTLE.stoneDark, {
        translation: [-0.09 + i * 0.09, 0.05, 0],
      }),
    );
  }
  return assembleGltfDocument({ parts });
}

function tableWithLegs(
  topWidth: number,
  topDepth: number,
  height: number,
  color: number,
  legColor: number,
): MeshPart[] {
  const legInsetX = topWidth / 2 - 0.1;
  const legInsetZ = topDepth / 2 - 0.1;
  const leg = buildBoxPrimitive(0.08, height, 0.08);
  return [
    castlePart('Top', buildBoxPrimitive(topWidth, 0.07, topDepth), color, {
      translation: [0, height, 0],
    }),
    castlePart('LegA', leg, legColor, { translation: [-legInsetX, 0, -legInsetZ] }),
    castlePart('LegB', leg, legColor, { translation: [legInsetX, 0, -legInsetZ] }),
    castlePart('LegC', leg, legColor, { translation: [-legInsetX, 0, legInsetZ] }),
    castlePart('LegD', leg, legColor, { translation: [legInsetX, 0, legInsetZ] }),
  ];
}

const readingTable = () =>
  assembleGltfDocument({ parts: tableWithLegs(1.4, 0.8, 0.72, CASTLE.woodMid, CASTLE.woodDark) });

const bindingTable = () =>
  assembleGltfDocument({ parts: tableWithLegs(1.1, 0.6, 0.75, CASTLE.woodLight, CASTLE.woodDark) });

const writingDesk = () =>
  assembleGltfDocument({
    parts: tableWithLegs(1.2, 0.65, 0.74, CASTLE.woodLight, CASTLE.woodDark),
  });

function costumeRack(): Record<string, unknown> {
  const post = buildCylinderPrimitive(0.04, 0.04, 1.7, 6);
  const parts: MeshPart[] = [
    castlePart('PostLeft', post, CASTLE.iron, { translation: [-0.55, 0, 0] }),
    castlePart('PostRight', post, CASTLE.iron, { translation: [0.55, 0, 0] }),
    castlePart('Rail', buildBoxPrimitive(1.2, 0.05, 0.05), CASTLE.iron, {
      translation: [0, 1.7, 0],
    }),
  ];
  const garmentColors = [CASTLE.clothWarm, CASTLE.cloth, CASTLE.scale];
  garmentColors.forEach((color, index) => {
    parts.push(
      castlePart(`Garment${index + 1}`, buildBoxPrimitive(0.28, 0.9, 0.12), color, {
        translation: [-0.35 + index * 0.35, 0.72, 0],
      }),
    );
  });
  return assembleGltfDocument({ parts });
}

/** Beat 9's three clues, three silhouettes: a closed book, a rolled scroll, a folded sheet. */
const clueDiary = () => singleMeshAsset('Diary', buildBoxPrimitive(0.2, 0.06, 0.14), CASTLE.ink);
const clueMap = () =>
  singleMeshAsset('Scroll', buildCylinderPrimitive(0.05, 0.05, 0.3, 10), CASTLE.parchment);
const clueNote = () =>
  singleMeshAsset('Note', buildBoxPrimitive(0.16, 0.01, 0.12), CASTLE.parchment);

function rodRack(): Record<string, unknown> {
  return assembleGltfDocument({
    parts: [
      castlePart('Base', buildBoxPrimitive(1, 0.08, 0.22), CASTLE.woodDark),
      castlePart('BackBoard', buildPlanePrimitive(1, 0.5), CASTLE.woodMid, {
        translation: [0, 0.08, -0.1],
      }),
    ],
  });
}

/**
 * The three rods of beat 10. `order-the-keys` grades ordering **by length**,
 * so these three lengths (0.35 / 0.6 / 0.9) are the asset's whole job - a
 * clear 1.7x step between neighbours, readable at eye height rather than
 * only in an asset viewer.
 */
const rod = (length: number, color: number) =>
  singleMeshAsset('Rod', buildCylinderPrimitive(0.03, 0.03, length, 8), color);

function roundWindow(): Record<string, unknown> {
  return assembleGltfDocument({
    parts: [
      castlePart('Frame', buildTorusPrimitive(0.45, 0.06, 8, 20), CASTLE.stoneDark, {
        rotation: quat([1, 0, 0], Math.PI / 2),
        translation: [0, 0.45, 0],
      }),
      castlePart('Glass', buildCylinderPrimitive(0.42, 0.42, 0.03, 20), CASTLE.parchment, {
        rotation: quat([1, 0, 0], Math.PI / 2),
        translation: [0, 0.45, 0.02],
        emissive: hexToRgb01(GLOW.warm),
      }),
    ],
  });
}

// --- A.5 state-variant pairs -----------------------------------------------

/**
 * A hero portrait: a frame, a mount, and a flat silhouette. Texture-free
 * means the hero is an extruded outline rather than a picture
 * (`docs/STORYKEEPER_CASTLE_3D_ROADMAP.md` A.10, risk 1) - Keeper Quill
 * names each one aloud and the HUD card names it in text, so the silhouette
 * is never the only cue a child has.
 */
function heroPortrait(hero: 'puppy' | 'dragon' | 'fox', lit: boolean): Record<string, unknown> {
  const frameColor = lit ? CASTLE.gold : CASTLE.woodMid;
  const parts: MeshPart[] = [
    castlePart('Frame', buildPlanePrimitive(0.8, 1), frameColor, {
      ...(lit ? { emissive: hexToRgb01(GLOW.bright) } : {}),
    }),
    castlePart(
      'Mount',
      buildPlanePrimitive(0.68, 0.86),
      lit ? CASTLE.parchment : CASTLE.stoneDark,
      {
        translation: [0, 0.07, 0.02],
      },
    ),
  ];

  if (hero === 'puppy') {
    parts.push(
      castlePart('Body', buildBoxPrimitive(0.32, 0.2, 0.02), CASTLE.fur, {
        translation: [0, 0.28, 0.04],
      }),
      castlePart('Head', buildBoxPrimitive(0.18, 0.18, 0.02), CASTLE.fur, {
        translation: [0.14, 0.46, 0.04],
      }),
      castlePart('Ear', buildConePrimitive(0.07, 0.14, 3), CASTLE.woodDark, {
        translation: [0.14, 0.62, 0.04],
      }),
    );
  } else if (hero === 'dragon') {
    parts.push(
      castlePart('Body', buildBoxPrimitive(0.3, 0.18, 0.02), CASTLE.scale, {
        translation: [-0.04, 0.3, 0.04],
      }),
      castlePart('Wing', buildConePrimitive(0.2, 0.28, 3), CASTLE.leaf, {
        translation: [-0.04, 0.46, 0.04],
      }),
      castlePart('Tail', buildConePrimitive(0.06, 0.26, 3), CASTLE.scale, {
        translation: [0.2, 0.3, 0.04],
        rotation: quat([0, 0, 1], -Math.PI / 2.4),
      }),
    );
  } else {
    parts.push(
      castlePart('Body', buildBoxPrimitive(0.3, 0.16, 0.02), CASTLE.clothWarm, {
        translation: [-0.02, 0.3, 0.04],
      }),
      castlePart('Head', buildConePrimitive(0.1, 0.18, 3), CASTLE.clothWarm, {
        translation: [0.16, 0.46, 0.04],
      }),
      castlePart('Tail', buildConePrimitive(0.09, 0.3, 3), CASTLE.fur, {
        translation: [-0.2, 0.3, 0.04],
        rotation: quat([0, 0, 1], Math.PI / 3),
      }),
    );
  }

  return assembleGltfDocument({ parts });
}

/** The arched stone surround the three window views sit inside. Static; no lit variant. */
function windowFrame(): Record<string, unknown> {
  const jamb = buildBoxPrimitive(0.2, 2.2, 0.3);
  return assembleGltfDocument({
    parts: [
      castlePart('JambLeft', jamb, CASTLE.stoneDark, { translation: [-0.7, 0, 0] }),
      castlePart('JambRight', jamb, CASTLE.stoneDark, { translation: [0.7, 0, 0] }),
      castlePart('Arch', buildConePrimitive(0.8, 0.5, 8), CASTLE.stoneDark, {
        translation: [0, 2.2, 0],
      }),
    ],
  });
}

/**
 * One of the three Setting Tower views. Lit is the chosen one (beat 4);
 * unlit is shuttered. Flat colour and silhouette only - no texture, so the
 * "view" is composed from two or three shapes against a backdrop.
 */
function windowView(
  setting: 'island' | 'mountain' | 'cave',
  lit: boolean,
): Record<string, unknown> {
  const backdrop: Record<typeof setting, number> = {
    island: 0x7fb2d9,
    mountain: 0x9db4c8,
    cave: 0x24303d,
  };
  const parts: MeshPart[] = [
    castlePart('Backdrop', buildPlanePrimitive(1.3, 2.1), lit ? backdrop[setting] : CASTLE.unlit, {
      ...(lit ? { emissive: hexToRgb01(setting === 'cave' ? GLOW.cool : GLOW.warm) } : {}),
    }),
  ];
  if (!lit) {
    // Shuttered: two plain boards across the opening, so a closed window
    // reads as deliberately closed rather than as a broken one.
    parts.push(
      castlePart('ShutterTop', buildBoxPrimitive(1.3, 0.9, 0.04), CASTLE.woodDark, {
        translation: [0, 1.2, 0.03],
      }),
      castlePart('ShutterBottom', buildBoxPrimitive(1.3, 0.9, 0.04), CASTLE.woodDark, {
        translation: [0, 0.2, 0.03],
      }),
    );
    return assembleGltfDocument({ parts });
  }

  if (setting === 'island') {
    parts.push(
      castlePart('Island', buildConePrimitive(0.45, 0.35, 6), CASTLE.stoneDark, {
        translation: [0, 0.95, 0.03],
        rotation: quat([0, 0, 1], Math.PI),
      }),
      castlePart('Grass', buildBoxPrimitive(0.8, 0.08, 0.02), CASTLE.leaf, {
        translation: [0, 0.95, 0.04],
      }),
      castlePart('Tree', buildConePrimitive(0.16, 0.4, 5), CASTLE.leaf, {
        translation: [0.16, 1.03, 0.05],
      }),
    );
  } else if (setting === 'mountain') {
    parts.push(
      castlePart('PeakBack', buildConePrimitive(0.5, 1, 4), CASTLE.stoneDark, {
        translation: [-0.24, 0.2, 0.03],
      }),
      castlePart('PeakFront', buildConePrimitive(0.42, 0.8, 4), CASTLE.stoneWall, {
        translation: [0.26, 0.2, 0.05],
      }),
      castlePart('Snow', buildConePrimitive(0.2, 0.34, 4), CASTLE.snow, {
        translation: [-0.24, 0.86, 0.04],
      }),
    );
  } else {
    parts.push(
      castlePart('Mouth', buildConePrimitive(0.55, 1.1, 3), 0x121a22, {
        translation: [0, 0.15, 0.03],
      }),
      castlePart('GlowA', buildCylinderPrimitive(0.09, 0.09, 0.02, 8), CASTLE.caveGlow, {
        translation: [-0.16, 0.6, 0.05],
        emissive: hexToRgb01(GLOW.cool),
      }),
      castlePart('GlowB', buildCylinderPrimitive(0.06, 0.06, 0.02, 8), CASTLE.caveGlow, {
        translation: [0.18, 0.85, 0.05],
        emissive: hexToRgb01(GLOW.cool),
      }),
    );
  }
  return assembleGltfDocument({ parts });
}

/** The hub hearth. `hearth-lit` swaps in on `FIRST_STORY_TOLD` (beat 8). */
function hearth(lit: boolean): Record<string, unknown> {
  const parts: MeshPart[] = [
    castlePart('Surround', buildBoxPrimitive(2.2, 1.9, 0.5), CASTLE.stoneDark),
    castlePart('Opening', buildBoxPrimitive(1.4, 1.2, 0.1), lit ? CASTLE.flame : 0x1b2028, {
      translation: [0, 0.15, 0.26],
      ...(lit ? { emissive: hexToRgb01(GLOW.bright) } : {}),
    }),
    castlePart('Mantel', buildBoxPrimitive(2.6, 0.22, 0.7), CASTLE.stoneWall, {
      translation: [0, 1.9, 0],
    }),
  ];
  if (lit) {
    parts.push(
      castlePart('Flame', buildConePrimitive(0.32, 0.55, 6), CASTLE.flame, {
        translation: [0, 0.2, 0.24],
        emissive: hexToRgb01(GLOW.bright),
      }),
    );
  }
  return assembleGltfDocument({ parts });
}

/**
 * The shelf slot beat 8 fills. The empty variant is placed from SC-2 onward
 * so the child walks past a visibly empty gap every visit *before* they have
 * a story to put in it; without that, the payoff lands on a shelf they never
 * noticed.
 */
function shelfSlot(shelved: boolean): Record<string, unknown> {
  const parts: MeshPart[] = [
    castlePart('SlotBack', buildBoxPrimitive(0.42, 0.4, 0.06), 0x241a12),
    castlePart('SlotFloor', buildBoxPrimitive(0.42, 0.05, 0.3), CASTLE.woodDark),
  ];
  if (shelved) {
    parts.push(
      castlePart('Book', buildBoxPrimitive(0.14, 0.34, 0.24), CASTLE.gold, {
        translation: [0, 0.05, 0.02],
        emissive: hexToRgb01(GLOW.warm),
      }),
    );
  }
  return assembleGltfDocument({ parts });
}

/** Beat 10's worn carving, before and after the child names it a moon. */
const carvingWorn = () =>
  singleMeshAsset('Worn', buildCylinderPrimitive(0.08, 0.08, 0.025, 12), CASTLE.stoneWall);
const carvingWornRevealed = () =>
  singleMeshAsset('Moon', buildCylinderPrimitive(0.08, 0.08, 0.03, 12), CASTLE.silver, GLOW.bright);

/**
 * The door with no handle, no keyhole, and no hinges you can see. `Open` is
 * authored on the ajar variant so SC-9 can play the swing once on solving
 * the lock, then rebuild with the ajar asset on every later visit.
 */
function secretDoor(ajar: boolean): Record<string, unknown> {
  const parts: MeshPart[] = [
    castlePart('Door', buildPlanePrimitive(1, 2.2), CASTLE.stoneDark, {
      ...(ajar ? { rotation: quat([0, 1, 0], -0.6), translation: [-0.5, 0, 0] } : {}),
    }),
  ];
  if (ajar) {
    parts.push(
      castlePart('LightSpill', buildPlanePrimitive(0.9, 2.1), CASTLE.flame, {
        translation: [0, 0, -0.05],
        emissive: hexToRgb01(GLOW.bright),
      }),
    );
  }

  const animations: AnimationClipDef[] = ajar
    ? [
        {
          name: 'Open',
          channels: [
            track('Door', 'rotation', [
              [0, ...IDENTITY_QUAT],
              [1.2, ...quat([0, 1, 0], -0.6)],
            ]),
          ],
        },
      ]
    : [];

  return assembleGltfDocument({
    parts,
    ...(animations.length > 0 ? { animations } : {}),
  });
}

/** The last bookshelf, swung aside once the door behind it is solved. */
function bookshelfAjar(): Record<string, unknown> {
  return assembleGltfDocument({
    parts: [
      castlePart('Shelf', buildBoxPrimitive(1.8, 2.4, 0.4), CASTLE.woodDark, {
        rotation: quat([0, 1, 0], -0.7),
        translation: [-0.6, 0, 0.3],
      }),
      castlePart('Gap', buildPlanePrimitive(1.1, 2.2), CASTLE.flame, {
        translation: [0.5, 0, -0.1],
        emissive: hexToRgb01(GLOW.warm),
      }),
    ],
  });
}

// --- A.6 the easel, composed rather than enumerated -------------------------
//
// Beat 7 fills the easel with shapes keyed by (hero, setting): three heroes
// times three settings is nine outcomes. Authoring nine finished canvases
// would mean nine assets to redraw if a fourth hero is ever added, so the
// hero silhouette and the setting backdrop are separate assets that SC-5
// layers - seven assets instead of ten, and a fourth hero costs one.

function easel(): Record<string, unknown> {
  const leg = buildBoxPrimitive(0.06, 1.5, 0.06);
  return assembleGltfDocument({
    parts: [
      castlePart('LegLeft', leg, CASTLE.woodDark, {
        translation: [-0.35, 0, 0],
        rotation: quat([0, 0, 1], 0.12),
      }),
      castlePart('LegRight', leg, CASTLE.woodDark, {
        translation: [0.35, 0, 0],
        rotation: quat([0, 0, 1], -0.12),
      }),
      castlePart('LegBack', leg, CASTLE.woodDark, {
        translation: [0, 0, -0.3],
        rotation: quat([1, 0, 0], 0.2),
      }),
      castlePart('Ledge', buildBoxPrimitive(0.9, 0.07, 0.14), CASTLE.woodMid, {
        translation: [0, 0.8, 0.05],
      }),
      castlePart('Canvas', buildPlanePrimitive(0.85, 0.7), CASTLE.parchment, {
        translation: [0, 0.87, 0.06],
      }),
    ],
  });
}

/** A hero silhouette for the easel canvas. Layered in front of a setting backdrop. */
function canvasHero(hero: 'puppy' | 'dragon' | 'fox'): Record<string, unknown> {
  const color = hero === 'puppy' ? CASTLE.fur : hero === 'dragon' ? CASTLE.scale : CASTLE.clothWarm;
  return assembleGltfDocument({
    parts: [
      castlePart('Body', buildBoxPrimitive(0.24, 0.14, 0.01), color),
      castlePart('Head', buildConePrimitive(0.08, 0.14, hero === 'puppy' ? 4 : 3), color, {
        translation: [0.12, 0.14, 0],
      }),
      castlePart('Tail', buildConePrimitive(0.05, 0.18, 3), color, {
        translation: [-0.15, 0.06, 0],
        rotation: quat([0, 0, 1], Math.PI / 3),
      }),
    ],
  });
}

/** A setting backdrop for the easel canvas. Layered behind a hero silhouette. */
function canvasSetting(setting: 'island' | 'mountain' | 'cave'): Record<string, unknown> {
  const sky = setting === 'island' ? 0x8fc4e8 : setting === 'mountain' ? 0xc3d4e2 : 0x2b3745;
  const parts: MeshPart[] = [castlePart('Sky', buildPlanePrimitive(0.8, 0.62), sky)];
  if (setting === 'island') {
    parts.push(
      castlePart('Land', buildBoxPrimitive(0.5, 0.06, 0.01), CASTLE.leaf, {
        translation: [0, 0.16, 0.01],
      }),
      castlePart('Tree', buildConePrimitive(0.09, 0.22, 5), CASTLE.leaf, {
        translation: [0.14, 0.2, 0.02],
      }),
    );
  } else if (setting === 'mountain') {
    parts.push(
      castlePart('Peak', buildConePrimitive(0.3, 0.42, 4), CASTLE.stoneWall, {
        translation: [-0.1, 0.06, 0.01],
      }),
      castlePart('Snow', buildConePrimitive(0.13, 0.16, 4), CASTLE.snow, {
        translation: [-0.1, 0.32, 0.02],
      }),
    );
  } else {
    parts.push(
      castlePart('Mouth', buildConePrimitive(0.3, 0.44, 3), 0x141c25, {
        translation: [0, 0.06, 0.01],
      }),
      castlePart('Glow', buildCylinderPrimitive(0.05, 0.05, 0.01, 8), CASTLE.caveGlow, {
        translation: [0.02, 0.26, 0.02],
        emissive: hexToRgb01(GLOW.cool),
      }),
    );
  }
  return assembleGltfDocument({ parts });
}

// --- A.7 the one new character: Keeper Quill --------------------------------

/**
 * Keeper Quill, the castle's librarian and the only new character in the
 * pack. Follows `npcPip` above exactly: a named multi-part node hierarchy
 * whose clips are TRS rotation/translation tracks on those nodes. There is
 * no skinning, no skeleton, and no bones anywhere in this pipeline.
 *
 * Two consequences worth restating at the authoring site:
 *
 * - **Quill must never go through `createInstancedMeshFromAsset`**, which
 *   keeps only the first mesh it finds and would render a floating robe.
 *   `instantiateAsset`/`placeWithLod` clone the whole scene. Quill is placed
 *   once, so nothing is lost.
 * - **`Body` is the raycast target** the conventions doc nominates. If the
 *   silhouette turns out to be a poor one in the browser, add an
 *   `InteractionAnchor` empty node rather than teaching the loader a second
 *   rule.
 *
 * No `Walk` clip: Quill is stationary and never follows the child, the same
 * call `storykeeperCastleDecor.ts` already makes in the Phaser castle.
 */
function npcQuill(): Record<string, unknown> {
  const robeHeight = 1.15;
  const headSize = 0.3;
  const parts: MeshPart[] = [
    castlePart('Body', buildConePrimitive(0.38, robeHeight, 8), CASTLE.cloth),
    castlePart('Head', buildBoxPrimitive(headSize, headSize, headSize), 0xd9a670, {
      translation: [0, robeHeight, 0],
    }),
    castlePart('Cap', buildCylinderPrimitive(0.18, 0.2, 0.14, 8), CASTLE.clothWarm, {
      translation: [0, robeHeight + headSize, 0],
    }),
    castlePart('Arm', buildBoxPrimitive(0.09, 0.5, 0.09), CASTLE.cloth, {
      translation: [0.3, 0.5, 0],
    }),
    castlePart('Quill', buildConePrimitive(0.03, 0.28, 4), CASTLE.parchment, {
      translation: [0.3, 1, 0],
    }),
  ];

  const idle = idleBob('Body', 0.025, 1.6);

  const talk: AnimationClipDef = {
    name: 'Talk',
    channels: [
      track('Head', 'rotation', [
        [0, ...IDENTITY_QUAT],
        [0.18, ...quat([1, 0, 0], 0.1)],
        [0.36, ...IDENTITY_QUAT],
        [0.54, ...quat([1, 0, 0], 0.1)],
        [0.72, ...IDENTITY_QUAT],
      ]),
    ],
  };

  const wave: AnimationClipDef = {
    name: 'Wave',
    channels: [
      track('Arm', 'rotation', [
        [0, ...IDENTITY_QUAT],
        [0.35, ...quat([0, 0, 1], -Math.PI / 3)],
        [0.7, ...IDENTITY_QUAT],
        [1.05, ...quat([0, 0, 1], -Math.PI / 3)],
        [1.4, ...IDENTITY_QUAT],
      ]),
    ],
  };

  /**
   * Beats 2 and 5: Quill points at the archway, then at the mantel. Held at
   * the end rather than sprung back, because it is wayfinding - the child
   * needs it still there when they look up from the HUD.
   */
  const point: AnimationClipDef = {
    name: 'Point',
    channels: [
      track('Arm', 'rotation', [
        [0, ...IDENTITY_QUAT],
        [0.45, ...quat([0, 0, 1], -Math.PI / 2)],
        [2.5, ...quat([0, 0, 1], -Math.PI / 2)],
      ]),
      track('Quill', 'rotation', [
        [0, ...IDENTITY_QUAT],
        [0.45, ...quat([0, 0, 1], -Math.PI / 2)],
        [2.5, ...quat([0, 0, 1], -Math.PI / 2)],
      ]),
    ],
  };

  const celebrate: AnimationClipDef = {
    name: 'Celebrate',
    channels: [
      track('Body', 'translation', [
        [0, 0, 0, 0],
        [0.3, 0, 0.14, 0],
        [0.6, 0, 0, 0],
        [0.9, 0, 0.1, 0],
        [1.2, 0, 0, 0],
      ]),
      track('Arm', 'rotation', [
        [0, ...IDENTITY_QUAT],
        [0.3, ...quat([0, 0, 1], -Math.PI / 1.6)],
        [1.2, ...quat([0, 0, 1], -Math.PI / 1.6)],
      ]),
    ],
  };

  /** Never scolding: a slow head tilt, held. The hint ladder does the talking. */
  const reactConcerned: AnimationClipDef = {
    name: 'ReactConcerned',
    channels: [
      track('Head', 'rotation', [
        [0, ...IDENTITY_QUAT],
        [0.6, ...quat([0, 0, 1], 0.18)],
        [1.8, ...quat([0, 0, 1], 0.18)],
      ]),
    ],
  };

  return assembleGltfDocument({
    parts,
    animations: [idle, talk, wave, point, celebrate, reactConcerned],
  });
}

/** Every Storykeeper Castle asset, id -> builder. Merged into `ASSETS` below. */
const CASTLE_ASSETS: Record<string, () => Record<string, unknown>> = {
  // A.2 recolours
  'ground-tile-stone': groundTileStone,
  'ceiling-tile': ceilingTile,
  'wall-stone': wallStone,
  carpet,
  // A.3 kit
  archway,
  bookshelf,
  'portrait-frame': portraitFrame,
  tapestry,
  cushion,
  'star-carving': starCarving,
  'moon-carving': moonCarving,
  'wall-sconce': () => wallSconce(false),
  'wall-sconce-lit': () => wallSconce(true),
  // A.4 props
  lectern,
  'binding-table': bindingTable,
  'story-plate-problem': () => storyPlate(1, CASTLE.stoneWall),
  'story-plate-choice': () => storyPlate(2, CASTLE.stoneWall),
  'story-plate-ending': () => storyPlate(3, CASTLE.stoneWall),
  'reading-table': readingTable,
  'costume-rack': costumeRack,
  'clue-diary': clueDiary,
  'clue-map': clueMap,
  'clue-note': clueNote,
  'rod-rack': rodRack,
  'rod-silver': () => rod(0.35, CASTLE.silver),
  'rod-iron': () => rod(0.6, CASTLE.iron),
  'rod-brass': () => rod(0.9, CASTLE.brass),
  'writing-desk': writingDesk,
  'round-window': roundWindow,
  // A.5 state variants
  'portrait-puppy': () => heroPortrait('puppy', false),
  'portrait-puppy-lit': () => heroPortrait('puppy', true),
  'portrait-dragon': () => heroPortrait('dragon', false),
  'portrait-dragon-lit': () => heroPortrait('dragon', true),
  'portrait-fox': () => heroPortrait('fox', false),
  'portrait-fox-lit': () => heroPortrait('fox', true),
  'window-frame': windowFrame,
  'window-view-island': () => windowView('island', false),
  'window-view-island-lit': () => windowView('island', true),
  'window-view-mountain': () => windowView('mountain', false),
  'window-view-mountain-lit': () => windowView('mountain', true),
  'window-view-cave': () => windowView('cave', false),
  'window-view-cave-lit': () => windowView('cave', true),
  hearth: () => hearth(false),
  'hearth-lit': () => hearth(true),
  'shelf-slot-empty': () => shelfSlot(false),
  'story-book-shelved': () => shelfSlot(true),
  'carving-worn': carvingWorn,
  'carving-worn-revealed': carvingWornRevealed,
  'secret-door': () => secretDoor(false),
  'secret-door-ajar': () => secretDoor(true),
  'bookshelf-ajar': bookshelfAjar,
  // A.6 the easel set
  easel,
  'canvas-hero-puppy': () => canvasHero('puppy'),
  'canvas-hero-dragon': () => canvasHero('dragon'),
  'canvas-hero-fox': () => canvasHero('fox'),
  'canvas-setting-island': () => canvasSetting('island'),
  'canvas-setting-mountain': () => canvasSetting('mountain'),
  'canvas-setting-cave': () => canvasSetting('cave'),
  // A.7 the one new character
  'npc-quill': npcQuill,
};

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
  ...CASTLE_ASSETS,
};

mkdirSync(OUTPUT_DIR, { recursive: true });
for (const [id, build] of Object.entries(ASSETS)) {
  const document = build();
  const filePath = resolve(OUTPUT_DIR, `${id}.gltf`);
  writeFileSync(filePath, JSON.stringify(document));
  console.log(`wrote ${filePath}`);
}
console.log(`generated ${Object.keys(ASSETS).length} assets into ${OUTPUT_DIR}`);
