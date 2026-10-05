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

  it('keeps every migrated region’s own pre-generic URL working', async () => {
    // Each region's old URL becomes a redirect as it migrates (Phases 6, 7
    // and 9), so a bookmark or an old link never dead-ends.
    for (const [path, expected] of [
      ['/island/child-1/world/pirate-builder-bay-3d', 'child-1 pirate-builder-bay'],
      ['/island/child-1/world/wonderwild-forest-3d', 'child-1 wonderwild-forest'],
      ['/island/child-1/world/clockwork-harbor', 'child-1 clockwork-harbor'],
      ['/island/child-1/world/dragons-sanctuary', 'child-1 dragons-sanctuary'],
      ['/island/child-1/world/storykeeper-castle-3d', 'child-1 storykeeper-castle'],
    ] as const) {
      const view = renderAt(path);
      expect(await screen.findByTestId('location-world-page')).toHaveTextContent(expected);
      view.unmount();
    }
  });
});
