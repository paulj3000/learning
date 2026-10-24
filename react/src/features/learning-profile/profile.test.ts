import { describe, expect, it } from 'vitest';
import { SKILLS } from '../curriculum/content/index';
import { ZERO_SKILL_PROGRESS_COUNTS } from '../mastery/status';
import type { SkillProgressCounts } from '../mastery/types';
import { computeLearningProfile, domainProfile, hasEvidence, MAX_DERIVED_LEVEL } from './profile';
import {
  DOMAINS_WITHOUT_CURRICULUM_SKILLS,
  LEARNING_DOMAINS,
  SKILL_DOMAIN_MAP,
  unmappedSkills,
  type SkillEvidenceInput,
} from './types';

function counts(exposure: number, independent: number): SkillProgressCounts {
  return {
    ...ZERO_SKILL_PROGRESS_COUNTS,
    exposureCount: exposure,
    independentSuccessCount: independent,
  };
}

function evidence(skillId: string, exposure: number, independent: number): SkillEvidenceInput {
  return { skillId, counts: counts(exposure, independent) };
}

describe('SKILL_DOMAIN_MAP', () => {
  it('maps every authored curriculum skill to a domain', () => {
    // The authoring check: a new curriculum skill that nobody has placed in a
    // reasoning domain fails here rather than silently never counting toward
    // any level. Same role `manifest.test.ts` plays for assets.
    expect(unmappedSkills(SKILLS)).toEqual([]);
  });

  it('only maps ids that are real curriculum skills', () => {
    // Guards the opposite mistake: mapping a curriculum *domain* id (say
    // `early-number`) reads as a mapped skill but can never match evidence.
    const skillIds = new Set(SKILLS.map((skill) => skill.id));
    for (const mappedId of Object.keys(SKILL_DOMAIN_MAP)) {
      expect(skillIds.has(mappedId)).toBe(true);
    }
  });

  it('agrees with the documented list of domains that have no skills yet', () => {
    const mapped = new Set(Object.values(SKILL_DOMAIN_MAP));
    const withoutSkills = LEARNING_DOMAINS.filter((domain) => !mapped.has(domain));
    expect([...withoutSkills].sort()).toEqual([...DOMAINS_WITHOUT_CURRICULUM_SKILLS].sort());
  });
});

describe('computeLearningProfile', () => {
  it('reports every domain, even ones with no evidence', () => {
    const profile = computeLearningProfile([]);
    expect(Object.keys(profile.domains).sort()).toEqual([...LEARNING_DOMAINS].sort());
  });

  it('reads an unassessed domain as "no evidence", not as a low score', () => {
    const profile = computeLearningProfile([evidence('counting-sets', 10, 8)]);
    const reading = domainProfile(profile, 'reading');

    expect(reading.level).toBe(1);
    expect(reading.confidence).toBe(0);
    expect(hasEvidence(reading)).toBe(false);

    // Math, by contrast, has evidence behind its level.
    expect(hasEvidence(domainProfile(profile, 'math'))).toBe(true);
  });

  it('aggregates several skills into one domain', () => {
    const profile = computeLearningProfile([
      evidence('counting-sets', 6, 5),
      evidence('addition-within-ten', 6, 4),
    ]);
    const math = domainProfile(profile, 'math');

    expect(math.attempts).toBe(12);
    expect(math.successes).toBe(9);
  });

  it('routes patterns to logic rather than math', () => {
    const profile = computeLearningProfile([evidence('patterns', 8, 6)]);

    expect(domainProfile(profile, 'logic').successes).toBe(6);
    expect(domainProfile(profile, 'math').successes).toBe(0);
  });

  it('skips evidence for an unmapped skill rather than bucketing it somewhere', () => {
    const profile = computeLearningProfile([evidence('not-a-real-skill', 20, 20)]);

    for (const domain of LEARNING_DOMAINS) {
      expect(domainProfile(profile, domain).attempts).toBe(0);
    }
  });

  it('climbs the level ladder with independent successes', () => {
    const at = (exposure: number, independent: number) =>
      domainProfile(
        computeLearningProfile([evidence('counting-sets', exposure, independent)]),
        'math',
      ).level;

    expect(at(2, 0)).toBe(1);
    expect(at(5, 3)).toBe(2);
    expect(at(10, 8)).toBe(3);
    expect(at(18, 15)).toBe(4);
    expect(at(30, 24)).toBe(5);
  });

  it('never auto-promotes into the open-ended challenge band', () => {
    const level = domainProfile(
      computeLearningProfile([evidence('counting-sets', 500, 500)]),
      'math',
    ).level;

    expect(level).toBe(MAX_DERIVED_LEVEL);
    expect(level).toBeLessThan(6);
  });

  it('counts supported successes as attempts but not toward level', () => {
    const supportedOnly: SkillEvidenceInput = {
      skillId: 'counting-sets',
      counts: { ...ZERO_SKILL_PROGRESS_COUNTS, exposureCount: 10, supportedSuccessCount: 10 },
    };
    const math = domainProfile(computeLearningProfile([supportedOnly]), 'math');

    expect(math.attempts).toBe(10);
    expect(math.successes).toBe(0);
    expect(math.level).toBe(1);
  });

  describe('confidence', () => {
    it('grows with the volume of evidence behind the same ratio', () => {
      const few = domainProfile(computeLearningProfile([evidence('counting-sets', 3, 3)]), 'math');
      const many = domainProfile(
        computeLearningProfile([evidence('counting-sets', 12, 12)]),
        'math',
      );

      expect(many.confidence).toBeGreaterThan(few.confidence);
    });

    it('is lowest when the child is right about half the time', () => {
      const coinFlip = domainProfile(
        computeLearningProfile([evidence('counting-sets', 12, 6)]),
        'math',
      );
      const consistent = domainProfile(
        computeLearningProfile([evidence('counting-sets', 12, 12)]),
        'math',
      );

      expect(coinFlip.confidence).toBeLessThan(consistent.confidence);
    });

    it('stays within 0 and 1', () => {
      for (const [exposure, independent] of [
        [1, 0],
        [12, 6],
        [50, 50],
        [7, 3],
      ]) {
        const value = domainProfile(
          computeLearningProfile([evidence('counting-sets', exposure, independent)]),
          'math',
        ).confidence;
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    });
  });
});
