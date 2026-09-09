import { ISLAND_QUESTS } from './islandQuests';
import { CREATURE_CARE_COVE_QUESTS } from './creatureCareCoveQuests';
import { CLOCKWORK_HARBOR_QUESTS } from './clockworkHarborQuests';
import type { QuestDefinition, QuestId } from '../types';

export * from './islandQuests';
export * from './creatureCareCoveQuests';
export * from './clockworkHarborQuests';

/**
 * Every authored quest, in the order a content designer wrote them, one
 * world's pack after another (docs/ROADMAP.md Phase 29). The Quest Engine
 * has no notion of which world a quest belongs to: a quest is available when
 * its prerequisites pass, and a cove quest's prerequisite is having sailed
 * to the cove.
 */
export const QUEST_DEFINITIONS: readonly QuestDefinition[] = [
  ...ISLAND_QUESTS,
  ...CREATURE_CARE_COVE_QUESTS,
  ...CLOCKWORK_HARBOR_QUESTS,
];

export function getQuestDefinition(questId: QuestId): QuestDefinition | undefined {
  return QUEST_DEFINITIONS.find((definition) => definition.id === questId);
}

/** The quests one NPC offers, joining Phase 23's `NpcQuestOffer.questId` to this phase's content. */
export function getQuestsOfferedBy(npcId: string): QuestDefinition[] {
  return QUEST_DEFINITIONS.filter((definition) => definition.giverNpcId === npcId);
}
