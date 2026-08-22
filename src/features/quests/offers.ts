/**
 * The join between an NPC's authored offer (Phase 23) and whether the quest
 * behind it can actually be started (Phase 25).
 *
 * `src/features/quests/journal.ts` already names the rule this module
 * implements: "Phase 23's `availableQuestOffers` decides whether an NPC
 * *asks*; `availableQuests` decides whether the quest itself is startable,
 * and both must agree before a child is shown an offer they cannot accept."
 * Until a child could hold a conversation there was nowhere to enforce it;
 * `NpcConversation` (src/features/island-map/) is that place, and this is the
 * pure half it calls.
 *
 * It lives in `quests/` rather than `npc/` because the direction of the
 * dependency is already settled: the Quest Engine reads NPC state, never the
 * other way round (docs/ARCHITECTURE.md, engine boundaries). Nothing here
 * touches the network.
 */
import { availableQuestOffers } from '../npc/questGiver';
import { relationshipLevelForPoints } from '../npc/relationship';
import type { NpcContext, NpcDefinition, NpcQuestOffer, TimeOfDay } from '../npc/types';
import { isQuestAvailable } from './quest';
import type { QuestContext, QuestDefinition, QuestState } from './types';

/**
 * The `NpcContext` for one character, read out of the snapshot the Quest
 * Engine already builds (`buildQuestContext`).
 *
 * A conversation needs both contexts, and every field an `NpcContext` has is
 * already in a `QuestContext` - so deriving one from the other keeps a screen
 * to a single load, and makes it structurally impossible for a quest
 * condition and an NPC's own dialogue to disagree about the same child.
 *
 * An NPC the child has never met has no entry in either map, which reads as
 * "no flags, a stranger" rather than as an error.
 */
export function npcContextFromQuestContext(
  npcId: string,
  questContext: QuestContext,
  timeOfDay: TimeOfDay,
): NpcContext {
  return {
    npcId,
    timeOfDay,
    relationshipLevel: questContext.relationshipLevels[npcId] ?? 'STRANGER',
    memoryFlags: questContext.npcMemoryFlags[npcId] ?? {},
    worldChangeKeys: questContext.worldChangeKeys,
    completedQuestIds: questContext.completedQuestIds,
  };
}

/** The same context after a dialogue node was recorded, without a second load. */
export function questContextWithNpcState(
  questContext: QuestContext,
  npcId: string,
  memoryFlags: Readonly<Record<string, boolean>>,
  relationshipPoints: number,
): QuestContext {
  return {
    ...questContext,
    npcMemoryFlags: { ...questContext.npcMemoryFlags, [npcId]: { ...memoryFlags } },
    relationshipLevels: {
      ...questContext.relationshipLevels,
      [npcId]: relationshipLevelForPoints(relationshipPoints),
    },
  };
}

export interface OfferableQuest {
  offer: NpcQuestOffer;
  definition: QuestDefinition;
}

/**
 * What this character can ask this child for right now: the offers whose own
 * conditions pass *and* whose quest the child has neither started nor
 * finished and whose prerequisites are met.
 *
 * An offer naming a quest that does not exist is dropped rather than shown as
 * broken. `islandQuests.test.ts` asserts that never happens in authored
 * content, so this is a floor under a content typo, not an expected path.
 */
export function offerableQuests(
  npc: NpcDefinition,
  npcContext: NpcContext,
  definitions: readonly QuestDefinition[],
  states: readonly QuestState[],
  questContext: QuestContext,
): OfferableQuest[] {
  const byQuestId = new Map(states.map((state) => [state.questId, state]));
  return availableQuestOffers(npc, npcContext).flatMap((offer) => {
    const definition = definitions.find((candidate) => candidate.id === offer.questId);
    if (!definition) return [];
    if (!isQuestAvailable(definition, questContext, byQuestId.get(offer.questId))) return [];
    return [{ offer, definition }];
  });
}
