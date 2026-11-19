/**
 * Maps engine gameplay claims to pending notifications (pure).
 *
 * The engine only claims; it never decides anything (docs/scoring/SCORING_CONTRACTS.md section 7).
 * A pending entry holds a claim type and a semantic source hint, never an amount.
 *
 * Deliberately no pending award for `jump.challenge.completed` and `course.completed`: they are
 * deferred, client-reported and never authoritative (docs/scoring/TRUST_BOUNDARY.md). Falls,
 * respawns, hints and alternative routes are not scoring events either.
 */
import { validateGameplayEvent, type AnyGameplayEvent } from '@lai/game-engine/contracts';
import type { PendingEntry, PendingHint } from './pendingAwards';
import type { SourceKind } from './types';

function award(
  event: AnyGameplayEvent,
  sourceKinds: readonly SourceKind[],
  sourceRef: string | null,
  sourceRefSuffix: string | null,
  nowMs: number,
): PendingEntry {
  const hint: PendingHint = { sourceKinds, sourceRef, sourceRefSuffix };
  return { id: event.eventId, claimType: 'AWARD_CLAIM', hint, createdAtMs: nowMs };
}

/** The pending entry for a claim, or `null` when the event never creates one. */
export function pendingFromEvent(input: unknown, nowMs: number = Date.now()): PendingEntry | null {
  const result = validateGameplayEvent(input);
  if (!result.ok) return null;
  const event = result.value;
  switch (event.type) {
    case 'learning.answer.submitted': {
      const ref = event.payload.learningRef;
      let hint: PendingHint;
      switch (ref.kind) {
        case 'ADVENTURE_STEP':
          hint = {
            sourceKinds: ['ANSWER_CORRECT'],
            sourceRef: `${event.adventureId}/${ref.stepId}`,
            sourceRefSuffix: null,
          };
          break;
        case 'CHEST_CHALLENGE':
          hint = {
            sourceKinds: ['LEARNING_CHALLENGE'],
            sourceRef: null,
            sourceRefSuffix: ref.chestEntityId,
          };
          break;
        case 'AREA_PUZZLE':
          hint = {
            sourceKinds: ['PUZZLE_SOLVED'],
            sourceRef: null,
            sourceRefSuffix: ref.puzzleId,
          };
          break;
        case 'QUESTION_ITEM':
          hint = { sourceKinds: ['LEARNING_CHALLENGE'], sourceRef: null, sourceRefSuffix: ref.questionId };
          break;
      }
      return { id: event.eventId, claimType: 'ANSWER_CHECK', hint, createdAtMs: nowMs };
    }
    case 'exploration.area.entered':
      return award(event, ['LOCATION_FIRST_VISIT'], event.payload.areaId, null, nowMs);
    case 'exploration.discovery.found':
      return award(event, ['SECRET_DISCOVERED'], event.payload.discoveryId, null, nowMs);
    case 'collectible.collected':
      return award(event, ['PICKUP_COLLECTED'], null, event.payload.collectibleId, nowMs);
    case 'puzzle.completed':
      return event.areaId
        ? award(event, ['PUZZLE_SOLVED'], `${event.areaId}/${event.payload.puzzleId}`, null, nowMs)
        : award(event, ['PUZZLE_SOLVED'], null, event.payload.puzzleId, nowMs);
    case 'quest.completed':
      return award(event, ['QUEST_COMPLETED'], event.payload.questId, null, nowMs);
    case 'adventure.completed':
      return award(event, ['ADVENTURE_COMPLETED'], event.adventureId, null, nowMs);
    case 'realm.milestone.reached':
      return award(event, ['REALM_MILESTONE'], event.payload.milestoneId, null, nowMs);
    case 'jump.challenge.completed':
    case 'course.completed':
    case 'jump.alternative.used':
    case 'jump.challenge.started':
    case 'course.checkpoint.reached':
    case 'learning.question.presented':
    case 'npc.interaction.completed':
    case 'quest.step.completed':
    case 'adventure.started':
      return null;
  }
}
