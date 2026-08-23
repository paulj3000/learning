import type { TutorStrategy, TutorTurn } from './types';

/**
 * Authored, non-AI tutoring lines (CLAUDE.md section 7: "Every response
 * must have a safe fallback authored in code"; docs/AI_AND_CHILD_SAFETY.md
 * safety-architecture layer 9). Keyed by strategy so the child still gets
 * the *kind* of help the hint ladder decided they should get, even when
 * generation fails, is rejected, or a parent has AI switched off.
 *
 * Deliberately skill-neutral. A fallback line cannot mention counting or
 * measuring, because the same line has to be true for every skill; the
 * adventure's own authored hint text is the specific help, and
 * `requestTutorTurn` prefers it over these whenever the step has one.
 */
export const FALLBACK_TUTOR_TURNS: Record<TutorStrategy, TutorTurn> = {
  EXPLAIN: {
    spokenText: "Let's walk through it together, one step at a time.",
    strategy: 'EXPLAIN',
    emotion: 'CALM',
    safetyDisposition: 'ALLOW',
  },
  ASK_GUIDING_QUESTION: {
    spokenText: 'What do you notice first when you look at it?',
    strategy: 'ASK_GUIDING_QUESTION',
    emotion: 'CURIOUS',
    safetyDisposition: 'ALLOW',
  },
  GIVE_HINT: {
    spokenText: 'Take a closer look. You can do this!',
    strategy: 'GIVE_HINT',
    emotion: 'ENCOURAGING',
    safetyDisposition: 'ALLOW',
  },
  ENCOURAGE: {
    spokenText: 'You are working hard on this. Keep going!',
    strategy: 'ENCOURAGE',
    emotion: 'ENCOURAGING',
    safetyDisposition: 'ALLOW',
  },
  SWITCH_REPRESENTATION: {
    spokenText: "Let's try looking at it a different way.",
    strategy: 'SWITCH_REPRESENTATION',
    emotion: 'CHEERFUL',
    safetyDisposition: 'ALLOW',
  },
};

/**
 * The calm line shown instead of a turn whose safety disposition was not
 * ALLOW. Mirrors `FALLBACK_TURNS.REDIRECT` in `src/features/companion/`:
 * brief, unalarmed, and pointing at a grown-up rather than investigating
 * (docs/AI_AND_CHILD_SAFETY.md "Child input policy").
 */
export const TUTOR_REDIRECT_TURN: TutorTurn = {
  spokenText: "Let's save that one for a grown-up. Want to keep going with our adventure?",
  strategy: 'ENCOURAGE',
  emotion: 'CALM',
  safetyDisposition: 'REDIRECT',
};
