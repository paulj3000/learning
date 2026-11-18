import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADVENTURE_TEMPLATES } from '../../../../adventures/content';
import type { AdventureDefinition } from '../../../../adventures/engine/types';
import { padZoneId } from '../../runtime/manifests/castleRooms/castlePlatforms';
import { WorldEngineEventBus } from '../../worldEngineEvents';
import { PAD_DWELL_MS, usePadAnswers } from './usePadAnswers';

/**
 * The pad hook against a real event bus: a pad answers only after a short stand, one submit at a
 * time, and only for the step that is open. The session's `submit` is a spy standing for the one
 * `submitAnswer` the HUD card also calls.
 */

const definition = (slug: string): AdventureDefinition => {
  const found = ADVENTURE_TEMPLATES.find((template) => template.slug === slug)!;
  return found;
};

const PATTERN = definition('secret-door-chapter-2-pattern-lock');
const TALE = definition('the-storykeepers-tale');

function setup(adventure: AdventureDefinition, stepId: string | null, submit = vi.fn().mockResolvedValue('correct')) {
  const bus = new WorldEngineEventBus();
  const onWrongOrder = vi.fn();
  const view = renderHook(
    (props: { stepId: string | null }) =>
      usePadAnswers({ bus, definition: adventure, stepId: props.stepId, submit, onWrongOrder }),
    { initialProps: { stepId } },
  );
  const enter = (zone: string) => bus.emit('PlayerEnteredZone', { zoneId: zone });
  const leave = (zone: string) => bus.emit('PlayerLeftZone', { zoneId: zone });
  const stand = async (zone: string) => {
    enter(zone);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PAD_DWELL_MS + 10);
    });
  };
  return { bus, view, submit, onWrongOrder, enter, leave, stand };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('usePadAnswers', () => {
  it('submits a pad’s answer once the child has stood on it, through the one submit the card uses', async () => {
    const { submit, stand } = setup(PATTERN, 'continue-the-pattern');
    await stand(padZoneId('library-pattern', 'moon'));
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith({ kind: 'choice', optionId: 'moon' });
  });

  it('answers nothing for a hop across a pad', async () => {
    const { submit, enter, leave } = setup(PATTERN, 'continue-the-pattern');
    enter(padZoneId('library-pattern', 'star'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PAD_DWELL_MS - 200);
    });
    leave(padZoneId('library-pattern', 'star'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PAD_DWELL_MS * 2);
    });
    expect(submit).not.toHaveBeenCalled();
  });

  it('ignores a pad that means nothing for the open step, and non-pad zones', async () => {
    const { submit, stand } = setup(PATTERN, 'continue-the-pattern');
    await stand(padZoneId('library-books', 'diary'));
    await stand('tower-window-cave');
    await stand('castle-painted-wall');
    expect(submit).not.toHaveBeenCalled();
  });

  it('ignores everything when no step is open', async () => {
    const { submit, stand } = setup(PATTERN, null);
    await stand(padZoneId('library-pattern', 'moon'));
    expect(submit).not.toHaveBeenCalled();
  });

  it('does not submit a second time while the first is still being graded, and again after it settles', async () => {
    let settle: (value: 'incorrect') => void = () => {};
    const slow = vi.fn(() => new Promise<'incorrect'>((resolve) => (settle = resolve)));
    const { stand } = setup(PATTERN, 'continue-the-pattern', slow as never);
    await stand(padZoneId('library-pattern', 'star'));
    await stand(padZoneId('library-pattern', 'sun'));
    await stand(padZoneId('library-pattern', 'star'));
    expect(slow).toHaveBeenCalledTimes(1);
    await act(async () => {
      settle('incorrect');
      await Promise.resolve();
    });
    await stand(padZoneId('library-pattern', 'sun'));
    expect(slow).toHaveBeenCalledTimes(2);
  });

  it('turns three stones stepped on in order into one ordering answer, and tells Quill when it is wrong', async () => {
    const wrong = vi.fn().mockResolvedValue('incorrect');
    const { submit, stand, onWrongOrder } = setup(TALE, 'order-the-story', wrong);
    await stand(padZoneId('story-hall', 'ending'));
    await stand(padZoneId('story-hall', 'choice'));
    expect(submit).not.toHaveBeenCalled();
    // Stepping back onto a stone already used in this try changes nothing.
    await stand(padZoneId('story-hall', 'ending'));
    expect(submit).not.toHaveBeenCalled();
    await stand(padZoneId('story-hall', 'problem'));
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith({
      kind: 'ordering',
      order: ['beat-ending', 'beat-choice', 'beat-problem'],
    });
    expect(onWrongOrder).toHaveBeenCalledTimes(1);
  });

  it('forgets a half-finished order when the step moves on, and stops listening when it unmounts', async () => {
    const { submit, stand, view, enter } = setup(TALE, 'order-the-story');
    await stand(padZoneId('story-hall', 'problem'));
    view.rerender({ stepId: 'comprehension-check' });
    await stand(padZoneId('story-hall', 'choice'));
    expect(submit).not.toHaveBeenCalled();
    view.unmount();
    enter(padZoneId('story-hall', 'ending'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PAD_DWELL_MS * 3);
    });
    expect(submit).not.toHaveBeenCalled();
  });
});
