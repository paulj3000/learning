/**
 * GE-070 (step 6): which `lai.gameplay-event` v1 claims a region-play outcome becomes.
 *
 * Claims are facts for Django to confirm, never awards (`docs/engineering/game-engine/
 * public-contracts.md` section 2). Every claim here follows an outcome the server already
 * returned, so it only ever restates what Django recorded; scoring keys its awards on the server
 * rows, not on these. Pure: the companion supplies the two things an outcome does not carry.
 *
 * - An answer at a chest (the ruins pedestal and REPLAY chests included) becomes
 *   `learning.answer.submitted` with a `CHEST_CHALLENGE` reference. Never a discovery: a chest is
 *   a graded challenge. `choiceId` is null: the cove's choices are generated numbers, not authored
 *   option ids, and the server already holds the answer on the attempt.
 * - A pickup this request picked up becomes `collectible.collected`. The server's change key is
 *   not served to the client, so `pickupKey` is null; the placement id identifies it.
 * - Talking to an NPC becomes `npc.interaction.completed` with the authored NPC and interaction ids.
 * - Each quest objective the outcome completed becomes `quest.step.completed`, and a quest the
 *   outcome completed becomes `quest.completed`.
 *
 * Wrong answers are claimed like right ones (the server grades); nothing here judges or scores.
 */

import type { GameplayEventPayloads, GameplayEventType } from '@lai/game-engine/contracts';
import type { PlayOutcome } from '../npc-manager/dialogue/triggers';
import type { QuestUpdate } from '../../api/play/types';

export type RegionPlayClaim = {
  [T in GameplayEventType]: { type: T; payload: GameplayEventPayloads[T] };
}[GameplayEventType];

export interface RegionPlayClaimLookup {
  /** The chest an answered attempt was for, as the companion recorded when it submitted it. */
  chestForAttempt(attemptId: string): string | undefined;
  /** The NPC the child last asked to talk to, with its authored interaction id. */
  lastTalkedNpc(): { npcId: string; interactionId: string } | null;
}

function questClaims(updates: readonly QuestUpdate[]): RegionPlayClaim[] {
  return updates.flatMap((update): RegionPlayClaim[] => [
    ...update.newlyCompletedObjectiveIds.map(
      (stepId): RegionPlayClaim => ({
        type: 'quest.step.completed',
        payload: { questId: update.questId, stepId },
      }),
    ),
    ...(update.justCompleted
      ? [{ type: 'quest.completed', payload: { questId: update.questId } } as RegionPlayClaim]
      : []),
  ]);
}

export function claimsForOutcome(outcome: PlayOutcome, lookup: RegionPlayClaimLookup): RegionPlayClaim[] {
  switch (outcome.kind) {
    case 'answer': {
      const chestEntityId = lookup.chestForAttempt(outcome.outcome.attemptId);
      const answer: RegionPlayClaim[] = chestEntityId
        ? [
            {
              type: 'learning.answer.submitted',
              payload: {
                learningRef: {
                  kind: 'CHEST_CHALLENGE',
                  chestEntityId,
                  challengeAttemptId: outcome.outcome.attemptId,
                },
                choiceId: null,
              },
            },
          ]
        : [];
      return [...answer, ...questClaims(outcome.outcome.questUpdates)];
    }
    case 'pickup': {
      if (!outcome.outcome.pickedUp) return [];
      return [
        {
          type: 'collectible.collected',
          payload: { collectibleId: outcome.outcome.entityId, setId: null, pickupKey: null },
        },
        ...questClaims(outcome.outcome.questUpdates),
      ];
    }
    case 'talk': {
      const npc = lookup.lastTalkedNpc();
      return [
        ...(npc ? [{ type: 'npc.interaction.completed', payload: npc } as RegionPlayClaim] : []),
        ...questClaims(outcome.outcome.questUpdates),
      ];
    }
    default:
      return [];
  }
}
