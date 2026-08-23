import { describe, expect, it } from 'vitest';
import { SKILLS } from '../../curriculum/content';
import { disallowedCurriculumTerms } from '../schema';
import {
  CORE_TUTOR_VOCABULARY,
  CURRICULUM_TERMS,
  SKILL_VOCABULARY,
  allowedVocabularyForSkill,
} from './vocabulary';

describe('authored tutoring vocabulary', () => {
  it('only names skills the curriculum actually defines', () => {
    const curriculumSkillIds = new Set(SKILLS.map((skill) => skill.id));
    for (const skillId of Object.keys(SKILL_VOCABULARY)) {
      expect(curriculumSkillIds.has(skillId)).toBe(true);
    }
  });

  it('lets every skill say its own name without tripping the tripwire', () => {
    // A skill whose own title trips its own vocabulary check would fall
    // back on every single turn, which is the failure mode this asserts
    // against: the permission list has to cover the words the skill is
    // about, including the plural and -ing forms `CURRICULUM_TERMS` lists.
    for (const skill of SKILLS) {
      const allowed = allowedVocabularyForSkill(skill.id);
      if (!allowed) continue;
      expect(disallowedCurriculumTerms(`${skill.title}. ${skill.description}`, allowed)).toEqual(
        [],
      );
    }
  });

  it('keeps curriculum terms out of the shared core list', () => {
    const curriculumTerms = new Set(CURRICULUM_TERMS);
    for (const word of CORE_TUTOR_VOCABULARY) {
      expect(curriculumTerms.has(word)).toBe(false);
    }
  });

  it('has no vocabulary for a skill nobody authored one for', () => {
    expect(allowedVocabularyForSkill('quantum-mechanics')).toBeUndefined();
  });

  it('returns a stable, de-duplicated, sorted list', () => {
    const allowed = allowedVocabularyForSkill('counting-sets');
    expect(allowed).toBeDefined();
    expect(allowed).toEqual([...(allowed ?? [])].sort());
    expect(new Set(allowed).size).toBe(allowed?.length);
  });
});
