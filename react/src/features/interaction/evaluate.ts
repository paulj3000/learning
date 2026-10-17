import type { Correctness } from '../adventures/engine/types';
import type { InteractionAnswer, InteractionSkillParams } from './types';

/**
 * Deterministic correctness check, mirroring
 * `src/features/adventures/engine/validators.ts`'s `validateStepAnswer` —
 * AI never decides correctness (CLAUDE.md section 7). Every branch here
 * is a plain comparison against `skillParams`, never `presentation`.
 */
export function evaluateInteraction(
  skillParams: InteractionSkillParams,
  answer: InteractionAnswer,
): Correctness {
  if (skillParams.mechanic === 'DRAG_SORT' && answer.mechanic === 'DRAG_SORT') {
    const isExactMatch =
      answer.order.length === skillParams.correctOrder.length &&
      answer.order.every((id, index) => id === skillParams.correctOrder[index]);
    if (isExactMatch) return 'correct';
    const someInPlace = answer.order.some((id, index) => id === skillParams.correctOrder[index]);
    return someInPlace ? 'partial' : 'incorrect';
  }

  if (skillParams.mechanic === 'SPLIT' && answer.mechanic === 'SPLIT') {
    const sum = answer.parts.reduce((total, part) => total + part, 0);
    const rightCount = answer.parts.length === skillParams.partsCount;
    const rightSum = sum === skillParams.total;
    const allNonNegative = answer.parts.every((part) => part >= 0);
    if (rightCount && rightSum && allNonNegative) return 'correct';
    return rightSum || rightCount ? 'partial' : 'incorrect';
  }

  if (skillParams.mechanic === 'MEASURE' && answer.mechanic === 'MEASURE') {
    const distance = Math.abs(answer.value - skillParams.targetValue);
    if (distance <= skillParams.tolerance) return 'correct';
    return distance <= skillParams.tolerance * 2 ? 'partial' : 'incorrect';
  }

  if (skillParams.mechanic === 'BUILD' && answer.mechanic === 'BUILD') {
    const required = new Set(skillParams.requiredPieceIds);
    const selected = new Set(answer.selectedPieceIds);
    const isExactMatch =
      required.size === selected.size && [...required].every((id) => selected.has(id));
    if (isExactMatch) return 'correct';
    const someOverlap = [...required].some((id) => selected.has(id));
    return someOverlap ? 'partial' : 'incorrect';
  }

  if (skillParams.mechanic === 'DECODE' && answer.mechanic === 'DECODE') {
    const expected = new Map(skillParams.pairs.map((pair) => [pair.promptId, pair.answerId]));
    const allMatched =
      answer.matches.length === skillParams.pairs.length &&
      answer.matches.every((match) => expected.get(match.promptId) === match.answerId);
    if (allMatched) return 'correct';
    const someMatched = answer.matches.some(
      (match) => expected.get(match.promptId) === match.answerId,
    );
    return someMatched ? 'partial' : 'incorrect';
  }

  if (skillParams.mechanic === 'CONVERSE' && answer.mechanic === 'CONVERSE') {
    if (skillParams.acceptedResponseIds.length === 0) return 'not_applicable';
    return skillParams.acceptedResponseIds.includes(answer.responseId) ? 'correct' : 'incorrect';
  }

  throw new Error(
    `Answer mechanic "${answer.mechanic}" does not match skill params mechanic "${skillParams.mechanic}".`,
  );
}
