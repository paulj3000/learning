import type { Domain, Grade, Skill } from '../types';
import { MATH_SUBJECT } from './mathGrade1To2';

/**
 * Grade 3 mathematics, one skill only: multiplication facts. It exists so that
 * AI Question Studio questions (ADR-045) have a catalog learning objective to
 * record progress against; the rest of grade 3 is not authored yet.
 * Explorers only, since grade 3 is the Explorer band (ages 7 to 8).
 */

export const MATH_GRADE_3: Grade = {
  id: 'grade-3',
  subjectId: MATH_SUBJECT.id,
  title: 'Grade 3',
  ageBands: ['EXPLORER'],
};

export const MATH_GRADE_3_DOMAINS: Domain[] = [
  {
    id: 'multiplication-and-division',
    gradeId: MATH_GRADE_3.id,
    title: 'Multiplication and Division',
  },
];

export const MATH_GRADE_3_SKILLS: Skill[] = [
  {
    id: 'multiplication-facts',
    domainId: 'multiplication-and-division',
    title: 'Multiplication facts',
    description: 'Find the total of equal groups, such as 6 groups of 7.',
    prerequisiteSkillIds: ['addition-within-ten'],
    difficulty: 3,
    representations: ['numeric', 'visual', 'word-problem'],
  },
];
