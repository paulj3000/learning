import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CompanionBubble } from './CompanionBubble';
import type { CompanionTurnState } from './useCompanionTurn';

describe('CompanionBubble', () => {
  it('renders nothing while idle', () => {
    const { container } = render(<CompanionBubble state={{ status: 'idle' }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a thinking message while loading', () => {
    render(<CompanionBubble state={{ status: 'loading' }} />);
    expect(screen.getByText(/chatty is thinking/i)).toBeInTheDocument();
  });

  it('shows a calm message on error', () => {
    render(<CompanionBubble state={{ status: 'error' }} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/resting/i);
  });

  it('renders an AI-sourced turn', () => {
    const state: CompanionTurnState = {
      status: 'ready',
      source: 'AI',
      turn: {
        spokenText: 'Count the gaps in the bridge!',
        emotion: 'CURIOUS',
        intent: 'HINT',
        safetyDisposition: 'ALLOW',
      },
    };
    render(<CompanionBubble state={state} />);
    expect(screen.getByText('Count the gaps in the bridge!')).toBeInTheDocument();
  });

  it('renders a fallback turn identically to an AI turn', () => {
    const state: CompanionTurnState = {
      status: 'ready',
      source: 'FALLBACK',
      turn: {
        spokenText: 'Take a closer look. You can do this!',
        emotion: 'ENCOURAGING',
        intent: 'HINT',
        safetyDisposition: 'ALLOW',
      },
    };
    render(<CompanionBubble state={state} />);
    expect(screen.getByText('Take a closer look. You can do this!')).toBeInTheDocument();
  });

  it('renders allowed choices and calls onChoose', async () => {
    const onChoose = vi.fn();
    const user = userEvent.setup();
    const state: CompanionTurnState = {
      status: 'ready',
      source: 'AI',
      turn: {
        spokenText: 'Which plank goes first?',
        emotion: 'CURIOUS',
        intent: 'ASK',
        safetyDisposition: 'ALLOW',
        choices: [{ id: 'short', label: 'The short one' }],
      },
    };
    render(<CompanionBubble state={state} onChoose={onChoose} />);

    await user.click(screen.getByRole('button', { name: 'The short one' }));

    expect(onChoose).toHaveBeenCalledWith('short');
  });
});
