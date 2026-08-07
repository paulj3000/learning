import type { AdventureDefinition } from '../engine/types';
import { REPAIR_THE_MOONLIGHT_BRIDGE } from './repairTheMoonlightBridge';
import { THE_STORYKEEPERS_TALE } from './theStorykeepersTale';
import { BUZZ_AND_THE_WAGGLE_DANCE } from './buzzAndTheWaggleDance';

export const ADVENTURE_TEMPLATES: AdventureDefinition[] = [
  REPAIR_THE_MOONLIGHT_BRIDGE,
  THE_STORYKEEPERS_TALE,
  BUZZ_AND_THE_WAGGLE_DANCE,
];

export function getAdventureTemplate(slug: string): AdventureDefinition | undefined {
  return ADVENTURE_TEMPLATES.find((template) => template.slug === slug);
}

export function getAdventureTemplatesForLocation(locationSlug: string): AdventureDefinition[] {
  return ADVENTURE_TEMPLATES.filter((template) => template.locationSlug === locationSlug);
}

export * from './learningObjectives';
export * from './wonderWallQuestions';
export { REPAIR_THE_MOONLIGHT_BRIDGE, THE_STORYKEEPERS_TALE, BUZZ_AND_THE_WAGGLE_DANCE };
