/**
 * Assembles the content package from the existing, typed TypeScript content modules (LAI-0302).
 *
 * Trusted build-time execution boundary: this imports only the pure content modules listed below
 * (data and types; a test proves none of them reaches React, Amplify, Three.js, Phaser, or an
 * `api.ts`). Nothing is parsed from text and nothing untrusted is executed. Gameplay still loads
 * its content exactly as before; this module is read-only.
 */
import { ADVENTURE_TEMPLATES } from '../adventures/content/index';
import { LEARNING_OBJECTIVES } from '../adventures/content/learningObjectives';
import { WONDER_WALL_QUESTIONS } from '../adventures/content/wonderWallQuestions';
import { DOMAINS, GRADES, SKILLS, SUBJECTS } from '../curriculum/content/index';
import { ALL_CHECKPOINTS } from '../discovery/checkpoints';
import { DISCOVERY_DEFINITIONS } from '../discovery/content/index';
import { ISLAND_LOCATIONS } from '../island/locations';
import { ASSET_MANIFEST } from '../island-map/three/assets/manifest';
import * as worldObjects from '../island-map/worldObjects';
import { ALL_NPCS } from '../npc/content/index';
import { QUEST_DEFINITIONS } from '../quests/content/index';
import { ALL_COLLECTIBLE_SETS, ALL_ITEMS, ALL_REWARD_RULES } from '../rewards/content/index';
import { STORY_DEFINITIONS } from '../story/content/index';
import { loadAllWorldContentPacks } from '../worlds/packs/index';
import { WORLD_DEFINITIONS } from '../worlds/worlds';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toJsonValue } from './canonical';
import {
  FIREPEAK_COLLECTIBLE_SETS,
  FIREPEAK_ITEMS,
  FIREPEAK_LOCATIONS,
  FIREPEAK_NPCS,
  FIREPEAK_PACK_ADDITIONS,
  FIREPEAK_QUESTS,
  FIREPEAK_REWARD_RULES,
} from './firepeakContent';
import {
  HEART_COLLECTIBLE_SETS,
  HEART_ITEMS,
  HEART_LOCATIONS,
  HEART_NPCS,
  HEART_PACK_ADDITIONS,
  HEART_QUESTS,
  HEART_REWARD_RULES,
} from './firepeakHeartContent';
import {
  NORTH_POLE_COLLECTIBLE_SETS,
  NORTH_POLE_ITEMS,
  NORTH_POLE_LOCATIONS,
  NORTH_POLE_NPCS,
  NORTH_POLE_PACK,
  NORTH_POLE_QUESTS,
  NORTH_POLE_REWARD_RULES,
  NORTH_POLE_WORLD,
} from './northPoleContent';
import {
  TREASURE_RUSH_ITEMS,
  TREASURE_RUSH_QUESTS,
  TREASURE_RUSH_REWARD_RULES,
} from './treasureRushContent';
import type { ContentPackage, IslandEntry, RegionAssets, RegionInteractions } from './types';

/**
 * Which assets each location's scene uses, read from the committed index the engine side
 * writes (`island-map/three/runtime/sceneAssetIndex.test.ts`). Read as data rather than
 * computed here, because computing it needs the scene modules, which reach Three.js.
 */
const SCENE_ASSET_INDEX = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../content/derived/scene-asset-index.json',
);

function readSceneAssetIndex(): RegionAssets[] {
  const index = JSON.parse(readFileSync(SCENE_ASSET_INDEX, 'utf8')) as { regions: RegionAssets[] };
  return index.regions.map(({ regionSlug, assetIds }) => ({ regionSlug, assetIds: [...assetIds] }));
}

/** Authoring key -> the exported interaction table. The hub has no IslandLocation record. */
const INTERACTION_TABLES: ReadonlyArray<readonly [string, keyof typeof worldObjects]> = [
  ['welcome-harbor', 'WELCOME_HARBOR_INTERACTIONS'],
  ['pirate-builder-bay', 'PIRATE_BUILDER_BAY_INTERACTIONS'],
  ['wonderwild-forest', 'WONDERWILD_FOREST_INTERACTIONS'],
  ['storykeeper-castle', 'STORYKEEPER_CASTLE_INTERACTIONS'],
  ['dragons-sanctuary', 'DRAGONS_SANCTUARY_INTERACTIONS'],
  ['fossil-ridge-camp', 'FOSSIL_RIDGE_CAMP_INTERACTIONS'],
  ['castle-writing-room', 'CASTLE_WRITING_ROOM_INTERACTIONS'],
  ['bolts-workshop', 'BOLTS_WORKSHOP_INTERACTIONS'],
];

type PackBody = IslandEntry['pack'];

/**
 * Export-only additions to a world's content pack (Firepeak, ADR-047): the Amplify app loads its
 * packs unchanged, and the export lists the export-only Place and its content in its Island.
 */
function withExportOnly(worldSlug: string, pack: PackBody): PackBody {
  if (worldSlug !== FIREPEAK_PACK_ADDITIONS.worldSlug) return pack;
  return {
    ...pack,
    locationSlugs: [
      ...pack.locationSlugs,
      ...FIREPEAK_PACK_ADDITIONS.locationSlugs,
      ...HEART_PACK_ADDITIONS.locationSlugs,
    ],
    questIds: [...pack.questIds, ...FIREPEAK_PACK_ADDITIONS.questIds, ...HEART_PACK_ADDITIONS.questIds],
    npcIds: [...pack.npcIds, ...FIREPEAK_PACK_ADDITIONS.npcIds, ...HEART_PACK_ADDITIONS.npcIds],
    itemIds: [...pack.itemIds, ...FIREPEAK_PACK_ADDITIONS.itemIds, ...HEART_PACK_ADDITIONS.itemIds],
    collectibleSetIds: [
      ...pack.collectibleSetIds,
      ...FIREPEAK_PACK_ADDITIONS.collectibleSetIds,
      ...HEART_PACK_ADDITIONS.collectibleSetIds,
    ],
  };
}

export async function buildContentPackage(): Promise<ContentPackage> {
  const packs = await loadAllWorldContentPacks();
  const islands: IslandEntry[] = WORLD_DEFINITIONS.map((world) => {
    const pack = packs.find((candidate) => candidate.worldSlug === world.slug);
    if (!pack) throw new Error(`World "${world.slug}" has no content pack.`);
    const { worldSlug: _worldSlug, ...rest } = pack;
    return { ...world, pack: withExportOnly(world.slug, rest) };
  });
  // North Pole is export-only: its own Realm, with no travel requirement.
  islands.push({ ...NORTH_POLE_WORLD, pack: { ...NORTH_POLE_PACK } });
  const interactions: RegionInteractions[] = INTERACTION_TABLES.map(([regionSlug, exportName]) => ({
    regionSlug,
    interactions: [
      ...(worldObjects[exportName] as typeof worldObjects.WELCOME_HARBOR_INTERACTIONS),
    ],
  }));

  const pkg: ContentPackage = {
    islands,
    locations: [...ISLAND_LOCATIONS, ...FIREPEAK_LOCATIONS, ...HEART_LOCATIONS, ...NORTH_POLE_LOCATIONS],
    adventures: [...ADVENTURE_TEMPLATES],
    learningObjectives: [...LEARNING_OBJECTIVES],
    wonderWallQuestions: [...WONDER_WALL_QUESTIONS],
    stories: [...STORY_DEFINITIONS],
    quests: [...QUEST_DEFINITIONS, ...TREASURE_RUSH_QUESTS, ...FIREPEAK_QUESTS, ...HEART_QUESTS, ...NORTH_POLE_QUESTS],
    items: [...ALL_ITEMS, ...TREASURE_RUSH_ITEMS, ...FIREPEAK_ITEMS, ...HEART_ITEMS, ...NORTH_POLE_ITEMS],
    collectibleSets: [...ALL_COLLECTIBLE_SETS, ...FIREPEAK_COLLECTIBLE_SETS, ...HEART_COLLECTIBLE_SETS, ...NORTH_POLE_COLLECTIBLE_SETS],
    rewardRules: [...ALL_REWARD_RULES, ...TREASURE_RUSH_REWARD_RULES, ...FIREPEAK_REWARD_RULES, ...HEART_REWARD_RULES, ...NORTH_POLE_REWARD_RULES],
    npcs: [...ALL_NPCS, ...FIREPEAK_NPCS, ...HEART_NPCS, ...NORTH_POLE_NPCS],
    discoveries: [...DISCOVERY_DEFINITIONS],
    checkpoints: [...ALL_CHECKPOINTS],
    interactions,
    subjects: [...SUBJECTS],
    grades: [...GRADES],
    domains: [...DOMAINS],
    skills: [...SKILLS],
    assets: [...ASSET_MANIFEST],
    locationAssets: readSceneAssetIndex(),
  };
  // Round-trip through the strict converter so unsupported content fails here, with a path.
  return toJsonValue(pkg) as unknown as ContentPackage;
}
