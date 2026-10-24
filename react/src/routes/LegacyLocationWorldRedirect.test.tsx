import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { LegacyLocationWorldRedirect } from './LegacyLocationWorldRedirect';
import { LOCATION_WORLD_ROUTE } from '../features/island-map/three/runtime/locationWorldPath';

function WhereAmI() {
  const location = useLocation();
  return <p data-testid="where">{`${location.pathname}${location.search}`}</p>;
}

describe('LegacyLocationWorldRedirect', () => {
  it('sends an old per-region URL to the generic route, keeping the query string', () => {
    render(
      <MemoryRouter initialEntries={['/island/child-1/world/welcome-harbor-3d?from=bookmark']}>
        <Routes>
          <Route
            path="/island/:childId/world/welcome-harbor-3d"
            element={<LegacyLocationWorldRedirect regionId="welcome-harbor" />}
          />
          <Route path={LOCATION_WORLD_ROUTE} element={<WhereAmI />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId('where')).toHaveTextContent(
      '/island/child-1/explore/welcome-harbor?from=bookmark',
    );
  });
});
