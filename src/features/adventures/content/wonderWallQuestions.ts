/**
 * Curated Wonder Wall question categories (docs/ROADMAP.md Phase 6). This is
 * the curiosity-input catalog for Wonderwild Forest: a fixed set of
 * curated questions across nature/science categories, not a free-text
 * question box (docs/AI_AND_CHILD_SAFETY.md "Child input policy" — MVP
 * preferred inputs are taps and multiple choice, not open text). A child
 * taps a question on the Wonder Wall; only questions with a matching
 * adventure continue into that adventure today, and every other question
 * gets a calm, safe redirect rather than a dead end (see
 * `WONDER_WALL_FALLBACK_QUESTION_ID` and `buzzAndTheWaggleDance.ts`'s
 * `wonder-wall` step).
 *
 * Kept as source-controlled content rather than a DB model, same precedent
 * as `LEARNING_OBJECTIVES` and `ISLAND_LOCATIONS`
 * (docs/DATA_MODEL.md: "Prefer content definitions checked into source
 * control for MVP").
 */
export interface WonderWallQuestion {
  id: string;
  category: 'Animals' | 'Plants' | 'Sky and Weather' | 'Growing and Changing';
  question: string;
}

export const WONDER_WALL_QUESTIONS: WonderWallQuestion[] = [
  { id: 'wonder-bees', category: 'Animals', question: 'Why do bees dance?' },
  { id: 'wonder-seeds', category: 'Plants', question: 'How do seeds travel?' },
  { id: 'wonder-sky', category: 'Sky and Weather', question: 'Why is the sky blue?' },
  {
    id: 'wonder-butterfly',
    category: 'Growing and Changing',
    question: 'How does a caterpillar become a butterfly?',
  },
];

/** The only Wonder Wall question with a built adventure so far. */
export const WONDER_WALL_ANSWERED_QUESTION_ID = 'wonder-bees';
