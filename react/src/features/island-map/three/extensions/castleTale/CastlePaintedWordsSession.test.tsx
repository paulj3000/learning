import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THE_PAINTED_WORDS, THE_PAINTED_WORDS_AGAIN } from '../../../../adventures/content/thePaintedWords';
import { STORYKEEPER_CASTLE_INTERACTIONS } from '../../../worldObjects';
import { padZoneId } from '../../runtime/manifests/castleRooms/castlePlatforms';
import { WorldEngineEventBus } from '../../worldEngineEvents';
import { paintedWordsAdventureFor } from './castleTaleClaims';
import { castleTaleViewExtension } from './castleTaleViewExtension';
import { STORYKEEPER_CASTLE_MANIFEST } from '../../runtime/manifests/storykeeperCastle';
import { CastlePaintedWordsSession } from './CastlePaintedWordsSession';
import { PAD_DWELL_MS } from './usePadAnswers';

const session = vi.hoisted(() => ({
  submitAnswer: vi.fn(),
  status: 'IN_PROGRESS' as 'IN_PROGRESS' | 'COMPLETED',
  stepId: 'rhyme-cat',
}));

vi.mock('../../../../adventures/useAdventureSession', async () => {
  const { THE_PAINTED_WORDS: definition } = await import('../../../../adventures/content/thePaintedWords');
  return {
    useAdventureSession: () => ({
      loadState: 'ready',
      session: { status: session.status },
      currentStep: definition.steps.find((step) => step.id === session.stepId),
      hintLevel: 0,
      hintText: null,
      submitting: false,
      error: null,
      submitAnswer: session.submitAnswer,
      requestHint: vi.fn(),
      companionTurn: null,
      representationAid: null,
      storyScenes: null,
    }),
  };
});

vi.mock('../../../../adventures/AdventureStepCard', () => ({
  AdventureStepCard: ({ currentStep }: { currentStep: { id: string } }) => (
    <div data-testid="card">{currentStep.id}</div>
  ),
}));

function renderSession(onComplete = vi.fn()) {
  const bus = new WorldEngineEventBus();
  render(
    <CastlePaintedWordsSession
      childId="child-1"
      ageBand="PATHFINDER"
      aiEnabled={false}
      bus={bus}
      definition={THE_PAINTED_WORDS}
      onComplete={onComplete}
      backToMapHref="/island/child-1"
    />,
  );
  return { bus, onComplete };
}

const stand = async (bus: WorldEngineEventBus, zone: string) => {
  bus.emit('PlayerEnteredZone', { zoneId: zone });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(PAD_DWELL_MS + 10);
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  session.submitAnswer = vi.fn().mockResolvedValue('incorrect');
  session.status = 'IN_PROGRESS';
  session.stepId = 'rhyme-cat';
});
afterEach(() => vi.useRealTimers());

describe('the Painted Words, hosted in the Illustration Studio', () => {
  it('shows the same card as the card route, and tells which colour carries which word', () => {
    renderSession();
    expect(screen.getByTestId('card').textContent).toBe('rhyme-cat');
    const guide = screen.getByTestId('painted-words-pad-guide').textContent ?? '';
    expect(guide).toContain('The red pad says hat.');
    expect(guide).toContain('The blue pad says dog.');
    expect(guide).toContain('The yellow pad says sun.');
  });

  it('answers with the pad’s word through the one submit the card uses, once', async () => {
    const { bus } = renderSession();
    await stand(bus, padZoneId('studio', 'red'));
    expect(session.submitAnswer).toHaveBeenCalledTimes(1);
    expect(session.submitAnswer).toHaveBeenCalledWith({ kind: 'choice', optionId: 'opt-hat' });
  });

  it('answers nothing for a pad that is not one of this step’s, or a plain hop', async () => {
    const { bus } = renderSession();
    bus.emit('PlayerEnteredZone', { zoneId: padZoneId('studio', 'blue') });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PAD_DWELL_MS / 2);
    });
    bus.emit('PlayerLeftZone', { zoneId: padZoneId('studio', 'blue') });
    await stand(bus, padZoneId('library-books', 'diary'));
    expect(session.submitAnswer).not.toHaveBeenCalled();
  });

  it('shows no pad guide on a step that is not a choice (the claps), and fires completion once', () => {
    session.stepId = 'clap-apple';
    const { onComplete } = renderSession();
    expect(screen.queryByTestId('painted-words-pad-guide')).toBeNull();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('reports completion once the engine says the session is complete', () => {
    session.status = 'COMPLETED';
    const { onComplete } = renderSession();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});

describe('who the castle hands the painted wall to', () => {
  const wall = (id: string) => STORYKEEPER_CASTLE_INTERACTIONS.find((interaction) => interaction.id === id)!;

  it('takes both the first play and the replay for Pathfinders, and for no other band', () => {
    expect(paintedWordsAdventureFor(wall('castle-painted-words'), 'PATHFINDER')?.slug).toBe(THE_PAINTED_WORDS.slug);
    expect(paintedWordsAdventureFor(wall('castle-painted-words-again'), 'PATHFINDER')?.slug).toBe(
      THE_PAINTED_WORDS_AGAIN.slug,
    );
    for (const band of ['SPROUT', 'EXPLORER'] as const) {
      expect(paintedWordsAdventureFor(wall('castle-painted-words'), band)).toBeUndefined();
      expect(paintedWordsAdventureFor(wall('castle-painted-words-again'), band)).toBeUndefined();
    }
  });

  it('claims nothing else, and the registered view extension applies the same claim', () => {
    expect(paintedWordsAdventureFor(wall('castle-story-hall'), 'PATHFINDER')).toBeUndefined();
    expect(paintedWordsAdventureFor(wall('castle-tapestry-stair'), 'PATHFINDER')).toBeUndefined();
    const binding = STORYKEEPER_CASTLE_MANIFEST.extensions.find((extension) => extension.extensionId === 'castle-tale')!;
    const claims = (id: string, ageBand: 'SPROUT' | 'PATHFINDER' | 'EXPLORER') =>
      castleTaleViewExtension.claimsInteraction?.(wall(id), { ageBand, config: binding.config });
    expect(claims('castle-painted-words', 'PATHFINDER')).toBe(true);
    expect(claims('castle-painted-words-again', 'PATHFINDER')).toBe(true);
    expect(claims('castle-painted-words', 'SPROUT')).toBe(false);
    expect(claims('castle-painted-words', 'EXPLORER')).toBe(false);
  });
});
