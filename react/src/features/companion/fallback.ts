import type { CompanionIntent, CompanionTurn } from './schema';

/**
 * Authored, non-AI content shown whenever the AI route errors, returns
 * something invalid, or reports a safety disposition other than ALLOW
 * (CLAUDE.md section 7: "Every response must have a safe fallback authored
 * in code"; docs/AI_AND_CHILD_SAFETY.md safety-architecture layer 9,
 * "Authored fallback content"). Keyed by intent so the companion always has
 * something in-character to say no matter which turn failed.
 */
export const FALLBACK_TURNS: Record<CompanionIntent, CompanionTurn> = {
  NARRATE: {
    spokenText: "Let's see what's next on the island!",
    emotion: 'CURIOUS',
    intent: 'NARRATE',
    safetyDisposition: 'ALLOW',
  },
  ASK: {
    spokenText: 'What do you think we should try?',
    emotion: 'CURIOUS',
    intent: 'ASK',
    safetyDisposition: 'ALLOW',
  },
  HINT: {
    spokenText: 'Take a closer look. You can do this!',
    emotion: 'ENCOURAGING',
    intent: 'HINT',
    safetyDisposition: 'ALLOW',
  },
  CELEBRATE: {
    spokenText: 'Great work! The island is glad you helped.',
    emotion: 'CHEERFUL',
    intent: 'CELEBRATE',
    safetyDisposition: 'ALLOW',
  },
  REDIRECT: {
    spokenText: "Let's save that for a grown-up to help with. Want to keep exploring the island?",
    emotion: 'CALM',
    intent: 'REDIRECT',
    safetyDisposition: 'REDIRECT',
  },
};
