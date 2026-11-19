import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Correctness } from '../../../../adventures/engine/types';
import { setCastleSoundSink } from './castleSoundCues';
import { useCastleAnswerCues } from './useCastleAnswerCues';

afterEach(() => {
  setCastleSoundSink(null);
});

function setup(grade: Correctness | null) {
  const moments: string[] = [];
  setCastleSoundSink((moment) => moments.push(moment));
  const submit = vi.fn(async (_answer: string) => grade);
  const hook = renderHook(
    ({ stepId, hintLevel }: { stepId: string | null; hintLevel: number }) =>
      useCastleAnswerCues(submit, stepId, hintLevel),
    { initialProps: { stepId: 'step-1', hintLevel: 0 } },
  );
  return { moments, submit, hook };
}

describe('useCastleAnswerCues (SC-R06-01)', () => {
  it.each([
    ['correct', ['answerRight']],
    ['incorrect', ['answerRetry']],
    ['not_applicable', []],
    ['partial', []],
    [null, []],
  ] as const)('a %s grade raises %j', async (grade, expected) => {
    const { moments, submit, hook } = setup(grade);
    await act(async () => {
      await expect(hook.result.current('a')).resolves.toBe(grade);
    });
    expect(submit).toHaveBeenCalledWith('a');
    expect(moments).toEqual([...expected]);
  });

  it('chimes when the hint level rises on the same step, never on a new step or the first render', () => {
    const { moments, hook } = setup('correct');
    expect(moments).toEqual([]);
    hook.rerender({ stepId: 'step-1', hintLevel: 1 });
    hook.rerender({ stepId: 'step-1', hintLevel: 1 });
    hook.rerender({ stepId: 'step-2', hintLevel: 2 });
    hook.rerender({ stepId: 'step-2', hintLevel: 0 });
    expect(moments).toEqual(['hint']);
  });
});
