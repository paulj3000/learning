import { describe, expect, it } from 'vitest';
import { claimsLearningJudgment, containsUrl, requestsPersonalInformation } from './contentSafety';

describe('containsUrl', () => {
  it('flags http(s) links', () => {
    expect(containsUrl('Check this out: https://example.com')).toBe(true);
  });

  it('flags bare domains', () => {
    expect(containsUrl('Visit example.com for more')).toBe(true);
  });

  it('allows ordinary sentences', () => {
    expect(containsUrl('The bridge has three missing planks.')).toBe(false);
  });
});

describe('requestsPersonalInformation', () => {
  it('flags requests for a password', () => {
    expect(requestsPersonalInformation('What is your password?')).toBe(true);
  });

  it('flags requests for a home address', () => {
    expect(requestsPersonalInformation('Can you tell me your home address?')).toBe(true);
  });

  it('flags requests for a school name', () => {
    expect(requestsPersonalInformation("What's your school's name?")).toBe(true);
  });

  it('allows ordinary encouragement', () => {
    expect(requestsPersonalInformation('Great job counting those planks!')).toBe(false);
  });
});

describe('claimsLearningJudgment', () => {
  it('flags a claim that the child has mastered something', () => {
    expect(claimsLearningJudgment('You have mastered counting!')).toBe(true);
  });

  it('flags a level or grade label put on the child', () => {
    expect(claimsLearningJudgment('You are now at reading level 4.')).toBe(true);
    expect(claimsLearningJudgment('That was grade 2 work.')).toBe(true);
  });

  it('flags an invented curriculum requirement', () => {
    expect(claimsLearningJudgment('Next you need to learn multiplication.')).toBe(true);
    expect(claimsLearningJudgment('Your homework is to practise this.')).toBe(true);
  });

  it('flags a comparison against other children', () => {
    expect(claimsLearningJudgment('You are better at this than most kids.')).toBe(true);
  });

  it('allows praising the effort in front of it', () => {
    expect(claimsLearningJudgment('You worked really hard on that. Nice counting!')).toBe(false);
  });

  it('allows an ordinary hint', () => {
    expect(claimsLearningJudgment('Try counting the planks one at a time.')).toBe(false);
  });
});
