import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/errors';
import type { StoryArtifact } from '../adventures/api';
import { WritingRoomActivity, type WritingRoomDeps } from './WritingRoomActivity';

vi.mock('../../audio/speech/useSpeech', () => ({
  useSpeech: () => ({
    state: {
      phase: 'idle',
      caption: null,
      captionFrom: null,
      queued: 0,
      canReplay: false,
      textOnly: false,
    },
    speak: vi.fn(async () => undefined),
    showText: vi.fn(),
    stop: vi.fn(),
    skip: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    replay: vi.fn(async () => undefined),
    clearCaption: vi.fn(),
  }),
}));

function artifactFor(
  scenes: { stepId: string; text: string }[],
  title = 'My Story',
): StoryArtifact {
  return {
    id: 'artifact-1',
    childProfileId: 'child-1',
    sessionId: 'session-1',
    templateSlug: 'x',
    title,
    scenes: scenes.map((scene) => ({ ...scene, source: 'CHILD' as const })),
    createdAt: '2026-11-18T00:00:00Z',
  };
}

function setup(ageBand: 'SPROUT' | 'PATHFINDER' | 'EXPLORER', save?: WritingRoomDeps['saveStory']) {
  const saveStory = vi.fn(
    save ?? (async () => artifactFor([{ stepId: 'a', text: 'Saved by the server.' }])),
  );
  const startSession = vi.fn(async () => ({ id: 'session-1' }));
  render(
    <MemoryRouter>
      <WritingRoomActivity
        childId="child-1"
        ageBand={ageBand}
        roomHref="/room"
        logHref="/log"
        deps={{ startSession, saveStory }}
      />
    </MemoryRouter>,
  );
  return { saveStory, startSession };
}

describe('Sprouts: tap a picture, a character and a word', () => {
  it('asks one thing at a time, saves only option ids and shows authored encouragement', async () => {
    const user = userEvent.setup();
    const { saveStory, startSession } = setup('SPROUT');
    expect(screen.getByRole('heading', { name: 'My Picture Story' })).toBeInTheDocument();
    // Nothing is started until the child has finished.
    await user.click(screen.getByRole('button', { name: 'Let us write' }));
    expect(startSession).not.toHaveBeenCalled();

    expect(screen.getByText('Pick a picture for your story.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /the sea/i }));
    expect(screen.getByText('Who is in your story?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /the fox/i }));
    expect(screen.getByText('Pick a word for your story.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /kind/i }));

    await waitFor(() => expect(saveStory).toHaveBeenCalledTimes(1));
    expect(saveStory).toHaveBeenCalledWith('child-1', 'session-1', [
      { stepId: 'pick-the-picture', optionIds: ['picture-sea'] },
      { stepId: 'pick-the-character', optionIds: ['character-fox'] },
      { stepId: 'pick-the-word', optionIds: ['word-kind'] },
    ]);
    expect(await screen.findByText(/What a lovely story/)).toBeInTheDocument();
    expect(screen.getByText('Saved by the server.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the Writing Room' })).toHaveAttribute(
      'href',
      '/room',
    );
    expect(screen.getByRole('link', { name: 'See my adventure log' })).toHaveAttribute(
      'href',
      '/log',
    );
  });

  it('offers large targets, a way to hear each prompt and an authored idea, with no wrong answer', async () => {
    const user = userEvent.setup();
    setup('SPROUT');
    await user.click(screen.getByRole('button', { name: 'Let us write' }));
    expect(screen.getByRole('button', { name: 'Hear it' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Need an idea?' }));
    expect(screen.getByText('Tap the picture you like best.')).toBeInTheDocument();
    // Every option is a button; none is marked right or wrong.
    const group = screen.getByRole('group', { name: 'Pick a picture for your story.' });
    expect(within(group).getAllByRole('button')).toHaveLength(3);
    expect(screen.queryByText(/wrong|incorrect|try again/i)).not.toBeInTheDocument();
  });
});

describe('Pathfinders: build sentences from word tiles', () => {
  it('builds two sentences, sends tile ids in order and drops nothing but unfinished sentences', async () => {
    const user = userEvent.setup();
    const { saveStory } = setup('PATHFINDER');
    await user.click(screen.getByRole('button', { name: 'Let us write' }));

    // Sentence 1 needs two tiles before it can be kept.
    await user.click(screen.getByRole('button', { name: 'the little fox' }));
    expect(screen.queryByRole('button', { name: 'Next sentence' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'lived' }));
    expect(screen.getByLabelText('Your sentence so far')).toHaveTextContent(
      'The little fox lived.',
    );
    // Take a tile back, then put it back: the order is the child's own.
    await user.click(screen.getByRole('button', { name: 'Take back a tile' }));
    await user.click(screen.getByRole('button', { name: 'by the sea' }));
    expect(screen.getByLabelText('Your sentence so far')).toHaveTextContent(
      'The little fox by the sea.',
    );
    await user.click(screen.getByRole('button', { name: 'Next sentence' }));

    await user.click(screen.getByRole('button', { name: 'Then' }));
    await user.click(screen.getByRole('button', { name: 'they' }));
    // Two sentences are enough to finish.
    await user.click(screen.getByRole('button', { name: 'I am finished' }));

    await waitFor(() => expect(saveStory).toHaveBeenCalledTimes(1));
    expect(saveStory).toHaveBeenCalledWith('child-1', 'session-1', [
      { stepId: 'sentence-1', optionIds: ['sentence-1-tile-2', 'sentence-1-tile-6'] },
      { stepId: 'sentence-2', optionIds: ['sentence-2-tile-1', 'sentence-2-tile-2'] },
    ]);
    expect(await screen.findByText(/What a great story/)).toBeInTheDocument();
  });

  it('cannot use one tile twice and cannot finish with one sentence', async () => {
    const user = userEvent.setup();
    setup('PATHFINDER');
    await user.click(screen.getByRole('button', { name: 'Let us write' }));
    await user.click(screen.getByRole('button', { name: 'lived' }));
    expect(screen.getByRole('button', { name: 'lived' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'by the sea' }));
    expect(screen.queryByRole('button', { name: 'I am finished' })).not.toBeInTheDocument();
  });
});

describe('Explorers: a starter and a typed paragraph', () => {
  const PARAGRAPH = 'The tiny fox found a shiny key and opened a garden full of stars.';

  it('needs a starter and a paragraph in bounds, then saves both', async () => {
    const user = userEvent.setup();
    const { saveStory } = setup('EXPLORER');
    await user.click(screen.getByRole('button', { name: 'Let us write' }));
    const save = screen.getByRole('button', { name: 'Put it on the shelf' });
    expect(save).toBeDisabled();
    await user.click(screen.getByRole('radio', { name: /lamp in the tower/i }));
    await user.type(screen.getByRole('textbox'), 'Too short.');
    expect(save).toBeDisabled();
    await user.clear(screen.getByRole('textbox'));
    await user.type(screen.getByRole('textbox'), PARAGRAPH);
    expect(save).toBeEnabled();
    await user.click(save);
    await waitFor(() => expect(saveStory).toHaveBeenCalledTimes(1));
    expect(saveStory).toHaveBeenCalledWith('child-1', 'session-1', [
      { stepId: 'pick-a-starter', optionIds: ['starter-lamp'] },
      { stepId: 'write-the-story', text: PARAGRAPH },
    ]);
    expect(await screen.findByText(/What a story!/)).toBeInTheDocument();
  });

  it('answers a refused paragraph with a kind authored line that never repeats the text', async () => {
    const user = userEvent.setup();
    const refusal = new ApiError('invalid_request', { status: 400, code: 'written_story_refused' });
    const { saveStory } = setup('EXPLORER', async () => {
      throw refusal;
    });
    await user.click(screen.getByRole('button', { name: 'Let us write' }));
    await user.click(screen.getByRole('radio', { name: /door behind the bookshelf/i }));
    const bad = 'Call me at 555-123-4567 so we can write more of this story together.';
    await user.type(screen.getByRole('textbox'), bad);
    await user.click(screen.getByRole('button', { name: 'Put it on the shelf' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Keeper Quill likes stories with kind, gentle words.');
    expect(alert).not.toHaveTextContent('555');
    expect(saveStory).toHaveBeenCalledTimes(1);
    // Nothing was saved, so the child is still writing and can change their words.
    expect(screen.getByRole('textbox')).toHaveValue(bad);
    expect(screen.queryByText(/What a story!/)).not.toBeInTheDocument();
  });

  it('says a calm, generic thing when saving fails for another reason', async () => {
    const user = userEvent.setup();
    setup('EXPLORER', async () => {
      throw new Error('network');
    });
    await user.click(screen.getByRole('button', { name: 'Let us write' }));
    await user.click(screen.getByRole('radio', { name: /letter with no name/i }));
    await user.type(screen.getByRole('textbox'), PARAGRAPH);
    await user.click(screen.getByRole('button', { name: 'Put it on the shelf' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Please try again');
  });
});
