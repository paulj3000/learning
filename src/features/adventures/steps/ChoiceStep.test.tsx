import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ChoiceStep } from './ChoiceStep';

describe('ChoiceStep', () => {
  const options = [
    { id: 'a', label: 'Bundle A' },
    { id: 'b', label: 'Bundle B' },
  ];

  it('renders every option', () => {
    render(
      <ChoiceStep prompt="Pick a bundle" options={options} disabled={false} onSelect={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Bundle A' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bundle B' })).toBeInTheDocument();
  });

  it('calls onSelect with the chosen option id', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <ChoiceStep prompt="Pick a bundle" options={options} disabled={false} onSelect={onSelect} />,
    );

    await user.click(screen.getByRole('button', { name: 'Bundle B' }));

    expect(onSelect).toHaveBeenCalledWith('b');
  });

  it('disables every option while submitting', () => {
    render(<ChoiceStep prompt="Pick a bundle" options={options} disabled onSelect={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Bundle A' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Bundle B' })).toBeDisabled();
  });
});
