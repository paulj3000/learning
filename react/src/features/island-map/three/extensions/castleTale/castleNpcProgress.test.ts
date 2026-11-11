import { acceptLegacyQuest, recordLegacyMeeting } from './castleNpcProgress';

/**
 * LAI-NPC-039: the managed Quill keeps the castle's progression where the legacy
 * `NpcConversation` put it. The persistence modules are fakes; the NPC and quest content and
 * their pure rules are the real ones.
 */

vi.mock('../../../../npc/api', () => ({
  recordDialogueNode: vi.fn(async () => ({})),
}));
vi.mock('../../../../quests/api', () => ({
  buildQuestContext: vi.fn(async () => {
    const { EMPTY_QUEST_CONTEXT } = await import('../../../../quests/types');
    return EMPTY_QUEST_CONTEXT;
  }),
  startQuest: vi.fn(async () => ({})),
  syncQuestProgress: vi.fn(async () => []),
}));

const npcApi = await import('../../../../npc/api');
const questApi = await import('../../../../quests/api');

beforeEach(() => vi.clearAllMocks());

describe('recordLegacyMeeting', () => {
  it("records the opening node the legacy conversation shows (Quill's greeting)", async () => {
    await recordLegacyMeeting('kid', 'keeper-quill');
    expect(npcApi.recordDialogueNode).toHaveBeenCalledTimes(1);
    const [child, npcId, node] = vi.mocked(npcApi.recordDialogueNode).mock.calls[0];
    expect([child, npcId]).toEqual(['kid', 'keeper-quill']);
    expect(node.id).toBe('quill-greeting');
    expect(node.setsMemoryFlags).toContain('metQuill');
  });

  it('never throws when the progress cannot be read', async () => {
    vi.mocked(questApi.buildQuestContext).mockRejectedValueOnce(new Error('offline'));
    await expect(recordLegacyMeeting('kid', 'keeper-quill')).resolves.toBeUndefined();
    expect(npcApi.recordDialogueNode).not.toHaveBeenCalled();
  });

  it('does nothing for an unknown character', async () => {
    await recordLegacyMeeting('kid', 'nobody');
    expect(questApi.buildQuestContext).not.toHaveBeenCalled();
  });
});

describe('acceptLegacyQuest', () => {
  it("starts Quill's quest through the castle quest engine, then projects progress", async () => {
    expect(
      await acceptLegacyQuest('kid', 'tell-a-story-together', 'keeper-quill', 'PATHFINDER'),
    ).toBe(true);
    expect(questApi.startQuest).toHaveBeenCalledTimes(1);
    expect(vi.mocked(questApi.startQuest).mock.calls[0][1].id).toBe('tell-a-story-together');
    expect(questApi.syncQuestProgress).toHaveBeenCalledWith('kid');
  });

  it.each([
    ['a band the quest is not for', 'tell-a-story-together', 'keeper-quill', 'SPROUT'],
    ['another character', 'tell-a-story-together', 'pirate-pip', 'PATHFINDER'],
    ['an unknown quest', 'no-such-quest', 'keeper-quill', 'PATHFINDER'],
  ] as const)('refuses %s', async (_label, questId, npcId, band) => {
    expect(await acceptLegacyQuest('kid', questId, npcId, band)).toBe(false);
    expect(questApi.startQuest).not.toHaveBeenCalled();
  });
});
