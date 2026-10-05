import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LocationWorldPage } from './LocationWorldPage';
import { LOCATION_WORLD_ROUTE } from '../features/island-map/three/runtime/locationWorldPath';

/**
 * The generic page's own job (engine Phase 6): resolve the child's age band
 * and hand the URL's region id to the generic view. The view is stubbed; it
 * is tested in `ThreeLocationWorldView.test.tsx`.
 */
vi.mock('../features/island-map/three/runtime/ThreeLocationWorldView', () => ({
  ThreeLocationWorldView: (props: { childId: string; regionId: string; ageBand: string }) => (
    <div data-testid="generic-view">{`${props.childId} ${props.regionId} ${props.ageBand}`}</div>
  ),
}));
vi.mock('../features/island/IslandLayout', () => ({
  IslandLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../features/child-profile/api', () => ({ getChildProfile: vi.fn() }));

import { getChildProfile } from '../features/child-profile/api';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={LOCATION_WORLD_ROUTE} element={<LocationWorldPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('LocationWorldPage', () => {
  beforeEach(() => {
    vi.mocked(getChildProfile).mockReset();
    vi.mocked(getChildProfile).mockResolvedValue({ id: 'child-1', ageBand: 'EXPLORER' } as never);
  });

  it('hands the URL’s region and the child’s age band to the generic view', async () => {
    renderAt('/island/child-1/explore/welcome-harbor');
    expect(await screen.findByTestId('generic-view')).toHaveTextContent(
      'child-1 welcome-harbor EXPLORER',
    );
  });

  it('serves any region through the same page (acceptance A1)', async () => {
    renderAt('/island/child-1/explore/test-explorer-cove');
    expect(await screen.findByTestId('generic-view')).toHaveTextContent(
      'child-1 test-explorer-cove EXPLORER',
    );
  });

  it('shows an error instead of the world for a missing profile', async () => {
    vi.mocked(getChildProfile).mockResolvedValue(null as never);
    renderAt('/island/child-1/explore/welcome-harbor');
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByTestId('generic-view')).not.toBeInTheDocument();
  });

  it('shows an error when the profile cannot be read', async () => {
    vi.mocked(getChildProfile).mockRejectedValue(new Error('offline'));
    renderAt('/island/child-1/explore/welcome-harbor');
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
