import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgeBandValue } from '../../child-profile/constants';
import { PirateBuilderBayWorldView } from './PirateBuilderBayWorldView';
import { REPAIR_THE_MOONLIGHT_BRIDGE } from '../../adventures/content/repairTheMoonlightBridge';

vi.mock('./pirateBuilderBayScene', () => ({
  createPirateBuilderBayEngine: vi.fn(() => ({ dispose: vi.fn(), interact: vi.fn() })),
}));

/**
 * Tapping "Pirate Pip" hands off to `NpcConversation`, which loads the
 * Quest Engine's whole context; this file is about the view wiring the
 * spatial event to the right authored interaction id, so the conversation
 * is stubbed here and tested on its own in `NpcConversation.test.tsx`, same
 * precedent as `WelcomeHarborWorldView.test.tsx` and the 2D
 * `PirateBuilderBayWorldView.test.tsx`.
 */
vi.mock('../NpcConversation', () => ({
  NpcConversation: ({ npcId }: { npcId: string }) => (
    <div data-testid="npc-conversation">{npcId}</div>
  ),
}));

vi.mock('../../adventures/api', () => ({
  listAllWorldChanges: vi.fn(),
  resumeOrStartSession: vi.fn(),
}));

vi.mock('../../discovery/api', () => ({
  getWorldState: vi.fn(),
  recordCharacterMet: vi.fn(),
  saveCheckpoint: vi.fn(),
  recordDiscovery: vi.fn(),
  getDiscoveryDefinition: vi.fn(),
}));

vi.mock('../../rewards/api', () => ({
  getInventory: vi.fn(),
}));

vi.mock('../../quests/api', () => ({
  listQuestStates: vi.fn(),
}));

vi.mock('../../island/api', () => ({
  getCompanionProfile: vi.fn(),
}));

import { listAllWorldChanges, resumeOrStartSession } from '../../adventures/api';
import { getWorldState, recordCharacterMet, saveCheckpoint } from '../../discovery/api';
import { getInventory } from '../../rewards/api';
import { listQuestStates } from '../../quests/api';
import { getCompanionProfile } from '../../island/api';

const listAllWorldChangesMock = vi.mocked(listAllWorldChanges);
const resumeOrStartSessionMock = vi.mocked(resumeOrStartSession);
const getWorldStateMock = vi.mocked(getWorldState);
const recordCharacterMetMock = vi.mocked(recordCharacterMet);
const saveCheckpointMock = vi.mocked(saveCheckpoint);
const getInventoryMock = vi.mocked(getInventory);
const listQuestStatesMock = vi.mocked(listQuestStates);
const getCompanionProfileMock = vi.mocked(getCompanionProfile);

function renderView(ageBand: AgeBandValue = 'PATHFINDER') {
  return render(
    <MemoryRouter initialEntries={['/island/child-1/world/pirate-builder-bay-3d']}>
      <Routes>
        <Route
          path="/island/:childId/world/pirate-builder-bay-3d"
          element={<PirateBuilderBayWorldView childId="child-1" ageBand={ageBand} />}
        />
        <Route
          path="/island/:childId/locations/:locationSlug/adventures/:templateSlug"
          element={<p>Adventure route</p>}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('PirateBuilderBayWorldView', () => {
  beforeEach(() => {
    listAllWorldChangesMock.mockReset();
    resumeOrStartSessionMock.mockReset();
    getWorldStateMock.mockReset();
    recordCharacterMetMock.mockReset();
    saveCheckpointMock.mockReset();
    getInventoryMock.mockReset();
    listQuestStatesMock.mockReset();
    getCompanionProfileMock.mockReset();

    listAllWorldChangesMock.mockResolvedValue([]);
    getWorldStateMock.mockResolvedValue({ discoveredIds: [], metCharacterIds: [] });
    recordCharacterMetMock.mockResolvedValue(undefined);
    saveCheckpointMock.mockResolvedValue(undefined);
    getInventoryMock.mockResolvedValue({ ownedItemIds: [], grantedRuleIds: [] });
    listQuestStatesMock.mockResolvedValue([]);
    getCompanionProfileMock.mockResolvedValue(null);
  });

  it('shows a loading state before its reads resolve', () => {
    listAllWorldChangesMock.mockReturnValue(new Promise(() => {}));

    renderView();

    expect(screen.getByText(/loading pirate builder bay/i)).toBeInTheDocument();
  });

  it('renders the 3D scene and HUD, and lists the always-available interactions once ready', async () => {
    renderView();

    expect(await screen.findByText(/move: wasd or the arrow keys/i)).toBeInTheDocument();
    expect(screen.getByText('The broken Moonlight Bridge')).toBeInTheDocument();
    expect(screen.getByText('Pirate Pip')).toBeInTheDocument();
    expect(screen.getByText('A coil of rope')).toBeInTheDocument();
    expect(screen.getByText("Pirate Pip's toolbox")).toBeInTheDocument();
    expect(screen.getByText('A hidden treasure chest')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /backpack \(0\)/i })).toBeInTheDocument();
  });

  it('starts the real adventure session and navigates there from the accessible list', async () => {
    const user = userEvent.setup();
    resumeOrStartSessionMock.mockResolvedValue({
      id: 'session-1',
      currentStepId: REPAIR_THE_MOONLIGHT_BRIDGE.entryStepId,
    } as never);

    renderView();
    await user.click(await screen.findByText('The broken Moonlight Bridge'));
    await user.click(screen.getByRole('button', { name: /start the adventure/i }));

    await waitFor(() => {
      expect(resumeOrStartSessionMock).toHaveBeenCalledWith('child-1', REPAIR_THE_MOONLIGHT_BRIDGE);
    });
    expect(await screen.findByText('Adventure route')).toBeInTheDocument();
  });

  it('offers the repaired-bridge narration instead of the adventure once the bridge is repaired', async () => {
    listAllWorldChangesMock.mockResolvedValue([{ changeKey: 'BRIDGE_REPAIRED' } as never]);

    renderView();

    expect(await screen.findByText('The repaired Moonlight Bridge')).toBeInTheDocument();
    expect(screen.queryByText('The broken Moonlight Bridge')).not.toBeInTheDocument();
  });

  it('opens a conversation with Pip instead of trying to start a session', async () => {
    const user = userEvent.setup();

    renderView();
    await user.click(await screen.findByText('Pirate Pip'));

    expect(await screen.findByTestId('npc-conversation')).toHaveTextContent('pirate-pip');
    expect(resumeOrStartSessionMock).not.toHaveBeenCalled();
  });

  it('dismisses the interaction panel without navigating', async () => {
    const user = userEvent.setup();

    renderView();
    await user.click(await screen.findByText('Pirate Pip'));
    await user.click(screen.getByRole('button', { name: /not now/i }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it("shows the companion's name in the HUD once its profile loads", async () => {
    getCompanionProfileMock.mockResolvedValue({
      id: 'c1',
      childProfileId: 'child-1',
      companionType: 'CHATTY_PARROT',
      displayName: 'Chatty',
    } as never);

    renderView();

    expect(await screen.findByText('Chatty')).toBeInTheDocument();
  });

  it('offers a link back to the non-3D location page', async () => {
    renderView();

    expect(await screen.findByRole('link', { name: /prefer not to walk in 3d/i })).toHaveAttribute(
      'href',
      '/island/child-1/locations/pirate-builder-bay',
    );
  });
});
