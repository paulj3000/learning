import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { OrderingStep } from './OrderingStep';

const items = [
  { id: 'medium-plank', label: 'Medium plank' },
  { id: 'long-plank', label: 'Long plank' },
  { id: 'short-plank', label: 'Short plank' },
];

describe('OrderingStep', () => {
  it('renders items in the given order', () => {
    render(
      <OrderingStep prompt="Order the planks" items={items} disabled={false} onSubmit={vi.fn()} />,
    );
    const rendered = screen.getAllByText(/plank$/).map((element) => element.textContent);
    expect(rendered).toEqual(['Medium plank', 'Long plank', 'Short plank']);
  });

  it('moves an item up and down', async () => {
    const user = userEvent.setup();
    render(
      <OrderingStep prompt="Order the planks" items={items} disabled={false} onSubmit={vi.fn()} />,
    );

    await user.click(screen.getByRole('button', { name: /move short plank up/i }));
    let rendered = screen.getAllByText(/plank$/).map((element) => element.textContent);
    expect(rendered).toEqual(['Medium plank', 'Short plank', 'Long plank']);

    await user.click(screen.getByRole('button', { name: /move medium plank down/i }));
    rendered = screen.getAllByText(/plank$/).map((element) => element.textContent);
    expect(rendered).toEqual(['Short plank', 'Medium plank', 'Long plank']);
  });

  it('disables moving the first item up and the last item down', () => {
    render(
      <OrderingStep prompt="Order the planks" items={items} disabled={false} onSubmit={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: /move medium plank up/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /move short plank down/i })).toBeDisabled();
  });

  it('submits the current order', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <OrderingStep prompt="Order the planks" items={items} disabled={false} onSubmit={onSubmit} />,
    );

    await user.click(screen.getByRole('button', { name: /check my order/i }));

    expect(onSubmit).toHaveBeenCalledWith(['medium-plank', 'long-plank', 'short-plank']);
  });
});
