import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { WorldInteraction } from '../../worldObjects';

const { resumeOrStartSession } = vi.hoisted(() => ({
  resumeOrStartSession: vi.fn(async () => ({ id: 'session-1' })),
}));
vi.mock('../../../adventures/api', () => ({ resumeOrStartSession }));

import { WorldActionPanel } from './WorldActionPanel';

/**
 * ADR-041 return flow for the source-authored launch objects: an Adventure begun from a thing
 * in a 3D Area (`START_ADVENTURE`) ends back in that 3D Area.
 */

const START: WorldInteraction = {
  id: 'bay-bridge',
  type: 'OBJECT',
  trigger: 'TAP',
  title: 'The broken bridge',
  targetId: 'bridge',
  action: {
    kind: 'START_ADVENTURE',
    locationSlug: 'pirate-builder-bay',
    templateSlug: 'repair-the-moonlight-bridge',
  },
};

function Where() {
  const location = useLocation();
  return <p data-testid="where">{`${location.pathname}${location.search}`}</p>;
}

function renderPanel(regionId?: string) {
  return render(
    <MemoryRouter initialEntries={['/island/child-1/explore/pirate-builder-bay']}>
      <Routes>
        <Route
          path="/island/:childId/explore/:regionId"
          element={
            <WorldActionPanel
              childId="child-1"
              ageBand="PATHFINDER"
              interaction={START}
              onDismiss={vi.fn()}
              onDiscovered={vi.fn()}
              regionId={regionId}
            />
          }
        />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('starting an adventure from a 3D Area', () => {
  it('opens the adventure with a way back to this 3D Area', async () => {
    renderPanel('pirate-builder-bay');
    await userEvent.click(screen.getByRole('button', { name: 'Start the adventure' }));
    const where = await screen.findByTestId('where');
    const url = new URL(where.textContent ?? '', 'http://app');
    expect(url.pathname).toBe(
      '/island/child-1/locations/pirate-builder-bay/adventures/repair-the-moonlight-bridge',
    );
    expect(url.searchParams.get('returnTo')).toBe('/island/child-1/explore/pirate-builder-bay');
    expect(resumeOrStartSession).toHaveBeenCalledTimes(1);
  });

  it('opens it as before when no 3D Area is named', async () => {
    renderPanel();
    await userEvent.click(screen.getByRole('button', { name: 'Start the adventure' }));
    const where = await screen.findByTestId('where');
    expect(where.textContent).toBe(
      '/island/child-1/locations/pirate-builder-bay/adventures/repair-the-moonlight-bridge',
    );
  });
});
