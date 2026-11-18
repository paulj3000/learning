import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { read } from '../../../../../api/parse';
import * as parse from '../../../../../api/play/parse';
import type { RegionBootstrap } from '../../../../../api/play/types';
import { firstVariantIndex } from '../../../../region-play/areaPuzzles';
import type { RegionPlayInteractionEvent } from '../../../../region-play/regionPlayInteractions';
import { choiceBootstrap } from '../../../../../test/choicePuzzleFixtures';
import { FIREPEAK_SESSION, puzzleOutcomeJson } from '../../../../../test/firepeakFixtures';
import { setSoundSink, type SoundCue } from '../../../../region-play/soundCues';
import { AreaPuzzleLayer } from './AreaPuzzleLayer';
import type { RegionPlaySceneApi } from './regionPlayScene';

/** CHOOSE_ANSWER and ORDER_SEQUENCE are multi-instance: every state is keyed by puzzle id (FPV). */

function fakeScene() {
  return {
    effects: {
      setChangeKeys: vi.fn(),
      useReturn: vi.fn(() => false),
      previewSteamCleared: vi.fn(),
      safeCheckpoint: () => null,
      subscribe: () => () => undefined,
    },
    puzzles: {
      showArrangement: vi.fn(),
      showValveTurns: vi.fn(),
      discover: vi.fn(async () => undefined),
      setVisible: vi.fn(),
      showChoices: vi.fn(),
      clearChoices: vi.fn(),
    },
  } as unknown as RegionPlaySceneApi & {
    puzzles: { showChoices: ReturnType<typeof vi.fn>; clearChoices: ReturnType<typeof vi.fn> };
  };
}

function eventFor(data: RegionBootstrap, puzzleId: string, entityId: string): RegionPlayInteractionEvent {
  const puzzle = data.puzzles.find((p) => p.puzzleId === puzzleId)!;
  return { kind: 'puzzle', entityId, label: entityId, puzzle };
}

function setup(options: { solved?: string[]; outcome?: Record<string, unknown> } = {}) {
  const data = choiceBootstrap(options.solved);
  const scene = fakeScene();
  const solvePuzzle = vi.fn(async (_id: string, _submission: Record<string, unknown>) =>
    read(puzzleOutcomeJson(options.outcome), parse.puzzleOutcome),
  );
  const showToast = vi.fn();
  const onClose = vi.fn();
  const props = { bootstrap: data, sceneApi: scene, busy: false, solvePuzzle, showToast, onClose };
  const view = render(<AreaPuzzleLayer {...props} event={null} />);
  const open = (puzzleId: string, entityId: string) =>
    act(() => view.rerender(<AreaPuzzleLayer {...props} event={eventFor(data, puzzleId, entityId)} />));
  return { data, scene, solvePuzzle, open, showToast };
}

/** The variant the first visit should show, from the deterministic rule. */
function firstPrompt(puzzleId: string) {
  const index = firstVariantIndex(FIREPEAK_SESSION, puzzleId, 2);
  return ['What is 3 + 4?', 'What is 2 + 5?'][index];
}

describe('switch sounds', () => {
  afterEach(() => setSoundSink(null));

  it('plays switchFlip when a switch is added to the order, from the scene or the panel', async () => {
    const heard: SoundCue[] = [];
    setSoundSink((cue) => heard.push(cue));
    const { open } = setup();
    open('fh-order-1', 'fh-switch-blue');
    expect(heard).toEqual(['switchFlip']);
    await userEvent.click(screen.getByRole('button', { name: /Add: star, Sun switch/ }));
    expect(heard).toEqual(['switchFlip', 'switchFlip']);
  });

  it('is silent for a choose-answer touch', () => {
    const heard: SoundCue[] = [];
    setSoundSink((cue) => heard.push(cue));
    const { open } = setup();
    open('fh-choose-1', 'fh-stone-b');
    expect(heard).toEqual([]);
  });
});

describe('choice puzzles in the layer', () => {
  it('opens the deterministic first variant and sends {variantId, choice} to the server', async () => {
    const { open, solvePuzzle } = setup();
    open('fh-choose-1', 'fh-stone-b');
    expect(await screen.findByText(firstPrompt('fh-choose-1'))).toBeInTheDocument();
    // Touching the stone in the scene preselected its option.
    expect(screen.getByRole('button', { name: 'star, 7' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Check my answer' }));
    const variantId = firstVariantIndex(FIREPEAK_SESSION, 'fh-choose-1', 2) === 0 ? 'v1' : 'v2';
    expect(solvePuzzle).toHaveBeenCalledWith('fh-choose-1', { variantId, choice: 'b' });
  });

  it('keeps each puzzle on its own state', async () => {
    const { open } = setup();
    open('fh-choose-1', 'fh-stone-a');
    expect(screen.getByRole('button', { name: 'circle, 6' })).toHaveAttribute('aria-pressed', 'true');
    open('fh-choose-2', 'fh-other-c');
    expect(screen.getByRole('button', { name: 'moon, 8' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'circle, 6' })).toHaveAttribute('aria-pressed', 'false');
    // Back to the first puzzle: its pick is still there.
    open('fh-choose-1', 'fh-stone-a');
    expect(screen.getByRole('button', { name: 'circle, 6' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'moon, 8' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('draws labels and glow for every choice puzzle, each under its own id', () => {
    const { scene, open } = setup();
    const ids = scene.puzzles.showChoices.mock.calls.map((call) => call[0]);
    expect(ids).toEqual(expect.arrayContaining(['fh-choose-1', 'fh-choose-2', 'fh-order-1']));
    open('fh-choose-1', 'fh-stone-b');
    const last = scene.puzzles.showChoices.mock.calls.filter((c) => c[0] === 'fh-choose-1').at(-1)!;
    expect(last[1].highlighted).toEqual(['fh-stone-b']);
    expect(last[1].labels['fh-stone-b']).toContain('7');
    expect(last[1].labels['fh-stone-b']).toContain('★');
    const other = scene.puzzles.showChoices.mock.calls.filter((c) => c[0] === 'fh-choose-2').at(-1)!;
    expect(other[1].highlighted).toEqual([]);
  });

  it('shows the reveal with the explanation after a correct first solve', async () => {
    const { open } = setup();
    open('fh-choose-1', 'fh-stone-b');
    await userEvent.click(screen.getByRole('button', { name: 'Check my answer' }));
    expect(await screen.findByText(/make 7\./)).toBeInTheDocument();
  });

  it('keeps the same question after a wrong answer, and changes it on request', async () => {
    const { open, solvePuzzle } = setup({
      outcome: { correct: false, feedback: 'TRY_AGAIN', solvedNow: false },
    });
    open('fh-choose-1', 'fh-stone-a');
    const prompt = firstPrompt('fh-choose-1');
    await userEvent.click(screen.getByRole('button', { name: 'Check my answer' }));
    expect(await screen.findByText('Not quite. Let us look again!')).toBeInTheDocument();
    expect(screen.getByText(prompt)).toBeInTheDocument();
    expect(solvePuzzle).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Try a different one' }));
    expect(screen.queryByText(prompt)).not.toBeInTheDocument();
    expect(screen.queryByText('Not quite. Let us look again!')).not.toBeInTheDocument();
  });

  it('builds an order from scene touches and the panel, and sends {variantId, order}', async () => {
    const { open, solvePuzzle } = setup();
    open('fh-order-1', 'fh-switch-blue');
    await userEvent.click(screen.getByRole('button', { name: /Add: star, Sun switch/ }));
    await userEvent.click(screen.getByRole('button', { name: /Add: triangle, Fire switch/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Check my order' }));
    expect(solvePuzzle).toHaveBeenCalledWith('fh-order-1', {
      variantId: 'v1',
      order: ['blue', 'gold', 'red'],
    });
  });

  it('never sends a malformed answer', async () => {
    const { open, solvePuzzle } = setup();
    open('fh-order-1', 'fh-switch-blue');
    expect(screen.getByRole('button', { name: 'Check my order' })).toBeDisabled();
    expect(solvePuzzle).not.toHaveBeenCalled();
  });
});

describe('practice', () => {
  it('reopens a solved puzzle as practice on the next variant, with no reward', async () => {
    const { open, solvePuzzle } = setup({
      solved: ['fh-choose-1'],
      outcome: { correct: true, alreadySolved: true, solvedNow: false, practice: true, attemptId: null },
    });
    open('fh-choose-1', 'fh-stone-b');
    expect(screen.getByRole('note')).toHaveTextContent(/Practice/);
    const first = firstVariantIndex(FIREPEAK_SESSION, 'fh-choose-1', 2);
    const nextPrompt = ['What is 3 + 4?', 'What is 2 + 5?'][(first + 1) % 2];
    expect(screen.getByText(nextPrompt)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Check my answer' }));
    expect(solvePuzzle).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Yes! That is right.')).toBeInTheDocument();
    // The panel stays open with the explanation: no reward reveal replaced it.
    expect(screen.getByRole('button', { name: 'Practice another one' })).toBeInTheDocument();
  });

  it('treats a solved puzzle as practice even if an older server omits the field', async () => {
    const { open, showToast } = setup({ solved: ['fh-order-1'] });
    open('fh-order-1', 'fh-switch-blue');
    await userEvent.click(screen.getByRole('button', { name: /Add: star, Sun switch/ }));
    await userEvent.click(screen.getByRole('button', { name: /Add: triangle, Fire switch/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Check my order' }));
    expect(await screen.findByText('Yes! That is right.')).toBeInTheDocument();
    expect(showToast).not.toHaveBeenCalled();
  });

  it('says not quite in practice, with the explanation', async () => {
    const { open } = setup({
      solved: ['fh-choose-2'],
      outcome: { correct: false, feedback: 'TRY_AGAIN', alreadySolved: true, solvedNow: false, practice: true },
    });
    open('fh-choose-2', 'fh-other-a');
    await userEvent.click(screen.getByRole('button', { name: 'Check my answer' }));
    expect(await screen.findByText('Not quite. Let us look again!')).toBeInTheDocument();
    expect(screen.getByText(/together make 7/)).toBeInTheDocument();
  });
});
