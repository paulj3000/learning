import type { Domain, Grade, Skill, Subject } from '../types';

/**
 * Seed curriculum: one vertical slice only (roadmap Phase 19), not every
 * grade and subject. Scoped to grade 1-2 mathematics, enough to cover the
 * numeracy skills "Repair the Moonlight Bridge" (Phase 9/11) already
 * teaches: `addition-within-ten` and `comparing-lengths`. `counting-sets`
 * moved to `earlyYears.ts` so that Sprouts have numeracy of their own; it is
 * still this grade's prerequisite root, across the grade boundary.
 * The remaining numeracy codes from `learningObjectives.ts`
 * (`subtraction-within-ten`, `measurement`, `patterns`) are included too,
 * since they belong to the same grade band and cost nothing extra to
 * structure now.
 */

export const MATH_SUBJECT: Subject = {
  id: 'mathematics',
  title: 'Mathematics',
};

export const MATH_GRADE_1_2: Grade = {
  id: 'grade-1-2',
  subjectId: MATH_SUBJECT.id,
  title: 'Grade 1-2',
  /**
   * Serves Explorers as well as Pathfinders. The seed does not yet author a
   * distinct grade-3 skill set, and an Explorer has not stopped practising
   * measurement or arithmetic: `the-tide-gate-calculation` evidences
   * `measurement` and `comparing-lengths` directly. Without this band an
   * Explorer's curriculum would be empty, which is what the Phase 28
   * Director found when it was first run against live data.
   */
  ageBands: ['PATHFINDER', 'EXPLORER'],
};

export const MATH_DOMAINS: Domain[] = [
  {
    id: 'counting-and-cardinality',
    gradeId: MATH_GRADE_1_2.id,
    title: 'Counting and Cardinality',
  },
  {
    id: 'operations-and-algebraic-thinking',
    gradeId: MATH_GRADE_1_2.id,
    title: 'Operations and Algebraic Thinking',
  },
  {
    id: 'measurement-and-data',
    gradeId: MATH_GRADE_1_2.id,
    title: 'Measurement and Data',
  },
];

export const MATH_SKILLS: Skill[] = [
  {
    id: 'comparing-lengths',
    domainId: 'measurement-and-data',
    title: 'Comparing and ordering lengths',
    description: 'Compare two or more objects by length, directly or by sight.',
    prerequisiteSkillIds: [],
    difficulty: 1,
    representations: ['visual', 'game-interaction'],
  },
  {
    id: 'addition-within-ten',
    domainId: 'operations-and-algebraic-thinking',
    title: 'Addition within ten',
    description: 'Add two small groups to find a total of ten or fewer.',
    prerequisiteSkillIds: ['counting-sets'],
    difficulty: 2,
    representations: ['numeric', 'visual', 'game-interaction'],
  },
  {
    id: 'patterns',
    domainId: 'operations-and-algebraic-thinking',
    title: 'Recognizing and continuing patterns',
    description: 'Identify a repeating pattern and predict what comes next.',
    prerequisiteSkillIds: ['counting-sets'],
    difficulty: 2,
    representations: ['visual', 'game-interaction'],
  },
  {
    id: 'measurement',
    domainId: 'measurement-and-data',
    title: 'Measuring and comparing size',
    description: 'Measure an object using a non-standard or standard unit and compare results.',
    prerequisiteSkillIds: ['comparing-lengths'],
    difficulty: 3,
    representations: ['visual', 'numeric', 'game-interaction'],
  },
  {
    id: 'subtraction-within-ten',
    domainId: 'operations-and-algebraic-thinking',
    title: 'Subtraction within ten',
    description: 'Take away part of a group of ten or fewer and find how many remain.',
    prerequisiteSkillIds: ['addition-within-ten'],
    difficulty: 3,
    representations: ['numeric', 'word-problem'],
  },
];
