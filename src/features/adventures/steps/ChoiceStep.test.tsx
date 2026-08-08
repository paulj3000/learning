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

  it('renders one plank icon per plank for options with groups', () => {
    const plankOptions = [
      { id: 'a', label: '2 planks + 2 planks', groups: [2, 2] },
      { id: 'b', label: '1 plank + 2 planks', groups: [1, 2] },
    ];
    render(
      <ChoiceStep
        prompt="Pick a bundle"
        options={plankOptions}
        disabled={false}
        onSelect={vi.fn()}
      />,
    );

    const buttons = screen.getAllByRole('button');
    expect(buttons[0]?.querySelectorAll('rect')).toHaveLength(4);
    expect(buttons[1]?.querySelectorAll('rect')).toHaveLength(3);
  });

  it('keeps the label as the accessible name when plank icons are shown', () => {
    const plankOptions = [{ id: 'a', label: '2 planks + 2 planks', groups: [2, 2] }];
    render(
      <ChoiceStep
        prompt="Pick a bundle"
        options={plankOptions}
        disabled={false}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: '2 planks + 2 planks' })).toBeInTheDocument();
  });

  it('renders no plank icons for options without groups', () => {
    const { container } = render(
      <ChoiceStep prompt="Pick a bundle" options={options} disabled={false} onSelect={vi.fn()} />,
    );
    expect(container.querySelectorAll('svg')).toHaveLength(0);
  });
});
