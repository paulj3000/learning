import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateGameplayEvent, type AnyGameplayEvent } from '@lai/game-engine/contracts';
import type { Correctness } from '../../../../adventures/engine/types';
import { resetLocationClaimsForTests, setLocationClaimSink } from '../../runtime/gameplayClaimSink';
import {
  CASTLE_REALM_ID,
  adventureCompletedClaim,
  answerClaim,
  castleClaimContext,
  emitCastleClaim,
  roomExploredClaim,
} from './castleGameplayClaims';
import { setCastleSoundSink } from './castleSoundCues';
import { useCastleAnswerCues } from './useCastleAnswerCues';

afterEach(() => {
  resetLocationClaimsForTests();
  setCastleSoundSink(null);
});

function capture(): AnyGameplayEvent[] {
  const claims: AnyGameplayEvent[] = [];
  setLocationClaimSink((event) => claims.push(event));
  return claims;
}

describe('castle gameplay claims (GE-072)', () => {
  it('builds v1 claims the engine validator accepts, inside an adventure and while exploring', () => {
    const claims = capture();
    const inTale = castleClaimContext(
      'the-storykeepers-tale',
      '3f2b0c1e-0000-4000-8000-000000000001',
    );
    emitCastleClaim(
      inTale,
      answerClaim('order-the-story', { kind: 'ordering', order: ['a', 'b'] }),
    );
    emitCastleClaim(
      inTale,
      answerClaim('choose-hero', { kind: 'creative-choice', optionId: 'hero-fox' }),
    );
    emitCastleClaim(inTale, adventureCompletedClaim());
    emitCastleClaim(castleClaimContext(null, null), roomExploredClaim('great-library'));

    expect(claims.map((claim) => claim.type)).toEqual([
      'learning.answer.submitted',
      'learning.answer.submitted',
      'adventure.completed',
      'exploration.area.entered',
    ]);
    for (const claim of claims) expect(validateGameplayEvent(claim).ok, claim.type).toBe(true);
    expect(claims[0]).toMatchObject({
      realmId: CASTLE_REALM_ID,
      adventureId: 'the-storykeepers-tale',
      sessionRef: '3f2b0c1e-0000-4000-8000-000000000001',
      payload: {
        learningRef: { kind: 'ADVENTURE_STEP', stepId: 'order-the-story' },
        choiceId: null,
      },
    });
    expect(claims[1].payload).toMatchObject({ choiceId: 'hero-fox' });
    expect(claims[3]).toMatchObject({
      adventureId: CASTLE_REALM_ID,
      sessionRef: null,
      payload: { areaId: 'great-library' },
    });
  });

  it('never carries a grade, support level, band or score', () => {
    const claims = capture();
    emitCastleClaim(
      castleClaimContext('the-painted-words', null),
      answerClaim('rhyme-1', { kind: 'choice', optionId: 'opt-hat' }),
    );
    const text = JSON.stringify(claims);
    for (const forbidden of ['correct', 'support', 'ageBand', 'PATHFINDER', 'score', 'points']) {
      expect(text, forbidden).not.toContain(forbidden);
    }
  });

  it('does nothing without a sink, and never throws for an unbuildable claim', () => {
    expect(() =>
      emitCastleClaim(castleClaimContext(null, null), roomExploredClaim('a room with spaces')),
    ).not.toThrow();
    const claims = capture();
    emitCastleClaim(castleClaimContext(null, null), roomExploredClaim('a room with spaces'));
    expect(claims).toEqual([]);
  });
});

describe('useCastleAnswerCues claims each accepted answer once (GE-072)', () => {
  function setup(
    grade: Correctness | null,
    claim: { adventureSlug: string; sessionId: string | null } | null,
  ) {
    setCastleSoundSink(() => undefined);
    const claims = capture();
    const submit = vi.fn(async (_answer: { kind: 'choice'; optionId: string }) => grade);
    const hook = renderHook(() => useCastleAnswerCues(submit, 'rhyme-1', 0, claim));
    return { claims, hook };
  }

  it.each(['correct', 'incorrect', 'not_applicable'] as const)(
    'claims a %s answer: the server graded it, the claim only restates it',
    async (grade) => {
      const { claims, hook } = setup(grade, {
        adventureSlug: 'the-painted-words',
        sessionId: null,
      });
      await act(async () => {
        await hook.result.current({ kind: 'choice', optionId: 'opt-hat' });
      });
      expect(claims).toHaveLength(1);
      expect(claims[0]).toMatchObject({
        type: 'learning.answer.submitted',
        adventureId: 'the-painted-words',
        payload: {
          learningRef: { kind: 'ADVENTURE_STEP', stepId: 'rhyme-1' },
          choiceId: 'opt-hat',
        },
      });
    },
  );

  it('claims nothing when the submit failed, or when no claim context is given', async () => {
    const failed = setup(null, { adventureSlug: 'the-painted-words', sessionId: null });
    await act(async () => {
      await failed.hook.result.current({ kind: 'choice', optionId: 'opt-hat' });
    });
    expect(failed.claims).toEqual([]);
    failed.hook.unmount();
    resetLocationClaimsForTests();

    const none = setup('correct', null);
    await act(async () => {
      await none.hook.result.current({ kind: 'choice', optionId: 'opt-hat' });
    });
    expect(none.claims).toEqual([]);
  });
});
