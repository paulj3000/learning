import { describe, expect, it } from 'vitest';
import { getSkill } from '../../curriculum/queries';
import { evaluateInteraction } from '../../interaction/evaluate';
import { REPRESENTATION_AIDS, representationAidFor } from './representationAids';

describe('authored representation aids', () => {
  it('only names skills the curriculum defines, in representations it authored', () => {
    for (const aid of REPRESENTATION_AIDS) {
      const skill = getSkill(aid.skillId);
      expect(skill, aid.id).toBeDefined();
      expect(skill?.representations, aid.id).toContain(aid.representation);
    }
  });

  it('has a unique id per aid and at most one aid per skill and representation', () => {
    const ids = REPRESENTATION_AIDS.map((aid) => aid.id);
    expect(new Set(ids).size).toBe(ids.length);
    const pairs = REPRESENTATION_AIDS.map((aid) => `${aid.skillId}:${aid.representation}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it('keeps skill parameters and presentation on the same mechanic', () => {
    for (const aid of REPRESENTATION_AIDS) {
      expect(aid.skillParams.mechanic, aid.id).toBe(aid.presentation.mechanic);
    }
  });

  it('is solvable: the authored target is reachable from the authored items', () => {
    // An aid a child could not possibly get right would be a trap rather than
    // a scaffold, so every authored aid is checked against its own evaluator.
    for (const aid of REPRESENTATION_AIDS) {
      const { skillParams } = aid;
      if (skillParams.mechanic === 'DRAG_SORT' && aid.presentation.mechanic === 'DRAG_SORT') {
        const itemIds = aid.presentation.items.map((item) => item.id);
        expect([...skillParams.correctOrder].sort(), aid.id).toEqual([...itemIds].sort());
        expect(
          evaluateInteraction(skillParams, {
            mechanic: 'DRAG_SORT',
            order: skillParams.correctOrder,
          }),
          aid.id,
        ).toBe('correct');
      }
      if (skillParams.mechanic === 'BUILD' && aid.presentation.mechanic === 'BUILD') {
        const pieceIds = aid.presentation.availablePieces.map((piece) => piece.id);
        for (const required of skillParams.requiredPieceIds) {
          expect(pieceIds, aid.id).toContain(required);
        }
      }
      if (skillParams.mechanic === 'DECODE' && aid.presentation.mechanic === 'DECODE') {
        const promptIds = aid.presentation.prompts.map((prompt) => prompt.id);
        const choiceIds = aid.presentation.choices.map((choice) => choice.id);
        for (const pair of skillParams.pairs) {
          expect(promptIds, aid.id).toContain(pair.promptId);
          expect(choiceIds, aid.id).toContain(pair.answerId);
        }
      }
      if (skillParams.mechanic === 'MEASURE') {
        expect(skillParams.targetValue, aid.id).toBeGreaterThan(0);
      }
      if (skillParams.mechanic === 'SPLIT') {
        expect(skillParams.partsCount, aid.id).toBeGreaterThan(1);
        expect(skillParams.total, aid.id).toBeGreaterThan(skillParams.partsCount);
      }
    }
  });

  it('keeps every child-facing line free of em dashes', () => {
    for (const aid of REPRESENTATION_AIDS) {
      const copy = [aid.encouragement, JSON.stringify(aid.presentation)].join(' ');
      expect(copy.includes('—'), aid.id).toBe(false);
    }
  });
});

describe('representationAidFor', () => {
  it('matches on the representation the tutoring turn named', () => {
    expect(representationAidFor('counting-sets', 'visual')?.id).toBe('counting-sets-visual');
    expect(representationAidFor('counting-sets', 'numeric')).toBeUndefined();
  });

  it('falls back to the skill’s authored aid when no representation was named', () => {
    // The normal case with AI off or a fallback turn: the rung still asked
    // for a switch, and the curriculum already said which modality this
    // skill has.
    expect(representationAidFor('counting-sets')?.id).toBe('counting-sets-visual');
  });

  it('returns nothing rather than improvising for a skill with no aid', () => {
    expect(representationAidFor('reading-comprehension')).toBeUndefined();
    expect(representationAidFor('counting-sets', 'word-problem')).toBeUndefined();
  });
});
