/**
 * The NPC Conversation UI (docs/ROADMAP.md Phase 26.5).
 *
 * These cover the seam this component exists to close: a child talking their
 * way to a memory flag, and a quest that could not be started before now
 * being accepted from the conversation that offers it. The dialogue rules
 * themselves belong to `src/features/npc/` and are tested there; what is
 * asserted here is that the screen honours them and persists what it shows.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NpcConversation } from './NpcConversation';
import { EMPTY_QUEST_CONTEXT, type QuestState } from '../quests/types';
import type { DialogueNode } from '../npc/types';

vi.mock('../npc/api', () => ({
  recordDialogueNode: vi.fn(),
}));

vi.mock('../quests/api', () => ({
  buildQuestContext: vi.fn(),
  listQuestStates: vi.fn(),
  startQuest: vi.fn(),
  syncQuestProgress: vi.fn(),
}));

import { recordDialogueNode } from '../npc/api';
import { buildQuestContext, listQuestStates, startQuest, syncQuestProgress } from '../quests/api';

const recordDialogueNodeMock = vi.mocked(recordDialogueNode);
const buildQuestContextMock = vi.mocked(buildQuestContext);
const listQuestStatesMock = vi.mocked(listQuestStates);
const startQuestMock = vi.mocked(startQuest);
const syncQuestProgressMock = vi.mocked(syncQuestProgress);

/**
 * A stand-in for the real write that accumulates the way `recordDialogueNode`
 * does, so a test can see the same thing a child would: flags set earlier in a
 * conversation still set later in it.
 */
function fakeRecorder() {
  const flags: Record<string, boolean> = {};
  let points = 0;
  const seen = new Set<string>();
  return (_childId: string, npcId: string, node: DialogueNode) => {
    for (const flag of node.setsMemoryFlags ?? []) flags[flag] = true;
    if (!seen.has(node.id)) {
      seen.add(node.id);
      points += node.awardsRelationshipPoints ?? 0;
    }
    return Promise.resolve({
      state: {
        npcId,
        relationshipPoints: points,
        memoryFlags: { ...flags },
        seenNodeIds: [...seen],
      },
      relationshipLevel: 'STRANGER' as const,
      levelIncreased: false,
    });
  };
}

function renderConversation(npcId: string, onEnd = vi.fn()) {
  return render(
    <MemoryRouter>
      <NpcConversation childId="child-1" npcId={npcId} onEnd={onEnd} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  buildQuestContextMock.mockResolvedValue(EMPTY_QUEST_CONTEXT);
  listQuestStatesMock.mockResolvedValue([]);
  recordDialogueNodeMock.mockImplementation(fakeRecorder());
  syncQuestProgressMock.mockResolvedValue([]);
});

describe('NpcConversation', () => {
  it('opens with the authored line the NPC engine selects, and records it', async () => {
    renderConversation('pirate-pip');

    expect(await screen.findByText(/Ahoy! I am Pip/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nice to meet you!' })).toBeInTheDocument();
    await waitFor(() =>
      expect(recordDialogueNodeMock).toHaveBeenCalledWith(
        'child-1',
        'pirate-pip',
        expect.objectContaining({ id: 'pip-greeting' }),
      ),
    );
  });

  /**
   * The path that makes "repair-the-bridge" completable at all: its first
   * objective waits on `heardAboutBridge`, and this follow-up is the only
   * node a first conversation can reach that sets it.
   */
  it('follows a choice to a follow-up node and records that too', async () => {
    const user = userEvent.setup();
    renderConversation('pirate-pip');

    await user.click(await screen.findByRole('button', { name: 'What are you building?' }));

    expect(await screen.findByText(/lost half its planks/)).toBeInTheDocument();
    await waitFor(() =>
      expect(recordDialogueNodeMock).toHaveBeenCalledWith(
        'child-1',
        'pirate-pip',
        expect.objectContaining({ id: 'pip-bridge-story', setsMemoryFlags: ['heardAboutBridge'] }),
      ),
    );
  });

  it('offers the quest this NPC asks for once the talking is done, and starts it', async () => {
    const user = userEvent.setup();
    startQuestMock.mockResolvedValue({
      questId: 'repair-the-bridge',
      status: 'ACTIVE',
      currentStageId: 'hear-pip-out',
      completedStageIds: [],
      completedObjectiveIds: [],
      startedAt: '2026-08-21T00:00:00.000Z',
    });

    renderConversation('pirate-pip');
    await user.click(await screen.findByRole('button', { name: 'Nice to meet you!' }));

    expect(await screen.findByText(/Help Pip count and measure planks/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Yes, I will help!' }));

    await waitFor(() =>
      expect(startQuestMock).toHaveBeenCalledWith(
        'child-1',
        expect.objectContaining({ id: 'repair-the-bridge' }),
      ),
    );
    // Projected immediately, so a first objective the child satisfied during
    // this very conversation is already ticked when they open the journal.
    expect(syncQuestProgressMock).toHaveBeenCalledWith('child-1');
    expect(await screen.findByRole('link', { name: 'Open the journal' })).toHaveAttribute(
      'href',
      '/island/child-1/quests',
    );
  });

  /**
   * Bolt's offer is gated on the `metBolt` flag his own greeting sets, so
   * without folding a recorded node back into the live context a child would
   * have to leave and come back before he could ask for anything.
   */
  it('offers a quest unlocked by a flag set earlier in the same conversation', async () => {
    const user = userEvent.setup();
    renderConversation('bolt');

    await user.click(await screen.findByRole('button', { name: 'Hello, Bolt!' }));

    expect(await screen.findByText(/sort the workshop parts/i)).toBeInTheDocument();
  });

  it('does not re-offer a quest the child has already started', async () => {
    const user = userEvent.setup();
    const active: QuestState = {
      questId: 'repair-the-bridge',
      status: 'ACTIVE',
      currentStageId: 'hear-pip-out',
      completedStageIds: [],
      completedObjectiveIds: [],
      startedAt: '2026-08-21T00:00:00.000Z',
    };
    listQuestStatesMock.mockResolvedValue([active]);

    renderConversation('pirate-pip');
    await user.click(await screen.findByRole('button', { name: 'Nice to meet you!' }));

    expect(await screen.findByRole('button', { name: 'Goodbye for now' })).toBeInTheDocument();
    expect(screen.queryByText(/Help Pip count and measure planks/)).not.toBeInTheDocument();
  });

  it('ends the conversation through the caller rather than closing itself', async () => {
    const user = userEvent.setup();
    const onEnd = vi.fn();
    renderConversation('ember-dragon', onEnd);

    await user.click(await screen.findByRole('button', { name: 'Thank you, Ember!' }));
    await user.click(await screen.findByRole('button', { name: 'Goodbye for now' }));

    expect(onEnd).toHaveBeenCalled();
  });

  it('stays warm and calm when the child is offline, rather than showing an error', async () => {
    buildQuestContextMock.mockRejectedValue(new Error('offline'));

    renderConversation('pirate-pip');

    expect(await screen.findByText(/Pirate Pip waves hello, but is too busy/)).toBeInTheDocument();
  });

  it('says something safe for a character that is not in the authored cast', async () => {
    renderConversation('not-a-real-npc');

    expect(await screen.findByText(/Someone waves hello/)).toBeInTheDocument();
    expect(buildQuestContextMock).not.toHaveBeenCalled();
  });
});
