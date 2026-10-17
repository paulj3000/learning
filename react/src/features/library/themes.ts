/**
 * The five adventure themes `docs/ROADMAP.md` Phase 15 names ("fantasy,
 * exploration, building, nature, and mystery"), matching the grouping
 * `docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md` section 34
 * uses for its candidate list.
 *
 * A theme is a shelf in the library, not a difficulty level and not an
 * audience: it says what an arc is *about*, and nothing about who it is
 * "for". Age suitability is decided only by `StoryDefinition.supportedAgeBands`,
 * and relevance only by interest tags (`interests.ts`).
 */
export const ADVENTURE_THEMES = [
  'FANTASY',
  'EXPLORATION',
  'BUILDING',
  'NATURE',
  'MYSTERY',
] as const;

export type AdventureTheme = (typeof ADVENTURE_THEMES)[number];

/** Child-facing shelf names, readable aloud (CLAUDE.md section 13). */
export const ADVENTURE_THEME_LABELS: Record<AdventureTheme, string> = {
  FANTASY: 'Fantasy',
  EXPLORATION: 'Exploring',
  BUILDING: 'Building',
  NATURE: 'Nature',
  MYSTERY: 'Mystery',
};
