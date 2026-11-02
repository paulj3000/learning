import { ApiError } from '../../api/errors';
import { read } from '../../api/parse';
import * as parse from '../../api/play/parse';
import type { PublicChallenge } from '../../api/play/types';
import { outcomeJson, questJson } from '../../test/playFixtures';
import {
  CONTROL_KEYS,
  HINTS,
  PLAY_COPY,
  completedQuests,
  describeChallenge,
  hintsFor,
  nextStepHint,
  objectiveCue,
  parseTypedAnswer,
  playErrorMessage,
  questObjective,
  questStatusLabel,
  shouldCelebrate,
} from './regionPlayUi';

const challenge = (
  operation: PublicChallenge['operation'],
  operands: number[],
): PublicChallenge => ({
  skillId: 's',
  operation,
  operands,
  responseMode: 'CHOICE',
  choices: [],
});
const outcome = (correct: boolean, attemptId = 'a1') =>
  read(outcomeJson(correct, { attemptId }), parse.answerOutcome);

describe('describeChallenge', () => {
  it('draws a count as one group of coins', () => {
    expect(describeChallenge(challenge('COUNT', [4]))).toMatchObject({
      question: PLAY_COPY.askCount,
      groups: [{ count: 4, takenAway: false }],
      join: null,
    });
  });

  it('draws an addition as two groups joined by a plus', () => {
    const picture = describeChallenge(challenge('ADD', [2, 3]));
    expect(picture.groups).toEqual([
      { count: 2, takenAway: false },
      { count: 3, takenAway: false },
    ]);
    expect(picture.join).toBe('+');
    expect(picture.spoken).toBe('2 coins and 3 coins more.');
  });

  it('draws a subtraction as the coins left plus the faded ones taken away', () => {
    const picture = describeChallenge(challenge('SUBTRACT', [7, 3]));
    expect(picture.groups).toEqual([
      { count: 4, takenAway: false },
      { count: 3, takenAway: true },
    ]);
    expect(picture.spoken).toBe('7 coins. Take away 3 coins.');
  });

  it('says one coin, not one coins', () => {
    expect(describeChallenge(challenge('ADD', [1, 1])).spoken).toBe('1 coin and 1 coin more.');
  });
});

describe('hints', () => {
  it('adds one hint per request, up to the ladder', () => {
    const add = challenge('ADD', [2, 3]);
    expect(hintsFor(add, 0)).toEqual([]);
    expect(hintsFor(add, 1)).toEqual([HINTS.ADD[0]]);
    expect(hintsFor(add, 5)).toEqual(HINTS.ADD);
  });

  it('never contains a number, so a hint can never give an answer away', () => {
    for (const hint of Object.values(HINTS).flat()) expect(hint).not.toMatch(/\d/);
  });
});

describe('parseTypedAnswer', () => {
  it('accepts whole numbers the API accepts and nothing else', () => {
    expect(parseTypedAnswer(' 7 ')).toBe(7);
    expect(parseTypedAnswer('100')).toBe(100);
    for (const raw of ['', '101', '-1', '3.5', 'seven', '1e2'])
      expect(parseTypedAnswer(raw)).toBeNull();
  });
});

describe('shouldCelebrate', () => {
  it('celebrates a correct outcome for the attempt just submitted, once', () => {
    expect(shouldCelebrate(outcome(true), 'a1', new Set())).toBe(true);
    expect(shouldCelebrate(outcome(true), 'a1', new Set(['a1']))).toBe(false);
  });

  it('never celebrates a wrong answer, another attempt, or no outcome', () => {
    expect(shouldCelebrate(outcome(false), 'a1', new Set())).toBe(false);
    expect(shouldCelebrate(outcome(true), 'a2', new Set())).toBe(false);
    expect(shouldCelebrate(outcome(true), null, new Set())).toBe(false);
    expect(shouldCelebrate(null, 'a1', new Set())).toBe(false);
  });
});

describe('completedQuests', () => {
  it('takes completion from the server’s update and titles from the server’s quests', () => {
    const quests = [
      read(questJson(), parse.quest),
      read(questJson({ questId: 'other', title: 'Other' }), parse.quest),
    ];
    expect(completedQuests(outcome(true), quests).map((q) => q.title)).toEqual(['Treasure Rush']);
    expect(completedQuests(outcome(false), quests)).toEqual([]);
  });
});

describe('playErrorMessage', () => {
  it.each([
    ['unauthenticated', undefined, PLAY_COPY.errorSignIn],
    ['not_found', undefined, PLAY_COPY.errorNotHere],
    ['network', undefined, PLAY_COPY.errorTryAgain],
    ['unavailable', undefined, PLAY_COPY.errorTryAgain],
    ['conflict', 'chest_already_open', PLAY_COPY.chestOpen],
    ['conflict', 'session_not_open', PLAY_COPY.errorSessionEnded],
    ['conflict', 'content_unavailable', PLAY_COPY.chestNotReady],
  ] as const)('%s %s', (kind, code, message) => {
    expect(playErrorMessage(new ApiError(kind, { code }))).toBe(message);
  });

  it('never tells a signed-in parent to sign in again for a 403', () => {
    expect(playErrorMessage(new ApiError('forbidden', { code: 'account_setup_failed' }))).toBe(
      PLAY_COPY.errorAccountSetup,
    );
    expect(playErrorMessage(new ApiError('forbidden', { code: 'account_not_provisioned' }))).toBe(
      PLAY_COPY.errorAccountSetup,
    );
    expect(playErrorMessage(new ApiError('forbidden', { code: 'permission_denied' }))).toBe(
      PLAY_COPY.errorNotAllowed,
    );
  });

  it('says nothing for an aborted request or a replay the view re-reads', () => {
    expect(playErrorMessage(new ApiError('aborted'))).toBeNull();
    expect(
      playErrorMessage(new ApiError('conflict', { code: 'attempt_already_answered' })),
    ).toBeNull();
    expect(playErrorMessage(null)).toBeNull();
  });
});

describe('copy and keys', () => {
  it('labels quest states in words', () => {
    expect([
      questStatusLabel('AVAILABLE'),
      questStatusLabel('ACTIVE'),
      questStatusLabel('COMPLETED'),
    ]).toEqual(['New', 'Doing now', 'Done']);
  });

  it('uses no em dashes in child-facing copy (CLAUDE.md section 13)', () => {
    for (const text of [...Object.values(PLAY_COPY), ...Object.values(HINTS).flat()])
      expect(text).not.toContain('—');
  });

  it('covers every key the first-person controls act on', () => {
    for (const key of ['w', 'a', 's', 'd', 'e', 'enter', ' ', 'arrowup'])
      expect(CONTROL_KEYS.has(key)).toBe(true);
  });
});

describe('objective and hints (TR-12)', () => {
  const quest = (overrides: Record<string, unknown> = {}) =>
    read(questJson(overrides), parse.quest);
  const giver = (npcId: string | null) => (npcId === 'pirate-pip' ? 'Pirate Pip' : 'your friend');
  const twoObjectives = (firstDone: boolean) => [
    {
      id: 'find',
      title: 'Find the treasure',
      complete: false,
      objectives: [
        { id: 'a', label: 'Open the first chest', optional: false, complete: firstDone },
        { id: 'b', label: 'Open the second chest', optional: false, complete: false },
        { id: 'c', label: 'Wave at a crab', optional: true, complete: true },
      ],
    },
  ];
  const chest = (isOpen: boolean, challengeAvailable = true) =>
    ({ isOpen, challengeAvailable }) as Parameters<typeof nextStepHint>[1][number];

  it('points at the quest giver while a quest is only on offer', () => {
    const objective = questObjective([quest()], giver);
    expect(objective).toEqual({ kind: 'start', giver: 'Pirate Pip' });
    expect(objectiveCue(objective!)).toBe('Talk to Pirate Pip to start an adventure');
    expect(nextStepHint(objective, [chest(false)])).toMatch(/Walk up to Pirate Pip/);
  });

  it('counts required objectives only, done of total, for the active quest', () => {
    const objective = questObjective(
      [quest({ status: 'ACTIVE', stages: twoObjectives(true) })],
      giver,
    );
    expect(objective).toEqual({
      kind: 'progress',
      title: 'Treasure Rush',
      giver: 'Pirate Pip',
      done: 1,
      total: 2,
    });
    expect(objectiveCue(objective!)).toBe('Treasure Rush: 1 of 2');
  });

  it('prefers an active quest over one on offer', () => {
    const objective = questObjective(
      [quest({ questId: 'other' }), quest({ status: 'ACTIVE' })],
      giver,
    );
    expect(objective?.kind).toBe('progress');
  });

  it('sends the child to a closed chest, or back to the giver when none is left', () => {
    const objective = questObjective([quest({ status: 'ACTIVE' })], giver);
    expect(nextStepHint(objective, [chest(false)])).toMatch(/gold star/);
    expect(nextStepHint(objective, [chest(true)])).toMatch(/Walk back to Pirate Pip/);
    // A closed chest with no challenge for this child is not somewhere to send them.
    expect(nextStepHint(objective, [chest(false, false)])).toMatch(/Walk back to Pirate Pip/);
  });

  it('celebrates a finished quest and leaves the child free to explore', () => {
    const objective = questObjective([quest({ status: 'COMPLETED' })], giver);
    expect(objectiveCue(objective!)).toBe('Treasure Rush: all done!');
    expect(nextStepHint(objective, [])).toMatch(/Explore the cove/);
  });

  it('sends a child who finished the quest across the bridge to the spyglass (TR-17, TR-20)', () => {
    const objective = questObjective([quest({ status: 'COMPLETED' })], giver);
    const spyglass = (lockReason: 'PROGRESS' | null, challengeAvailable = true) =>
      ({
        isOpen: false,
        presentation: 'REPLAY',
        lockReason,
        challengeAvailable,
      }) as Parameters<typeof nextStepHint>[1][number];
    expect(nextStepHint(objective, [spyglass(null)])).toBe(PLAY_COPY.lookoutHint);
    // Still locked, or with nothing for this child's age: just explore.
    expect(nextStepHint(objective, [spyglass('PROGRESS')])).toMatch(/Explore the cove/);
    expect(nextStepHint(objective, [spyglass(null, false)])).toMatch(/Explore the cove/);
  });

  it('never sends a child with a quest still under way to the spyglass', () => {
    const objective = questObjective([quest({ status: 'ACTIVE' })], giver);
    const locked = {
      isOpen: false,
      presentation: 'REPLAY',
      lockReason: 'PROGRESS',
      challengeAvailable: true,
    } as Parameters<typeof nextStepHint>[1][number];
    expect(nextStepHint(objective, [locked])).toMatch(/Walk back to Pirate Pip/);
  });

  it('has no objective in a region with no quests, and a general hint', () => {
    expect(questObjective([], giver)).toBeNull();
    expect(nextStepHint(null, [])).toMatch(/A button shows what you can do/);
  });

  it('uses no em dashes in any cue or hint', () => {
    const objectives = [
      questObjective([quest()], giver),
      questObjective([quest({ status: 'ACTIVE' })], giver),
      questObjective([quest({ status: 'COMPLETED' })], giver),
    ];
    for (const objective of objectives) {
      expect(objectiveCue(objective!)).not.toContain('\u2014');
      expect(nextStepHint(objective, [chest(false)])).not.toContain('\u2014');
    }
  });
});
