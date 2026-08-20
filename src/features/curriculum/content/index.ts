import type { Domain, Grade, Skill, Subject } from '../types';
import { MATH_DOMAINS, MATH_GRADE_1_2, MATH_SKILLS, MATH_SUBJECT } from './mathGrade1To2';

export const SUBJECTS: Subject[] = [MATH_SUBJECT];
export const GRADES: Grade[] = [MATH_GRADE_1_2];
export const DOMAINS: Domain[] = [...MATH_DOMAINS];
export const SKILLS: Skill[] = [...MATH_SKILLS];

export * from './mathGrade1To2';
