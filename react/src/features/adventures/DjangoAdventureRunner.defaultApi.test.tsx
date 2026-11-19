import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { parseStepView, type StepRunnerApi } from '../../api/play/stepRunnerApi';
import { read } from '../../api/parse';
import { viewJson } from '../../test/stepRunnerFixtures';

/**
 * Owner QA 2026-11-15 (critical): choosing "Help Pip carry planks to the bridge" on the signpost
 * opened the Adventure page, which looped forever. The session hook built its default API client
 * as a default parameter, a new object every render, so its start effect re-ran on every render
 * it caused. The page renders the runner without an `api`, exactly as here.
 */

const start = vi.fn();
const stepRunnerApiFor = vi.fn((_childId: string): StepRunnerApi => ({
  start,
  getStep: vi.fn(),
  submitAnswer: vi.fn(),
  requestHint: vi.fn(),
}));

vi.mock('../../api/play/stepRunnerApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/play/stepRunnerApi')>()),
  stepRunnerApiFor: (childId: string) => stepRunnerApiFor(childId),
}));

const { DjangoAdventureRunner } = await import('./DjangoAdventureRunner');

afterEach(() => {
  start.mockReset();
  stepRunnerApiFor.mockClear();
});

describe('DjangoAdventureRunner with the build’s own API', () => {
  it('starts the adventure once, not on every render', async () => {
    start.mockResolvedValue(read(viewJson(), parseStepView));
    const { rerender } = render(
      <MemoryRouter>
        <DjangoAdventureRunner
          childId="c1"
          adventureSlug="mend-bridge"
          backToMapHref="/island/c1"
        />
      </MemoryRouter>,
    );
    expect(await screen.findByText('How many planks?')).not.toBeNull();
    // A parent re-render (the layout, the router) must not restart it either.
    rerender(
      <MemoryRouter>
        <DjangoAdventureRunner
          childId="c1"
          adventureSlug="mend-bridge"
          backToMapHref="/island/c1"
        />
      </MemoryRouter>,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(start).toHaveBeenCalledTimes(1);
    expect(stepRunnerApiFor).toHaveBeenCalledTimes(1);
  });
});
