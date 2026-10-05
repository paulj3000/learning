import { render, screen } from '@testing-library/react';
import { MemoryRouter, useParams } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AppRoutes } from './AppRoutes';

/**
 * The real route table's wiring for engine Phase 6: the generic 3D route
 * reaches the generic page, and the pre-Phase-6 Welcome Harbor URL lands on
 * it too. Auth and the page are stubbed; each is tested on its own.
 */
vi.mock('../features/auth/RequireParent', () => ({
  RequireParent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../routes/LocationWorldPage', () => ({
  LocationWorldPage: () => {
    const { childId, regionId } = useParams();
    return <p data-testid="location-world-page">{`${childId} ${regionId}`}</p>;
  },
}));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

describe('AppRoutes: manifest-driven 3D locations', () => {
  it('routes /island/:childId/explore/:regionId to the generic page', async () => {
    renderAt('/island/child-1/explore/welcome-harbor');
    expect(await screen.findByTestId('location-world-page')).toHaveTextContent(
      'child-1 welcome-harbor',
    );
  });

  it('keeps the old Welcome Harbor 3D URL working', async () => {
    renderAt('/island/child-1/world/welcome-harbor-3d');
    expect(await screen.findByTestId('location-world-page')).toHaveTextContent(
      'child-1 welcome-harbor',
    );
  });
});
