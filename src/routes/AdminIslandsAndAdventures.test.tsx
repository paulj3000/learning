import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const api = vi.hoisted(() => ({
  listIslands: vi.fn(),
  listAdventures: vi.fn(),
  listAdventuresByIsland: vi.fn(),
  getIsland: vi.fn(),
  getAdventure: vi.fn(),
  setIslandActive: vi.fn(),
  setAdventureActive: vi.fn(),
  createIsland: vi.fn(),
  updateIsland: vi.fn(),
  createAdventure: vi.fn(),
  updateAdventure: vi.fn(),
  importGameContent: vi.fn(),
  countModelsByAdventure: vi.fn(),
  getDeleteBlockReason: vi.fn(),
  deleteAdventure: vi.fn(),
  hasGameContent: vi.fn(),
  listModelsByAdventure: vi.fn(),
  listAssignableModels: vi.fn(),
  assignModel: vi.fn(),
  unassignModel: vi.fn(),
}));
vi.mock('../features/admin/catalogApi', () => api);

vi.mock('../features/auth/AuthContext', () => ({ useAuth: vi.fn() }));

import { useAuth } from '../features/auth/AuthContext';
import type { Adventure, Island } from '../features/admin/catalogApi';
import type { Asset } from '../features/assets/types';
import { AdminIslands } from './AdminIslands';
import { AdminIslandDetail } from './AdminIslandDetail';
import { AdminAdventures } from './AdminAdventures';
import { AdminAdventureDetail } from './AdminAdventureDetail';
import { AdminAdventureForm } from './AdminAdventureForm';
import { AdminIslandForm } from './AdminIslandForm';

const useAuthMock = vi.mocked(useAuth);

function signInAs(role: 'admin' | 'superuser') {
  useAuthMock.mockReturnValue({
    status: 'authenticated',
    userId: `${role}-1`,
    isAdmin: true,
    isSuperuser: role === 'superuser',
    refresh: vi.fn(),
    signOut: vi.fn(),
  });
}

function island(overrides: Partial<Island>): Island {
  return {
    id: 'dragons',
    slug: 'dragons-sanctuary',
    name: "Dragon's Sanctuary",
    shortDescription: 'A mountain hollow.',
    description: 'Home to a dragon who trusts you.',
    active: true,
    sortOrder: 10,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-02T00:00:00Z',
    ...overrides,
  } as Island;
}

function adventure(overrides: Partial<Adventure>): Adventure {
  return {
    id: 'egg',
    islandId: 'dragons',
    slug: 'the-lost-dragon-egg',
    name: 'The Lost Dragon Egg',
    shortDescription: 'Find the egg.',
    description: 'A long search through the caves for a lost egg.',
    active: true,
    sortOrder: 10,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-02T00:00:00Z',
    ...overrides,
  } as Adventure;
}

const DRAGONS = island({});
const CLOCKWORK = island({
  id: 'clockwork',
  slug: 'clockwork-harbor',
  name: 'Clockwork Harbor',
  active: false,
  sortOrder: 20,
});

function renderRoutes(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/islands" element={<AdminIslands />} />
        <Route path="/admin/islands/new" element={<AdminIslandForm />} />
        <Route path="/admin/islands/:islandId" element={<AdminIslandDetail />} />
        <Route path="/admin/islands/:islandId/adventures/new" element={<AdminAdventureForm />} />
        <Route path="/admin/adventures" element={<AdminAdventures />} />
        <Route path="/admin/adventures/:adventureId" element={<AdminAdventureDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  signInAs('admin');
  api.countModelsByAdventure.mockResolvedValue(new Map([['egg', 2]]));
  api.hasGameContent.mockReturnValue(false);
  api.listModelsByAdventure.mockResolvedValue([]);
  api.listAssignableModels.mockResolvedValue([]);
});

describe('AdminIslands', () => {
  it('lists active and inactive islands with adventure counts and links', async () => {
    api.listIslands.mockResolvedValue([DRAGONS, CLOCKWORK]);
    api.listAdventures.mockResolvedValue([adventure({}), adventure({ id: 'b' })]);
    renderRoutes('/admin/islands');

    const table = await screen.findByRole('table', { name: 'Islands' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Active');
    expect(rows[0]).toHaveTextContent('2');
    expect(rows[1]).toHaveTextContent('Inactive');
    expect(within(rows[1]!).getByRole('link', { name: 'Clockwork Harbor' })).toHaveAttribute(
      'href',
      '/admin/islands/clockwork',
    );
    expect(screen.getByRole('link', { name: 'Create Island' })).toHaveAttribute(
      'href',
      '/admin/islands/new',
    );
  });

  it('shows the empty state', async () => {
    api.listIslands.mockResolvedValue([]);
    api.listAdventures.mockResolvedValue([]);
    renderRoutes('/admin/islands');
    expect(await screen.findByText('No islands have been created yet.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create your first island.' })).toBeInTheDocument();
  });

  it('activates an inactive island', async () => {
    api.listIslands.mockResolvedValue([CLOCKWORK]);
    api.listAdventures.mockResolvedValue([]);
    api.setIslandActive.mockResolvedValue({ ...CLOCKWORK, active: true });
    const user = userEvent.setup();
    renderRoutes('/admin/islands');

    await user.click(await screen.findByRole('button', { name: 'Activate Clockwork Harbor' }));
    expect(api.setIslandActive).toHaveBeenCalledWith('clockwork', true, 'admin-1');
    expect(await screen.findByRole('status')).toHaveTextContent('Clockwork Harbor is now active.');
  });
});

describe('AdminIslandForm', () => {
  it('validates, creates, and opens the new island', async () => {
    api.listIslands.mockResolvedValue([DRAGONS]);
    api.createIsland.mockResolvedValue(island({ id: 'pirate', name: 'Pirate Bay' }));
    api.getIsland.mockResolvedValue(island({ id: 'pirate', name: 'Pirate Bay' }));
    api.listAdventuresByIsland.mockResolvedValue([]);
    const user = userEvent.setup();
    renderRoutes('/admin/islands/new');

    await user.click(await screen.findByRole('button', { name: 'Create island' }));
    expect(screen.getByText('Enter a name.')).toBeInTheDocument();
    expect(api.createIsland).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('Name'), 'Pirate Bay');
    expect(screen.getByLabelText('Slug')).toHaveValue('pirate-bay');
    await user.click(screen.getByRole('button', { name: 'Create island' }));

    expect(api.createIsland).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Pirate Bay',
        slug: 'pirate-bay',
        active: true,
        sortOrder: 20,
      }),
      'admin-1',
    );
    expect(await screen.findByRole('status')).toHaveTextContent('Created Pirate Bay.');
  });

  it('refuses a slug another island already uses', async () => {
    api.listIslands.mockResolvedValue([DRAGONS]);
    const user = userEvent.setup();
    renderRoutes('/admin/islands/new');

    await user.type(await screen.findByLabelText('Name'), "Dragon's Sanctuary");
    await user.click(screen.getByRole('button', { name: 'Create island' }));
    expect(screen.getByText('The slug "dragons-sanctuary" is already in use.')).toBeInTheDocument();
    expect(api.createIsland).not.toHaveBeenCalled();
  });
});

describe('AdminIslandDetail', () => {
  it("shows the island's description and only its own adventures, each linked", async () => {
    api.getIsland.mockResolvedValue(DRAGONS);
    api.listAdventuresByIsland.mockResolvedValue([
      adventure({}),
      adventure({ id: 'cavern', name: 'Cavern of Numbers', active: false }),
    ]);
    renderRoutes('/admin/islands/dragons');

    expect(await screen.findByText('Home to a dragon who trusts you.')).toBeInTheDocument();
    expect(api.listAdventuresByIsland).toHaveBeenCalledWith('dragons');
    const table = screen.getByRole('table', { name: "Adventures on Dragon's Sanctuary" });
    expect(within(table).getByRole('link', { name: 'The Lost Dragon Egg' })).toHaveAttribute(
      'href',
      '/admin/adventures/egg',
    );
    expect(within(table).getByRole('link', { name: 'Cavern of Numbers' })).toHaveAttribute(
      'href',
      '/admin/adventures/cavern',
    );
    expect(screen.getByRole('link', { name: 'Create Adventure' })).toHaveAttribute(
      'href',
      '/admin/islands/dragons/adventures/new',
    );
  });

  it('shows the no-adventures empty state and deactivates the island', async () => {
    api.getIsland.mockResolvedValue(DRAGONS);
    api.listAdventuresByIsland.mockResolvedValue([]);
    api.setIslandActive.mockResolvedValue({ ...DRAGONS, active: false });
    const user = userEvent.setup();
    renderRoutes('/admin/islands/dragons');

    expect(
      await screen.findByText('No adventures have been created for this island yet.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Deactivate Island' }));
    expect(api.setIslandActive).toHaveBeenCalledWith('dragons', false, 'admin-1');
    expect(await screen.findByRole('status')).toHaveTextContent(/is inactive/);
  });
});

describe('AdminAdventureForm from an island', () => {
  it('preselects the island and creates the adventure under it', async () => {
    api.listIslands.mockResolvedValue([DRAGONS, CLOCKWORK]);
    api.listAdventures.mockResolvedValue([]);
    api.createAdventure.mockResolvedValue(adventure({ id: 'new', name: 'Flight School' }));
    api.getAdventure.mockResolvedValue(adventure({ id: 'new', name: 'Flight School' }));
    api.getIsland.mockResolvedValue(DRAGONS);
    const user = userEvent.setup();
    renderRoutes('/admin/islands/dragons/adventures/new');

    expect(await screen.findByLabelText('Island')).toHaveValue('dragons');
    await user.type(screen.getByLabelText('Adventure name'), 'Flight School');
    await user.click(screen.getByRole('button', { name: 'Create adventure' }));

    expect(api.createAdventure).toHaveBeenCalledWith(
      expect.objectContaining({ islandId: 'dragons', slug: 'flight-school' }),
      'admin-1',
    );
    expect(await screen.findByRole('status')).toHaveTextContent('Created Flight School.');
  });
});

describe('AdminAdventures', () => {
  it('lists every adventure with its island and filters by status', async () => {
    api.listIslands.mockResolvedValue([DRAGONS, CLOCKWORK]);
    api.listAdventures.mockResolvedValue([
      adventure({}),
      adventure({ id: 'gears', islandId: 'clockwork', name: 'Gear Trouble', active: false }),
    ]);
    const user = userEvent.setup();
    renderRoutes('/admin/adventures');

    const table = await screen.findByRole('table', { name: 'Adventures' });
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(within(table).getByRole('link', { name: 'Gear Trouble' })).toHaveAttribute(
      'href',
      '/admin/adventures/gears',
    );

    await user.selectOptions(screen.getByLabelText('Status'), 'inactive');
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    expect(within(table).queryByText('The Lost Dragon Egg')).toBeNull();
  });
});

describe('AdminAdventureDetail', () => {
  const model = {
    assignment: { id: 'am-1', adventureId: 'egg', assetId: 'asset-1', role: 'NPC', sortOrder: 10 },
    asset: { id: 'asset-1', name: 'Dragon Elder', category: 'CREATURE', status: 'DRAFT' } as Asset,
  };

  beforeEach(() => {
    api.getAdventure.mockResolvedValue(adventure({}));
    api.getIsland.mockResolvedValue(DRAGONS);
  });

  it('shows the description, a link to its island, and its models', async () => {
    api.listModelsByAdventure.mockResolvedValue([model]);
    renderRoutes('/admin/adventures/egg');

    expect(
      await screen.findByText('A long search through the caves for a lost egg.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: "Dragon's Sanctuary" })).toHaveAttribute(
      'href',
      '/admin/islands/dragons',
    );
    const models = await screen.findByRole('table', { name: 'Adventure models' });
    expect(within(models).getByText('Dragon Elder')).toBeInTheDocument();
    expect(within(models).getByText('NPC')).toBeInTheDocument();
    expect(within(models).getByText('Draft')).toBeInTheDocument();
  });

  it('shows the no-models empty state', async () => {
    renderRoutes('/admin/adventures/egg');
    expect(
      await screen.findByText('No models are currently assigned to this adventure.'),
    ).toBeInTheDocument();
  });

  it('deactivates the adventure', async () => {
    api.setAdventureActive.mockResolvedValue(adventure({ active: false }));
    const user = userEvent.setup();
    renderRoutes('/admin/adventures/egg');

    await user.click(await screen.findByRole('button', { name: 'Deactivate' }));
    expect(api.setAdventureActive).toHaveBeenCalledWith('egg', false, 'admin-1');
  });

  it('warns when the adventure is active but its island is not', async () => {
    api.getIsland.mockResolvedValue({ ...DRAGONS, active: false });
    renderRoutes('/admin/adventures/egg');
    expect(await screen.findByText(/its island is inactive/)).toBeInTheDocument();
  });

  it('does not offer Delete to a normal admin', async () => {
    renderRoutes('/admin/adventures/egg');
    await screen.findByText('A long search through the caves for a lost egg.');
    expect(screen.queryByRole('button', { name: 'Delete Adventure' })).toBeNull();
  });

  it('lets a superuser delete only after confirming', async () => {
    signInAs('superuser');
    api.getDeleteBlockReason.mockResolvedValue(null);
    api.deleteAdventure.mockResolvedValue(undefined);
    api.listAdventuresByIsland.mockResolvedValue([]);
    const user = userEvent.setup();
    renderRoutes('/admin/adventures/egg');

    await user.click(await screen.findByRole('button', { name: 'Delete Adventure' }));
    expect(api.deleteAdventure).not.toHaveBeenCalled();
    const dialog = screen.getByRole('alertdialog', { name: 'Delete Adventure?' });
    expect(dialog).toHaveTextContent('You are about to delete "The Lost Dragon Egg".');

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(api.deleteAdventure).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Delete Adventure' }));
    const confirm = await within(screen.getByRole('alertdialog')).findByRole('button', {
      name: 'Delete Adventure',
    });
    await vi.waitFor(() => expect(confirm).toBeEnabled());
    await user.click(confirm);
    expect(api.deleteAdventure).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('status')).toHaveTextContent('Deleted The Lost Dragon Egg.');
  });

  it('blocks a superuser from deleting an adventure children have played', async () => {
    signInAs('superuser');
    api.getDeleteBlockReason.mockResolvedValue('Children have played this adventure (2 sessions).');
    const user = userEvent.setup();
    renderRoutes('/admin/adventures/egg');

    await user.click(await screen.findByRole('button', { name: 'Delete Adventure' }));
    const dialog = screen.getByRole('alertdialog');
    expect(await within(dialog).findByText(/2 sessions/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Delete Adventure' })).toBeDisabled();
    expect(api.deleteAdventure).not.toHaveBeenCalled();
  });
});
