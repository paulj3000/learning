import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Link } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { PortalButton, PortalCard, ProgressIndicator, normalizeProgress } from './index';

describe('PortalButton', () => {
  it('is a real button that never submits a form by accident', async () => {
    const onSubmit = vi.fn((event: SubmitEvent) => event.preventDefault());
    const onClick = vi.fn();
    render(
      <form onSubmit={(event) => onSubmit(event.nativeEvent as SubmitEvent)}>
        <PortalButton onClick={onClick}>Sail</PortalButton>
      </form>,
    );
    const button = screen.getByRole('button', { name: 'Sail' });
    expect(button).toHaveAttribute('type', 'button');
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('meets the 48px touch floor at every size', () => {
    render(
      <>
        <PortalButton>Medium</PortalButton>
        <PortalButton size="lg">Large</PortalButton>
      </>,
    );
    expect(screen.getByRole('button', { name: 'Medium' }).className).toContain('min-h-12');
    expect(screen.getByRole('button', { name: 'Large' }).className).toContain('min-h-14');
  });

  it('keeps the visible focus ring (no outline-none)', () => {
    render(<PortalButton tone="treasure">Gold</PortalButton>);
    expect(screen.getByRole('button', { name: 'Gold' }).className).not.toContain('outline-none');
  });

  it('stays a link when rendered asChild', () => {
    render(
      <MemoryRouter>
        <PortalButton asChild tone="tropical">
          <Link to="/island/child-1">Go</Link>
        </PortalButton>
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: 'Go' });
    expect(link).toHaveAttribute('href', '/island/child-1');
    expect(link.className).toContain('bg-tropical-700');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('lets a caller override a default class', () => {
    render(<PortalButton className="px-2">Tight</PortalButton>);
    const { className } = screen.getByRole('button', { name: 'Tight' });
    expect(className).toContain('px-2');
    expect(className).not.toContain('px-5');
  });
});

describe('PortalCard', () => {
  it('renders the chosen landmark element with its tone', () => {
    render(
      <PortalCard as="section" aria-label="Quest" tone="purple">
        Hi
      </PortalCard>,
    );
    const card = screen.getByRole('region', { name: 'Quest' });
    expect(card.className).toContain('bg-purple-50');
  });
});

describe('ProgressIndicator', () => {
  it('exposes its numbers and says them in words', () => {
    render(<ProgressIndicator label="Bridge repair" value={2} max={5} />);
    const bar = screen.getByRole('progressbar', { name: 'Bridge repair' });
    expect(bar).toHaveAttribute('aria-valuenow', '2');
    expect(bar).toHaveAttribute('aria-valuemax', '5');
    expect(bar).toHaveAttribute('aria-valuetext', '2 of 5 steps');
    expect(screen.getByText('2 of 5 steps')).toBeInTheDocument();
  });

  it('never shows a percentage or score', () => {
    render(<ProgressIndicator label="Story" value={1} max={4} />);
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it.each([
    [3, 2, { value: 2, max: 2 }],
    [-1, 4, { value: 0, max: 4 }],
    [Number.NaN, 4, { value: 0, max: 4 }],
    [1, 0, { value: 0, max: 0 }],
    [1.6, 3.2, { value: 2, max: 3 }],
  ])('normalises %s of %s', (value, max, expected) => {
    expect(normalizeProgress(value, max)).toEqual(expected);
  });
});
