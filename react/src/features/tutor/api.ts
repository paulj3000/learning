import {
  currentDjangoAiApi,
  templateIdFor,
  type DjangoAiApi,
  type TurnSpeechReference,
} from '../../api/ai/djangoAi';
import { normalizeEmotion, normalizeEnumValue } from '../companion/schema';
import type { AgeBandValue } from '../child-profile/constants';
import { buildTutorContext, isTutorableSkill } from './context';
import { FALLBACK_TUTOR_TURNS } from './fallback';
import { validateTutorTurn } from './schema';
import { strategyForHintLevel } from './strategy';
import { APPROVED_TUTOR_STRATEGIES } from './types';
import type { TutorStrategy, TutorTurn } from './types';

export interface RequestTutorTurnInput {
  childProfileId: string;
  ageBand: AgeBandValue;
  /** `Skill.id`, which is the step's `learningObjectiveCode`. */
  skillId: string;
  /** The rung the hint ladder has reached (docs/ADVENTURE_ENGINE.md). */
  hintLevel: number;
  /** The step's own authored hint text at this rung; already correct. */
  authoredBaseText?: string;
  sessionId?: string;
  stepId?: string;
  /** The adventure template the step belongs to; required by the Django route. */
  templateId?: string;
  /** `ChildProfile.aiEnabled`; when false this never reaches Bedrock at all. */
  aiEnabled?: boolean;
}

export interface TutorTurnResult {
  turn: TutorTurn;
  source: 'AI' | 'FALLBACK';
  /** The server will speak exactly `turn.spokenText` if asked (SM-P8). Absent otherwise. */
  speech?: TurnSpeechReference;
}

function authoredFallback(input: RequestTutorTurnInput): TutorTurn {
  const strategy = strategyForHintLevel(input.hintLevel);
  const base = FALLBACK_TUTOR_TURNS[strategy];
  // The adventure's own hint is real, reviewed content for this exact step,
  // so it beats the skill-neutral line whenever the rung is one that gives
  // information at all. ENCOURAGE and ASK_GUIDING_QUESTION deliberately do
  // not use it: those rungs are supposed to withhold the hint.
  if (input.authoredBaseText && strategy !== 'ENCOURAGE' && strategy !== 'ASK_GUIDING_QUESTION') {
    return { ...base, spokenText: input.authoredBaseText };
  }
  return base;
}

/**
 * A tutoring turn, always safe to render (CLAUDE.md section 7's pipeline).
 * Never throws.
 *
 * Generation runs only on Django (`POST ai/tutor-turns/`, LAI-0706), which
 * assembles the tutor context from the child's own records, validates, falls
 * back, audits and records safety events server-side. AMP-05 removed the
 * Amplify AI Kit route and its browser-side context reads and audit writes.
 *
 * Three cases return authored content *without any network call at all*,
 * and all are deliberate:
 *
 * - `aiEnabled === false`, the parent's own switch (roadmap Phase 7);
 * - a skill that is not tutorable (`isTutorableSkill`): outside the seed
 *   curriculum, or with no authored vocabulary to bound the model. The
 *   authored hint ladder is complete on its own;
 * - a build without the Django API.
 */
export async function requestTutorTurn(input: RequestTutorTurnInput): Promise<TutorTurnResult> {
  if (input.aiEnabled === false || !isTutorableSkill(input.skillId)) {
    return { turn: authoredFallback(input), source: 'FALLBACK' };
  }
  return requestDjangoTutorTurn(currentDjangoAiApi(), input);
}

/**
 * An authored line Django chose (`source: "FALLBACK"`): a redirect after a
 * safety stop carries its own strategy (ENCOURAGE), so it is checked for
 * shape and safety disposition only, not against the requested strategy.
 */
function readDjangoFallbackTurn(raw: Record<string, unknown>): TutorTurn | undefined {
  const spokenText = raw.spokenText;
  const strategy = normalizeEnumValue<TutorStrategy>(raw.strategy, APPROVED_TUTOR_STRATEGIES);
  const emotion = normalizeEmotion(raw.emotion);
  const safetyDisposition = normalizeEnumValue(raw.safetyDisposition, [
    'ALLOW',
    'REDIRECT',
    'STOP',
  ]);
  if (typeof spokenText !== 'string' || !spokenText.trim() || !strategy || !emotion)
    return undefined;
  if (!safetyDisposition || typeof raw.representation === 'string') return undefined;
  return { spokenText, strategy, emotion, safetyDisposition };
}

/**
 * The Django path (LAI-0706). Django assembles the tutor context itself from
 * the child's own records (mastery titles, active quest), so the browser
 * makes no mastery or quest reads and writes no audit row. An `AI` turn is
 * re-validated against the same safe context the browser can build; any
 * error or unexpected turn becomes the authored fallback. Exported for tests.
 */
export async function requestDjangoTutorTurn(
  api: DjangoAiApi,
  input: RequestTutorTurnInput,
): Promise<TutorTurnResult> {
  try {
    const response = await api.tutorTurn(input.childProfileId, {
      skillId: input.skillId,
      templateId: templateIdFor(input.templateId),
      hintLevel: Math.min(Math.max(Math.round(input.hintLevel), 0), 5),
      authoredBaseText: input.authoredBaseText,
      sessionId: input.sessionId,
      stepId: input.stepId,
    });
    if (response.source === 'FALLBACK') {
      const turn = readDjangoFallbackTurn(response.turn);
      if (!turn) return { turn: authoredFallback(input), source: 'FALLBACK' };
      return {
        turn,
        source: 'FALLBACK',
        ...(response.speech ? { speech: response.speech } : {}),
      };
    }
    const context = buildTutorContext({
      ageBand: input.ageBand,
      skillId: input.skillId,
      hintLevel: input.hintLevel,
      authoredBaseText: input.authoredBaseText,
    });
    const result = context ? validateTutorTurn(response.turn, context) : undefined;
    if (!result?.valid) return { turn: authoredFallback(input), source: 'FALLBACK' };
    return {
      turn: result.turn,
      source: 'AI',
      ...(response.speech ? { speech: response.speech } : {}),
    };
  } catch {
    return { turn: authoredFallback(input), source: 'FALLBACK' };
  }
}
