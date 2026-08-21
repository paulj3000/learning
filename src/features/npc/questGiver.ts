/**
 * Quest-giver behavior (docs/ROADMAP.md Phase 23, "quest-giver behavior tied
 * into Phase 25").
 *
 * This phase deliberately owns only the *offer* — which NPC offers which
 * quest, and under what conditions. Quest objectives, progression, and
 * rewards belong to the Phase 25 Data-Driven Quest Engine, which does not
 * exist yet. Shipping only the seam (`questId`) means Phase 25 can define
 * the quest model freely instead of migrating a guess made here, matching
 * how Phases 19-22 each shipped a contract ahead of its consumer.
 *
 * Until Phase 25 lands, `context.completedQuestIds` is always empty and
 * `QUEST_COMPLETED` conditions therefore never pass. That is a real, known
 * limitation, not an oversight: offers gated on finishing another quest stay
 * dormant, while offers gated on memory flags, world changes, and
 * relationship level work today.
 */
import { evaluateConditions } from './conditions';
import type { NpcContext, NpcDefinition, NpcQuestOffer } from './types';

/** Offers this child currently qualifies for, in authored order. */
export function availableQuestOffers(npc: NpcDefinition, context: NpcContext): NpcQuestOffer[] {
  return npc.questOffers.filter((offer) => evaluateConditions(offer.conditions, context));
}

/** Whether this NPC has anything to ask right now, for a World Engine indicator. */
export function hasQuestToOffer(npc: NpcDefinition, context: NpcContext): boolean {
  return availableQuestOffers(npc, context).length > 0;
}

/**
 * Every NPC on the island with an available offer. The read the Phase 25
 * Quest Engine is expected to call when assembling a child's quest log,
 * and the same shape the `QuestAdvanced` event contract in
 * docs/ARCHITECTURE.md anticipates.
 */
export function questGiversWithOffers(
  npcs: readonly NpcDefinition[],
  buildContext: (npcId: string) => NpcContext,
): { npc: NpcDefinition; offers: NpcQuestOffer[] }[] {
  return npcs
    .map((npc) => ({ npc, offers: availableQuestOffers(npc, buildContext(npc.id)) }))
    .filter((entry) => entry.offers.length > 0);
}
