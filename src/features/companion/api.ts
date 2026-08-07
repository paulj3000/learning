import { client } from '../../lib/data-client';
import { CHATTY_PERSONA_VERSION } from '../../../amplify/data/chattyPersona';
import type { AgeBandValue } from '../child-profile/constants';
import { FALLBACK_TURNS } from './fallback';
import { MAX_SPOKEN_LENGTH_BY_AGE_BAND } from './limits';
import { validateCompanionTurn } from './schema';
import type { CompanionIntent, CompanionTurn } from './schema';

const ROUTE_NAME = 'generateCompanionTurn';
const OUTPUT_SCHEMA_VERSION = 1;
/** Informational label for observability only; not a Bedrock resource ARN. */
const COMPANION_MODEL_ID = 'anthropic.claude-haiku-4-5';

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

async function recordAudit(params: {
  childProfileId: string;
  sessionId?: string;
  stepId?: string;
  inputCategory: string;
  validationStatus: 'VALID' | 'INVALID_SCHEMA' | 'INVALID_CONTENT' | 'ERROR';
  safetyDisposition: 'ALLOW' | 'REDIRECT' | 'STOP';
  fallbackUsed: boolean;
  latencyMs: number;
}): Promise<void> {
  try {
    await client.models.AIInteractionAudit.create({
      childProfileId: params.childProfileId,
      sessionId: params.sessionId,
      stepId: params.stepId,
      routeName: ROUTE_NAME,
      promptTemplateVersion: CHATTY_PERSONA_VERSION,
      modelId: COMPANION_MODEL_ID,
      inputCategory: params.inputCategory,
      outputSchemaVersion: OUTPUT_SCHEMA_VERSION,
      validationStatus: params.validationStatus,
      safetyDisposition: params.safetyDisposition,
      fallbackUsed: params.fallbackUsed,
      latencyMs: params.latencyMs,
      createdAt: new Date().toISOString(),
    });
  } catch {
    // Audit logging is best-effort observability; it must never block or
    // hide a companion turn from the child (docs/ARCHITECTURE.md
    // "Observability").
  }
}

async function recordSafetyEvent(params: {
  childProfileId: string;
  sessionId?: string;
  category: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  actionTaken: string;
}): Promise<void> {
  try {
    await client.models.SafetyEvent.create({
      childProfileId: params.childProfileId,
      sessionId: params.sessionId,
      category: params.category,
      severity: params.severity,
      source: 'OUTPUT',
      actionTaken: params.actionTaken,
      reviewStatus: 'OPEN',
      createdAt: new Date().toISOString(),
    });
  } catch {
    // Same best-effort rationale as recordAudit.
  }
}

/**
 * Calls the `generateCompanionTurn` AI route, validates the response, and
 * falls back to authored content on any error, invalid output, or non-ALLOW
 * safety disposition (CLAUDE.md section 7 pipeline: generation -> schema
 * validation -> safety checks -> approved UI component). Always resolves —
 * never throws — so a companion turn is always safe to render.
 */
export async function requestCompanionTurn(
  input: RequestCompanionTurnInput,
): Promise<CompanionTurnResult> {
  if (input.aiEnabled === false) {
    return { turn: authoredFallback(input), source: 'FALLBACK' };
  }

  const maxLength = MAX_SPOKEN_LENGTH_BY_AGE_BAND[input.ageBand];
  const startedAt = Date.now();

  let validationStatus: 'VALID' | 'INVALID_SCHEMA' | 'INVALID_CONTENT' | 'ERROR' = 'ERROR';
  let safetyDisposition: 'ALLOW' | 'REDIRECT' | 'STOP' = 'ALLOW';
  let fallbackUsed = false;
  let turn: CompanionTurn;

  try {
    const { data, errors } = await client.generations.generateCompanionTurn({
      ageBand: input.ageBand,
      intent: input.intent,
      stepSummary: input.stepSummary,
      maxLength,
      learningObjectiveCode: input.learningObjectiveCode,
      hintLevel: input.hintLevel,
      authoredBaseText: input.authoredBaseText,
      allowedChoiceIds: input.allowedChoiceIds,
    });

    if (errors?.length || !data) {
      throw new Error(errors?.[0]?.message ?? 'The companion route returned no data.');
    }

    const result = validateCompanionTurn(data, {
      expectedIntent: input.intent,
      maxLength,
      allowedChoiceIds: input.allowedChoiceIds,
    });

    if (!result.valid) {
      validationStatus = 'INVALID_CONTENT';
      fallbackUsed = true;
      turn = authoredFallback(input);
    } else {
      validationStatus = 'VALID';
      safetyDisposition = result.turn.safetyDisposition;
      if (safetyDisposition === 'ALLOW') {
        turn = result.turn;
      } else {
        fallbackUsed = true;
        turn = { ...FALLBACK_TURNS.REDIRECT, safetyDisposition };
      }
    }
  } catch {
    validationStatus = 'ERROR';
    fallbackUsed = true;
    turn = authoredFallback(input);
  }

  const latencyMs = Date.now() - startedAt;

  await recordAudit({
    childProfileId: input.childProfileId,
    sessionId: input.sessionId,
    stepId: input.stepId,
    inputCategory: input.intent,
    validationStatus,
    safetyDisposition,
    fallbackUsed,
    latencyMs,
  });

  if (safetyDisposition !== 'ALLOW') {
    await recordSafetyEvent({
      childProfileId: input.childProfileId,
      sessionId: input.sessionId,
      category: `companion-turn-${input.intent.toLowerCase()}`,
      severity: safetyDisposition === 'STOP' ? 'HIGH' : 'MEDIUM',
      actionTaken: 'Replaced with authored fallback content.',
    });
  }

  return { turn, source: fallbackUsed ? 'FALLBACK' : 'AI' };
}
