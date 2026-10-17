/**
 * The quest state machine (docs/ROADMAP.md Phase 25).
 *
 * Pure and deterministic, like the Adventure Engine's own transition logic:
 * given an authored quest, a stored state, and a context snapshot, decide
 * which stage the child is on and whether the quest is finished. No AI ever
 * touches this - CLAUDE.md section 7 requires gameplay correctness to be
 * evaluated by application code, and "did the child finish this quest" is
 * exactly that.
 */
import {
  areRequiredObjectivesComplete,
  completedObjectiveIds,
  evaluateQuestConditions,
} from './objectives';
import type {
  QuestContext,
  QuestDefinition,
  QuestStage,
  QuestState,
  QuestWorldChange,
} from './types';

export function getStage(definition: QuestDefinition, stageId: string): QuestStage | undefined {
  return definition.stages.find((stage) => stage.id === stageId);
}

/** Every objective in the quest, across all stages, for journal and content checks. */
export function allObjectives(definition: QuestDefinition) {
  return definition.stages.flatMap((stage) => stage.objectives);
}

/**
 * Whether this child may start `definition` right now: prerequisites pass
 * and they have not already started or finished it.
 */
export function isQuestAvailable(
  definition: QuestDefinition,
  context: QuestContext,
  state?: QuestState,
): boolean {
  if (state) return false;
  return evaluateQuestConditions(definition.prerequisites, context);
}

/** The state a quest starts in. `startedAt` is passed in so this stays pure. */
export function startQuest(definition: QuestDefinition, startedAt: string): QuestState {
  return {
    questId: definition.id,
    status: 'ACTIVE',
    currentStageId: definition.entryStageId,
    completedStageIds: [],
    completedObjectiveIds: [],
    startedAt,
  };
}

/**
 * Which stage follows `stage`: the first branch whose conditions pass, else
 * the authored fallthrough, else nothing - and nothing means the quest is
 * complete. Branching is therefore authored as "the special cases first,
 * the ordinary path last", the same first-match-wins rule dialogue nodes
 * already use.
 */
export function nextStageId(
  stage: QuestStage,
  context: QuestContext,
  state: QuestState,
): string | undefined {
  const branch = (stage.branches ?? []).find((candidate) =>
    evaluateQuestConditions(candidate.conditions, context, state),
  );
  return branch?.nextStageId ?? stage.nextStageId;
}

export interface AdvanceQuestResult {
  state: QuestState;
  /** True when this call moved the quest along at all, so a caller can skip a write. */
  changed: boolean;
  /** Stages completed by this call, in the order they completed. */
  newlyCompletedStageIds: readonly string[];
  /** Objectives newly satisfied, including optional ones, for a celebration beat. */
  newlyCompletedObjectiveIds: readonly string[];
  /** World changes owed by the stages that just completed, plus the quest's own. */
  worldChanges: readonly QuestWorldChange[];
  /** True when this call finished the quest. */
  justCompleted: boolean;
}

/**
 * Recomputes a quest against the world and walks it forward as far as it can
 * go.
 *
 * The loop matters: a child can satisfy several stages' objectives before
 * their journal is next read (they wandered off, repaired the bridge anyway,
 * and came back), so advancing exactly one stage per call would leave the
 * journal permanently behind the world. It walks until it reaches a stage
 * with unfinished work or the quest ends.
 *
 * `visited` guards against an authored cycle - a branch pointing back at an
 * earlier stage whose objectives are already satisfied would otherwise spin
 * forever. A cycle is a content bug (`islandQuests.test.ts` asserts there is
 * none), but a content bug must not hang a child's device.
 */
export function advanceQuest(
  definition: QuestDefinition,
  state: QuestState,
  context: QuestContext,
): AdvanceQuestResult {
  const newlyCompletedStageIds: string[] = [];
  const worldChanges: QuestWorldChange[] = [];
  const completedObjectives = new Set(state.completedObjectiveIds);
  const previousObjectives = new Set(state.completedObjectiveIds);
  const completedStages = [...state.completedStageIds];
  const visited = new Set<string>();

  let currentStageId = state.currentStageId;
  let justCompleted = false;
  let status = state.status;

  if (status === 'COMPLETED') {
    return {
      state,
      changed: false,
      newlyCompletedStageIds: [],
      newlyCompletedObjectiveIds: [],
      worldChanges: [],
      justCompleted: false,
    };
  }

  for (;;) {
    const stage = getStage(definition, currentStageId);
    if (!stage) {
      // An authored stage id that does not resolve. Treat the quest as
      // stuck-but-intact rather than crashing a child's journal; the
      // content test is what catches this before it ships.
      break;
    }

    for (const objectiveId of completedObjectiveIds(stage.objectives, context)) {
      completedObjectives.add(objectiveId);
    }

    if (!areRequiredObjectivesComplete(stage.objectives, context)) break;
    if (visited.has(stage.id)) break;
    visited.add(stage.id);

    if (!completedStages.includes(stage.id)) {
      completedStages.push(stage.id);
      newlyCompletedStageIds.push(stage.id);
      worldChanges.push(...(stage.worldChanges ?? []));
    }

    const followingId = nextStageId(stage, context, {
      ...state,
      completedObjectiveIds: [...completedObjectives],
    });
    if (!followingId) {
      status = 'COMPLETED';
      justCompleted = true;
      worldChanges.push(...(definition.completion.worldChanges ?? []));
      break;
    }
    currentStageId = followingId;
  }

  const newlyCompletedObjectiveIds = [...completedObjectives].filter(
    (id) => !previousObjectives.has(id),
  );
  const changed =
    justCompleted ||
    newlyCompletedStageIds.length > 0 ||
    newlyCompletedObjectiveIds.length > 0 ||
    currentStageId !== state.currentStageId;

  return {
    state: {
      ...state,
      status,
      currentStageId,
      completedStageIds: completedStages,
      completedObjectiveIds: [...completedObjectives],
      // Deliberately not stamped here: this function is pure, so the clock
      // belongs to the caller. `syncQuestProgress` (api.ts) sets
      // `completedAt` on the write it makes when `justCompleted` is true.
      completedAt: state.completedAt,
    },
    changed,
    newlyCompletedStageIds,
    newlyCompletedObjectiveIds,
    worldChanges,
    justCompleted,
  };
}
