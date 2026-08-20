import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConverseInteraction } from './ConverseInteraction';

const responses = [
  { id: 'kind', label: 'Ask kindly' },
  { id: 'demand', label: 'Demand it' },
];

describe('ConverseInteraction', () => {
  it('renders every response as a button', () => {
    render(
      <ConverseInteraction prompt="What do you say?" responses={responses} disabled={false} onSelect={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Ask kindly' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Demand it' })).toBeInTheDocument();
  });

  it('calls onSelect with the chosen response id', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <ConverseInteraction prompt="What do you say?" responses={responses} disabled={false} onSelect={onSelect} />,
    );

    await user.click(screen.getByRole('button', { name: 'Ask kindly' }));

    expect(onSelect).toHaveBeenCalledWith('kind');
  });

  it('disables every response while submitting', () => {
    render(<ConverseInteraction prompt="What do you say?" responses={responses} disabled onSelect={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Ask kindly' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Demand it' })).toBeDisabled();
  });
});
