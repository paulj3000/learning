import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { openChoiceState, recordChoiceResult, selectOption } from '../../../../../region-play/areaPuzzleUi';
import {
  parsePuzzleParams,
  type ChooseAnswerParams,
  type OrderSequenceParams,
} from '../../../../../region-play/areaPuzzles';
import { CHOOSE_PARAMS, ORDER_PARAMS } from '../../../../../../test/choicePuzzleFixtures';
import { ChooseAnswerPanel, OrderSequencePanel } from './AreaPuzzlePanels';

const choose = parsePuzzleParams('CHOOSE_ANSWER', CHOOSE_PARAMS) as ChooseAnswerParams;
const order = parsePuzzleParams('ORDER_SEQUENCE', ORDER_PARAMS) as OrderSequenceParams;

function chooseProps(overrides: Partial<Parameters<typeof ChooseAnswerPanel>[0]> = {}) {
  return {
    title: 'Lava stones',
    params: choose,
    state: { ...openChoiceState('s', 'p', choose, false), variantIndex: 0 },
    busy: false,
    onSelect: vi.fn(),
    onDifferent: vi.fn(),
    onSubmit: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

describe('ChooseAnswerPanel', () => {
  it('reads the prompt and offers every option as a button with a symbol and a label', () => {
    render(<ChooseAnswerPanel {...chooseProps()} />);
    expect(screen.getByText('What is 3 + 4?')).toBeInTheDocument();
    const seven = screen.getByRole('button', { name: 'star, 7' });
    expect(seven.tagName).toBe('BUTTON');
    expect(seven).toHaveTextContent('★');
    expect(screen.getByRole('button', { name: 'circle, 6' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'moon, 8' })).toBeInTheDocument();
  });

  it('selects an option and only checks it on request', async () => {
    const props = chooseProps();
    const { rerender } = render(<ChooseAnswerPanel {...props} />);
    const check = screen.getByRole('button', { name: 'Check my answer' });
    expect(check).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'star, 7' }));
    expect(props.onSelect).toHaveBeenCalledWith('b');
    rerender(<ChooseAnswerPanel {...props} state={selectOption(props.state, 'b')} />);
    expect(screen.getByRole('button', { name: 'star, 7' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Check my answer' }));
    expect(props.onSubmit).toHaveBeenCalled();
  });

  it('answers a wrong try kindly, keeps the question and shows no answer', () => {
    const state = recordChoiceResult(selectOption(chooseProps().state, 'a'), false);
    render(<ChooseAnswerPanel {...chooseProps({ state })} />);
    expect(screen.getByText('Not quite. Let us look again!')).toBeInTheDocument();
    expect(screen.getByText('What is 3 + 4?')).toBeInTheDocument();
    expect(screen.queryByText(/together make 7/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Count up from 4/)).not.toBeInTheDocument();
  });

  it('shows the hint after hintAfterAttempts wrong tries, or on request', async () => {
    let state = chooseProps().state;
    state = recordChoiceResult(recordChoiceResult(state, false), false);
    const { unmount } = render(<ChooseAnswerPanel {...chooseProps({ state })} />);
    expect(screen.getByText(/Count up from 4/)).toBeInTheDocument();
    unmount();
    render(<ChooseAnswerPanel {...chooseProps()} />);
    expect(screen.queryByText(/Count up from 4/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'I would like a hint' }));
    expect(screen.getByText(/Count up from 4/)).toBeInTheDocument();
  });

  it('offers a different one', async () => {
    const props = chooseProps();
    render(<ChooseAnswerPanel {...props} />);
    await userEvent.click(screen.getByRole('button', { name: 'Try a different one' }));
    expect(props.onDifferent).toHaveBeenCalled();
  });

  it('shows the explanation and closing lines on success', () => {
    const state = recordChoiceResult(selectOption(chooseProps().state, 'b'), true);
    render(<ChooseAnswerPanel {...chooseProps({ state })} />);
    expect(screen.getByText('You got it!')).toBeInTheDocument();
    expect(screen.getByText('3 and 4 together make 7.')).toBeInTheDocument();
    expect(screen.getByText('The stone glows!')).toBeInTheDocument();
    expect(screen.getByText('Adding puts groups together.')).toBeInTheDocument();
  });

  it('says it is practice, and explains a wrong try too', () => {
    const practice = { ...chooseProps().state, practice: true };
    const wrong = recordChoiceResult(selectOption(practice, 'a'), false);
    render(<ChooseAnswerPanel {...chooseProps({ state: wrong })} />);
    expect(screen.getByRole('note', { name: '' })).toHaveTextContent(/Practice/);
    expect(screen.getByText('3 and 4 together make 7.')).toBeInTheDocument();
  });

  it('offers another practice question once a practice try is right', async () => {
    const practice = recordChoiceResult(
      selectOption({ ...chooseProps().state, practice: true }, 'b'),
      true,
    );
    const props = chooseProps({ state: practice });
    render(<ChooseAnswerPanel {...props} />);
    expect(screen.getByText('Yes! That is right.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Practice another one' }));
    expect(props.onDifferent).toHaveBeenCalled();
  });
});

function orderProps(overrides: Partial<Parameters<typeof OrderSequencePanel>[0]> = {}) {
  return {
    title: 'Forge switches',
    params: order,
    state: openChoiceState('s', 'p', order, false),
    busy: false,
    onAdd: vi.fn(),
    onUndo: vi.fn(),
    onClear: vi.fn(),
    onDifferent: vi.fn(),
    onSubmit: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

describe('OrderSequencePanel', () => {
  it('adds items by button, with symbols, no dragging', async () => {
    const props = orderProps();
    render(<OrderSequencePanel {...props} />);
    expect(screen.getByText(/Tap the items below/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Add: triangle, Fire switch/ }));
    expect(props.onAdd).toHaveBeenCalledWith('red');
    expect(screen.getByRole('button', { name: 'Check my order' })).toBeDisabled();
  });

  it('lists the order so far, disables used items, and undoes or clears', async () => {
    const props = orderProps({
      state: { ...orderProps().state, order: ['blue', 'gold'] },
    });
    render(<OrderSequencePanel {...props} />);
    const list = screen.getByRole('list', { name: 'Your order' });
    expect(list).toHaveTextContent('Water switch');
    expect(list).toHaveTextContent('Sun switch');
    expect(screen.getByRole('button', { name: /Add: circle, Water switch/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Check my order' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await userEvent.click(screen.getByRole('button', { name: 'Start over' }));
    expect(props.onUndo).toHaveBeenCalled();
    expect(props.onClear).toHaveBeenCalled();
  });

  it('checks once every item is placed, and answers a wrong order kindly', async () => {
    const full = { ...orderProps().state, order: ['red', 'gold', 'blue'] };
    const props = orderProps({ state: recordChoiceResult(full, false) });
    render(<OrderSequencePanel {...props} />);
    expect(screen.getByText(/Not quite\. Let us look again/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Check my order' }));
    expect(props.onSubmit).toHaveBeenCalled();
  });

  it('shows the explanation when it is right', () => {
    const done = recordChoiceResult(
      { ...orderProps().state, order: ['blue', 'gold', 'red'] },
      true,
    );
    render(<OrderSequencePanel {...orderProps({ state: done })} />);
    expect(screen.getByText(/Water is cool/)).toBeInTheDocument();
  });
});
