import { describe, expect, it } from 'vitest';
import { isGuidedCompletion, nextHintLevel } from '../adventures/engine/hints';
import {
  MAX_SCAFFOLDING_LEVEL,
  hintLevelForScaffoldingLevel,
  nextScaffoldingLevel,
  scaffoldingLevelForHintLevel,
  shouldForceAdvancement,
} from './scaffolding';
import { SCAFFOLDING_LEVEL_ORDER } from './types';

describe('scaffoldingLevelForHintLevel', () => {
  it('has no named level at or below zero', () => {
    expect(scaffoldingLevelForHintLevel(0)).toBeUndefined();
    expect(scaffoldingLevelForHintLevel(-1)).toBeUndefined();
  });

  it('maps 1-5 to the five named levels in order', () => {
    expect(scaffoldingLevelForHintLevel(1)).toBe('CONTEXTUAL_HINT');
    expect(scaffoldingLevelForHintLevel(5)).toBe('EQUIVALENT_RETRY_PROBLEM');
    expect(SCAFFOLDING_LEVEL_ORDER.length).toBe(MAX_SCAFFOLDING_LEVEL);
  });

  it('clamps above the maximum rather than going out of bounds', () => {
    expect(scaffoldingLevelForHintLevel(9)).toBe('EQUIVALENT_RETRY_PROBLEM');
  });
});

describe('hintLevelForScaffoldingLevel', () => {
  it('round-trips every named level back to its 1-based hint level', () => {
    SCAFFOLDING_LEVEL_ORDER.forEach((level, index) => {
      expect(hintLevelForScaffoldingLevel(level)).toBe(index + 1);
      expect(scaffoldingLevelForHintLevel(index + 1)).toBe(level);
    });
  });
});

describe('nextScaffoldingLevel', () => {
  it('starts at the mildest level from no prior scaffold', () => {
    expect(nextScaffoldingLevel(undefined)).toBe('CONTEXTUAL_HINT');
  });

  it('escalates one level at a time', () => {
    expect(nextScaffoldingLevel('CONTEXTUAL_HINT')).toBe('VISUAL_REPRESENTATION');
  });

  it('caps at the most intensive level', () => {
    expect(nextScaffoldingLevel('EQUIVALENT_RETRY_PROBLEM')).toBe('EQUIVALENT_RETRY_PROBLEM');
  });
});

describe('shouldForceAdvancement', () => {
  it('is false with no scaffold used', () => {
    expect(shouldForceAdvancement(undefined)).toBe(false);
  });

  it('is false below the most intensive level', () => {
    expect(shouldForceAdvancement('GUIDED_DEMONSTRATION')).toBe(false);
  });

  it('is true at the most intensive level', () => {
    expect(shouldForceAdvancement('EQUIVALENT_RETRY_PROBLEM')).toBe(true);
  });
});

describe('equivalence with the existing hint ladder (hints.ts)', () => {
  it('shouldForceAdvancement agrees with isGuidedCompletion at every hint level', () => {
    for (let hintLevel = 0; hintLevel <= 6; hintLevel += 1) {
      expect(shouldForceAdvancement(scaffoldingLevelForHintLevel(hintLevel))).toBe(
        isGuidedCompletion(hintLevel),
      );
    }
  });

  it('escalating a named level matches escalating the equivalent numeric hint level', () => {
    for (let hintLevel = 0; hintLevel <= 5; hintLevel += 1) {
      const escalatedNamed = hintLevelForScaffoldingLevel(
        nextScaffoldingLevel(scaffoldingLevelForHintLevel(hintLevel)),
      );
      expect(escalatedNamed).toBe(nextHintLevel(hintLevel));
    }
  });
});
