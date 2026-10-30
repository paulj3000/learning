import type { ApiError } from '../../api/errors';
import type { AnswerOutcome, PublicChallenge, QuestEntry } from '../../api/play/types';

/**
 * The rules behind the Treasure Rush play UI (TR-8), apart from React so
 * they can be tested on their own. Nothing here grades, rewards, or decides
 * progress: every input is something the play API returned.
 */

/** Child-facing copy. Readable aloud, localizable, no em dashes. */
export const PLAY_COPY = {
  close: 'Close',
  keepExploring: 'Keep exploring',
  // Pip
  pipNoQuest: 'Ahoy! Enjoy the cove.',
  pipAsk: 'Will you help me?',
  pipAccept: 'Yes, I will help!',
  pipLater: 'Maybe later',
  pipActive: 'The treasure is waiting for you. Here is what to do.',
  pipCompleted: 'You found the treasure! Thank you, friend.',
  questAccepted: 'Quest accepted!',
  // Chest
  chestOpening: 'The lock is clicking...',
  chestOpen: 'This chest is already open.',
  chestNotReady: 'This chest is not ready yet. Come back soon!',
  chestWaiting: 'Getting ready to play...',
  askCount: 'How many coins?',
  askAdd: 'How many coins are there altogether?',
  askSubtract: 'How many coins are left?',
  typeAnswer: 'Your answer',
  openIt: 'Open it!',
  helpMe: 'Help me',
  checking: 'Checking...',
  wrong: 'Not quite. The lock is still shut. Let us try another one!',
  tryAgain: 'Try again',
  // Reward
  chestOpened: 'Click! The chest is open!',
  youFound: 'You found',
  questComplete: 'Quest complete!',
  // Backpack
  backpack: 'Backpack',
  backpackTitle: 'My backpack',
  backpackEmpty: 'Nothing here yet. Open a chest to find treasure!',
  myQuests: 'My quests',
  questNew: 'New',
  questDoing: 'Doing now',
  questDone: 'Done',
  // Errors
  errorSignIn: 'Please ask a grown-up to sign in again.',
  errorAccountSetup: 'We are still getting your island ready. Please try again in a moment.',
  errorNotAllowed: 'This is not open for you right now. Please ask a grown-up.',
  errorNotHere: 'This is not here right now.',
  errorTryAgain: 'Something went wrong. Let us try that again.',
  errorSessionEnded: 'This visit has ended. Come back to play again!',
  retry: 'Try that again',
} as const;

// --- Challenges ---------------------------------------------------------------------------

export interface ChallengePicture {
  /** The question, as words a grown-up can read aloud. */
  question: string;
  /** What the picture shows, in words (the picture's text alternative). */
  spoken: string;
  /** Coin groups to draw. A taken-away group is drawn faded. */
  groups: { count: number; takenAway: boolean }[];
  /** Join between groups when there are two: `+` or nothing (take away is shown by fading). */
  join: '+' | null;
}

function coins(count: number): string {
  return count === 1 ? '1 coin' : `${count} coins`;
}

/** The picture for a server-generated challenge, from its operation and operands only. */
export function describeChallenge(challenge: PublicChallenge): ChallengePicture {
  const [first = 0, second = 0] = challenge.operands;
  switch (challenge.operation) {
    case 'COUNT':
      return {
        question: PLAY_COPY.askCount,
        spoken: `Count the coins in the chest lock.`,
        groups: [{ count: first, takenAway: false }],
        join: null,
      };
    case 'ADD':
      return {
        question: PLAY_COPY.askAdd,
        spoken: `${coins(first)} and ${coins(second)} more.`,
        groups: [
          { count: first, takenAway: false },
          { count: second, takenAway: false },
        ],
        join: '+',
      };
    case 'SUBTRACT':
      return {
        question: PLAY_COPY.askSubtract,
        spoken: `${coins(first)}. Take away ${coins(second)}.`,
        groups: [
          { count: first - second, takenAway: false },
          { count: second, takenAway: true },
        ],
        join: null,
      };
  }
}

/**
 * Strategy hints, one more each time the child asks. They teach how to find
 * the answer and never say it: they are built from the operation alone.
 */
export const HINTS: Record<PublicChallenge['operation'], readonly string[]> = {
  COUNT: ['Touch each coin and count out loud.', 'Count slowly. Say one number for each coin.'],
  ADD: [
    'Count the first pile of coins.',
    'Now keep counting with the second pile. Do not start again at one!',
  ],
  SUBTRACT: [
    'Count only the shiny coins. The faded ones were taken away.',
    'Start at the first coin and count each shiny one once.',
  ],
};

export function hintsFor(challenge: PublicChallenge, level: number): readonly string[] {
  return HINTS[challenge.operation].slice(0, Math.max(0, level));
}

export const MAX_HINT_LEVEL = 2;
export const MAX_TYPED_ANSWER = 100;

/** A typed answer as the API accepts it: a whole number 0 to 100, or null. Not a judgement. */
export function parseTypedAnswer(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d{1,3}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value <= MAX_TYPED_ANSWER ? value : null;
}

// --- Rewards --------------------------------------------------------------------------------

/**
 * Whether to show the reward reveal for `outcome`: only for an answer this
 * panel just submitted, only when the server said correct, and only once per
 * attempt. A replayed answer has no outcome (the server refuses it with a
 * 409), and state re-read on a later visit never carries one.
 */
export function shouldCelebrate(
  outcome: AnswerOutcome | null,
  submittedAttemptId: string | null,
  celebrated: ReadonlySet<string>,
): outcome is AnswerOutcome {
  return (
    outcome !== null &&
    outcome.correct &&
    outcome.attemptId === submittedAttemptId &&
    !celebrated.has(outcome.attemptId)
  );
}

/** Quests the server says this answer finished, with their titles from the server's quest list. */
export function completedQuests(
  outcome: AnswerOutcome,
  quests: readonly QuestEntry[],
): QuestEntry[] {
  const finished = new Set(
    outcome.questUpdates.filter((u) => u.justCompleted).map((u) => u.questId),
  );
  return quests.filter((quest) => finished.has(quest.questId));
}

// --- Quests ---------------------------------------------------------------------------------

export function questStatusLabel(status: QuestEntry['status']): string {
  if (status === 'COMPLETED') return PLAY_COPY.questDone;
  if (status === 'ACTIVE') return PLAY_COPY.questDoing;
  return PLAY_COPY.questNew;
}

// --- Errors ---------------------------------------------------------------------------------

/** What to tell the child about a failure, or null for one that needs no words. */
export function playErrorMessage(error: ApiError | null): string | null {
  if (!error) return null;
  switch (error.kind) {
    case 'aborted':
      return null;
    case 'unauthenticated':
      return PLAY_COPY.errorSignIn;
    case 'forbidden':
      // Signed in, so never "sign in again": either the account is not set up yet, or not allowed.
      return error.code === 'account_setup_failed' || error.code === 'account_not_provisioned'
        ? PLAY_COPY.errorAccountSetup
        : PLAY_COPY.errorNotAllowed;
    case 'not_found':
    case 'disabled':
      return PLAY_COPY.errorNotHere;
    case 'conflict':
      if (error.code === 'chest_already_open') return PLAY_COPY.chestOpen;
      if (error.code === 'session_not_open') return PLAY_COPY.errorSessionEnded;
      if (error.code === 'content_unavailable' || error.code === 'quest_unavailable')
        return PLAY_COPY.chestNotReady;
      // attempt_already_answered: the view re-reads the truth; nothing new to say.
      return null;
    default:
      return PLAY_COPY.errorTryAgain;
  }
}

/**
 * Keys the first-person controls act on (`pointerControls.ts`): movement,
 * and `E`/`Enter` to interact. Inside a panel their keydown is kept from
 * reaching the window, so typing or pressing a button never walks the child
 * away or re-opens what they are looking at. A button's own Enter or Space
 * still clicks it: stopping propagation does not cancel that default.
 */
export const CONTROL_KEYS = new Set([
  'w',
  'a',
  's',
  'd',
  'e',
  'arrowup',
  'arrowdown',
  'arrowleft',
  'arrowright',
  ' ',
  'enter',
]);
