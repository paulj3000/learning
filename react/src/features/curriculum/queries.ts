import { DOMAINS, GRADES, SKILLS, SUBJECTS } from './content';
import type { AgeBandValue } from '../child-profile/constants';
import type { Domain, Grade, Skill, Subject } from './types';

/**
 * Pure curriculum query functions (Learning Engine, docs/ARCHITECTURE.md).
 * All read from the source-controlled seed content in `./content` — no
 * network or DB access, so these are safe to call from anywhere without
 * an authenticated session.
 */

export function listSubjects(): Subject[] {
  return SUBJECTS;
}

export function getSubject(subjectId: string): Subject | undefined {
  return SUBJECTS.find((subject) => subject.id === subjectId);
}

export function listGrades(subjectId: string): Grade[] {
  return GRADES.filter((grade) => grade.subjectId === subjectId);
}

export function getGrade(gradeId: string): Grade | undefined {
  return GRADES.find((grade) => grade.id === gradeId);
}

export function listDomains(gradeId: string): Domain[] {
  return DOMAINS.filter((domain) => domain.gradeId === gradeId);
}

export function getDomain(domainId: string): Domain | undefined {
  return DOMAINS.find((domain) => domain.id === domainId);
}

export function listSkills(domainId: string): Skill[] {
  return SKILLS.filter((skill) => skill.domainId === domainId);
}

export function getSkill(skillId: string): Skill | undefined {
  return SKILLS.find((skill) => skill.id === skillId);
}

/**
 * Every skill whose domain's grade is appropriate for the given age band.
 */
export function listSkillsByAgeBand(ageBand: AgeBandValue): Skill[] {
  const gradeIds = new Set(
    GRADES.filter((grade) => grade.ageBands.includes(ageBand)).map((grade) => grade.id),
  );
  const domainIds = new Set(
    DOMAINS.filter((domain) => gradeIds.has(domain.gradeId)).map((domain) => domain.id),
  );
  return SKILLS.filter((skill) => domainIds.has(skill.domainId));
}

/** Resolved prerequisite skills for a skill (unknown IDs are silently skipped). */
export function listPrerequisites(skillId: string): Skill[] {
  const skill = getSkill(skillId);
  if (!skill) return [];
  return skill.prerequisiteSkillIds
    .map((id) => getSkill(id))
    .filter((prerequisite): prerequisite is Skill => prerequisite !== undefined);
}

/**
 * A skill is unlocked once every one of its prerequisites is in the
 * caller-supplied set of already-known skill IDs. A skill with no
 * prerequisites is always unlocked. Callers (the Mastery Engine, from
 * Phase 20) supply their own notion of "known" — this function has no
 * opinion on what counts as mastered.
 */
export function isSkillUnlocked(
  skillId: string,
  knownSkillIds: ReadonlySet<string> | readonly string[],
): boolean {
  const skill = getSkill(skillId);
  if (!skill) return false;
  const known = knownSkillIds instanceof Set ? knownSkillIds : new Set(knownSkillIds);
  return skill.prerequisiteSkillIds.every((id) => known.has(id));
}
