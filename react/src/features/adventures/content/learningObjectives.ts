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
    title: 'Understanding cause and effect',
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
  { code: 'classification', domain: 'science', title: 'Sorting things by what they are' },
  { code: 'subtraction-within-ten', domain: 'numeracy', title: 'Subtraction within ten' },
  { code: 'vocabulary', domain: 'literacy', title: 'Learning and using new words' },
  { code: 'multiplication-facts', domain: 'numeracy', title: 'Multiplication facts' },
  {
    code: 'phonemic-awareness',
    domain: 'literacy',
    title: 'Hearing rhymes and the sounds in words',
  },
  // FPV-D10: Area puzzle objectives (Heart of Firepeak, North Pole). Mapping and reasons:
  // docs/regions/PUZZLE_SKILL_MAPPING.md.
  { code: 'number-recognition', domain: 'numeracy', title: 'Recognizing written numbers' },
  {
    code: 'comparing-and-ordering-numbers',
    domain: 'numeracy',
    title: 'Comparing and ordering numbers',
  },
  { code: 'addition-within-100', domain: 'numeracy', title: 'Addition within 100' },
  { code: 'subtraction-within-100', domain: 'numeracy', title: 'Subtraction within 100' },
  { code: 'equal-sharing', domain: 'numeracy', title: 'Sharing equally into groups' },
  { code: 'halves-and-fractions', domain: 'numeracy', title: 'Halves and simple fractions' },
  { code: 'shapes-and-geometry', domain: 'numeracy', title: 'Naming and describing shapes' },
  // #102 (owner, 2026-11-27): grid routes and compass clues are spatial reasoning, not only
  // ordered steps. NAVIGATE_ROUTE and the cove map's direction clues name it.
  {
    code: 'position-and-direction',
    domain: 'numeracy',
    title: 'Using directions and positions on a map',
  },
  { code: 'symmetry', domain: 'numeracy', title: 'Finding symmetry' },
  { code: 'sight-words', domain: 'literacy', title: 'Reading common sight words' },
  { code: 'simple-circuits', domain: 'science', title: 'How simple circuits work' },
  {
    code: 'earth-science',
    domain: 'science',
    title: 'Rocks, volcanoes and how the land changes',
  },
  { code: 'earth-and-space', domain: 'science', title: 'The Sun, Moon and stars' },
];
