import type { AdventureDefinition } from '../engine/types';
import { REPAIR_THE_MOONLIGHT_BRIDGE } from './repairTheMoonlightBridge';
import { THE_STORYKEEPERS_TALE } from './theStorykeepersTale';
import { BUZZ_AND_THE_WAGGLE_DANCE } from './buzzAndTheWaggleDance';
import { EMBER_MOUNTAIN_CHAPTER_ADVENTURES } from './emberMountainChapterAdventures';
import { DINOSAUR_EXPEDITION_ADVENTURES } from './dinosaurExpeditionAdventures';
import { ROBOT_RESCUE_ADVENTURES } from './robotRescueAdventures';
import { BUTTERFLY_GARDEN_ADVENTURES } from './butterflyGardenAdventures';
import { CASTLES_SECRET_DOOR_ADVENTURES } from './castlesSecretDoorAdventures';

/**
 * Every arc challenge below the first four entries carries a story-only
 * pseudo-location slug, so `getAdventureTemplatesForLocation` keeps
 * returning exactly the card-based adventure each real island location
 * already had (Phase 15).
 */
export const ADVENTURE_TEMPLATES: AdventureDefinition[] = [
  REPAIR_THE_MOONLIGHT_BRIDGE,
  THE_STORYKEEPERS_TALE,
  BUZZ_AND_THE_WAGGLE_DANCE,
  ...EMBER_MOUNTAIN_CHAPTER_ADVENTURES,
  ...DINOSAUR_EXPEDITION_ADVENTURES,
  ...ROBOT_RESCUE_ADVENTURES,
  ...BUTTERFLY_GARDEN_ADVENTURES,
  ...CASTLES_SECRET_DOOR_ADVENTURES,
];

export function getAdventureTemplate(slug: string): AdventureDefinition | undefined {
  return ADVENTURE_TEMPLATES.find((template) => template.slug === slug);
}

export function getAdventureTemplatesForLocation(locationSlug: string): AdventureDefinition[] {
  return ADVENTURE_TEMPLATES.filter((template) => template.locationSlug === locationSlug);
}

export * from './learningObjectives';
export * from './wonderWallQuestions';
export * from './emberMountainChapterAdventures';
export * from './dinosaurExpeditionAdventures';
export * from './robotRescueAdventures';
export * from './butterflyGardenAdventures';
export * from './castlesSecretDoorAdventures';
export { REPAIR_THE_MOONLIGHT_BRIDGE, THE_STORYKEEPERS_TALE, BUZZ_AND_THE_WAGGLE_DANCE };
