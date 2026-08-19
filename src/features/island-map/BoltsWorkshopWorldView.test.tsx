import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { BoltsWorkshopWorldView } from './BoltsWorkshopWorldView';
import { listAllWorldChanges } from '../adventures/api';

vi.mock('phaser', () => ({
  default: { AUTO: 0, Scale: { FIT: 0, CENTER_BOTH: 0 } },
}));

vi.mock('./scenes/BoltsWorkshopScene', () => ({
  BoltsWorkshopScene: class {},
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

function renderWorldView() {
  return render(
    <MemoryRouter initialEntries={['/island/child-1/world/bolts-workshop']}>
      <Routes>
        <Route
          path="/island/:childId/world/bolts-workshop"
          element={<BoltsWorkshopWorldView childId="child-1" avatarKey="FOX" />}
        />
        <Route path="/island/:childId" element={<p>Map route</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('BoltsWorkshopWorldView', () => {
  beforeEach(() => {
    listAllWorldChangesMock.mockReset();
  });

  it('shows a loading state before world changes resolve', () => {
    listAllWorldChangesMock.mockReturnValue(new Promise(() => {}));

    renderWorldView();

    expect(screen.getByText(/loading bolt's workshop/i)).toBeInTheDocument();
  });

  it('shows a calm not-discovered-yet message when the story has not been completed', async () => {
    listAllWorldChangesMock.mockResolvedValue([]);

    renderWorldView();

    expect(await screen.findByText(/has not been discovered yet/i)).toBeInTheDocument();
    expect(screen.queryByTestId('phaser-game-container')).not.toBeInTheDocument();
  });

  it('lets a not-yet-unlocked child navigate back to the map', async () => {
    const user = userEvent.setup();
    listAllWorldChangesMock.mockResolvedValue([]);

    renderWorldView();
    await user.click(await screen.findByText(/back to the map/i));

    expect(await screen.findByText('Map route')).toBeInTheDocument();
  });

  it('renders the scene and every always-available interaction once the story is complete', async () => {
    listAllWorldChangesMock.mockResolvedValue([{ changeKey: 'ROBOT_RESCUE_COMPLETE' } as never]);

    renderWorldView();

    expect(await screen.findByTestId('phaser-game-container')).toBeInTheDocument();
    expect(screen.getByText('Bolt')).toBeInTheDocument();
    expect(screen.getByText("Bolt's spare parts")).toBeInTheDocument();
    expect(screen.getByText('The path back to Welcome Harbor')).toBeInTheDocument();
  });

  it('shows a plain message for tapping Bolt instead of trying to start a session', async () => {
    const user = userEvent.setup();
    listAllWorldChangesMock.mockResolvedValue([{ changeKey: 'ROBOT_RESCUE_COMPLETE' } as never]);

    renderWorldView();
    await user.click(await screen.findByText('Bolt'));

    expect(await screen.findByText(/cheerful hello/i)).toBeInTheDocument();
  });
});
