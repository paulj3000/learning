import { describe, expect, it } from 'vitest';
import { MAX_HINT_LEVEL } from '../adventures/engine/hints';
import { SCAFFOLDING_LEVEL_ORDER } from '../teaching/types';
import {
  TUTOR_STRATEGY_BY_HINT_LEVEL,
  scaffoldingLevelForStrategy,
  strategyForHintLevel,
} from './strategy';
import { APPROVED_TUTOR_STRATEGIES } from './types';

describe('strategyForHintLevel', () => {
  it('escalates gentlest to most direct across the whole hint ladder', () => {
    expect([1, 2, 3, 4, 5].map(strategyForHintLevel)).toEqual([
      'ENCOURAGE',
      'ASK_GUIDING_QUESTION',
      'GIVE_HINT',
      'SWITCH_REPRESENTATION',
      'EXPLAIN',
    ]);
  });

  it('never gives away more than encouragement before the child has asked', () => {
    expect(strategyForHintLevel(0)).toBe('ENCOURAGE');
    expect(strategyForHintLevel(-3)).toBe('ENCOURAGE');
  });

  it('clamps at guided completion, matching the ladder length', () => {
    expect(strategyForHintLevel(MAX_HINT_LEVEL)).toBe('EXPLAIN');
    expect(strategyForHintLevel(MAX_HINT_LEVEL + 4)).toBe('EXPLAIN');
  });

  it('covers exactly one rung per approved strategy', () => {
    expect([...TUTOR_STRATEGY_BY_HINT_LEVEL].sort()).toEqual([...APPROVED_TUTOR_STRATEGIES].sort());
    expect(TUTOR_STRATEGY_BY_HINT_LEVEL).toHaveLength(MAX_HINT_LEVEL);
  });
});

describe('scaffoldingLevelForStrategy', () => {
  it('maps each strategy onto the Phase 21 support-type label for the same rung', () => {
    expect(APPROVED_TUTOR_STRATEGIES.map(scaffoldingLevelForStrategy).sort()).toEqual(
      [...SCAFFOLDING_LEVEL_ORDER].sort(),
    );
    expect(scaffoldingLevelForStrategy('EXPLAIN')).toBe('EQUIVALENT_RETRY_PROBLEM');
  });
});
