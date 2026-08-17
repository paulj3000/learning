import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PirateBuilderBayWorldView } from './PirateBuilderBayWorldView';
import { listAllWorldChanges, resumeOrStartSession } from '../adventures/api';
import { getAdventureTemplate } from '../adventures/content';
import { REPAIR_THE_MOONLIGHT_BRIDGE } from '../adventures/content/repairTheMoonlightBridge';

vi.mock('phaser', () => ({
  default: { AUTO: 0, Scale: { FIT: 0, CENTER_BOTH: 0 } },
}));

vi.mock('./scenes/PirateBuilderBayScene', () => ({
  PirateBuilderBayScene: class {},
  WORLD_WIDTH: 960,
  WORLD_HEIGHT: 640,
}));

vi.mock('./PhaserGameContainer', () => ({
  PhaserGameContainer: () => <div data-testid="phaser-game-container" />,
}));

vi.mock('../adventures/api', () => ({
  listAllWorldChanges: vi.fn(),
  resumeOrStartSession: vi.fn(),
}));

vi.mock('../adventures/content', () => ({
  getAdventureTemplate: vi.fn(),
}));

const listAllWorldChangesMock = vi.mocked(listAllWorldChanges);
const resumeOrStartSessionMock = vi.mocked(resumeOrStartSession);
const getAdventureTemplateMock = vi.mocked(getAdventureTemplate);

function renderWorldView() {
  return render(
    <MemoryRouter initialEntries={['/island/child-1/world/pirate-builder-bay']}>
      <Routes>
        <Route
          path="/island/:childId/world/pirate-builder-bay"
          element={<PirateBuilderBayWorldView childId="child-1" avatarKey="FOX" />}
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
    getAdventureTemplateMock.mockReset();
  });

  it('shows a loading state before world changes resolve', async () => {
    listAllWorldChangesMock.mockReturnValue(new Promise(() => {}));

    renderWorldView();

    expect(screen.getByText(/loading pirate builder bay/i)).toBeInTheDocument();
  });

  it('lists every always-available interaction as an accessible alternative to walking', async () => {
    listAllWorldChangesMock.mockResolvedValue([]);

    renderWorldView();

    expect(await screen.findByText('The broken Moonlight Bridge')).toBeInTheDocument();
    expect(screen.getByText('Pirate Pip')).toBeInTheDocument();
    expect(screen.getByText('A coil of rope')).toBeInTheDocument();
    expect(screen.getByText("Pirate Pip's toolbox")).toBeInTheDocument();
    expect(screen.getByText('A hidden treasure chest')).toBeInTheDocument();
    expect(screen.getByText('The path back to Welcome Harbor')).toBeInTheDocument();
  });

  it('starts the real adventure session and navigates there from the accessible list', async () => {
    const user = userEvent.setup();
    listAllWorldChangesMock.mockResolvedValue([]);
    getAdventureTemplateMock.mockReturnValue(REPAIR_THE_MOONLIGHT_BRIDGE);
    resumeOrStartSessionMock.mockResolvedValue({
      id: 'session-1',
      currentStepId: REPAIR_THE_MOONLIGHT_BRIDGE.entryStepId,
    } as never);

    renderWorldView();
    await user.click(await screen.findByText('The broken Moonlight Bridge'));
    await user.click(screen.getByRole('button', { name: /start the adventure/i }));

    await waitFor(() => {
      expect(resumeOrStartSessionMock).toHaveBeenCalledWith('child-1', REPAIR_THE_MOONLIGHT_BRIDGE);
    });
    expect(await screen.findByText('Adventure route')).toBeInTheDocument();
  });

  it('offers the repaired-bridge narration instead of the adventure once the bridge is repaired', async () => {
    listAllWorldChangesMock.mockResolvedValue([{ changeKey: 'BRIDGE_REPAIRED' } as never]);

    renderWorldView();

    expect(await screen.findByText('The repaired Moonlight Bridge')).toBeInTheDocument();
    expect(screen.queryByText('The broken Moonlight Bridge')).not.toBeInTheDocument();
  });

  it('shows a plain message for a SHOW_MESSAGE interaction instead of trying to start a session', async () => {
    const user = userEvent.setup();
    listAllWorldChangesMock.mockResolvedValue([]);

    renderWorldView();
    await user.click(await screen.findByText('Pirate Pip'));

    expect(await screen.findByText(/ahoy/i)).toBeInTheDocument();
    expect(resumeOrStartSessionMock).not.toHaveBeenCalled();
  });

  it('dismisses the interaction panel without navigating', async () => {
    const user = userEvent.setup();
    listAllWorldChangesMock.mockResolvedValue([]);

    renderWorldView();
    await user.click(await screen.findByText('Pirate Pip'));
    await user.click(screen.getByRole('button', { name: /not now/i }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
