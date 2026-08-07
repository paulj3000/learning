import type { AdventureDefinition } from '../engine/types';
import { REPAIR_THE_MOONLIGHT_BRIDGE } from './repairTheMoonlightBridge';

export const ADVENTURE_TEMPLATES: AdventureDefinition[] = [REPAIR_THE_MOONLIGHT_BRIDGE];

export function getAdventureTemplate(slug: string): AdventureDefinition | undefined {
  return ADVENTURE_TEMPLATES.find((template) => template.slug === slug);
}

export function getAdventureTemplatesForLocation(locationSlug: string): AdventureDefinition[] {
  return ADVENTURE_TEMPLATES.filter((template) => template.locationSlug === locationSlug);
}

export * from './learningObjectives';
export { REPAIR_THE_MOONLIGHT_BRIDGE };
