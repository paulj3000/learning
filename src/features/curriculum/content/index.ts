import type { Domain, Grade, Skill, Subject } from '../types';
import { MATH_DOMAINS, MATH_GRADE_1_2, MATH_SKILLS, MATH_SUBJECT } from './mathGrade1To2';
import {
  EARLY_SCIENCE_DOMAINS,
  EARLY_SCIENCE_GRADE,
  EARLY_SCIENCE_SKILLS,
  MATH_EARLY_DOMAINS,
  MATH_EARLY_GRADE,
  MATH_EARLY_SKILLS,
  SCIENCE_SUBJECT,
} from './earlyYears';

export const SUBJECTS: Subject[] = [MATH_SUBJECT, SCIENCE_SUBJECT];
export const GRADES: Grade[] = [MATH_EARLY_GRADE, MATH_GRADE_1_2, EARLY_SCIENCE_GRADE];
export const DOMAINS: Domain[] = [...MATH_EARLY_DOMAINS, ...MATH_DOMAINS, ...EARLY_SCIENCE_DOMAINS];
export const SKILLS: Skill[] = [...MATH_EARLY_SKILLS, ...MATH_SKILLS, ...EARLY_SCIENCE_SKILLS];

export * from './mathGrade1To2';
export * from './earlyYears';
