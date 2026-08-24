import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ThreeSandboxWorldView } from './ThreeSandboxWorldView';

vi.mock('./sandboxScene', () => ({
  createSandboxEngine: vi.fn(() => ({ dispose: vi.fn(), interact: vi.fn() })),
}));

vi.mock('../../adventures/api', () => ({
  listAllWorldChanges: vi.fn(),
}));

vi.mock('../../rewards/api', () => ({
  getInventory: vi.fn(),
}));

vi.mock('../../discovery/api', () => ({
  getWorldState: vi.fn(),
  recordCharacterMet: vi.fn(),
}));

import { listAllWorldChanges } from '../../adventures/api';
import { getInventory } from '../../rewards/api';
import { getWorldState, recordCharacterMet } from '../../discovery/api';

const listAllWorldChangesMock = vi.mocked(listAllWorldChanges);
const getInventoryMock = vi.mocked(getInventory);
const getWorldStateMock = vi.mocked(getWorldState);
const recordCharacterMetMock = vi.mocked(recordCharacterMet);

describe('ThreeSandboxWorldView', () => {
  beforeEach(() => {
    listAllWorldChangesMock.mockReset();
    getInventoryMock.mockReset();
    getWorldStateMock.mockReset();
    recordCharacterMetMock.mockReset();
    listAllWorldChangesMock.mockResolvedValue([]);
    getInventoryMock.mockResolvedValue({ ownedItemIds: [], grantedRuleIds: [] });
    getWorldStateMock.mockResolvedValue({ discoveredIds: [], metCharacterIds: [] });
    recordCharacterMetMock.mockResolvedValue(undefined);
  });

  it('shows a loading state before context resolves', () => {
    listAllWorldChangesMock.mockReturnValue(new Promise(() => {}));

    render(<ThreeSandboxWorldView childId="child-1" />);

    expect(screen.getByText(/loading the sandbox/i)).toBeInTheDocument();
  });

  it('frames the sandbox as an early, unfinished preview, not a real location', async () => {
    render(<ThreeSandboxWorldView childId="child-1" />);

    expect(await screen.findByText(/early look, not a full adventure yet/i)).toBeInTheDocument();
  });

  it('offers a non-graphical way to say hello to Pip without the 3D scene', async () => {
    const user = userEvent.setup();
    render(<ThreeSandboxWorldView childId="child-1" />);

    await user.click(await screen.findByRole('button', { name: /say hello to pip/i }));

    expect(recordCharacterMetMock).toHaveBeenCalledWith('child-1', 'pirate-pip');
  });
});
