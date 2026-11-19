import { describe, expect, it } from 'vitest';
import { createGameplayEventFactory, validateGameplayEvent } from '@lai/game-engine/contracts';
import type { AnswerOutcome, PickupOutcome, PuzzleOutcome, QuestUpdate, TalkOutcome } from '../../api/play/types';
import {
  claimsForOutcome,
  claimsForPuzzleOutcome,
  type RegionPlayClaim,
  type RegionPlayClaimLookup,
} from './regionPlayClaims';

const ATTEMPT = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const SESSION = '0b5f8c4e-6d0a-4c43-9b6c-2f2b1b3f9a10';

const lookup: RegionPlayClaimLookup = {
  chestForAttempt: (attemptId) => (attemptId === ATTEMPT ? 'cove-chest' : undefined),
  lastTalkedNpc: () => ({ npcId: 'pirate-pip', interactionId: 'meet-pirate-pip' }),
};

const completed: QuestUpdate = {
  questId: 'pips-missing-treasure',
  status: 'COMPLETED',
  currentStageId: 'return-to-pip',
  justCompleted: true,
  newlyCompletedObjectiveIds: ['cove-return-to-pip'],
};

function answer(overrides: Partial<AnswerOutcome> = {}): AnswerOutcome {
  return {
    attemptId: ATTEMPT,
    correct: true,
    feedback: 'CORRECT',
    canRetry: false,
    chestOpened: true,
    newItems: [],
    rewardMessage: null,
    questUpdates: [],
    completionRewards: [],
    ...overrides,
  } as AnswerOutcome;
}

function pickup(overrides: Partial<PickupOutcome> = {}): PickupOutcome {
  return {
    entityId: 'cove-brass-key',
    pickedUp: true,
    collected: true,
    newItems: [],
    rewardMessage: null,
    questUpdates: [],
    completionRewards: [],
    ...overrides,
  };
}

const talk = (questUpdates: QuestUpdate[] = []): TalkOutcome => ({
  flagsSet: [],
  questUpdates,
  completionRewards: [],
});

/** Builds each claim through the real v1 factory, which throws on anything invalid. */
function built(claims: RegionPlayClaim[]) {
  const factory = createGameplayEventFactory({
    realmId: 'pirate-builder-bay',
    adventureId: 'treasure-rush-cove',
    areaId: 'treasure-rush-cove',
    sessionRef: SESSION,
  });
  return claims.map((claim) => factory.create(claim.type, claim.payload as never));
}

describe('region play outcomes as gameplay claims (GE-070)', () => {
  it('an answer at a chest is a CHEST_CHALLENGE answer, never a discovery', () => {
    const claims = claimsForOutcome({ kind: 'answer', outcome: answer() }, lookup);
    expect(claims).toEqual([
      {
        type: 'learning.answer.submitted',
        payload: {
          learningRef: { kind: 'CHEST_CHALLENGE', chestEntityId: 'cove-chest', challengeAttemptId: ATTEMPT },
          choiceId: null,
        },
      },
    ]);
    expect(claims.some((claim) => claim.type === 'exploration.discovery.found')).toBe(false);
  });

  it('claims a wrong answer exactly like a right one: the server grades, the claim does not', () => {
    const right = claimsForOutcome({ kind: 'answer', outcome: answer() }, lookup);
    const wrong = claimsForOutcome(
      { kind: 'answer', outcome: answer({ correct: false, chestOpened: false, canRetry: true }) },
      lookup,
    );
    expect(wrong).toEqual(right);
  });

  it('claims nothing for an answer the companion did not submit at a chest', () => {
    const claims = claimsForOutcome({ kind: 'answer', outcome: answer({ attemptId: 'unknown' }) }, lookup);
    expect(claims).toEqual([]);
  });

  it('a pickup this request picked up is a collectible; a repeat is nothing', () => {
    expect(claimsForOutcome({ kind: 'pickup', outcome: pickup() }, lookup)).toEqual([
      {
        type: 'collectible.collected',
        payload: { collectibleId: 'cove-brass-key', setId: null, pickupKey: null },
      },
    ]);
    expect(claimsForOutcome({ kind: 'pickup', outcome: pickup({ pickedUp: false }) }, lookup)).toEqual([]);
  });

  it('talking to Pip is an NPC interaction, and a quest it finishes is a step and a completion', () => {
    expect(claimsForOutcome({ kind: 'talk', outcome: talk([completed]) }, lookup)).toEqual([
      { type: 'npc.interaction.completed', payload: { npcId: 'pirate-pip', interactionId: 'meet-pirate-pip' } },
      { type: 'quest.step.completed', payload: { questId: 'pips-missing-treasure', stepId: 'cove-return-to-pip' } },
      { type: 'quest.completed', payload: { questId: 'pips-missing-treasure' } },
    ]);
  });

  it('claims no NPC when it does not know who was talked to', () => {
    const unknown = { ...lookup, lastTalkedNpc: () => null };
    expect(claimsForOutcome({ kind: 'talk', outcome: talk() }, unknown)).toEqual([]);
  });

  it('claims nothing for session, challenge-issued or world-change outcomes', () => {
    expect(
      claimsForOutcome({ kind: 'world_changes', added: [] }, lookup).concat(
        claimsForOutcome({ kind: 'session_changed', session: {} as never }, lookup),
      ),
    ).toEqual([]);
  });

  it('every claim it makes is a valid v1 event, with no grading or child data in it', () => {
    const claims = [
      ...claimsForOutcome({ kind: 'answer', outcome: answer({ questUpdates: [completed] }) }, lookup),
      ...claimsForOutcome({ kind: 'pickup', outcome: pickup({ questUpdates: [completed] }) }, lookup),
      ...claimsForOutcome({ kind: 'talk', outcome: talk([completed]) }, lookup),
    ];
    const events = built(claims);
    expect(events).toHaveLength(claims.length);
    for (const event of events) {
      expect(validateGameplayEvent(event).ok).toBe(true);
      expect(JSON.stringify(event)).not.toMatch(/"correct"|hintLevel|score|childId/);
    }
  });
});

describe('3D Area puzzle claims (GE-073)', () => {
  function puzzle(overrides: Partial<PuzzleOutcome> = {}): PuzzleOutcome {
    return {
      attemptId: ATTEMPT,
      correct: true,
      feedback: 'CORRECT',
      solvedNow: true,
      alreadySolved: false,
      practice: false,
      failedAttempts: 0,
      newItems: [],
      rewardMessage: null,
      questUpdates: [],
      ...overrides,
    };
  }

  it('a first solve is the answer, with the authored choice, then puzzle.completed', () => {
    const claims = claimsForPuzzleOutcome('fh-lava-numbers', puzzle(), { variantId: 'v1', choice: 'b' });
    expect(claims).toEqual([
      {
        type: 'learning.answer.submitted',
        payload: {
          learningRef: { kind: 'AREA_PUZZLE', puzzleId: 'fh-lava-numbers', challengeAttemptId: ATTEMPT },
          choiceId: 'b',
        },
      },
      { type: 'puzzle.completed', payload: { puzzleId: 'fh-lava-numbers' } },
    ]);
  });

  it('a wrong answer is still claimed as an answer, never as completed', () => {
    const claims = claimsForPuzzleOutcome('fh-forge-switches', puzzle({ correct: false, solvedNow: false }), {
      variantId: 'v1',
      order: ['a', 'b'],
    });
    expect(claims.map((c) => c.type)).toEqual(['learning.answer.submitted']);
    expect((claims[0].payload as { choiceId: string | null }).choiceId).toBeNull();
  });

  it('practice and already-solved replays never complete again; no attempt, no answer claim', () => {
    expect(claimsForPuzzleOutcome('p', puzzle({ practice: true, solvedNow: false }), {}).map((c) => c.type)).toEqual([
      'learning.answer.submitted',
    ]);
    expect(claimsForPuzzleOutcome('p', puzzle({ attemptId: null, alreadySolved: true, solvedNow: false }), {})).toEqual([]);
  });

  it('carries quest progress, and every claim is a valid v1 event with no score or child data', () => {
    const claims = claimsForPuzzleOutcome('fh-heart-return', puzzle({ questUpdates: [completed] }), {});
    expect(claims.map((c) => c.type)).toEqual([
      'learning.answer.submitted',
      'puzzle.completed',
      ...claimsForOutcome({ kind: 'talk', outcome: { questUpdates: [completed] } as unknown as TalkOutcome }, {
        chestForAttempt: () => undefined,
        lastTalkedNpc: () => null,
      }).map((c) => c.type),
    ]);
    for (const event of built(claims)) {
      expect(validateGameplayEvent(event).ok).toBe(true);
      expect(JSON.stringify(event)).not.toMatch(/"correct"|hintLevel|score|childId/);
    }
  });
});
