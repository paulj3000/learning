import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DecodeInteraction } from './DecodeInteraction';

const prompts = [
  { id: 'b', label: 'b' },
  { id: 'c', label: 'c' },
];
const choices = [
  { id: 'buh', label: '/buh/' },
  { id: 'kuh', label: '/kuh/' },
];

describe('DecodeInteraction', () => {
  it('renders one select per prompt', () => {
    render(
      <DecodeInteraction
        prompt="Match the letter to its sound"
        prompts={prompts}
        choices={choices}
        disabled={false}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('b')).toBeInTheDocument();
    expect(screen.getByLabelText('c')).toBeInTheDocument();
  });

  it('keeps submit disabled until every prompt has a selection', async () => {
    const user = userEvent.setup();
    render(
      <DecodeInteraction
        prompt="Match the letter to its sound"
        prompts={prompts}
        choices={choices}
        disabled={false}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /check my matches/i })).toBeDisabled();
    await user.selectOptions(screen.getByLabelText('b'), 'buh');
    expect(screen.getByRole('button', { name: /check my matches/i })).toBeDisabled();
    await user.selectOptions(screen.getByLabelText('c'), 'kuh');
    expect(screen.getByRole('button', { name: /check my matches/i })).toBeEnabled();
  });

  it('submits every prompt-answer match', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <DecodeInteraction
        prompt="Match the letter to its sound"
        prompts={prompts}
        choices={choices}
        disabled={false}
        onSubmit={onSubmit}
      />,
    );

    await user.selectOptions(screen.getByLabelText('b'), 'buh');
    await user.selectOptions(screen.getByLabelText('c'), 'kuh');
    await user.click(screen.getByRole('button', { name: /check my matches/i }));

    expect(onSubmit).toHaveBeenCalledWith([
      { promptId: 'b', answerId: 'buh' },
      { promptId: 'c', answerId: 'kuh' },
    ]);
  });
});
