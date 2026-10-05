import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WelcomeHarborWorldPage } from './WelcomeHarborWorldPage';

/**
 * The page's own job: resolve the child's age band and hand Welcome Harbor's
 * region id to the generic view (engine Phase 5). The view is stubbed; it is
 * tested in `ThreeLocationWorldView.test.tsx` and, for this region's
 * behaviour, `welcomeHarborParity.test.tsx`.
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

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/island/child-1/world/welcome-harbor-3d']}>
      <Routes>
        <Route
          path="/island/:childId/world/welcome-harbor-3d"
          element={<WelcomeHarborWorldPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('WelcomeHarborWorldPage', () => {
  beforeEach(() => {
    vi.mocked(getChildProfile).mockReset();
  });

  it('renders Welcome Harbor through the generic location view with the child’s age band', async () => {
    vi.mocked(getChildProfile).mockResolvedValue({ id: 'child-1', ageBand: 'EXPLORER' } as never);
    renderPage();
    expect(await screen.findByTestId('generic-view')).toHaveTextContent(
      'child-1 welcome-harbor EXPLORER',
    );
  });

  it('shows an error instead of the world when the profile does not exist', async () => {
    vi.mocked(getChildProfile).mockResolvedValue(null as never);
    renderPage();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByTestId('generic-view')).not.toBeInTheDocument();
  });
});
