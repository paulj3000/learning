import type { AgeBandValue } from '../../child-profile/constants';
import type { StoryDefinition } from './types';

/**
 * Whether this child's age band may play this story at all.
 *
 * One line, and it earns its own module because ADR-019 turned it into a
 * rule with more than one enforcer: a story arc may now be entered from the
 * Adventure Library *and* from a 3D region, and "reaching a Three.js object
 * must never bypass Story Engine eligibility". Two call sites restating
 * `supportedAgeBands.includes(...)` would be two chances for a band gate to
 * drift, and the one that drifts is the one nobody is looking at - a child
 * walking into a room, rather than a child reading a library.
 *
 * So eligibility lives with the Story Engine, which owns the story, and
 * every entry point asks it. `StoryPage`, `library/recommend.ts` and
 * Storykeeper Castle's first-person region all call this.
 */
export function isStoryForAgeBand(story: StoryDefinition, ageBand: AgeBandValue): boolean {
  return story.supportedAgeBands.includes(ageBand);
}
