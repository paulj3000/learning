import { containsUrl, requestsPersonalInformation } from '../../lib/ai/contentSafety';

/**
 * Matches docs/AI_AND_CHILD_SAFETY.md's `CompanionTurn` structured-response
 * example and the `CompanionTurn`/`CompanionChoice` custom types in
 * amplify/data/resource.ts. Defined independently of the generated Amplify
 * `Schema` type because this is what we validate *untrusted* AI output
 * against (CLAUDE.md section 13: "Validate all external and AI-generated
 * data at runtime") — the raw response is treated as `unknown` until it
 * passes `validateCompanionTurn`.
 */
export type CompanionEmotion = 'CHEERFUL' | 'CURIOUS' | 'CALM' | 'ENCOURAGING';
export type CompanionIntent = 'NARRATE' | 'ASK' | 'HINT' | 'CELEBRATE' | 'REDIRECT';
export type SafetyDisposition = 'ALLOW' | 'REDIRECT' | 'STOP';

export interface CompanionChoice {
  id: string;
  label: string;
}

export interface CompanionTurn {
  spokenText: string;
  emotion: CompanionEmotion;
  intent: CompanionIntent;
  choices?: CompanionChoice[];
  safetyDisposition: SafetyDisposition;
}

const EMOTIONS: readonly CompanionEmotion[] = ['CHEERFUL', 'CURIOUS', 'CALM', 'ENCOURAGING'];
const INTENTS: readonly CompanionIntent[] = ['NARRATE', 'ASK', 'HINT', 'CELEBRATE', 'REDIRECT'];
const DISPOSITIONS: readonly SafetyDisposition[] = ['ALLOW', 'REDIRECT', 'STOP'];

export interface CompanionTurnValidationContext {
  expectedIntent: CompanionIntent;
  maxLength: number;
  allowedChoiceIds?: string[];
}

export type CompanionTurnValidationResult =
  { valid: true; turn: CompanionTurn } | { valid: false; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isChoiceArray(value: unknown): value is CompanionChoice[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) => isRecord(item) && typeof item.id === 'string' && typeof item.label === 'string',
    )
  );
}

/**
 * `emotion`/`intent`/`safetyDisposition` are plain strings on the wire
 * (see the comment on `CompanionTurn` in amplify/data/resource.ts), and
 * real Bedrock output has been observed returning correct values in the
 * wrong case (e.g. `"curious"` instead of `"CURIOUS"`) even though the
 * persona prompt and every example use uppercase. Case is not a safety
 * property, so match case-insensitively and normalize to the canonical
 * uppercase form rather than rejecting an otherwise-safe response.
 */
function normalizeEnumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | undefined {
  if (typeof value !== 'string') return undefined;
  const upper = value.toUpperCase();
  return (allowed as readonly string[]).includes(upper) ? (upper as T) : undefined;
}

/**
 * `emotion` synonym fallback. A live red-team run against real Bedrock
 * output (docs/PILOT_READINESS.md section 2, scripts/ai-red-team.ts) found
 * the model frequently invents a free-text mood word ("wonder", "playful",
 * "warm and curious") instead of one of the four allowed values, even after
 * `chattyPersona.ts` was tightened to spell them out explicitly — the same
 * "no single model instruction is sufficient" reasoning CLAUDE.md section 7
 * applies everywhere else. `emotion` is cosmetic (not currently rendered
 * distinctly in the UI, and never a safety-relevant field), so a
 * best-effort keyword match here is safe: on no match, this still falls
 * through to `normalizeEnumValue`'s existing "reject and fall back to
 * authored content" behavior rather than guessing wrong. Checked in a fixed
 * category order, first match wins, so an ambiguous compound phrase (e.g.
 * "warm and curious") resolves deterministically rather than by iteration
 * order of the object literal.
 */
const EMOTION_SYNONYMS: { emotion: CompanionEmotion; keywords: RegExp }[] = [
  { emotion: 'CHEERFUL', keywords: /\b(playful|joyful|happy|cheerful|excited|fun|delighted)\b/i },
  { emotion: 'CURIOUS', keywords: /\b(curious|wonder(ing)?|intrigued|inquisitive)\b/i },
  { emotion: 'CALM', keywords: /\b(calm|peaceful|gentle|relaxed|soothing|focused)\b/i },
  { emotion: 'ENCOURAGING', keywords: /\b(encouraging|warm|supportive|proud|kind)\b/i },
];

function normalizeEmotion(value: unknown): CompanionEmotion | undefined {
  const exact = normalizeEnumValue(value, EMOTIONS);
  if (exact) return exact;
  if (typeof value !== 'string') return undefined;
  return EMOTION_SYNONYMS.find(({ keywords }) => keywords.test(value))?.emotion;
}

/**
 * Runtime schema + content-safety validation for one AI-generated
 * `CompanionTurn` (docs/AI_AND_CHILD_SAFETY.md validation rules). Returns a
 * typed, safe-to-render turn only when every check passes; callers must
 * fall back to authored content otherwise (CLAUDE.md section 7: "Every
 * response must have a safe fallback authored in code").
 */
export function validateCompanionTurn(
  raw: unknown,
  context: CompanionTurnValidationContext,
): CompanionTurnValidationResult {
  if (!isRecord(raw)) {
    return { valid: false, reason: 'Response was not an object.' };
  }

  const { spokenText, choices } = raw;

  if (typeof spokenText !== 'string' || spokenText.trim().length === 0) {
    return { valid: false, reason: 'spokenText was missing or empty.' };
  }
  const emotion = normalizeEmotion(raw.emotion);
  if (!emotion) {
    return { valid: false, reason: 'emotion was missing or not a known value.' };
  }
  const intent = normalizeEnumValue(raw.intent, INTENTS);
  if (!intent) {
    return { valid: false, reason: 'intent was missing or not a known value.' };
  }
  const safetyDisposition = normalizeEnumValue(raw.safetyDisposition, DISPOSITIONS);
  if (!safetyDisposition) {
    return { valid: false, reason: 'safetyDisposition was missing or not a known value.' };
  }
  // The model may always escalate to REDIRECT regardless of what was asked
  // for, but it may never wander into an unrelated intent.
  if (intent !== context.expectedIntent && intent !== 'REDIRECT') {
    return { valid: false, reason: `intent "${intent}" did not match the requested intent.` };
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

  let validatedChoices: CompanionChoice[] | undefined;
  if (choices !== undefined && choices !== null) {
    if (!isChoiceArray(choices)) {
      return { valid: false, reason: 'choices was not a list of {id, label}.' };
    }
    const allowedChoiceIds = context.allowedChoiceIds;
    if (!allowedChoiceIds || allowedChoiceIds.length === 0) {
      return { valid: false, reason: 'choices were offered but none were allowed.' };
    }
    const hasDisallowedChoice = choices.some((choice) => !allowedChoiceIds.includes(choice.id));
    if (hasDisallowedChoice) {
      return { valid: false, reason: 'choices included an ID that was not allowed.' };
    }
    validatedChoices = choices;
  }

  return {
    valid: true,
    turn: {
      spokenText,
      emotion,
      intent,
      choices: validatedChoices,
      safetyDisposition,
    },
  };
}
