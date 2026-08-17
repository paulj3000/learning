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
  {
    code: 'creative-storytelling',
    domain: 'creativity',
    title: 'Creating story characters and settings',
  },
  {
    code: 'reading-comprehension',
    domain: 'literacy',
    title: 'Understanding what a story says',
  },
  { code: 'sequencing', domain: 'literacy', title: 'Sequencing story events' },
  {
    code: 'curious-questioning',
    domain: 'science',
    title: 'Asking and exploring curious questions',
  },
  {
    code: 'cause-and-effect',
    domain: 'science',
    title: 'Understanding cause and effect in nature',
  },
  { code: 'observation', domain: 'science', title: 'Careful observation of the natural world' },
  {
    code: 'science-comprehension',
    domain: 'science',
    title: 'Understanding a nature explanation',
  },
  { code: 'patterns', domain: 'numeracy', title: 'Recognizing and continuing patterns' },
  { code: 'animal-science', domain: 'science', title: 'Learning how animals live and behave' },
  { code: 'measurement', domain: 'numeracy', title: 'Measuring and comparing size' },
  {
    code: 'empathy',
    domain: 'social-emotional',
    title: "Understanding another's feelings and perspective",
  },
];
