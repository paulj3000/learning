import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/errors';
import type { CastleDirectorApi } from '../../api/play/castleDirectorApi';
import { CASTLE_EVENTS, defaultEvent, linesFor } from './castleEvents';
import { useCastleDirector } from './useCastleDirector';

const serverEvent = {
  eventId: 'quill-hums-in-hall',
  source: 'AI' as const,
  lines: ['Keeper Quill hums a happy tune while tidying the story shelves.'],
  npcId: 'keeper-quill',
  visual: { kind: 'quill-scratch' },
};

function setup(api: CastleDirectorApi | null, over: Partial<Parameters<typeof useCastleDirector>[0]> = {}) {
  return renderHook(
    (props: Parameters<typeof useCastleDirector>[0]) => useCastleDirector(props),
    {
      initialProps: {
        childId: 'child-1',
        ageBand: 'PATHFINDER' as const,
        roomId: 'story-hall',
        worldChangeKeys: [] as string[],
        api,
        ...over,
      },
    },
  );
}

describe('useCastleDirector', () => {
  it("shows the server's authored line and sends only the room and visit ids", async () => {
    const choose = vi.fn().mockResolvedValue(serverEvent);
    const { result } = setup({ choose });
    await waitFor(() => expect(result.current?.eventId).toBe('quill-hums-in-hall'));
    expect(result.current).toMatchObject({ source: 'AI', npcId: 'keeper-quill' });
    expect(choose).toHaveBeenCalledTimes(1);
    expect(choose).toHaveBeenCalledWith('story-hall', expect.any(String));
  });

  it('on a server error computes the same local default event', async () => {
    const choose = vi.fn().mockRejectedValue(new ApiError('network', {}));
    const { result } = setup({ choose });
    const expected = defaultEvent(CASTLE_EVENTS, {
      ageBand: 'PATHFINDER',
      roomId: 'story-hall',
      conditions: { worldChanges: [], questStatuses: {}, relationshipLevels: {} },
      shownCounts: {},
      lastShownVisit: {},
      currentVisitIndex: 1,
    });
    await waitFor(() => expect(result.current?.source).toBe('LOCAL'));
    expect(result.current?.eventId).toBe(expected?.id);
    expect(result.current?.lines).toEqual(expected ? linesFor(expected, 'PATHFINDER') : []);
  });

  it('works with no Django API at all', async () => {
    const { result } = setup(null, { roomId: 'great-library' });
    await waitFor(() => expect(result.current?.source).toBe('LOCAL'));
    expect(result.current?.eventId).toBe('lanterns-glow-brighter');
  });

  it('gives a Sprout only the short Sprout line', async () => {
    const { result } = setup(null, { ageBand: 'SPROUT' });
    await waitFor(() => expect(result.current).toBeDefined());
    expect(result.current?.lines.every((line) => line.length <= 120)).toBe(true);
    expect(result.current?.lines).toEqual(
      linesFor(CASTLE_EVENTS.find((e) => e.id === result.current?.eventId)!, 'SPROUT'),
    );
  });

  it('uses world changes the child has to unlock local events', async () => {
    const { result } = setup(null, {
      roomId: 'setting-tower',
      worldChangeKeys: ['DRAGON_OF_EMBER_MOUNTAIN_COMPLETE', 'GREAT_STORYBOOK_RESTORED'],
    });
    await waitFor(() => expect(result.current?.eventId).toBe('ember-flies-past-tower'));
  });

  it('asks again for a new room and never shows the old room line', async () => {
    const choose = vi.fn().mockResolvedValue(serverEvent);
    const { result, rerender } = setup({ choose });
    await waitFor(() => expect(result.current).toBeDefined());
    rerender({
      childId: 'child-1',
      ageBand: 'PATHFINDER',
      roomId: 'great-library',
      worldChangeKeys: [],
      api: { choose },
    });
    expect(result.current).toBeUndefined();
    await waitFor(() => expect(choose).toHaveBeenCalledTimes(2));
  });

  it('does nothing without a room or an age band', () => {
    const choose = vi.fn();
    const { result } = setup({ choose }, { roomId: undefined });
    expect(result.current).toBeUndefined();
    expect(choose).not.toHaveBeenCalled();
  });
});
