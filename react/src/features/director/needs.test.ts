import { describe, expect, it } from 'vitest';
import { needWeightBySkillId, rankSkillNeeds, skillNeed } from './needs';
import { SKILL_NEED_WEIGHT } from './types';

describe('skillNeed', () => {
  it('weights a skill from its status alone', () => {
    expect(skillNeed({ skillId: 'counting-sets', status: 'INTRODUCED' })).toEqual({
      skillId: 'counting-sets',
      status: 'INTRODUCED',
      weight: SKILL_NEED_WEIGHT.INTRODUCED,
    });
  });
});

describe('rankSkillNeeds', () => {
  it('puts the weakest unlocked skill first', () => {
    const ranked = rankSkillNeeds([
      { skillId: 'a', status: 'PROFICIENT' },
      { skillId: 'b', status: 'INTRODUCED' },
      { skillId: 'c', status: 'DEVELOPING' },
    ]);
    expect(ranked.map((need) => need.skillId)).toEqual(['b', 'c', 'a']);
  });

  /**
   * The two ends of the ladder score zero for opposite reasons: a MASTERED
   * skill needs no practice, and a LOCKED one has unmet prerequisites, so
   * putting it in front of a child would be work they were never prepared
   * for. Both are dropped, so neither can be recommended.
   */
  it('drops both mastered and locked skills', () => {
    const ranked = rankSkillNeeds([
      { skillId: 'done', status: 'MASTERED' },
      { skillId: 'not-ready', status: 'LOCKED' },
      { skillId: 'working', status: 'DEVELOPING' },
    ]);
    expect(ranked.map((need) => need.skillId)).toEqual(['working']);
  });

  it('orders equal weights by skill id so a child sees a stable list', () => {
    const ranked = rankSkillNeeds([
      { skillId: 'zebra', status: 'INTRODUCED' },
      { skillId: 'apple', status: 'INTRODUCED' },
    ]);
    expect(ranked.map((need) => need.skillId)).toEqual(['apple', 'zebra']);
  });

  it('returns nothing when every skill is finished', () => {
    expect(rankSkillNeeds([{ skillId: 'a', status: 'MASTERED' }])).toEqual([]);
  });
});

describe('needWeightBySkillId', () => {
  it('indexes only the skills that need work', () => {
    const map = needWeightBySkillId([
      { skillId: 'a', status: 'INTRODUCED' },
      { skillId: 'b', status: 'MASTERED' },
    ]);
    expect(map.get('a')?.weight).toBe(SKILL_NEED_WEIGHT.INTRODUCED);
    expect(map.has('b')).toBe(false);
  });
});
