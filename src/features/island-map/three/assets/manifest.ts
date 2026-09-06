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

  // --- Storykeeper Castle (`docs/STORYKEEPER_CASTLE_3D_ROADMAP.md` SC-1) ---
  //
  // Appendix A of that roadmap is the inventory. Two things to know before
  // placing any of these:
  //
  // **Only single-mesh assets may go through
  // `createInstancedMeshFromAsset`.** In this group that is `ground-tile-
  // stone`, `ceiling-tile`, `wall-stone`, `carpet`, `bookshelf`,
  // `portrait-frame`, `tapestry`, `cushion`, `star-carving`, `moon-carving`,
  // both sconces, and the three rods. Everything else - `archway` and
  // `window-frame` included, despite being kit pieces - is multi-part and
  // must be placed individually, or instancing will silently keep only its
  // first mesh (the trap `foliage-tree` documents).
  //
  // **State variants are separate assets picked at construction time**, the
  // `bridge-plank`/`bridge-plank-repaired` precedent - not a runtime
  // material swap. `*-lit`, `hearth-lit`, `story-book-shelved`,
  // `carving-worn-revealed`, `secret-door-ajar` and `bookshelf-ajar` are all
  // the second half of a pair.
  //
  // No LOD is declared. `bookshelf` is the one plausible candidate (~16
  // placements in the densest room); SC-11 adds it only if profiling on a
  // target tablet asks for it.
  { id: 'ground-tile-stone', url: '/models/ground-tile-stone.gltf', kind: 'kit-piece', clips: [] },
  { id: 'ceiling-tile', url: '/models/ceiling-tile.gltf', kind: 'kit-piece', clips: [] },
  { id: 'wall-stone', url: '/models/wall-stone.gltf', kind: 'kit-piece', clips: [] },
  { id: 'carpet', url: '/models/carpet.gltf', kind: 'kit-piece', clips: [] },
  { id: 'archway', url: '/models/archway.gltf', kind: 'kit-piece', clips: [] },
  { id: 'bookshelf', url: '/models/bookshelf.gltf', kind: 'kit-piece', clips: [] },
  { id: 'portrait-frame', url: '/models/portrait-frame.gltf', kind: 'kit-piece', clips: [] },
  { id: 'tapestry', url: '/models/tapestry.gltf', kind: 'kit-piece', clips: [] },
  { id: 'cushion', url: '/models/cushion.gltf', kind: 'kit-piece', clips: [] },
  { id: 'star-carving', url: '/models/star-carving.gltf', kind: 'kit-piece', clips: [] },
  { id: 'moon-carving', url: '/models/moon-carving.gltf', kind: 'kit-piece', clips: [] },
  { id: 'wall-sconce', url: '/models/wall-sconce.gltf', kind: 'kit-piece', clips: [] },
  { id: 'wall-sconce-lit', url: '/models/wall-sconce-lit.gltf', kind: 'kit-piece', clips: [] },
  { id: 'window-frame', url: '/models/window-frame.gltf', kind: 'kit-piece', clips: [] },
  { id: 'bookshelf-ajar', url: '/models/bookshelf-ajar.gltf', kind: 'kit-piece', clips: [] },

  { id: 'lectern', url: '/models/lectern.gltf', kind: 'prop', clips: [] },
  { id: 'binding-lectern', url: '/models/binding-lectern.gltf', kind: 'prop', clips: [] },
  { id: 'binding-table', url: '/models/binding-table.gltf', kind: 'prop', clips: [] },
  { id: 'story-plate-problem', url: '/models/story-plate-problem.gltf', kind: 'prop', clips: [] },
  { id: 'story-plate-choice', url: '/models/story-plate-choice.gltf', kind: 'prop', clips: [] },
  { id: 'story-plate-ending', url: '/models/story-plate-ending.gltf', kind: 'prop', clips: [] },
  { id: 'reading-table', url: '/models/reading-table.gltf', kind: 'prop', clips: [] },
  { id: 'costume-rack', url: '/models/costume-rack.gltf', kind: 'prop', clips: [] },
  { id: 'clue-diary', url: '/models/clue-diary.gltf', kind: 'prop', clips: [] },
  { id: 'clue-map', url: '/models/clue-map.gltf', kind: 'prop', clips: [] },
  { id: 'clue-note', url: '/models/clue-note.gltf', kind: 'prop', clips: [] },
  { id: 'rod-rack', url: '/models/rod-rack.gltf', kind: 'prop', clips: [] },
  { id: 'rod-silver', url: '/models/rod-silver.gltf', kind: 'prop', clips: [] },
  { id: 'rod-iron', url: '/models/rod-iron.gltf', kind: 'prop', clips: [] },
  { id: 'rod-brass', url: '/models/rod-brass.gltf', kind: 'prop', clips: [] },
  { id: 'writing-desk', url: '/models/writing-desk.gltf', kind: 'prop', clips: [] },
  { id: 'round-window', url: '/models/round-window.gltf', kind: 'prop', clips: [] },
  { id: 'portrait-puppy', url: '/models/portrait-puppy.gltf', kind: 'prop', clips: [] },
  { id: 'portrait-puppy-lit', url: '/models/portrait-puppy-lit.gltf', kind: 'prop', clips: [] },
  { id: 'portrait-dragon', url: '/models/portrait-dragon.gltf', kind: 'prop', clips: [] },
  { id: 'portrait-dragon-lit', url: '/models/portrait-dragon-lit.gltf', kind: 'prop', clips: [] },
  { id: 'portrait-fox', url: '/models/portrait-fox.gltf', kind: 'prop', clips: [] },
  { id: 'portrait-fox-lit', url: '/models/portrait-fox-lit.gltf', kind: 'prop', clips: [] },
  { id: 'window-view-island', url: '/models/window-view-island.gltf', kind: 'prop', clips: [] },
  {
    id: 'window-view-island-lit',
    url: '/models/window-view-island-lit.gltf',
    kind: 'prop',
    clips: [],
  },
  { id: 'window-view-mountain', url: '/models/window-view-mountain.gltf', kind: 'prop', clips: [] },
  {
    id: 'window-view-mountain-lit',
    url: '/models/window-view-mountain-lit.gltf',
    kind: 'prop',
    clips: [],
  },
  { id: 'window-view-cave', url: '/models/window-view-cave.gltf', kind: 'prop', clips: [] },
  { id: 'window-view-cave-lit', url: '/models/window-view-cave-lit.gltf', kind: 'prop', clips: [] },
  { id: 'hearth', url: '/models/hearth.gltf', kind: 'prop', clips: [] },
  { id: 'hearth-lit', url: '/models/hearth-lit.gltf', kind: 'prop', clips: [] },
  { id: 'shelf-slot-empty', url: '/models/shelf-slot-empty.gltf', kind: 'prop', clips: [] },
  { id: 'story-book-shelved', url: '/models/story-book-shelved.gltf', kind: 'prop', clips: [] },
  { id: 'carving-worn', url: '/models/carving-worn.gltf', kind: 'prop', clips: [] },
  {
    id: 'carving-worn-revealed',
    url: '/models/carving-worn-revealed.gltf',
    kind: 'prop',
    clips: [],
  },
  { id: 'secret-door', url: '/models/secret-door.gltf', kind: 'prop', clips: [] },
  { id: 'easel', url: '/models/easel.gltf', kind: 'prop', clips: [] },
  { id: 'canvas-hero-puppy', url: '/models/canvas-hero-puppy.gltf', kind: 'prop', clips: [] },
  { id: 'canvas-hero-dragon', url: '/models/canvas-hero-dragon.gltf', kind: 'prop', clips: [] },
  { id: 'canvas-hero-fox', url: '/models/canvas-hero-fox.gltf', kind: 'prop', clips: [] },
  {
    id: 'canvas-setting-island',
    url: '/models/canvas-setting-island.gltf',
    kind: 'prop',
    clips: [],
  },
  {
    id: 'canvas-setting-mountain',
    url: '/models/canvas-setting-mountain.gltf',
    kind: 'prop',
    clips: [],
  },
  { id: 'canvas-setting-cave', url: '/models/canvas-setting-cave.gltf', kind: 'prop', clips: [] },
  {
    id: 'secret-door-ajar',
    url: '/models/secret-door-ajar.gltf',
    kind: 'prop',
    clips: ['Open'],
  },

  /**
   * The castle's one new character. Multi-part with TRS clips on named
   * nodes, so it must be cloned (`instantiateAsset`), never instanced. No
   * `Walk`: Keeper Quill is stationary and never follows the child.
   */
  {
    id: 'npc-quill',
    url: '/models/npc-quill.gltf',
    kind: 'character',
    clips: ['Idle', 'Talk', 'Wave', 'Point', 'Celebrate', 'ReactConcerned'],
  },

  // --- Wonderwild Forest (`docs/WONDERWILD_FOREST_3D_ROADMAP.md` WF-1) ---
  //
  // Appendix A of that roadmap is the inventory. Three things to know before
  // placing any of these:
  //
  // **This pack is about half the size of the castle's**, because it reuses
  // the Phase 34 outdoor kit the castle's own Appendix A.1 ruled out as
  // having "no role indoors": `ground-tile`, `foliage-tree` (with its
  // existing LOD level), `foliage-bush`, `rock`, `path` and `signpost` are
  // all load-bearing here and are not re-authored.
  //
  // **Every A.3 kit piece below is single-mesh and may be instanced** -
  // `fern`, `flower-cluster`, `mushroom-cluster`, `log-fallen`, `reed`,
  // `lily-pad`, `standing-stone`, `comb-cell` and `comb-cell-capped`.
  // `comb-cell` is the notable one: a hexagonal ring with a hole through it
  // is one indexed mesh via `buildHexRingPrismPrimitive`, which is the
  // opposite of what SC-1 found for the castle's `archway`. Everything else
  // in this group is multi-part and must be placed individually.
  //
  // **State variants are separate assets picked at construction time**, the
  // `bridge-plank`/`bridge-plank-repaired` precedent.
  // `wonder-stone-bee`/`-lit` share exact vertices and differ only by
  // emissive; `flower-patch-bare`/`-bloomed` and `cave-mouth`/`-lit` are real
  // geometry changes, because "flowers appear where there were none" is the
  // promised consequence and a recolour is not that.
  //
  // No LOD is declared. `fern` is the plausible candidate (~40 placements)
  // and `foliage-tree` already has one; WF-10 adds more only if profiling on
  // a target tablet asks for it.
  { id: 'ground-tile-moss', url: '/models/ground-tile-moss.gltf', kind: 'kit-piece', clips: [] },
  { id: 'ground-tile-comb', url: '/models/ground-tile-comb.gltf', kind: 'kit-piece', clips: [] },
  { id: 'path-forest', url: '/models/path-forest.gltf', kind: 'kit-piece', clips: [] },
  { id: 'fern', url: '/models/fern.gltf', kind: 'kit-piece', clips: [] },
  { id: 'flower-cluster', url: '/models/flower-cluster.gltf', kind: 'kit-piece', clips: [] },
  { id: 'mushroom-cluster', url: '/models/mushroom-cluster.gltf', kind: 'kit-piece', clips: [] },
  { id: 'log-fallen', url: '/models/log-fallen.gltf', kind: 'kit-piece', clips: [] },
  { id: 'reed', url: '/models/reed.gltf', kind: 'kit-piece', clips: [] },
  { id: 'lily-pad', url: '/models/lily-pad.gltf', kind: 'kit-piece', clips: [] },
  { id: 'standing-stone', url: '/models/standing-stone.gltf', kind: 'kit-piece', clips: [] },
  { id: 'comb-cell', url: '/models/comb-cell.gltf', kind: 'kit-piece', clips: [] },
  { id: 'comb-cell-capped', url: '/models/comb-cell-capped.gltf', kind: 'kit-piece', clips: [] },

  { id: 'wonder-stone-bee', url: '/models/wonder-stone-bee.gltf', kind: 'prop', clips: [] },
  {
    id: 'wonder-stone-bee-lit',
    url: '/models/wonder-stone-bee-lit.gltf',
    kind: 'prop',
    clips: [],
  },
  { id: 'wonder-stone-seed', url: '/models/wonder-stone-seed.gltf', kind: 'prop', clips: [] },
  { id: 'wonder-stone-sun', url: '/models/wonder-stone-sun.gltf', kind: 'prop', clips: [] },
  {
    id: 'wonder-stone-chrysalis',
    url: '/models/wonder-stone-chrysalis.gltf',
    kind: 'prop',
    clips: [],
  },
  { id: 'beehive', url: '/models/beehive.gltf', kind: 'prop', clips: [] },
  { id: 'hive-mouth', url: '/models/hive-mouth.gltf', kind: 'prop', clips: [] },
  { id: 'frog', url: '/models/frog.gltf', kind: 'prop', clips: [] },
  { id: 'leaf-pile', url: '/models/leaf-pile.gltf', kind: 'prop', clips: [] },
  { id: 'butterfly', url: '/models/butterfly.gltf', kind: 'prop', clips: [] },
  { id: 'glow-moss', url: '/models/glow-moss.gltf', kind: 'prop', clips: [] },
  { id: 'glowworm-ceiling', url: '/models/glowworm-ceiling.gltf', kind: 'prop', clips: [] },
  { id: 'flower-patch-bare', url: '/models/flower-patch-bare.gltf', kind: 'prop', clips: [] },
  {
    id: 'flower-patch-bloomed',
    url: '/models/flower-patch-bloomed.gltf',
    kind: 'prop',
    clips: [],
  },
  { id: 'cave-mouth', url: '/models/cave-mouth.gltf', kind: 'prop', clips: [] },
  { id: 'cave-mouth-lit', url: '/models/cave-mouth-lit.gltf', kind: 'prop', clips: [] },

  /**
   * The forest's one new character. Multi-part with TRS clips on named nodes,
   * so it must be cloned (`instantiateAsset`), never instanced. No `Walk`:
   * Buzz never leaves the dance floor and never follows the child.
   *
   * No waggle clip either, and that is deliberate. Beat 7 needs exactly five
   * discrete waggles, stopped at the end and replayable at no cost, which a
   * looping glTF clip does not give cleanly - `wonderwildHiveScene.ts` drives
   * the run as TRS motion on the `Abdomen` node instead, reading its repeat
   * count from `BUZZ_WAGGLE_RUN`. So `animationVocabulary.ts` needs no new
   * name, and SC-1's decision not to extend it holds.
   */
  {
    id: 'npc-buzz',
    url: '/models/npc-buzz.gltf',
    kind: 'character',
    clips: ['Idle', 'Talk', 'Celebrate'],
  },
] as const;

export function getAssetManifestEntry(id: string): AssetManifestEntry {
  const entry = ASSET_MANIFEST.find((candidate) => candidate.id === id);
  if (!entry) {
    throw new Error(`unknown asset id "${id}"`);
  }
  return entry;
}
