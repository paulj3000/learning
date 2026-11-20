import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { CastleSessionLoading, CastleSessionUnavailable } from './CastleSessionStatus';

describe('castle story panel states (SC-R12 child-facing states)', () => {
  it('announces opening politely', () => {
    render(<CastleSessionLoading message="Opening your story..." />);
    expect(screen.getByRole('status')).toHaveTextContent('Opening your story...');
  });

  it('never leaves a child at a dead end when a story cannot open', () => {
    render(
      <MemoryRouter>
        <CastleSessionUnavailable
          message="Something went wrong opening your story."
          backToMapHref="/island/child-1"
        />
      </MemoryRouter>,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Something went wrong opening your story.');
    expect(alert.textContent).not.toMatch(/—/);
    expect(screen.getByRole('link', { name: 'Back to the map' })).toHaveAttribute(
      'href',
      '/island/child-1',
    );
  });
});
