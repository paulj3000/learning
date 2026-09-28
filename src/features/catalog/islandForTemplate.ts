import type { AdventureDefinition } from '../adventures/engine/types';
import { getIslandLocation } from '../island/locations';

/**
 * Which island a story-arc adventure belongs to in the admin catalog.
 *
 * Arc challenges carry story-only pseudo-location slugs on purpose (see
 * `src/features/adventures/content/index.ts`) so they never surface on an
 * `IslandLocationPage`. The catalog still needs every adventure under one
 * island (docs/ISLAND_ADVENTURE_MANAGEMENT.md section 8), so each
 * pseudo-location is filed under the island its story leads to. This only
 * affects catalog grouping and availability; it never changes where or how
 * the story is played.
 */
export const STORY_ARC_ISLANDS: Readonly<Record<string, string>> = {
  // The Dragon of Ember Mountain unlocks The Dragon's Sanctuary.
  'ember-mountain': 'dragons-sanctuary',
  // The Dinosaur Expedition unlocks Fossil Ridge Camp.
  'fossil-ridge': 'fossil-ridge-camp',
  // Robot Rescue unlocks Bolt's Workshop.
  'robot-repair-reef': 'bolts-workshop',
  // The Castle's Secret Door is also entered from Storykeeper Castle (ADR-019).
  'castle-secret-passage': 'storykeeper-castle',
  // The Butterfly Garden is the Adventure Library's nature arc.
  'butterfly-garden': 'wonderwild-forest',
};

/** The island slug an adventure template is filed under, or `undefined` if it has none. */
export function islandSlugForTemplate(
  template: Pick<AdventureDefinition, 'locationSlug'>,
): string | undefined {
  if (getIslandLocation(template.locationSlug)) return template.locationSlug;
  return STORY_ARC_ISLANDS[template.locationSlug];
}
