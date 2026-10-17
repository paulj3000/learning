import type { StoryDefinition } from '../engine/types';
import { DRAGON_OF_EMBER_MOUNTAIN } from './dragonOfEmberMountain';
import { DINOSAUR_EXPEDITION } from './dinosaurExpedition';
import { ROBOT_RESCUE } from './robotRescue';
import { SAVE_THE_BUTTERFLY_GARDEN } from './saveTheButterflyGarden';
import { THE_CASTLES_SECRET_DOOR } from './theCastlesSecretDoor';

/**
 * Every authored story arc. Phase 15 turned this from "the one reference
 * story" into the Adventure Library's content set: one arc per theme
 * (docs/ROADMAP.md Phase 15). Shelving metadata lives separately in
 * `src/features/library/catalog.ts`, which is asserted to stay in step with
 * this list.
 */
export const STORY_DEFINITIONS: StoryDefinition[] = [
  DRAGON_OF_EMBER_MOUNTAIN,
  DINOSAUR_EXPEDITION,
  ROBOT_RESCUE,
  SAVE_THE_BUTTERFLY_GARDEN,
  THE_CASTLES_SECRET_DOOR,
];

export function getStoryDefinition(slug: string): StoryDefinition | undefined {
  return STORY_DEFINITIONS.find((story) => story.slug === slug);
}

export {
  DRAGON_OF_EMBER_MOUNTAIN,
  DINOSAUR_EXPEDITION,
  ROBOT_RESCUE,
  SAVE_THE_BUTTERFLY_GARDEN,
  THE_CASTLES_SECRET_DOOR,
};
