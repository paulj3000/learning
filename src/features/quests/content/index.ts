import { ISLAND_QUESTS } from './islandQuests';
import type { QuestDefinition, QuestId } from '../types';

export * from './islandQuests';

/** Every authored quest, in the order a content designer wrote them. */
export const QUEST_DEFINITIONS: readonly QuestDefinition[] = ISLAND_QUESTS;

export function getQuestDefinition(questId: QuestId): QuestDefinition | undefined {
  return QUEST_DEFINITIONS.find((definition) => definition.id === questId);
}

/** The quests one NPC offers, joining Phase 23's `NpcQuestOffer.questId` to this phase's content. */
export function getQuestsOfferedBy(npcId: string): QuestDefinition[] {
  return QUEST_DEFINITIONS.filter((definition) => definition.giverNpcId === npcId);
}
