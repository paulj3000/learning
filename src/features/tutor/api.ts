import { client } from '../../lib/data-client';
import { TUTOR_PERSONA_VERSION } from '../../../amplify/data/tutorPersona';
import type { AgeBandValue } from '../child-profile/constants';
import { listPrerequisites } from '../curriculum/queries';
import { listSkillProgress } from '../mastery/api';
import { buildMasterySummary, indexProgressBySkill } from '../mastery/summary';
import type { MasterySummary } from '../mastery/types';
import { getQuestDefinition, QUEST_DEFINITIONS } from '../quests/content';
import { listQuestStates } from '../quests/api';
import { getStage } from '../quests/quest';
import { buildTutorContext, isTutorableSkill } from './context';
import { FALLBACK_TUTOR_TURNS, TUTOR_REDIRECT_TURN } from './fallback';
import { validateTutorTurn } from './schema';
import { strategyForHintLevel } from './strategy';
import type { TutorContext, TutorTurn } from './types';

const ROUTE_NAME = 'generateTutorTurn';
const OUTPUT_SCHEMA_VERSION = 1;
/** Informational label for observability only; not a Bedrock resource ARN. */
const TUTOR_MODEL_ID = 'anthropic.claude-haiku-4-5';

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
  /** `ChildProfile.aiEnabled`; when false this never reaches Bedrock at all. */
  aiEnabled?: boolean;
}

export interface TutorTurnResult {
  turn: TutorTurn;
  source: 'AI' | 'FALLBACK';
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
 * Prerequisite mastery for one skill, from the Mastery Engine's own safe
 * summary view. Skips the read entirely for a skill with no prerequisites,
 * which is most of the seed curriculum - a hint should not cost a table
 * scan to learn nothing.
 */
async function loadPrerequisiteSummaries(
  childProfileId: string,
  skillId: string,
): Promise<readonly MasterySummary[]> {
  const prerequisiteIds = listPrerequisites(skillId).map((skill) => skill.id);
  if (prerequisiteIds.length === 0) return [];
  const rows = await listSkillProgress(childProfileId);
  return buildMasterySummary(prerequisiteIds, indexProgressBySkill(rows));
}

/** Authored title and stage heading of the quest this child is in the middle of, if any. */
async function loadActiveQuestCopy(
  childProfileId: string,
): Promise<{ questTitle?: string; questStageTitle?: string }> {
  if (QUEST_DEFINITIONS.length === 0) return {};
  const states = await listQuestStates(childProfileId);
  const active = states.find((state) => state.status === 'ACTIVE');
  if (!active) return {};
  const definition = getQuestDefinition(active.questId);
  if (!definition) return {};
  return {
    questTitle: definition.title,
    questStageTitle: getStage(definition, active.currentStageId)?.title,
  };
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
      promptTemplateVersion: TUTOR_PERSONA_VERSION,
      modelId: TUTOR_MODEL_ID,
      inputCategory: params.inputCategory,
      outputSchemaVersion: OUTPUT_SCHEMA_VERSION,
      validationStatus: params.validationStatus,
      safetyDisposition: params.safetyDisposition,
      fallbackUsed: params.fallbackUsed,
      latencyMs: params.latencyMs,
      createdAt: new Date().toISOString(),
    });
  } catch {
    // Best-effort observability, same as the companion route: an audit
    // write must never block or hide a turn from the child.
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
 * Assembles the safe context, calls `generateTutorTurn`, validates the
 * response, and falls back to authored content on any failure (CLAUDE.md
 * section 7's pipeline). Always resolves and never throws, so a tutoring
 * turn is always safe to render.
 *
 * Two cases return authored content *without any network call at all*, and
 * both are deliberate:
 *
 * - `aiEnabled === false`, the parent's own switch (roadmap Phase 7). No
 *   generation, no reads, no audit row, same as the companion route.
 * - a skill that is not tutorable (`isTutorableSkill`): outside the seed
 *   curriculum, or with no authored vocabulary. Calling the model anyway
 *   would mean prompting it with no word list to bound it, which is
 *   precisely the unbounded prompt this phase exists to avoid. The child
 *   loses nothing: the authored hint ladder is complete on its own, and
 *   callers keep their pre-Phase-27 behavior for these skills.
 */
export async function requestTutorTurn(input: RequestTutorTurnInput): Promise<TutorTurnResult> {
  if (input.aiEnabled === false || !isTutorableSkill(input.skillId)) {
    return { turn: authoredFallback(input), source: 'FALLBACK' };
  }

  const startedAt = Date.now();
  let validationStatus: 'VALID' | 'INVALID_SCHEMA' | 'INVALID_CONTENT' | 'ERROR' = 'ERROR';
  let safetyDisposition: 'ALLOW' | 'REDIRECT' | 'STOP' = 'ALLOW';
  let fallbackUsed = false;
  let turn: TutorTurn;
  let context: TutorContext | undefined;

  try {
    // Context assembly reads the child's own records; a failure here must
    // degrade to a less-informed *authored* turn rather than to a
    // less-informed *generated* one, so it shares the outer catch.
    const [masterySummaries, questCopy] = await Promise.all([
      loadPrerequisiteSummaries(input.childProfileId, input.skillId),
      loadActiveQuestCopy(input.childProfileId),
    ]);

    context = buildTutorContext({
      ageBand: input.ageBand,
      skillId: input.skillId,
      hintLevel: input.hintLevel,
      masterySummaries,
      questTitle: questCopy.questTitle,
      questStageTitle: questCopy.questStageTitle,
      authoredBaseText: input.authoredBaseText,
    });
    if (!context) {
      throw new Error('No safe tutor context could be built for this skill.');
    }

    const { data, errors } = await client.generations.generateTutorTurn({
      ageBand: context.ageBand,
      strategy: context.strategy,
      maxLength: context.maxLength,
      skillTitle: context.skillTitle,
      skillDescription: context.skillDescription,
      allowedVocabulary: [...context.allowedVocabulary],
      knownPrerequisiteTitles: [...context.knownPrerequisiteTitles],
      allowedRepresentations: [...context.allowedRepresentations],
      questTitle: context.questTitle,
      questStageTitle: context.questStageTitle,
      hintLevel: context.hintLevel,
      authoredBaseText: context.authoredBaseText,
    });

    if (errors?.length || !data) {
      throw new Error(errors?.[0]?.message ?? 'The tutor route returned no data.');
    }

    const result = validateTutorTurn(data, context);
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
        turn = { ...TUTOR_REDIRECT_TURN, safetyDisposition };
      }
    }
  } catch {
    validationStatus = 'ERROR';
    fallbackUsed = true;
    turn = authoredFallback(input);
  }

  const latencyMs = Date.now() - startedAt;
  const strategy = context?.strategy ?? strategyForHintLevel(input.hintLevel);

  await recordAudit({
    childProfileId: input.childProfileId,
    sessionId: input.sessionId,
    stepId: input.stepId,
    // Metadata only, never child text: which approved strategy was asked
    // for is exactly what a later safety or pedagogy review needs to read.
    inputCategory: `TUTOR_${strategy}`,
    validationStatus,
    safetyDisposition,
    fallbackUsed,
    latencyMs,
  });

  if (safetyDisposition !== 'ALLOW') {
    await recordSafetyEvent({
      childProfileId: input.childProfileId,
      sessionId: input.sessionId,
      category: `tutor-turn-${strategy.toLowerCase()}`,
      severity: safetyDisposition === 'STOP' ? 'HIGH' : 'MEDIUM',
      actionTaken: 'Replaced with authored fallback content.',
    });
  }

  return { turn, source: fallbackUsed ? 'FALLBACK' : 'AI' };
}
