import {
  currentDjangoAiApi,
  templateIdFor,
  type DjangoAiApi,
  type TurnSpeechReference,
} from '../../api/ai/djangoAi';
import type { AgeBandValue } from '../child-profile/constants';
import { FALLBACK_TURNS } from './fallback';
import { MAX_SPOKEN_LENGTH_BY_AGE_BAND } from './limits';
import { validateCompanionTurn } from './schema';
import type { CompanionIntent, CompanionTurn } from './schema';

export interface RequestCompanionTurnInput {
  childProfileId: string;
  ageBand: AgeBandValue;
  intent: CompanionIntent;
  /** Short, non-identifying description of the current step, e.g. "counting missing planks". */
  stepSummary: string;
  sessionId?: string;
  stepId?: string;
  learningObjectiveCode?: string;
  hintLevel?: number;
  /** Authored, already-correct content the model may rephrase but not contradict. */
  authoredBaseText?: string;
  allowedChoiceIds?: string[];
  /**
   * The adventure template (or `npc:<id>`, `story:<id>`) the turn belongs to
   * (CLAUDE.md section 7). Required by the Django route.
   */
  templateId?: string;
  /**
   * An NPC dialogue node with an authored narration hint (LAI-0709). With the
   * Django API, Django reads the topic and fallback text from its own catalog
   * (`contextSource: DJANGO_CATALOG`) and the browser sends only these ids.
   */
  npcNode?: { npcId: string; nodeId: string };
  /**
   * Parent-facing AI control (docs/ROADMAP.md Phase 7,
   * `ChildProfile.aiEnabled`). Defaults to `true` so every existing caller
   * keeps working unchanged. When explicitly `false`, this call never
   * reaches Bedrock at all — it returns authored fallback content
   * immediately, before any network call or audit write.
   */
  aiEnabled?: boolean;
}

export interface CompanionTurnResult {
  turn: CompanionTurn;
  source: 'AI' | 'FALLBACK';
  /** The server will speak exactly `turn.spokenText` if asked (SM-P8). Absent otherwise. */
  speech?: TurnSpeechReference;
}

function authoredFallback(input: RequestCompanionTurnInput): CompanionTurn {
  const base = FALLBACK_TURNS[input.intent];
  // Prefer the adventure's own authored hint text over the generic fallback
  // line when we have it — it's real, correct content either way.
  if (input.intent === 'HINT' && input.authoredBaseText) {
    return { ...base, spokenText: input.authoredBaseText };
  }
  return base;
}

/**
 * A companion turn, always safe to render (CLAUDE.md section 7 pipeline:
 * generation -> schema validation -> safety checks -> approved UI component).
 * Never throws.
 *
 * Generation runs only on Django (`POST ai/companion-turns/`, LAI-0706),
 * which validates, falls back, audits and records safety events
 * server-side. AMP-05 removed the Amplify AI Kit route: a build without the
 * Django API, or a parent who switched AI off, gets the authored fallback
 * without any network call.
 */
export async function requestCompanionTurn(
  input: RequestCompanionTurnInput,
): Promise<CompanionTurnResult> {
  if (input.aiEnabled === false) {
    return { turn: authoredFallback(input), source: 'FALLBACK' };
  }
  const django = currentDjangoAiApi();
  if (!django) return { turn: authoredFallback(input), source: 'FALLBACK' };
  return requestDjangoCompanionTurn(django, input);
}

/**
 * The Django path (LAI-0706): Django validates, falls back, audits and
 * records safety events server-side, so the browser writes nothing. The
 * returned turn is still checked here (defence in depth, CLAUDE.md section
 * 13); anything unexpected, and any error at all, becomes the authored
 * fallback. Exported for tests.
 */
export async function requestDjangoCompanionTurn(
  api: DjangoAiApi,
  input: RequestCompanionTurnInput,
): Promise<CompanionTurnResult> {
  try {
    const body = input.npcNode
      ? {
          intent: input.intent,
          contextSource: 'DJANGO_CATALOG' as const,
          npcId: input.npcNode.npcId,
          nodeId: input.npcNode.nodeId,
        }
      : undefined;
    const response = await api.companionTurn(
      input.childProfileId,
      body ?? {
        intent: input.intent,
        templateId: templateIdFor(input.templateId),
        stepSummary: input.stepSummary,
        authoredBaseText: input.authoredBaseText,
        learningObjectiveCode: input.learningObjectiveCode,
        hintLevel: input.hintLevel,
        allowedChoiceIds: input.allowedChoiceIds,
        sessionId: input.sessionId,
        stepId: input.stepId,
      },
    );
    const result = validateCompanionTurn(response.turn, {
      expectedIntent: input.intent,
      maxLength: MAX_SPOKEN_LENGTH_BY_AGE_BAND[input.ageBand],
      allowedChoiceIds: input.allowedChoiceIds,
    });
    if (!result.valid) return { turn: authoredFallback(input), source: 'FALLBACK' };
    return {
      turn: result.turn,
      source: response.source,
      ...(response.speech ? { speech: response.speech } : {}),
    };
  } catch {
    return { turn: authoredFallback(input), source: 'FALLBACK' };
  }
}
