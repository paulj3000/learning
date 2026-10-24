import type { AdventureDefinition } from '../adventures/engine/types';
import type { LearningObjective } from '../adventures/content/learningObjectives';
import type { WonderWallQuestion } from '../adventures/content/wonderWallQuestions';
import type { Domain, Grade, Skill, Subject } from '../curriculum/types';
import type { DiscoveryDefinition } from '../discovery/types';
import type { RegionCheckpoint } from '../discovery/checkpoints';
import type { AssetManifestEntry } from '../island-map/three/assets/manifest';
import type { WorldInteraction } from '../island-map/worldObjects';
import type { IslandLocation } from '../island/locations';
import type { NpcDefinition } from '../npc/types';
import type { QuestDefinition } from '../quests/types';
import type { CollectibleSet, ItemDefinition, RewardRule } from '../rewards/types';
import type { StoryDefinition } from '../story/engine/types';
import type { WorldContentPack, WorldDefinition } from '../worlds/types';

/**
 * Bumped whenever the shape of an exported file changes incompatibly.
 *
 * 2: adventures gain optional `skillDomain` and `skillLevel`; interaction actions gain
 *    `START_STORY`. Every version 1 file is still valid content, but a version 1 validator rejects
 *    version 2 files, so the version moves. See docs/DATA_MODEL.md.
 */
export const SCHEMA_VERSION = 2;
export const EXPORT_TOOL = { name: 'lai-content-export', version: '1.0.0' } as const;

export interface IslandEntry extends WorldDefinition {
  /** The world's content pack: which locations, adventures, quests, ... belong to it. */
  pack: Omit<WorldContentPack, 'worldSlug'>;
}

export interface RegionInteractions {
  /** Authoring key of the table: a location slug, or `welcome-harbor` (the hub, which has no IslandLocation). */
  regionSlug: string;
  interactions: WorldInteraction[];
}

/** Everything exported, before it is split into files. Authored order is preserved everywhere. */
export interface ContentPackage {
  islands: IslandEntry[];
  locations: IslandLocation[];
  adventures: AdventureDefinition[];
  learningObjectives: LearningObjective[];
  wonderWallQuestions: WonderWallQuestion[];
  stories: StoryDefinition[];
  quests: QuestDefinition[];
  items: ItemDefinition[];
  collectibleSets: CollectibleSet[];
  rewardRules: RewardRule[];
  npcs: NpcDefinition[];
  discoveries: DiscoveryDefinition[];
  checkpoints: RegionCheckpoint[];
  interactions: RegionInteractions[];
  subjects: Subject[];
  grades: Grade[];
  domains: Domain[];
  skills: Skill[];
  assets: AssetManifestEntry[];
}

/** Exported file name -> the collections it holds (key = property inside the file). */
export const FILE_LAYOUT = {
  'islands.json': ['islands'],
  'locations.json': ['locations'],
  'adventures.json': ['adventures', 'learningObjectives', 'wonderWallQuestions'],
  'stories.json': ['stories'],
  'quests.json': ['quests'],
  'rewards.json': ['items', 'collectibleSets', 'rewardRules'],
  'npcs.json': ['npcs'],
  'discoveries.json': ['discoveries', 'checkpoints'],
  'interactions.json': ['interactions'],
  'curriculum.json': ['subjects', 'grades', 'domains', 'skills'],
  'assets.json': ['assets'],
} as const satisfies Record<string, readonly (keyof ContentPackage)[]>;

export type ContentFileName = keyof typeof FILE_LAYOUT;
