import type { AdventureDefinition } from '../engine/types';
import type { AgeBandValue } from '../../child-profile/constants';
import { REPAIR_THE_MOONLIGHT_BRIDGE } from './repairTheMoonlightBridge';
import { THREE_PLANKS_FOR_THE_BRIDGE } from './threePlanksForTheBridge';
import { THE_TIDE_GATE_CALCULATION } from './theTideGateCalculation';
import { THE_STORYKEEPERS_TALE } from './theStorykeepersTale';
import { QUILLS_PICTURE_STORY } from './quillsPictureStory';
import { BUZZ_AND_THE_WAGGLE_DANCE } from './buzzAndTheWaggleDance';
import { EMBER_MOUNTAIN_CHAPTER_ADVENTURES } from './emberMountainChapterAdventures';
import { DINOSAUR_EXPEDITION_ADVENTURES } from './dinosaurExpeditionAdventures';
import { ROBOT_RESCUE_ADVENTURES } from './robotRescueAdventures';
import { BUTTERFLY_GARDEN_ADVENTURES } from './butterflyGardenAdventures';
import { CASTLES_SECRET_DOOR_ADVENTURES } from './castlesSecretDoorAdventures';
import { CREATURE_CARE_COVE_ADVENTURES } from './creatureCareCoveAdventures';

/**
 * Every arc challenge below the first four entries carries a story-only
 * pseudo-location slug, so `getAdventureTemplatesForLocation` keeps
 * returning exactly the card-based adventure each real island location
 * already had (Phase 15).
 */
export const ADVENTURE_TEMPLATES: AdventureDefinition[] = [
  REPAIR_THE_MOONLIGHT_BRIDGE,
  THREE_PLANKS_FOR_THE_BRIDGE,
  THE_TIDE_GATE_CALCULATION,
  THE_STORYKEEPERS_TALE,
  QUILLS_PICTURE_STORY,
  BUZZ_AND_THE_WAGGLE_DANCE,
  ...EMBER_MOUNTAIN_CHAPTER_ADVENTURES,
  ...DINOSAUR_EXPEDITION_ADVENTURES,
  ...ROBOT_RESCUE_ADVENTURES,
  ...BUTTERFLY_GARDEN_ADVENTURES,
  ...CASTLES_SECRET_DOOR_ADVENTURES,
  // Phase 29: a second world's content, registered exactly like the first
  // world's. The engine has no notion of which island an adventure is on.
  ...CREATURE_CARE_COVE_ADVENTURES,
];

export function getAdventureTemplate(slug: string): AdventureDefinition | undefined {
  return ADVENTURE_TEMPLATES.find((template) => template.slug === slug);
}

/**
 * Whether this adventure is authored for this child's age band.
 *
 * A named function rather than an inline `ageBands.includes(...)` because
 * the rule has to hold on *every* route that can start an adventure, and it
 * did not: `IslandLocationPage` checked it from Phase 2, while the
 * explorable world views (Phase 9 onward) started their `START_ADVENTURE`
 * interactions without checking at all. A child could be told "not
 * available for your age yet" on the location page and then be handed the
 * same adventure by walking into it, which is the exact failure CLAUDE.md
 * section 3 rules out ("never show content merely because it is
 * available") and the Definition of Done's "age bands are respected" means.
 *
 * Grep for this name to find every place the guarantee is enforced.
 */
export function isAdventureForAgeBand(
  template: AdventureDefinition,
  ageBand: AgeBandValue,
): boolean {
  return template.ageBands.includes(ageBand);
}

/**
 * The adventure to run at `locationSlug` for this child, preferring the one
 * the world interaction names.
 *
 * A world spot names one `templateSlug`, but a location can hold more than
 * one adventure telling the same story at different bands - Pirate Builder
 * Bay holds "Repair the Moonlight Bridge" (Pathfinder) and "Three Planks for
 * the Bridge" (Sprout). Resolving here means the authored interaction stays a
 * single entry and adding a band variant is purely a content change, rather
 * than every world view growing a branch per band.
 *
 * Returns `undefined` when the location has nothing for this band, which
 * callers must render as the authored "not available for your age yet" line
 * rather than starting something anyway.
 */
export function resolveAdventureForAgeBand(
  locationSlug: string,
  preferredSlug: string,
  ageBand: AgeBandValue,
): AdventureDefinition | undefined {
  const preferred = getAdventureTemplate(preferredSlug);
  if (preferred && isAdventureForAgeBand(preferred, ageBand)) return preferred;
  return getAdventureTemplatesForLocation(locationSlug).find((template) =>
    isAdventureForAgeBand(template, ageBand),
  );
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
export * from './creatureCareCoveAdventures';
export {
  REPAIR_THE_MOONLIGHT_BRIDGE,
  THREE_PLANKS_FOR_THE_BRIDGE,
  THE_TIDE_GATE_CALCULATION,
  THE_STORYKEEPERS_TALE,
  QUILLS_PICTURE_STORY,
  BUZZ_AND_THE_WAGGLE_DANCE,
};
