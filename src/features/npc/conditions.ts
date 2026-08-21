/**
 * Conditional dialogue evaluation (docs/ROADMAP.md Phase 23). Pure, total,
 * and deliberately boring: a closed `switch` over the authored `NpcCondition`
 * shapes, mirroring `isLocationUnlocked`'s approach in
 * `src/features/island/locations.ts` rather than inventing an expression
 * language a content designer could not review.
 */
import {
  RELATIONSHIP_LEVEL_ORDER,
  type NpcCondition,
  type NpcContext,
  type RelationshipLevel,
} from './types';

/** Rank on the four-step ladder; higher means better acquainted. */
export function relationshipRank(level: RelationshipLevel): number {
  return RELATIONSHIP_LEVEL_ORDER.indexOf(level);
}

export function evaluateCondition(condition: NpcCondition, context: NpcContext): boolean {
  switch (condition.type) {
    case 'ALWAYS':
      return true;
    case 'MEMORY_FLAG':
      // An unset flag reads as false, so authoring `equals: false` matches a
      // child who has never triggered it as well as one who has it cleared.
      return (context.memoryFlags[condition.flag] ?? false) === condition.equals;
    case 'RELATIONSHIP_AT_LEAST':
      return relationshipRank(context.relationshipLevel) >= relationshipRank(condition.level);
    case 'WORLD_CHANGE':
      return context.worldChangeKeys.includes(condition.changeKey);
    case 'QUEST_COMPLETED':
      return context.completedQuestIds.includes(condition.questId);
    case 'TIME_OF_DAY':
      return context.timeOfDay === condition.timeOfDay;
  }
}

/** All conditions must pass. An empty list passes, matching `requirements: [{ type: 'ALWAYS' }]`. */
export function evaluateConditions(
  conditions: readonly NpcCondition[] | undefined,
  context: NpcContext,
): boolean {
  return (conditions ?? []).every((condition) => evaluateCondition(condition, context));
}
