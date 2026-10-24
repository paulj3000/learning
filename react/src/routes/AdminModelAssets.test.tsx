import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const { listModelAssets } = vi.hoisted(() => ({ listModelAssets: vi.fn() }));

vi.mock('../features/assets/assetService', () => ({ listModelAssets }));

import { AdminModelAssets } from './AdminModelAssets';
import type { Asset } from '../features/assets/types';

function asset(overrides: Partial<Asset>): Asset {
  return {
    id: 'a',
    name: 'Rock',
    category: 'PROP',
    status: 'DRAFT',
    currentVersion: 1,
    fileSize: 2048,
    worldId: null,
    regionId: null,
    updatedAt: '2026-09-01T00:00:00Z',
    ...overrides,
  } as Asset;
}

function renderPage(state?: unknown) {
  render(
    <MemoryRouter initialEntries={[{ pathname: '/admin/assets/models', state }]}>
      <AdminModelAssets />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AdminModelAssets', () => {
  it('lists models newest first with their category, place, status, version, and size', async () => {
    listModelAssets.mockResolvedValue([
      asset({ id: 'old', name: 'Old Rock', updatedAt: '2026-01-01T00:00:00Z' }),
      asset({
        id: 'new',
        name: 'Rowing Boat',
        category: 'VEHICLE',
        worldId: 'learning-adventure-island',
        regionId: 'pirate-builder-bay',
        currentVersion: 3,
        fileSize: 15_518_924,
        updatedAt: '2026-09-01T00:00:00Z',
      }),
    ]);
    renderPage();

    const table = await screen.findByRole('table', { name: 'Uploaded models' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((row) => within(row).getByRole('rowheader').textContent)).toEqual([
      'Rowing Boat',
      'Old Rock',
    ]);
    expect(rows[0]).toHaveTextContent('Vehicle');
    expect(rows[0]).toHaveTextContent('Learning Adventure Island / Pirate Builder Bay');
    expect(rows[0]).toHaveTextContent('Draft');
    expect(rows[0]).toHaveTextContent('v3');
    expect(rows[0]).toHaveTextContent('14.8 MB');
    expect(rows[1]).toHaveTextContent('Any world');
  });

  it('shows an empty state', async () => {
    listModelAssets.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('No models have been uploaded yet.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Upload a model' })).toHaveAttribute(
      'href',
      '/admin/assets/models/new',
    );
  });

  it('shows an error with a retry', async () => {
    listModelAssets.mockRejectedValueOnce(new Error('Unauthorized')).mockResolvedValueOnce([]);
    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No models have been uploaded yet.')).toBeInTheDocument();
  });

  it('confirms a just-finished upload as a draft that children cannot see', async () => {
    listModelAssets.mockResolvedValue([]);
    renderPage({ uploadedName: 'Rowing Boat' });
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Uploaded "Rowing Boat" as a draft. It is not visible to children.',
    );
  });
});
