import type { AnimationClipName } from './animationVocabulary';

/**
 * The typed registry of every asset `scripts/generate-world-assets.ts`
 * produces into `public/models/`, for `docs/ROADMAP.md` Phase 34.
 * `assetLoader.ts` and `sceneKit.ts` resolve assets by id through this file
 * rather than hard-coding urls, and `manifest.test.ts` is the authoring
 * check (same spirit as Phase 26.5's `reachableMemoryFlags`) that every
 * entry here actually resolves to a generated file and only declares clips
 * from `animationVocabulary.ts`.
 */

export type AssetKind = 'kit-piece' | 'character' | 'prop' | 'collectible';

export interface AssetLodLevel {
  /** The lower-detail variant's own manifest id, swapped in via `THREE.LOD` beyond `distanceMeters`. */
  lowDetailId: string;
  distanceMeters: number;
}

export interface AssetManifestEntry {
  id: string;
  /** Served from Vite's `public/` dir, so no bundler asset-import config is needed. */
  url: string;
  kind: AssetKind;
  /** The clip names this asset's glTF document actually authors - a subset of `ANIMATION_CLIP_NAMES`, not the whole vocabulary. */
  clips: readonly AnimationClipName[];
  lod?: AssetLodLevel;
}

export const ASSET_MANIFEST: readonly AssetManifestEntry[] = [
  { id: 'ground-tile', url: '/models/ground-tile.gltf', kind: 'kit-piece', clips: [] },
  { id: 'rock', url: '/models/rock.gltf', kind: 'kit-piece', clips: [] },
  { id: 'wall', url: '/models/wall.gltf', kind: 'kit-piece', clips: [] },
  { id: 'roof', url: '/models/roof.gltf', kind: 'kit-piece', clips: [] },
  { id: 'door', url: '/models/door.gltf', kind: 'kit-piece', clips: [] },
  { id: 'fence', url: '/models/fence.gltf', kind: 'kit-piece', clips: [] },
  { id: 'path', url: '/models/path.gltf', kind: 'kit-piece', clips: [] },
  { id: 'bridge-plank', url: '/models/bridge-plank.gltf', kind: 'kit-piece', clips: [] },
  {
    id: 'bridge-plank-repaired',
    url: '/models/bridge-plank-repaired.gltf',
    kind: 'kit-piece',
    clips: [],
  },
  {
    id: 'foliage-tree',
    url: '/models/foliage-tree.gltf',
    kind: 'kit-piece',
    clips: [],
    lod: { lowDetailId: 'foliage-tree-lod1', distanceMeters: 14 },
  },
  { id: 'foliage-tree-lod1', url: '/models/foliage-tree-lod1.gltf', kind: 'kit-piece', clips: [] },
  { id: 'foliage-bush', url: '/models/foliage-bush.gltf', kind: 'kit-piece', clips: [] },
  {
    id: 'npc-pip',
    url: '/models/npc-pip.gltf',
    kind: 'character',
    clips: ['Idle', 'Talk', 'Wave'],
  },
  {
    id: 'companion-chatty',
    url: '/models/companion-chatty.gltf',
    kind: 'character',
    clips: ['Idle'],
  },
  { id: 'rope-coil', url: '/models/rope-coil.gltf', kind: 'prop', clips: [] },
  { id: 'toolbox', url: '/models/toolbox.gltf', kind: 'prop', clips: [] },
  { id: 'treasure-chest', url: '/models/treasure-chest.gltf', kind: 'prop', clips: ['Open'] },
  { id: 'signpost', url: '/models/signpost.gltf', kind: 'prop', clips: [] },
  {
    id: 'collectible-gem',
    url: '/models/collectible-gem.gltf',
    kind: 'collectible',
    clips: ['Idle'],
  },
] as const;

export function getAssetManifestEntry(id: string): AssetManifestEntry {
  const entry = ASSET_MANIFEST.find((candidate) => candidate.id === id);
  if (!entry) {
    throw new Error(`unknown asset id "${id}"`);
  }
  return entry;
}
