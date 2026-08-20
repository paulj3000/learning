import { describe, expect, it } from 'vitest';
import { evaluateInteraction } from './evaluate';
import type { InteractionAnswer, InteractionSkillParams } from './types';

describe('evaluateInteraction', () => {
  describe('DRAG_SORT', () => {
    const skillParams: InteractionSkillParams = {
      mechanic: 'DRAG_SORT',
      correctOrder: ['a', 'b', 'c'],
    };

    it('is correct for an exact match', () => {
      const answer: InteractionAnswer = { mechanic: 'DRAG_SORT', order: ['a', 'b', 'c'] };
      expect(evaluateInteraction(skillParams, answer)).toBe('correct');
    });

    it('is partial when some items are already in place', () => {
      const answer: InteractionAnswer = { mechanic: 'DRAG_SORT', order: ['a', 'c', 'b'] };
      expect(evaluateInteraction(skillParams, answer)).toBe('partial');
    });

    it('is incorrect when nothing is in place', () => {
      const answer: InteractionAnswer = { mechanic: 'DRAG_SORT', order: ['c', 'a', 'b'] };
      expect(evaluateInteraction(skillParams, answer)).toBe('incorrect');
    });
  });

  describe('SPLIT', () => {
    const skillParams: InteractionSkillParams = { mechanic: 'SPLIT', total: 10, partsCount: 2 };

    it('is correct with the right count and sum', () => {
      const answer: InteractionAnswer = { mechanic: 'SPLIT', parts: [4, 6] };
      expect(evaluateInteraction(skillParams, answer)).toBe('correct');
    });

    it('is partial with the right sum but wrong part count', () => {
      const answer: InteractionAnswer = { mechanic: 'SPLIT', parts: [2, 3, 5] };
      expect(evaluateInteraction(skillParams, answer)).toBe('partial');
    });

    it('is partial with the right count but wrong sum', () => {
      const answer: InteractionAnswer = { mechanic: 'SPLIT', parts: [4, 5] };
      expect(evaluateInteraction(skillParams, answer)).toBe('partial');
    });

    it('is partial, not correct, when a part is negative even if the sum and count are right', () => {
      const answer: InteractionAnswer = { mechanic: 'SPLIT', parts: [-1, 11] };
      expect(evaluateInteraction(skillParams, answer)).toBe('partial');
    });

    it('is incorrect when both count and sum are wrong', () => {
      const answer: InteractionAnswer = { mechanic: 'SPLIT', parts: [1, 1, 1] };
      expect(evaluateInteraction(skillParams, answer)).toBe('incorrect');
    });
  });

  describe('MEASURE', () => {
    const skillParams: InteractionSkillParams = {
      mechanic: 'MEASURE',
      targetValue: 10,
      tolerance: 1,
    };

    it('is correct within tolerance', () => {
      expect(
        evaluateInteraction(skillParams, { mechanic: 'MEASURE', value: 10.5 }),
      ).toBe('correct');
    });

    it('is partial within double tolerance', () => {
      expect(evaluateInteraction(skillParams, { mechanic: 'MEASURE', value: 12 })).toBe('partial');
    });

    it('is incorrect beyond double tolerance', () => {
      expect(evaluateInteraction(skillParams, { mechanic: 'MEASURE', value: 20 })).toBe(
        'incorrect',
      );
    });
  });

  describe('BUILD', () => {
    const skillParams: InteractionSkillParams = {
      mechanic: 'BUILD',
      requiredPieceIds: ['wheel', 'axle'],
    };

    it('is correct for an exact set match, order independent', () => {
      expect(
        evaluateInteraction(skillParams, {
          mechanic: 'BUILD',
          selectedPieceIds: ['axle', 'wheel'],
        }),
      ).toBe('correct');
    });

    it('is partial with some overlap', () => {
      expect(
        evaluateInteraction(skillParams, {
          mechanic: 'BUILD',
          selectedPieceIds: ['wheel', 'sail'],
        }),
      ).toBe('partial');
    });

    it('is incorrect with no overlap', () => {
      expect(
        evaluateInteraction(skillParams, { mechanic: 'BUILD', selectedPieceIds: ['sail'] }),
      ).toBe('incorrect');
    });

    it('is incorrect for an extra piece beyond the required set', () => {
      expect(
        evaluateInteraction(skillParams, {
          mechanic: 'BUILD',
          selectedPieceIds: ['wheel', 'axle', 'sail'],
        }),
      ).toBe('partial');
    });
  });

  describe('DECODE', () => {
    const skillParams: InteractionSkillParams = {
      mechanic: 'DECODE',
      pairs: [
        { promptId: 'b', answerId: 'buh' },
        { promptId: 'c', answerId: 'kuh' },
      ],
    };

    it('is correct when every pair matches', () => {
      expect(
        evaluateInteraction(skillParams, {
          mechanic: 'DECODE',
          matches: [
            { promptId: 'b', answerId: 'buh' },
            { promptId: 'c', answerId: 'kuh' },
          ],
        }),
      ).toBe('correct');
    });

    it('is partial when some pairs match', () => {
      expect(
        evaluateInteraction(skillParams, {
          mechanic: 'DECODE',
          matches: [
            { promptId: 'b', answerId: 'buh' },
            { promptId: 'c', answerId: 'buh' },
          ],
        }),
      ).toBe('partial');
    });

    it('is incorrect when no pairs match', () => {
      expect(
        evaluateInteraction(skillParams, {
          mechanic: 'DECODE',
          matches: [{ promptId: 'b', answerId: 'kuh' }],
        }),
      ).toBe('incorrect');
    });
  });

  describe('CONVERSE', () => {
    it('is not_applicable when no response is marked accepted (open/creative)', () => {
      const skillParams: InteractionSkillParams = { mechanic: 'CONVERSE', acceptedResponseIds: [] };
      expect(
        evaluateInteraction(skillParams, { mechanic: 'CONVERSE', responseId: 'anything' }),
      ).toBe('not_applicable');
    });

    it('is correct for an accepted response', () => {
      const skillParams: InteractionSkillParams = {
        mechanic: 'CONVERSE',
        acceptedResponseIds: ['kind'],
      };
      expect(evaluateInteraction(skillParams, { mechanic: 'CONVERSE', responseId: 'kind' })).toBe(
        'correct',
      );
    });

    it('is incorrect for a response outside the accepted set', () => {
      const skillParams: InteractionSkillParams = {
        mechanic: 'CONVERSE',
        acceptedResponseIds: ['kind'],
      };
      expect(evaluateInteraction(skillParams, { mechanic: 'CONVERSE', responseId: 'rude' })).toBe(
        'incorrect',
      );
    });
  });

  it('throws when the answer mechanic does not match the skill params mechanic', () => {
    const skillParams: InteractionSkillParams = { mechanic: 'MEASURE', targetValue: 1, tolerance: 1 };
    const answer: InteractionAnswer = { mechanic: 'CONVERSE', responseId: 'x' };
    expect(() => evaluateInteraction(skillParams, answer)).toThrow();
  });
});
