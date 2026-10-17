/**
 * Objective evaluation (docs/ROADMAP.md Phase 25).
 *
 * Pure, total, and deliberately boring: one closed `switch` over the eleven
 * authored primitives, mirroring `evaluateCondition` in
 * `src/features/npc/conditions.ts`. Every branch answers the same question -
 * "does state that already exists satisfy this?" - which is what lets quest
 * progress be derived rather than reported (see the module comment in
 * `types.ts`).
 */
import { relationshipRank } from '../npc/conditions';
import { SKILL_STATUS_ORDER } from '../mastery/types';
import type { QuestCondition, QuestContext, QuestObjective, QuestState } from './types';

function npcRemembers(context: QuestContext, npcId: string, flag: string): boolean {
  return context.npcMemoryFlags[npcId]?.[flag] === true;
}

/** Whether one objective is satisfied by the child's current world state. */
export function isObjectiveComplete(objective: QuestObjective, context: QuestContext): boolean {
  switch (objective.kind) {
    case 'TALK_TO':
    case 'HELP_NPC':
      return npcRemembers(context, objective.npcId, objective.memoryFlag);

    case 'DELIVER':
      // Both halves: the child had the thing, and the recipient remembers
      // receiving it. Checking only the flag would let an NPC "remember" a
      // delivery the child never made, and checking only the item would
      // complete the moment it was picked up.
      return (
        context.ownedItemIds.includes(objective.itemId) &&
        npcRemembers(context, objective.npcId, objective.memoryFlag)
      );

    case 'FIND':
    case 'CRAFT':
      return context.ownedItemIds.includes(objective.itemId);

    case 'COLLECT': {
      const owned = objective.itemIds.filter((itemId) => context.ownedItemIds.includes(itemId));
      const required = objective.requiredCount ?? objective.itemIds.length;
      return owned.length >= required;
    }

    case 'SOLVE':
      return context.completedAdventureSlugs.includes(objective.adventureSlug);

    case 'BUILD':
      return context.worldChangeKeys.includes(objective.changeKey);

    case 'EXPLORE':
      return context.visitedLocationSlugs.includes(objective.locationSlug);

    case 'LEARN': {
      const status = context.skillStatuses[objective.learningObjectiveCode];
      if (!status) return false;
      return SKILL_STATUS_ORDER.indexOf(status) >= SKILL_STATUS_ORDER.indexOf(objective.atLeast);
    }

    case 'DISCOVER':
      // Always false until Phase 26 fills `discoveryKeys` - a known dormant
      // primitive, documented in `types.ts`, not an oversight.
      return context.discoveryKeys.includes(objective.discoveryKey);
  }
}

/** The objectives of `stage` that are satisfied, in authored order. */
export function completedObjectiveIds(
  objectives: readonly QuestObjective[],
  context: QuestContext,
): string[] {
  return objectives
    .filter((objective) => isObjectiveComplete(objective, context))
    .map((objective) => objective.id);
}

/**
 * A stage is done when every *required* objective is done. Optional ones are
 * tracked (and celebrated) but never block progress, per the roadmap's
 * "optional objectives" deliverable.
 */
export function areRequiredObjectivesComplete(
  objectives: readonly QuestObjective[],
  context: QuestContext,
): boolean {
  return objectives
    .filter((objective) => !objective.optional)
    .every((objective) => isObjectiveComplete(objective, context));
}

/**
 * Evaluates one prerequisite or branch guard.
 *
 * `state` is optional because prerequisites are checked before a quest has
 * any state at all; an `OBJECTIVE_COMPLETED` guard therefore reads false for
 * a quest that has not started, which is the only sane reading of "did the
 * child already do that step".
 */
export function evaluateQuestCondition(
  condition: QuestCondition,
  context: QuestContext,
  state?: QuestState,
): boolean {
  switch (condition.type) {
    case 'ALWAYS':
      return true;
    case 'QUEST_COMPLETED':
      return context.completedQuestIds.includes(condition.questId);
    case 'WORLD_CHANGE':
      return context.worldChangeKeys.includes(condition.changeKey);
    case 'ITEM_OWNED':
      return context.ownedItemIds.includes(condition.itemId);
    case 'RELATIONSHIP_AT_LEAST': {
      const level = context.relationshipLevels[condition.npcId] ?? 'STRANGER';
      return relationshipRank(level) >= relationshipRank(condition.level);
    }
    case 'OBJECTIVE_COMPLETED':
      return (state?.completedObjectiveIds ?? []).includes(condition.objectiveId);
  }
}

/** All conditions must pass. An empty list passes, matching `[{ type: 'ALWAYS' }]`. */
export function evaluateQuestConditions(
  conditions: readonly QuestCondition[] | undefined,
  context: QuestContext,
  state?: QuestState,
): boolean {
  return (conditions ?? []).every((condition) => evaluateQuestCondition(condition, context, state));
}
