import {
  claimsLearningJudgment,
  containsUrl,
  requestsPersonalInformation,
} from '../../lib/ai/contentSafety';
import { normalizeEmotion, normalizeEnumValue } from '../companion/schema';
import type { SafetyDisposition } from '../companion/schema';
import type { CurriculumRepresentation } from '../curriculum/types';
import { CURRICULUM_TERMS } from './content/vocabulary';
import { APPROVED_TUTOR_STRATEGIES } from './types';
import type { TutorContext, TutorStrategy, TutorTurn } from './types';

/**
 * Runtime validation for one AI-generated tutoring turn (roadmap Phase 27's
 * "response validation and deterministic fallback, consistent with the
 * existing AI validation pipeline"). Structurally the same contract as
 * `validateCompanionTurn`, and it reuses that module's enum/emotion
 * normalizers rather than re-deriving them, so the two routes cannot drift
 * on how they read a model's casing.
 *
 * Three checks are specific to tutoring, and each one exists because a
 * prompt cannot enforce it:
 *
 * 1. **Strategy is not the model's to choose.** The returned strategy must
 *    be the one that was requested. `strategyForHintLevel` decided it from
 *    the hint ladder, so a model answering with a different strategy has
 *    substituted its own judgment about what this child needs.
 * 2. **No learning judgments** (`claimsLearningJudgment`) - the roadmap's
 *    "cannot independently determine mastery".
 * 3. **No curriculum terms outside this skill's authored vocabulary** - the
 *    roadmap's "cannot invent curriculum requirements". A counting lesson
 *    that mentions multiplication has left the skill it was given.
 *
 * There is no "bypass safety constraints" check, because there is nothing
 * to bypass: the safety checks are here, on the response, not requests the
 * model could decline.
 */
const REPRESENTATIONS: readonly CurriculumRepresentation[] = [
  'numeric',
  'visual',
  'word-problem',
  'game-interaction',
];

const DISPOSITIONS: readonly SafetyDisposition[] = ['ALLOW', 'REDIRECT', 'STOP'];

export type TutorTurnValidationResult =
  { valid: true; turn: TutorTurn } | { valid: false; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function escapeForRegExp(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Curriculum terms present in `text` that this skill's authored vocabulary
 * does not permit. Whole-word, case-insensitive matching, so "count" does
 * not fire on "country" and "add" does not fire on "address"; morphological
 * variants are listed explicitly in `CURRICULUM_TERMS` instead of stemmed.
 * Exported for the content tests, which assert that every authored skill
 * vocabulary is self-consistent (no skill may permit a word its own
 * examples would then trip on).
 */
export function disallowedCurriculumTerms(
  text: string,
  allowedVocabulary: readonly string[],
): string[] {
  const allowed = new Set(allowedVocabulary.map((word) => word.toLowerCase()));
  return CURRICULUM_TERMS.filter(
    (term) =>
      !allowed.has(term.toLowerCase()) &&
      new RegExp(`\\b${escapeForRegExp(term)}\\b`, 'i').test(text),
  );
}

export function validateTutorTurn(raw: unknown, context: TutorContext): TutorTurnValidationResult {
  if (!isRecord(raw)) {
    return { valid: false, reason: 'Response was not an object.' };
  }

  const { spokenText } = raw;
  if (typeof spokenText !== 'string' || spokenText.trim().length === 0) {
    return { valid: false, reason: 'spokenText was missing or empty.' };
  }

  const strategy = normalizeEnumValue<TutorStrategy>(raw.strategy, APPROVED_TUTOR_STRATEGIES);
  if (!strategy) {
    return { valid: false, reason: 'strategy was missing or not an approved strategy.' };
  }
  if (strategy !== context.strategy) {
    return {
      valid: false,
      reason: `strategy "${strategy}" did not match the requested strategy.`,
    };
  }

  const emotion = normalizeEmotion(raw.emotion);
  if (!emotion) {
    return { valid: false, reason: 'emotion was missing or not a known value.' };
  }

  const safetyDisposition = normalizeEnumValue(raw.safetyDisposition, DISPOSITIONS);
  if (!safetyDisposition) {
    return { valid: false, reason: 'safetyDisposition was missing or not a known value.' };
  }

  if (spokenText.length > context.maxLength) {
    return { valid: false, reason: 'spokenText exceeded the age band length limit.' };
  }
  if (containsUrl(spokenText)) {
    return { valid: false, reason: 'spokenText contained a URL.' };
  }
  if (requestsPersonalInformation(spokenText)) {
    return { valid: false, reason: 'spokenText requested personal information.' };
  }
  if (claimsLearningJudgment(spokenText)) {
    return { valid: false, reason: 'spokenText judged the child or claimed mastery.' };
  }

  const strayTerms = disallowedCurriculumTerms(spokenText, context.allowedVocabulary);
  if (strayTerms.length > 0) {
    return {
      valid: false,
      reason: `spokenText used curriculum terms outside this skill: ${strayTerms.join(', ')}.`,
    };
  }

  let representation: CurriculumRepresentation | undefined;
  const rawRepresentation = raw.representation;
  if (rawRepresentation !== undefined && rawRepresentation !== null && rawRepresentation !== '') {
    if (typeof rawRepresentation !== 'string') {
      return { valid: false, reason: 'representation was not a string.' };
    }
    const normalized = rawRepresentation.toLowerCase() as CurriculumRepresentation;
    if (!REPRESENTATIONS.includes(normalized)) {
      return { valid: false, reason: 'representation was not a known representation.' };
    }
    if (strategy !== 'SWITCH_REPRESENTATION') {
      return {
        valid: false,
        reason: 'representation was set on a turn that was not switching representation.',
      };
    }
    if (!context.allowedRepresentations.includes(normalized)) {
      return {
        valid: false,
        reason: 'representation was not one the curriculum authored for this skill.',
      };
    }
    representation = normalized;
  }

  return {
    valid: true,
    turn: { spokenText, strategy, representation, emotion, safetyDisposition },
  };
}
