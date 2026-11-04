import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { SpeechState } from './SpeechPlayer';
import { SpeechCaption } from './SpeechCaption';

const state = (overrides: Partial<SpeechState> = {}): SpeechState => ({
  phase: 'idle',
  caption: 'Welcome to the library.',
  captionFrom: 'speech',
  queued: 0,
  canReplay: true,
  textOnly: false,
  ...overrides,
});
const handlers = () => ({
  onReplay: vi.fn(),
  onStop: vi.fn(),
  onPause: vi.fn(),
  onResume: vi.fn(),
});

describe('SpeechCaption', () => {
  it('renders nothing when there is nothing to say', () => {
    const { container } = render(
      <SpeechCaption state={state({ caption: null })} {...handlers()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the words as a polite live status, with the speaker', () => {
    render(<SpeechCaption state={state()} speaker="Keeper Quill" {...handlers()} />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Keeper Quill: Welcome to the library.');
    expect(status).toHaveAttribute('aria-live', 'polite');
  });

  it('shows the words even when there is no sound, and says so kindly', () => {
    render(<SpeechCaption state={state({ phase: 'failed', textOnly: true })} {...handlers()} />);
    expect(screen.getByText('Welcome to the library.')).toBeInTheDocument();
    expect(screen.getByText(/no sound for this one/i)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a loading note, and the authored words while it loads', () => {
    render(<SpeechCaption state={state({ phase: 'loading', canReplay: false })} {...handlers()} />);
    expect(screen.getByText('Welcome to the library.')).toBeInTheDocument();
    expect(screen.getByText('Getting ready to talk...')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Skip' })).toBeInTheDocument();
  });

  it('offers only the controls that can do something', () => {
    const { rerender } = render(
      <SpeechCaption state={state({ phase: 'playing' })} {...handlers()} />,
    );
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Skip' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hear it again' })).not.toBeInTheDocument();
    rerender(<SpeechCaption state={state({ phase: 'paused' })} {...handlers()} />);
    expect(screen.getByRole('button', { name: 'Keep going' })).toBeInTheDocument();
    rerender(<SpeechCaption state={state({ phase: 'idle' })} {...handlers()} />);
    expect(screen.getByRole('button', { name: 'Hear it again' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Skip' })).not.toBeInTheDocument();
    rerender(<SpeechCaption state={state({ canReplay: false })} {...handlers()} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('calls the right handler from a real button, including from the keyboard', async () => {
    const h = handlers();
    render(<SpeechCaption state={state()} {...h} />);
    screen.getByRole('button', { name: 'Hear it again' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(h.onReplay).toHaveBeenCalledTimes(1);
  });
});
