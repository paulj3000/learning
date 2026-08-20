import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DragSortInteraction } from './DragSortInteraction';

const items = [
  { id: 'a', label: 'Alpha' },
  { id: 'b', label: 'Beta' },
  { id: 'c', label: 'Gamma' },
];

describe('DragSortInteraction', () => {
  it('renders items in the given order', () => {
    render(<DragSortInteraction prompt="Order them" items={items} disabled={false} onSubmit={vi.fn()} />);
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      expect.stringContaining('Alpha'),
      expect.stringContaining('Beta'),
      expect.stringContaining('Gamma'),
    ]);
  });

  it('moves an item up with the keyboard-accessible button', async () => {
    const user = userEvent.setup();
    render(<DragSortInteraction prompt="Order them" items={items} disabled={false} onSubmit={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /move gamma up/i }));

    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      expect.stringContaining('Alpha'),
      expect.stringContaining('Gamma'),
      expect.stringContaining('Beta'),
    ]);
  });

  it('disables moving the first item up and the last item down', () => {
    render(<DragSortInteraction prompt="Order them" items={items} disabled={false} onSubmit={vi.fn()} />);
    expect(screen.getByRole('button', { name: /move alpha up/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /move gamma down/i })).toBeDisabled();
  });

  it('submits the current order', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<DragSortInteraction prompt="Order them" items={items} disabled={false} onSubmit={onSubmit} />);

    await user.click(screen.getByRole('button', { name: /check my order/i }));

    expect(onSubmit).toHaveBeenCalledWith(['a', 'b', 'c']);
  });

  it('disables every control while submitting', () => {
    render(<DragSortInteraction prompt="Order them" items={items} disabled onSubmit={vi.fn()} />);
    expect(screen.getByRole('button', { name: /check my order/i })).toBeDisabled();
  });
});
