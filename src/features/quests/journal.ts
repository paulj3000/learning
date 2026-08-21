/**
 * The quest journal (docs/ROADMAP.md Phase 25, "a quest journal with
 * save/resume").
 *
 * A pure read model: authored quests plus stored states plus a context
 * snapshot, in - one ordered list of journal entries, out. Nothing here
 * writes, so the same function backs the child-facing journal screen, a
 * future parent-facing summary, and tests.
 *
 * "Resume" needs no special code path. Because every objective is derived
 * from world state (`objectives.ts`), reopening the journal recomputes
 * exactly where the child is, including credit for anything they did while
 * the quest sat untouched. There is no separate cursor to get out of sync.
 */
import { areRequiredObjectivesComplete, isObjectiveComplete } from './objectives';
import { advanceQuest, getStage, isQuestAvailable } from './quest';
import type { QuestContext, QuestDefinition, QuestId, QuestState } from './types';

/** What the journal shows for one quest. `AVAILABLE` is derived, never stored. */
export type JournalStatus = 'AVAILABLE' | 'ACTIVE' | 'COMPLETED';

export interface JournalObjective {
  id: string;
  label: string;
  done: boolean;
  optional: boolean;
}

export interface QuestJournalEntry {
  questId: QuestId;
  title: string;
  summary: string;
  status: JournalStatus;
  giverNpcId?: string;
  /** Child-facing heading for where they are now; absent for a finished quest. */
  stageTitle?: string;
  /** The current stage's objectives, with optional ones marked. Empty when finished. */
  objectives: readonly JournalObjective[];
  /** How many stages are done out of how many, for a calm progress line. */
  stagesCompleted: number;
  stageCount: number;
  /** The authored wrap-up line, shown only once the quest is complete. */
  journalNote?: string;
}

/**
 * Builds one entry, projecting the quest forward first so the journal shows
 * where the child *actually* is rather than where they were when the row was
 * last written. The projection is display-only; persisting it is
 * `syncQuestProgress`'s job (api.ts).
 */
export function buildJournalEntry(
  definition: QuestDefinition,
  state: QuestState | undefined,
  context: QuestContext,
): QuestJournalEntry | undefined {
  const base = {
    questId: definition.id,
    title: definition.title,
    summary: definition.summary,
    giverNpcId: definition.giverNpcId,
    stageCount: definition.stages.length,
  };

  if (!state) {
    if (!isQuestAvailable(definition, context)) return undefined;
    return {
      ...base,
      status: 'AVAILABLE',
      objectives: [],
      stagesCompleted: 0,
    };
  }

  const projected = advanceQuest(definition, state, context).state;

  if (projected.status === 'COMPLETED') {
    return {
      ...base,
      status: 'COMPLETED',
      objectives: [],
      stagesCompleted: projected.completedStageIds.length,
      journalNote: definition.completion.journalNote,
    };
  }

  const stage = getStage(definition, projected.currentStageId);
  return {
    ...base,
    status: 'ACTIVE',
    stageTitle: stage?.title,
    objectives: (stage?.objectives ?? []).map((objective) => ({
      id: objective.id,
      label: objective.label,
      done: isObjectiveComplete(objective, context),
      optional: objective.optional === true,
    })),
    stagesCompleted: projected.completedStageIds.length,
  };
}

const STATUS_ORDER: Record<JournalStatus, number> = {
  ACTIVE: 0,
  AVAILABLE: 1,
  COMPLETED: 2,
};

/**
 * The whole journal, ordered the way a child reads it: what they are doing
 * now, then what they could start, then what they finished. Quests whose
 * prerequisites are unmet are omitted entirely rather than shown locked -
 * `docs/UX_AND_ACCESSIBILITY.md`'s calm-engagement rules and CLAUDE.md
 * pillar 7 both argue against dangling unreachable content in front of a
 * child.
 */
export function buildQuestJournal(
  definitions: readonly QuestDefinition[],
  states: readonly QuestState[],
  context: QuestContext,
): QuestJournalEntry[] {
  const byQuestId = new Map(states.map((state) => [state.questId, state]));
  return definitions
    .map((definition) => buildJournalEntry(definition, byQuestId.get(definition.id), context))
    .filter((entry): entry is QuestJournalEntry => entry !== undefined)
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
}

/**
 * Quests this child could start right now, for an NPC's offer indicator.
 * Phase 23's `availableQuestOffers` decides whether an NPC *asks*; this
 * decides whether the quest itself is startable, and both must agree before
 * a child is shown an offer they cannot accept.
 */
export function availableQuests(
  definitions: readonly QuestDefinition[],
  states: readonly QuestState[],
  context: QuestContext,
): QuestDefinition[] {
  const byQuestId = new Map(states.map((state) => [state.questId, state]));
  return definitions.filter((definition) =>
    isQuestAvailable(definition, context, byQuestId.get(definition.id)),
  );
}

/** True when the child has finished everything the current stage requires. */
export function isCurrentStageComplete(
  definition: QuestDefinition,
  state: QuestState,
  context: QuestContext,
): boolean {
  const stage = getStage(definition, state.currentStageId);
  if (!stage) return false;
  return areRequiredObjectivesComplete(stage.objectives, context);
}
