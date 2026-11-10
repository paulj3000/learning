import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { DjangoAdventureRunner } from './DjangoAdventureRunner';
import type { StepRunnerApi } from '../../api/play/stepRunnerApi';
import { parseStepView, parseVerdict } from '../../api/play/stepRunnerApi';
import { read } from '../../api/parse';
import { sessionJson, viewJson } from '../../test/stepRunnerFixtures';

const verdictJson = (overrides: Record<string, unknown> = {}) => ({
  correctness: 'CORRECT',
  supportLevel: 0,
  action: 'ADVANCE',
  nextStepId: 'done',
  replayed: false,
  session: sessionJson({ status: 'COMPLETED', currentStepId: 'done' }),
  worldChangeKeys: [],
  completion: {
    rewards: [{ ruleId: 'r', message: 'You mended the bridge!', granted: true, newItemIds: [] }],
    questsCompleted: [],
  },
  ...overrides,
});

const doneView = viewJson({
  session: sessionJson({ status: 'COMPLETED', currentStepId: 'done' }),
  step: {
    id: 'done',
    type: 'COMPLETE',
    objectiveIds: [],
    presentation: { kind: 'complete', text: 'Well done, builder!' },
    hasHints: false,
  },
  created: undefined,
});

function fakeApi(overrides: Partial<StepRunnerApi> = {}): StepRunnerApi {
  return {
    start: vi.fn().mockResolvedValue(read(viewJson(), parseStepView)),
    getStep: vi.fn().mockResolvedValue(read(doneView, parseStepView)),
    submitAnswer: vi.fn().mockResolvedValue(read(verdictJson(), parseVerdict)),
    requestHint: vi.fn().mockResolvedValue({ hintLevel: 1, hintText: 'Count the planks.' }),
    ...overrides,
  };
}

function renderRunner(api: StepRunnerApi, onComplete?: () => void) {
  return render(
    <MemoryRouter>
      <DjangoAdventureRunner
        childId="c1"
        adventureSlug="mend-bridge"
        backToMapHref="/island/c1"
        api={api}
        onComplete={onComplete}
      />
    </MemoryRouter>,
  );
}

describe('DjangoAdventureRunner (LAI-0816)', () => {
  it('starts the adventure on the server and shows the first step', async () => {
    const api = fakeApi();
    renderRunner(api);
    expect(screen.getByText(/loading your adventure/i)).not.toBeNull();
    expect(await screen.findByText('How many planks?')).not.toBeNull();
    expect(api.start).toHaveBeenCalledWith('mend-bridge', expect.anything());
  });

  it('sends the answer, shows only what the server decides, and fires onComplete once', async () => {
    const api = fakeApi();
    const onComplete = vi.fn();
    const user = userEvent.setup();
    renderRunner(api, onComplete);

    await screen.findByText('How many planks?');
    await user.type(screen.getByRole('spinbutton'), '3');
    await user.click(screen.getByRole('button', { name: /check|submit|answer|done/i }));

    expect(await screen.findByText('Well done, builder!')).not.toBeNull();
    expect(api.submitAnswer).toHaveBeenCalledWith(
      expect.any(String),
      'count',
      { kind: 'number-input', value: 3 },
      expect.stringMatching(/[0-9a-f-]{36}/),
    );
    expect(api.getStep).toHaveBeenCalled();
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
  });

  it('asks the server for a hint and shows the text it returns', async () => {
    const api = fakeApi();
    const user = userEvent.setup();
    renderRunner(api);
    await screen.findByText('How many planks?');
    await user.click(screen.getByRole('button', { name: /need a hint/i }));
    expect(await screen.findByText('Count the planks.')).not.toBeNull();
    expect(api.requestHint).toHaveBeenCalledWith(expect.any(String), 'count', 0);
  });

  it('shows a calm message, not a stack trace, when the server cannot be reached', async () => {
    renderRunner(fakeApi({ start: vi.fn().mockRejectedValue(new Error('boom')) }));
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /could not open this adventure/i,
    );
    expect(screen.queryByText(/boom/)).toBeNull();
  });

  it('keeps the step and says so calmly when an answer fails to send', async () => {
    const api = fakeApi({ submitAnswer: vi.fn().mockRejectedValue(new Error('offline')) });
    const user = userEvent.setup();
    renderRunner(api);
    await screen.findByText('How many planks?');
    await user.type(screen.getByRole('spinbutton'), '3');
    await user.click(screen.getByRole('button', { name: /check|submit|answer|done/i }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/try that again/i);
    expect(screen.getByText('How many planks?')).not.toBeNull();
  });
});
