import type { AdventureStep, Correctness } from './types';

export type StepAnswer =
  | { kind: 'number-input'; value: number }
  | { kind: 'choice'; optionId: string }
  | { kind: 'ordering'; order: string[] }
  | { kind: 'matching'; pairs: Array<{ leftId: string; rightId: string }> }
  | { kind: 'short-response'; optionId: string }
  | { kind: 'creative-choice'; optionId: string }
  | { kind: 'reflection' }
  | { kind: 'narrative' }
  | { kind: 'world-change' };

/**
 * Deterministic correctness check for one step's answer. AI never decides
 * correctness (CLAUDE.md section 7): every branch here is plain comparison
 * against the step's authored presentation data.
 */
export function validateStepAnswer(step: AdventureStep, answer: StepAnswer): Correctness {
  const { presentation } = step;

  if (presentation.kind === 'number-input' && answer.kind === 'number-input') {
    return answer.value === presentation.correctValue ? 'correct' : 'incorrect';
  }

  if (presentation.kind === 'choice' && answer.kind === 'choice') {
    return answer.optionId === presentation.correctOptionId ? 'correct' : 'incorrect';
  }

  if (presentation.kind === 'ordering' && answer.kind === 'ordering') {
    const isExactMatch =
      answer.order.length === presentation.correctOrder.length &&
      answer.order.every((id, index) => id === presentation.correctOrder[index]);
    return isExactMatch ? 'correct' : 'incorrect';
  }

  if (presentation.kind === 'matching' && answer.kind === 'matching') {
    const expected = new Map(presentation.pairs.map((pair) => [pair.leftId, pair.rightId]));
    const allMatched =
      answer.pairs.length === presentation.pairs.length &&
      answer.pairs.every((pair) => expected.get(pair.leftId) === pair.rightId);
    if (allMatched) return 'correct';
    const someMatched = answer.pairs.some((pair) => expected.get(pair.leftId) === pair.rightId);
    return someMatched ? 'partial' : 'incorrect';
  }

  if (presentation.kind === 'short-response' && answer.kind === 'short-response') {
    return presentation.acceptedOptionIds.includes(answer.optionId) ? 'correct' : 'incorrect';
  }

  if (presentation.kind === 'creative-choice' && answer.kind === 'creative-choice') {
    return 'not_applicable';
  }

  if (
    presentation.kind === 'reflection' ||
    presentation.kind === 'narrative' ||
    presentation.kind === 'world-change' ||
    presentation.kind === 'complete'
  ) {
    return 'not_applicable';
  }

  throw new Error(`Answer kind "${answer.kind}" does not match step "${step.id}"'s presentation.`);
}
