import { describe, expect, it } from 'vitest';
import { DOMAINS, GRADES, SKILLS, SUBJECTS } from './content';
import {
  getDomain,
  getGrade,
  getSkill,
  getSubject,
  isSkillUnlocked,
  listDomains,
  listGrades,
  listPrerequisites,
  listSkills,
  listSkillsByAgeBand,
  listSubjects,
} from './queries';

describe('curriculum queries', () => {
  it('lists subjects, grades, domains, and skills by parent id', () => {
    expect(listSubjects()).toEqual(SUBJECTS);
    expect(listGrades('mathematics')).toEqual(GRADES);
    expect(listDomains('grade-1-2')).toEqual(DOMAINS);
    expect(listSkills('counting-and-cardinality')).toEqual([
      SKILLS.find((skill) => skill.id === 'counting-sets'),
    ]);
  });

  it('returns undefined for unknown ids rather than throwing', () => {
    expect(getSubject('not-a-subject')).toBeUndefined();
    expect(getGrade('not-a-grade')).toBeUndefined();
    expect(getDomain('not-a-domain')).toBeUndefined();
    expect(getSkill('not-a-skill')).toBeUndefined();
  });

  it('filters skills by age band through the grade they belong to', () => {
    const pathfinderSkills = listSkillsByAgeBand('PATHFINDER');
    expect(pathfinderSkills.map((skill) => skill.id).sort()).toEqual(
      [...SKILLS].map((skill) => skill.id).sort(),
    );
    expect(listSkillsByAgeBand('SPROUT')).toEqual([]);
    expect(listSkillsByAgeBand('EXPLORER')).toEqual([]);
  });

  it('resolves prerequisite skill ids into skill objects', () => {
    expect(listPrerequisites('counting-sets')).toEqual([]);
    expect(listPrerequisites('addition-within-ten').map((skill) => skill.id)).toEqual([
      'counting-sets',
    ]);
    expect(listPrerequisites('not-a-skill')).toEqual([]);
  });

  it('treats a skill with no prerequisites as always unlocked', () => {
    expect(isSkillUnlocked('counting-sets', [])).toBe(true);
    expect(isSkillUnlocked('counting-sets', new Set())).toBe(true);
  });

  it('unlocks a skill only once every prerequisite is known', () => {
    expect(isSkillUnlocked('addition-within-ten', [])).toBe(false);
    expect(isSkillUnlocked('addition-within-ten', ['counting-sets'])).toBe(true);
    expect(isSkillUnlocked('subtraction-within-ten', ['counting-sets'])).toBe(false);
    expect(
      isSkillUnlocked('subtraction-within-ten', new Set(['counting-sets', 'addition-within-ten'])),
    ).toBe(true);
  });

  it('returns false for an unknown skill id', () => {
    expect(isSkillUnlocked('not-a-skill', ['counting-sets'])).toBe(false);
  });
});

describe('curriculum seed content integrity', () => {
  it('has every domain pointing at a real grade', () => {
    const gradeIds = new Set(GRADES.map((grade) => grade.id));
    for (const domain of DOMAINS) {
      expect(gradeIds.has(domain.gradeId)).toBe(true);
    }
  });

  it('has every grade pointing at a real subject', () => {
    const subjectIds = new Set(SUBJECTS.map((subject) => subject.id));
    for (const grade of GRADES) {
      expect(subjectIds.has(grade.subjectId)).toBe(true);
    }
  });

  it('has every skill pointing at a real domain', () => {
    const domainIds = new Set(DOMAINS.map((domain) => domain.id));
    for (const skill of SKILLS) {
      expect(domainIds.has(skill.domainId)).toBe(true);
    }
  });

  it('has every prerequisite id pointing at a real skill', () => {
    const skillIds = new Set(SKILLS.map((skill) => skill.id));
    for (const skill of SKILLS) {
      for (const prerequisiteId of skill.prerequisiteSkillIds) {
        expect(skillIds.has(prerequisiteId)).toBe(true);
      }
    }
  });

  it('has no duplicate ids within subjects, grades, domains, or skills', () => {
    expect(new Set(SUBJECTS.map((s) => s.id)).size).toBe(SUBJECTS.length);
    expect(new Set(GRADES.map((g) => g.id)).size).toBe(GRADES.length);
    expect(new Set(DOMAINS.map((d) => d.id)).size).toBe(DOMAINS.length);
    expect(new Set(SKILLS.map((s) => s.id)).size).toBe(SKILLS.length);
  });

  it('covers every numeracy objective "Repair the Moonlight Bridge" teaches', () => {
    const skillIds = new Set(SKILLS.map((skill) => skill.id));
    for (const objectiveId of ['counting-sets', 'addition-within-ten', 'comparing-lengths']) {
      expect(skillIds.has(objectiveId)).toBe(true);
    }
  });
});
