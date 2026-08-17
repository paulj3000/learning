import type { StoryDefinition } from '../engine/types';
import { DRAGON_OF_EMBER_MOUNTAIN } from './dragonOfEmberMountain';

export const STORY_DEFINITIONS: StoryDefinition[] = [DRAGON_OF_EMBER_MOUNTAIN];

export function getStoryDefinition(slug: string): StoryDefinition | undefined {
  return STORY_DEFINITIONS.find((story) => story.slug === slug);
}

export { DRAGON_OF_EMBER_MOUNTAIN };
