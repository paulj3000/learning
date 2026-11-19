import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enabledSummary } from './fixtures';

const h = vi.hoisted(() => ({ impl: (_id: string): Promise<unknown> => Promise.resolve(null), calls: [] as string[] }));
vi.mock('./api', () => ({
  getScoringSummary: (id: string) => {
    h.calls.push(id);
    return h.impl(id);
  },
}));

import { ParentProgressionPanel } from './ParentProgressionPanel';

beforeEach(() => {
  h.calls.length = 0;
});

describe('ParentProgressionPanel', () => {
  it('shows subjects, totals, results and the provisional notice', async () => {
    h.impl = () => Promise.resolve(enabledSummary());
    render(<ParentProgressionPanel childId="c1" />);
    expect(await screen.findByText(/Provisional development values/)).toBeInTheDocument();
    expect(screen.getByText(/Number sense: 4 skills, 1 proficient, 1 mastered/)).toBeInTheDocument();
    expect(screen.getByText('XP: 800')).toBeInTheDocument();
    expect(screen.getByText('Treasure rush cove')).toBeInTheDocument();
    expect(h.calls).toEqual(['c1']);
  });

  it('hides the notice when the policy is approved', async () => {
    h.impl = () => Promise.resolve(enabledSummary({ policy: { key: 'default', version: 4, provisional: false } }));
    render(<ParentProgressionPanel childId="c1" />);
    await screen.findByText('Progress and rewards');
    expect(screen.queryByText(/Provisional/)).toBeNull();
  });

  it('renders nothing when disabled', async () => {
    h.impl = () => Promise.resolve({ enabled: false, contractVersion: 1 });
    const { container } = render(<ParentProgressionPanel childId="c1" />);
    await vi.waitFor(() => expect(h.calls).toHaveLength(1));
    await vi.waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('shows a safe message on error', async () => {
    h.impl = () => Promise.reject(new TypeError('secret internals'));
    render(<ParentProgressionPanel childId="c1" />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Progress is not available right now.');
  });
});
