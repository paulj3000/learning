import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WelcomeHarborWorldView } from './WelcomeHarborWorldView';

vi.mock('./welcomeHarborScene', () => ({
  createWelcomeHarborEngine: vi.fn(() => ({ dispose: vi.fn(), interact: vi.fn() })),
}));

/**
 * Tapping "Say hello to Pip" hands off to `NpcConversation`, which loads the
 * Quest Engine's whole context; this file is about the view wiring the
 * button and the checkpoint/HUD reads, so the conversation is stubbed here
 * and tested on its own in `NpcConversation.test.tsx` - same precedent as
 * `PirateBuilderBayWorldView.test.tsx`.
 */
vi.mock('../NpcConversation', () => ({
  NpcConversation: ({ npcId }: { npcId: string }) => (
    <div data-testid="npc-conversation">{npcId}</div>
  ),
}));

vi.mock('../../discovery/api', () => ({
  getWorldState: vi.fn(),
  recordCharacterMet: vi.fn(),
  saveCheckpoint: vi.fn(),
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

import { getWorldState, recordCharacterMet, saveCheckpoint } from '../../discovery/api';
import { getInventory } from '../../rewards/api';
import { listQuestStates } from '../../quests/api';
import { getCompanionProfile } from '../../island/api';

const getWorldStateMock = vi.mocked(getWorldState);
const recordCharacterMetMock = vi.mocked(recordCharacterMet);
const saveCheckpointMock = vi.mocked(saveCheckpoint);
const getInventoryMock = vi.mocked(getInventory);
const listQuestStatesMock = vi.mocked(listQuestStates);
const getCompanionProfileMock = vi.mocked(getCompanionProfile);

function renderView() {
  return render(
    <MemoryRouter>
      <WelcomeHarborWorldView childId="child-1" ageBand="PATHFINDER" />
    </MemoryRouter>,
  );
}

describe('WelcomeHarborWorldView', () => {
  beforeEach(() => {
    getWorldStateMock.mockReset();
    recordCharacterMetMock.mockReset();
    saveCheckpointMock.mockReset();
    getInventoryMock.mockReset();
    listQuestStatesMock.mockReset();
    getCompanionProfileMock.mockReset();

    getWorldStateMock.mockResolvedValue({ discoveredIds: [], metCharacterIds: [] });
    recordCharacterMetMock.mockResolvedValue(undefined);
    saveCheckpointMock.mockResolvedValue(undefined);
    getInventoryMock.mockResolvedValue({ ownedItemIds: [], grantedRuleIds: [] });
    listQuestStatesMock.mockResolvedValue([]);
    getCompanionProfileMock.mockResolvedValue(null);
  });

  it('shows a loading state before its reads resolve', () => {
    getWorldStateMock.mockReturnValue(new Promise(() => {}));

    renderView();

    expect(screen.getByText(/loading welcome harbor/i)).toBeInTheDocument();
  });

  it('renders the 3D scene and HUD once ready', async () => {
    renderView();

    expect(await screen.findByText(/move: wasd or the arrow keys/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /backpack \(0\)/i })).toBeInTheDocument();
  });

  it('opens a conversation with Pip from the "Things to do here" list', async () => {
    const user = userEvent.setup();
    renderView();

    await user.click(await screen.findByRole('button', { name: /say hello to pip/i }));

    expect(await screen.findByTestId('npc-conversation')).toHaveTextContent('pirate-pip');
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

  it('offers a link back to the non-3D harbor', async () => {
    renderView();

    expect(await screen.findByRole('link', { name: /prefer not to walk in 3d/i })).toHaveAttribute(
      'href',
      '/island/child-1',
    );
  });
});
