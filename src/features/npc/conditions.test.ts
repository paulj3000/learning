import { describe, expect, it } from 'vitest';
import { evaluateCondition, evaluateConditions, relationshipRank } from './conditions';
import type { NpcContext } from './types';

function context(overrides: Partial<NpcContext> = {}): NpcContext {
  return {
    npcId: 'pirate-pip',
    timeOfDay: 'MORNING',
    relationshipLevel: 'STRANGER',
    memoryFlags: {},
    worldChangeKeys: [],
    completedQuestIds: [],
    ...overrides,
  };
}

describe('evaluateCondition', () => {
  it('always passes ALWAYS', () => {
    expect(evaluateCondition({ type: 'ALWAYS' }, context())).toBe(true);
  });

  it('treats an unset memory flag as false', () => {
    expect(
      evaluateCondition({ type: 'MEMORY_FLAG', flag: 'metPip', equals: false }, context()),
    ).toBe(true);
    expect(
      evaluateCondition({ type: 'MEMORY_FLAG', flag: 'metPip', equals: true }, context()),
    ).toBe(false);
  });

  it('matches a set memory flag', () => {
    const ctx = context({ memoryFlags: { bridgeQuestCompleted: true } });
    expect(
      evaluateCondition({ type: 'MEMORY_FLAG', flag: 'bridgeQuestCompleted', equals: true }, ctx),
    ).toBe(true);
  });

  it('passes RELATIONSHIP_AT_LEAST at or above the named level', () => {
    const friend = context({ relationshipLevel: 'FRIEND' });
    expect(
      evaluateCondition({ type: 'RELATIONSHIP_AT_LEAST', level: 'ACQUAINTANCE' }, friend),
    ).toBe(true);
    expect(evaluateCondition({ type: 'RELATIONSHIP_AT_LEAST', level: 'FRIEND' }, friend)).toBe(
      true,
    );
    expect(
      evaluateCondition({ type: 'RELATIONSHIP_AT_LEAST', level: 'TRUSTED_FRIEND' }, friend),
    ).toBe(false);
  });

  it('reads world change keys and completed quests from context', () => {
    const ctx = context({
      worldChangeKeys: ['bridge-repaired'],
      completedQuestIds: ['repair-the-bridge'],
    });
    expect(evaluateCondition({ type: 'WORLD_CHANGE', changeKey: 'bridge-repaired' }, ctx)).toBe(
      true,
    );
    expect(evaluateCondition({ type: 'WORLD_CHANGE', changeKey: 'nope' }, ctx)).toBe(false);
    expect(evaluateCondition({ type: 'QUEST_COMPLETED', questId: 'repair-the-bridge' }, ctx)).toBe(
      true,
    );
  });

  it('matches the current time bucket', () => {
    expect(evaluateCondition({ type: 'TIME_OF_DAY', timeOfDay: 'MORNING' }, context())).toBe(true);
    expect(evaluateCondition({ type: 'TIME_OF_DAY', timeOfDay: 'EVENING' }, context())).toBe(false);
  });
});

describe('evaluateConditions', () => {
  it('requires every condition to pass', () => {
    const ctx = context({ memoryFlags: { metPip: true }, relationshipLevel: 'FRIEND' });
    expect(
      evaluateConditions(
        [
          { type: 'MEMORY_FLAG', flag: 'metPip', equals: true },
          { type: 'RELATIONSHIP_AT_LEAST', level: 'FRIEND' },
        ],
        ctx,
      ),
    ).toBe(true);
    expect(
      evaluateConditions(
        [
          { type: 'MEMORY_FLAG', flag: 'metPip', equals: true },
          { type: 'RELATIONSHIP_AT_LEAST', level: 'TRUSTED_FRIEND' },
        ],
        ctx,
      ),
    ).toBe(false);
  });

  it('passes an empty or absent condition list', () => {
    expect(evaluateConditions([], context())).toBe(true);
    expect(evaluateConditions(undefined, context())).toBe(true);
  });
});

describe('relationshipRank', () => {
  it('orders the four levels', () => {
    expect(relationshipRank('STRANGER')).toBeLessThan(relationshipRank('ACQUAINTANCE'));
    expect(relationshipRank('ACQUAINTANCE')).toBeLessThan(relationshipRank('FRIEND'));
    expect(relationshipRank('FRIEND')).toBeLessThan(relationshipRank('TRUSTED_FRIEND'));
  });
});
