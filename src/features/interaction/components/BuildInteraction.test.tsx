import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BuildInteraction } from './BuildInteraction';

const pieces = [
  { id: 'wheel', label: 'Wheel' },
  { id: 'axle', label: 'Axle' },
  { id: 'sail', label: 'Sail' },
];

describe('BuildInteraction', () => {
  it('renders every available piece as a toggle button', () => {
    render(<BuildInteraction prompt="Build the cart" availablePieces={pieces} disabled={false} onSubmit={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Wheel' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('toggles a piece on and off', async () => {
    const user = userEvent.setup();
    render(<BuildInteraction prompt="Build the cart" availablePieces={pieces} disabled={false} onSubmit={vi.fn()} />);

    const wheel = screen.getByRole('button', { name: 'Wheel' });
    await user.click(wheel);
    expect(wheel).toHaveAttribute('aria-pressed', 'true');
    await user.click(wheel);
    expect(wheel).toHaveAttribute('aria-pressed', 'false');
  });

  it('keeps submit disabled until at least one piece is selected', async () => {
    const user = userEvent.setup();
    render(<BuildInteraction prompt="Build the cart" availablePieces={pieces} disabled={false} onSubmit={vi.fn()} />);

    expect(screen.getByRole('button', { name: /build it/i })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Wheel' }));
    expect(screen.getByRole('button', { name: /build it/i })).toBeEnabled();
  });

  it('submits every selected piece id', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<BuildInteraction prompt="Build the cart" availablePieces={pieces} disabled={false} onSubmit={onSubmit} />);

    await user.click(screen.getByRole('button', { name: 'Wheel' }));
    await user.click(screen.getByRole('button', { name: 'Axle' }));
    await user.click(screen.getByRole('button', { name: /build it/i }));

    expect(onSubmit).toHaveBeenCalledWith(['wheel', 'axle']);
  });
});
