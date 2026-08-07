/**
 * Content-managed reference data, kept in source control for MVP rather than
 * a DB model (docs/DATA_MODEL.md: "Prefer content definitions checked into
 * source control for MVP" — same approach Phase 2 used for IslandLocation).
 */
export interface LearningObjective {
  code: string;
  domain:
    'literacy' | 'numeracy' | 'science' | 'creativity' | 'social-emotional' | 'executive-function';
  title: string;
}

export const LEARNING_OBJECTIVES: LearningObjective[] = [
  { code: 'counting-sets', domain: 'numeracy', title: 'Counting sets of objects' },
  { code: 'addition-within-ten', domain: 'numeracy', title: 'Addition within ten' },
  { code: 'comparing-lengths', domain: 'numeracy', title: 'Comparing and ordering lengths' },
  {
    code: 'following-instructions',
    domain: 'executive-function',
    title: 'Following ordered instructions',
  },
];
