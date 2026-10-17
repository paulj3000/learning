import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { StoryChapterRunner } from './StoryChapterRunner';
import { isAdventureSessionComplete, recordStoryReflectionEvidence } from './api';
import { requestCompanionTurn } from '../companion/api';
import type { StoryChapter } from './engine/types';

vi.mock('./api', () => ({
  isAdventureSessionComplete: vi.fn(),
  recordStoryReflectionEvidence: vi.fn(),
}));

vi.mock('../companion/api', () => ({
  requestCompanionTurn: vi.fn(),
}));

vi.mock('../adventures/AdventureRunner', () => ({
  AdventureRunner: ({ onComplete }: { onComplete?: () => void }) => (
    <div>
      <p>Mock embedded adventure</p>
      <button type="button" onClick={onComplete}>
        Finish mock adventure
      </button>
    </div>
  ),
}));

const isAdventureSessionCompleteMock = vi.mocked(isAdventureSessionComplete);
const recordStoryReflectionEvidenceMock = vi.mocked(recordStoryReflectionEvidence);
const requestCompanionTurnMock = vi.mocked(requestCompanionTurn);

function baseProps(chapter: StoryChapter) {
  return {
    childProfileId: 'child-1',
    ageBand: 'PATHFINDER' as const,
    aiEnabled: false,
    storyProgressId: 'progress-1',
    chapter,
    flags: {},
    backToStoryHref: '/island/child-1/stories/dragon-of-ember-mountain',
    onFlag: vi.fn().mockResolvedValue(undefined),
    onChapterComplete: vi.fn().mockResolvedValue(undefined),
  };
}

describe('StoryChapterRunner', () => {
  beforeEach(() => {
    isAdventureSessionCompleteMock.mockReset();
    recordStoryReflectionEvidenceMock.mockReset();
    requestCompanionTurnMock.mockReset();
  });

  it('renders a NARRATIVE scene and advances to the next scene on Continue', async () => {
    const user = userEvent.setup();
    const chapter: StoryChapter = {
      id: 'chapter-1',
      title: 'Chapter One',
      scenes: [
        { id: 'scene-1', kind: 'NARRATIVE', speaker: 'Chatty the Parrot', text: 'Hello there.' },
        { id: 'scene-2', kind: 'REFLECTION', prompt: 'How do you feel?', objectiveIds: [] },
      ],
    };
    const props = baseProps(chapter);
    render(<StoryChapterRunner {...props} />);

    expect(await screen.findByText('Hello there.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /continue/i }));

    expect(await screen.findByText('How do you feel?')).toBeInTheDocument();
  });

  it('renders a CHOICE scene, calls onFlag with the chosen flagValue, and advances', async () => {
    const user = userEvent.setup();
    const chapter: StoryChapter = {
      id: 'chapter-1',
      title: 'Chapter One',
      scenes: [
        {
          id: 'scene-1',
          kind: 'CHOICE',
          prompt: 'Pick a direction.',
          flagKey: 'trackDirection',
          options: [
            { id: 'opt-a', label: 'Toward the cave', flagValue: 'cave' },
            { id: 'opt-b', label: 'Toward the river', flagValue: 'river' },
          ],
        },
      ],
    };
    const props = baseProps(chapter);
    render(<StoryChapterRunner {...props} />);

    await user.click(await screen.findByRole('button', { name: 'Toward the cave' }));

    expect(props.onFlag).toHaveBeenCalledWith('trackDirection', 'cave');
    expect(props.onChapterComplete).toHaveBeenCalledTimes(1);
  });

  it('records skill evidence for a REFLECTION scene and advances on Continue', async () => {
    const user = userEvent.setup();
    const chapter: StoryChapter = {
      id: 'chapter-1',
      title: 'Chapter One',
      scenes: [
        {
          id: 'scene-1',
          kind: 'REFLECTION',
          prompt: 'How do you feel?',
          objectiveIds: ['empathy'],
        },
      ],
    };
    const props = baseProps(chapter);
    recordStoryReflectionEvidenceMock.mockResolvedValue(undefined);
    render(<StoryChapterRunner {...props} />);

    await user.click(await screen.findByRole('button', { name: /continue/i }));

    expect(recordStoryReflectionEvidenceMock).toHaveBeenCalledWith('child-1', 'progress-1', [
      'empathy',
    ]);
    expect(props.onChapterComplete).toHaveBeenCalledTimes(1);
  });

  it('renders the embedded adventure and shows a "Continue the story" button once it completes', async () => {
    const user = userEvent.setup();
    const chapter: StoryChapter = {
      id: 'chapter-1',
      title: 'Chapter One',
      scenes: [{ id: 'scene-1', kind: 'ADVENTURE', templateSlug: 'dragon-chapter-1-broken-path' }],
    };
    const props = baseProps(chapter);
    isAdventureSessionCompleteMock.mockResolvedValue(false);
    render(<StoryChapterRunner {...props} />);

    expect(await screen.findByText('Mock embedded adventure')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /continue the story/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /finish mock adventure/i }));
    expect(await screen.findByRole('button', { name: /continue the story/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /continue the story/i }));
    expect(props.onChapterComplete).toHaveBeenCalledTimes(1);
  });

  it('skips straight to a "already finished" prompt when the embedded adventure was already completed', async () => {
    const user = userEvent.setup();
    const chapter: StoryChapter = {
      id: 'chapter-1',
      title: 'Chapter One',
      scenes: [{ id: 'scene-1', kind: 'ADVENTURE', templateSlug: 'dragon-chapter-1-broken-path' }],
    };
    const props = baseProps(chapter);
    isAdventureSessionCompleteMock.mockResolvedValue(true);
    render(<StoryChapterRunner {...props} />);

    expect(await screen.findByText(/already finished this part/i)).toBeInTheDocument();
    expect(screen.queryByText('Mock embedded adventure')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /continue the story/i }));
    expect(props.onChapterComplete).toHaveBeenCalledTimes(1);
  });

  it('calls onChapterComplete once every scene in the chapter has resolved', async () => {
    const chapter: StoryChapter = {
      id: 'chapter-1',
      title: 'Chapter One',
      scenes: [],
    };
    const props = baseProps(chapter);
    render(<StoryChapterRunner {...props} />);

    expect(await screen.findByText(/saving your progress/i)).toBeInTheDocument();
    expect(props.onChapterComplete).toHaveBeenCalledTimes(1);
  });
});
