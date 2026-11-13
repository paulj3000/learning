import type { AgeBandValue } from '../../../../child-profile/constants';
import { recordDialogueNode } from '../../../../npc/api';
import { findNpc } from '../../../../npc/content';
import { selectDialogueNode } from '../../../../npc/dialogue';
import { timeOfDayForDate } from '../../../../npc/schedule';
import { buildQuestContext, startQuest, syncQuestProgress } from '../../../../quests/api';
import { QUEST_DEFINITIONS } from '../../../../quests/content';
import { npcContextFromQuestContext } from '../../../../quests/offers';

/**
 * What talking to Keeper Quill has always meant for the castle's progression, kept when the NPC
 * Manager serves him (LAI-NPC-039). The legacy `NpcConversation` recorded the opening node it
 * showed (which sets `metQuill`, the "Meet Keeper Quill" objective of `tell-a-story-together`,
 * and warms the friendship), and its "Yes, I will help!" started the quest. The managed Quill
 * says published lines instead, so these two calls are what keep the castle's quests and NPC
 * memory exactly where the legacy path would have put them. Same engines, same writes; nothing
 * new is persisted. Both resolve quietly on failure: a conversation that cannot be saved is
 * still a conversation (the legacy component's own rule).
 */

/** Records the opening node the legacy conversation would have shown this child. */
export async function recordLegacyMeeting(childId: string, npcId: string): Promise<void> {
  const npc = findNpc(npcId);
  if (!npc) return;
  try {
    const context = await buildQuestContext(childId);
    const forNpc = npcContextFromQuestContext(npc.id, context, timeOfDayForDate(new Date()));
    const opening = selectDialogueNode(npc, forNpc);
    if (opening) await recordDialogueNode(childId, npc.id, opening);
  } catch {
    // Nothing to tell the child: the conversation goes ahead.
  }
}

/**
 * The legacy accept: starts an offered quest the castle's quest engine knows, when this NPC gives
 * it and the child's band may play it. Returns whether it was started (or already was).
 */
export async function acceptLegacyQuest(
  childId: string,
  questId: string,
  npcId: string,
  ageBand: AgeBandValue,
): Promise<boolean> {
  const definition = QUEST_DEFINITIONS.find((quest) => quest.id === questId);
  if (!definition || definition.giverNpcId !== npcId) return false;
  if (!definition.ageBands.includes(ageBand)) return false;
  try {
    await startQuest(childId, definition);
    await syncQuestProgress(childId).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}
