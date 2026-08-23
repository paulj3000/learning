import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const { buildQuestContext, listQuestStates, syncQuestProgress, startQuest, getChildProfile } =
  vi.hoisted(() => ({
    buildQuestContext: vi.fn(),
    listQuestStates: vi.fn(),
    syncQuestProgress: vi.fn(),
    startQuest: vi.fn(),
    getChildProfile: vi.fn(),
  }));

vi.mock('../features/quests/api', () => ({
  buildQuestContext,
  listQuestStates,
  syncQuestProgress,
  startQuest,
}));

// The journal hides quests authored for other age bands, so the route reads
// the child's own band (`buildQuestJournal`).
vi.mock('../features/child-profile/api', () => ({ getChildProfile }));

import { QuestJournal } from './QuestJournal';
import { EMPTY_QUEST_CONTEXT, type QuestContext, type QuestState } from '../features/quests/types';

function renderJournal() {
  return render(
    <MemoryRouter initialEntries={['/island/child-1/quests']}>
      <Routes>
        <Route path="/island/:childId/quests" element={<QuestJournal />} />
      </Routes>
    </MemoryRouter>,
  );
}

function context(overrides: Partial<QuestContext> = {}): QuestContext {
  return { ...EMPTY_QUEST_CONTEXT, ...overrides };
}

const BRIDGE_STARTED: QuestState = {
  questId: 'repair-the-bridge',
  status: 'ACTIVE',
  currentStageId: 'hear-pip-out',
  completedStageIds: [],
  completedObjectiveIds: [],
  startedAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  syncQuestProgress.mockResolvedValue([]);
  startQuest.mockResolvedValue(undefined);
  listQuestStates.mockResolvedValue([]);
  buildQuestContext.mockResolvedValue(context());
  // Every authored quest the existing cases assert on is Pathfinder-facing.
  getChildProfile.mockResolvedValue({ id: 'child-1', ageBand: 'PATHFINDER' });
});

describe('QuestJournal', () => {
  it('shows available quests with who is asking', async () => {
    renderJournal();

    expect(await screen.findByText('The Moonlight Bridge')).toBeInTheDocument();
    expect(screen.getAllByText('You can start this').length).toBeGreaterThan(0);
    expect(screen.getByText(/Asked by Pirate Pip/i)).toBeInTheDocument();
  });

  it('shows the current stage and ticks off objectives already done', async () => {
    listQuestStates.mockResolvedValue([BRIDGE_STARTED]);
    buildQuestContext.mockResolvedValue(
      context({
        npcMemoryFlags: { 'pirate-pip': { heardAboutBridge: true } },
        ownedItemIds: ['spiral-shell'],
      }),
    );

    renderJournal();

    expect(await screen.findByText(/Now: Repair the moonlight bridge/)).toBeInTheDocument();
    expect(screen.getByText(/Finish the bridge repair with Pip/)).toBeInTheDocument();
    // The optional side errand is marked as optional, in child-facing words.
    expect(screen.getByText(/if you want to/)).toBeInTheDocument();
  });

  it('states each objective as done or not for screen readers, not by colour alone', async () => {
    listQuestStates.mockResolvedValue([BRIDGE_STARTED]);
    buildQuestContext.mockResolvedValue(
      context({
        npcMemoryFlags: { 'pirate-pip': { heardAboutBridge: true } },
        ownedItemIds: ['spiral-shell'],
      }),
    );

    renderJournal();

    await screen.findByText(/Now: Repair the moonlight bridge/);
    expect(screen.getAllByText(/- done/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/- not done yet/).length).toBeGreaterThan(0);
  });

  it('shows the authored wrap-up note once a quest is finished', async () => {
    listQuestStates.mockResolvedValue([
      { ...BRIDGE_STARTED, status: 'COMPLETED', currentStageId: 'bridge-stands-again' },
    ]);

    renderJournal();

    expect(await screen.findByText(/Lanterns line it now/)).toBeInTheDocument();
    expect(screen.getByText('Finished')).toBeInTheDocument();
  });

  /**
   * The save/resume case: the stored row is stale (still on stage one) but
   * the child has since done all the work, so the journal must show the
   * quest as finished rather than asking them to repeat it.
   */
  it('projects a stale stored state forward when it is opened', async () => {
    listQuestStates.mockResolvedValue([BRIDGE_STARTED]);
    buildQuestContext.mockResolvedValue(
      context({
        npcMemoryFlags: { 'pirate-pip': { heardAboutBridge: true } },
        completedAdventureSlugs: ['repair-the-moonlight-bridge'],
        worldChangeKeys: ['BRIDGE_REPAIRED'],
      }),
    );

    renderJournal();

    expect(await screen.findByText(/Lanterns line it now/)).toBeInTheDocument();
  });

  it('persists progress on open so a quest finished elsewhere is not left dangling', async () => {
    renderJournal();

    await waitFor(() => expect(syncQuestProgress).toHaveBeenCalledWith('child-1'));
  });

  it('still renders the journal when persisting progress fails', async () => {
    syncQuestProgress.mockRejectedValue(new Error('offline'));

    renderJournal();

    expect(await screen.findByText('The Moonlight Bridge')).toBeInTheDocument();
  });

  it('reports a load failure without breaking the screen', async () => {
    buildQuestContext.mockRejectedValue(new Error('offline'));

    renderJournal();

    expect(await screen.findByRole('alert')).toHaveTextContent(/went wrong loading your quests/i);
  });
});

/**
 * Phase 29. Before a second world existed, every startable quest was offered
 * by an NPC in a conversation or opened by a discovery, so the journal could
 * label one "You can start this" with no way to start it. Creature Care Cove
 * has neither, so its quest had no entrance at all.
 */
describe('starting an available quest from the journal', () => {
  it('starts the quest and reprojects the journal', async () => {
    const user = userEvent.setup();
    renderJournal();

    const button = await screen.findByRole('button', {
      name: 'Start this quest: The Moonlight Bridge',
    });
    await user.click(button);

    await waitFor(() => expect(startQuest).toHaveBeenCalled());
    expect(startQuest.mock.calls[0]?.[0]).toBe('child-1');
    expect(startQuest.mock.calls[0]?.[1]).toMatchObject({ id: 'repair-the-bridge' });
    // A reprojection, because the first stage may already be complete from
    // work the child did before accepting.
    await waitFor(() => expect(syncQuestProgress).toHaveBeenCalledTimes(2));
  });

  it('offers no start button for a quest already under way', async () => {
    listQuestStates.mockResolvedValue([BRIDGE_STARTED]);
    renderJournal();

    await screen.findByText('The Moonlight Bridge');
    expect(
      screen.queryByRole('button', { name: 'Start this quest: The Moonlight Bridge' }),
    ).not.toBeInTheDocument();
  });

  it('says so calmly when the quest cannot be started', async () => {
    startQuest.mockRejectedValue(new Error('offline'));
    const user = userEvent.setup();
    renderJournal();

    await user.click(
      await screen.findByRole('button', { name: 'Start this quest: The Moonlight Bridge' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('We could not start that quest');
  });
});
