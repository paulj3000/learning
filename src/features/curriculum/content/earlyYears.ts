import type { Domain, Grade, Skill, Subject } from '../types';

/**
 * The early-years slice of the seed curriculum (docs/ROADMAP.md Phase 19).
 *
 * Added because `listSkillsByAgeBand` returned **nothing** for Sprouts and
 * Explorers: the seed authored one grade, `grade-1-2`, banded `PATHFINDER`
 * only. That was invisible until the Phase 28 Director was run against live
 * data for all three bands, where every adventure tied at zero for two of
 * them. Two engines depend on this file being populated:
 *
 * - the **Adaptive Adventure Director** (Phase 28) ranks by the mastery
 *   statuses of a child's *own band's* skills, so an empty band cannot be
 *   personalised at all;
 * - the **AI Tutor** (Phase 27) only tutors a skill the curriculum knows
 *   *and* a designer has written vocabulary for (`isTutorableSkill`).
 *
 * A skill belongs to exactly one domain, hence one grade, hence one set of
 * age bands. That is why a grade here can serve two bands rather than one:
 * counting a small set of objects is genuinely the same skill for a
 * four-year-old and a six-year-old, and splitting it into two ids would
 * break the `Skill.id === learningObjectiveCode` join that every authored
 * adventure relies on.
 *
 * Scoped, like the original seed, to what authored content actually
 * practises. Every skill below is named by a step in a shipped adventure:
 * `three-planks-for-the-bridge` (Sprout) evidences `counting-sets`,
 * `classification`, and `cause-and-effect`; the butterfly garden chapters
 * evidence `counting-sets` and `animal-science`.
 */

export const SCIENCE_SUBJECT: Subject = {
  id: 'science',
  title: 'Science and the natural world',
};

/**
 * Serves Sprouts and Pathfinders. A Pathfinder has not finished with sorting
 * and noticing; they practise the same skills inside longer adventures, so
 * removing the band here would make a Pathfinder's profile claim they had no
 * science skills at all.
 */
export const EARLY_SCIENCE_GRADE: Grade = {
  id: 'early-science',
  subjectId: SCIENCE_SUBJECT.id,
  title: 'First look at the world',
  ageBands: ['SPROUT', 'PATHFINDER'],
};

export const EARLY_SCIENCE_DOMAINS: Domain[] = [
  {
    id: 'observing-and-sorting',
    gradeId: EARLY_SCIENCE_GRADE.id,
    title: 'Observing and Sorting',
  },
  {
    id: 'living-things',
    gradeId: EARLY_SCIENCE_GRADE.id,
    title: 'Living Things',
  },
];

export const EARLY_SCIENCE_SKILLS: Skill[] = [
  {
    id: 'observation',
    domainId: 'observing-and-sorting',
    title: 'Careful observation of the natural world',
    description: 'Look closely at something and say what you notice about it.',
    prerequisiteSkillIds: [],
    difficulty: 1,
    representations: ['visual', 'game-interaction'],
  },
  {
    id: 'classification',
    domainId: 'observing-and-sorting',
    title: 'Sorting things by what they are',
    description: 'Put things into groups by shape, colour, or what they are used for.',
    prerequisiteSkillIds: ['observation'],
    difficulty: 1,
    representations: ['visual', 'game-interaction'],
  },
  {
    id: 'cause-and-effect',
    domainId: 'observing-and-sorting',
    title: 'Understanding cause and effect',
    description: 'Say what happens next, and why one thing made another thing happen.',
    prerequisiteSkillIds: ['observation'],
    difficulty: 2,
    representations: ['visual', 'word-problem', 'game-interaction'],
  },
  {
    id: 'animal-science',
    domainId: 'living-things',
    title: 'Learning how animals live and behave',
    description: 'Find out what an animal eats, where it lives, and how it moves.',
    prerequisiteSkillIds: ['observation'],
    difficulty: 2,
    representations: ['visual', 'word-problem'],
  },
];

/**
 * Counting lives here rather than in `grade-1-2` so that Sprouts have any
 * numeracy at all. Nothing is lost by the move: this grade serves
 * Pathfinders too, and `addition-within-ten` still names `counting-sets` as
 * its prerequisite across the grade boundary, which the graph allows.
 */
export const MATH_EARLY_GRADE: Grade = {
  id: 'math-early-years',
  subjectId: 'mathematics',
  title: 'First numbers',
  ageBands: ['SPROUT', 'PATHFINDER'],
};

export const MATH_EARLY_DOMAINS: Domain[] = [
  {
    id: 'early-number',
    gradeId: MATH_EARLY_GRADE.id,
    title: 'Early Number',
  },
];

export const MATH_EARLY_SKILLS: Skill[] = [
  {
    id: 'counting-sets',
    domainId: 'early-number',
    title: 'Counting sets of objects',
    description: 'Count a set of objects one at a time and give the total.',
    prerequisiteSkillIds: [],
    difficulty: 1,
    representations: ['visual', 'game-interaction'],
  },
];
