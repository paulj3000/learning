import { describe, expect, it } from 'vitest';
import { isCoopEligibleStepType, parseCoopSharedState } from './types';

describe('isCoopEligibleStepType', () => {
  it('marks NUMBER_INPUT, ORDERING, MATCHING, and WORLD_CHANGE as coop-eligible', () => {
    expect(isCoopEligibleStepType('NUMBER_INPUT')).toBe(true);
    expect(isCoopEligibleStepType('ORDERING')).toBe(true);
    expect(isCoopEligibleStepType('MATCHING')).toBe(true);
    expect(isCoopEligibleStepType('WORLD_CHANGE')).toBe(true);
  });

  it('keeps every single-child step type ineligible, per docs/ADVENTURE_ENGINE.md', () => {
    expect(isCoopEligibleStepType('NARRATIVE')).toBe(false);
    expect(isCoopEligibleStepType('CHOICE')).toBe(false);
    expect(isCoopEligibleStepType('SHORT_RESPONSE')).toBe(false);
    expect(isCoopEligibleStepType('CREATIVE_CHOICE')).toBe(false);
    expect(isCoopEligibleStepType('REFLECTION')).toBe(false);
    expect(isCoopEligibleStepType('COMPLETE')).toBe(false);
  });
});

describe('parseCoopSharedState', () => {
  it('returns empty slots and presence for null/undefined/non-object input', () => {
    expect(parseCoopSharedState(null)).toEqual({ slots: {}, presence: [] });
    expect(parseCoopSharedState(undefined)).toEqual({ slots: {}, presence: [] });
    expect(parseCoopSharedState('not an object')).toEqual({ slots: {}, presence: [] });
  });

  it('parses a well-formed shared state', () => {
    const parsed = parseCoopSharedState({
      slots: { 'count-planks': 'child-a' },
      presence: ['child-a', 'child-b'],
    });
    expect(parsed).toEqual({
      slots: { 'count-planks': 'child-a' },
      presence: ['child-a', 'child-b'],
    });
  });

  it('drops non-string slot values and non-string presence entries rather than trusting them', () => {
    const parsed = parseCoopSharedState({
      slots: { 'count-planks': 'child-a', 'bad-slot': 42 },
      presence: ['child-a', 7, null],
    });
    expect(parsed).toEqual({
      slots: { 'count-planks': 'child-a' },
      presence: ['child-a'],
    });
  });
});
