import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/errors';
import type { CastleDirectorApi } from '../../api/play/castleDirectorApi';
import { CASTLE_DEFAULT_LINES } from './castleDefaultLines';
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

  it('on a server error shows the room quiet default line', async () => {
    const choose = vi.fn().mockRejectedValue(new ApiError('network', {}));
    const { result } = setup({ choose });
    await waitFor(() => expect(result.current?.source).toBe('LOCAL'));
    expect(result.current?.lines).toEqual([CASTLE_DEFAULT_LINES['story-hall']?.PATHFINDER]);
    expect(result.current?.npcId).toBeNull();
  });

  it('works with no Django API at all', async () => {
    const { result } = setup(null, { roomId: 'great-library' });
    await waitFor(() => expect(result.current?.source).toBe('LOCAL'));
    expect(result.current?.eventId).toBe('quiet-great-library');
    expect(result.current?.lines).toEqual([CASTLE_DEFAULT_LINES['great-library']?.PATHFINDER]);
  });

  it('shows a room the server has no approved event for as its quiet line', async () => {
    const choose = vi.fn().mockRejectedValue(new ApiError('not_found', { status: 404 }));
    const { result } = setup({ choose }, { roomId: 'trophy-room' });
    await waitFor(() => expect(result.current?.source).toBe('LOCAL'));
  });

  it('gives a Sprout only the short Sprout line', async () => {
    const { result } = setup(null, { ageBand: 'SPROUT' });
    await waitFor(() => expect(result.current).toBeDefined());
    expect(result.current?.lines.every((line) => line.length <= 120)).toBe(true);
    expect(result.current?.lines).toEqual([CASTLE_DEFAULT_LINES['story-hall']?.SPROUT]);
  });

  it('shows nothing for a room the castle does not have', async () => {
    const { result } = setup(null, { roomId: 'no-such-room' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current).toBeUndefined();
  });

  it('asks again for a new room and never shows the old room line', async () => {
    const choose = vi.fn().mockResolvedValue(serverEvent);
    const { result, rerender } = setup({ choose });
    await waitFor(() => expect(result.current).toBeDefined());
    rerender({
      childId: 'child-1',
      ageBand: 'PATHFINDER',
      roomId: 'great-library',
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

  describe("Keeper Quill's flavour line (Final D)", () => {
    const aiLine = 'Keeper Quill hums while the shelves settle.';

    it("replaces Quill's authored line with the server's AI flavour and shows it as the caption", async () => {
      const choose = vi.fn().mockResolvedValue({ ...serverEvent, source: 'FALLBACK' });
      const flavour = vi
        .fn()
        .mockResolvedValue({ eventId: 'quill-hums-in-hall', line: aiLine, source: 'AI' });
      const { result } = setup({ choose, flavour });
      await waitFor(() => expect(result.current?.lines).toEqual([aiLine]));
      expect(result.current?.source).toBe('AI');
      // The closed request: the event id and nothing else.
      expect(flavour).toHaveBeenCalledWith('quill-hums-in-hall');
    });

    it('keeps the authored lines when the server answers FALLBACK', async () => {
      const choose = vi.fn().mockResolvedValue(serverEvent);
      const flavour = vi.fn().mockResolvedValue({
        eventId: 'quill-hums-in-hall',
        line: 'The authored first line.',
        source: 'FALLBACK',
      });
      const { result } = setup({ choose, flavour });
      await waitFor(() => expect(flavour).toHaveBeenCalled());
      await Promise.resolve();
      expect(result.current?.lines).toEqual(serverEvent.lines);
    });

    it('keeps the authored lines on a network failure of the flavour call', async () => {
      const choose = vi.fn().mockResolvedValue(serverEvent);
      const flavour = vi.fn().mockRejectedValue(new ApiError('network', {}));
      const { result } = setup({ choose, flavour });
      await waitFor(() => expect(flavour).toHaveBeenCalled());
      await Promise.resolve();
      expect(result.current?.lines).toEqual(serverEvent.lines);
    });

    it('asks only for Quill events, and only when the API offers flavour', async () => {
      const flavour = vi.fn();
      const other = { ...serverEvent, npcId: 'ember-dragon' };
      setup({ choose: vi.fn().mockResolvedValue(other), flavour });
      const none = setup({ choose: vi.fn().mockResolvedValue(serverEvent) });
      await waitFor(() => expect(none.result.current?.eventId).toBe('quill-hums-in-hall'));
      expect(flavour).not.toHaveBeenCalled();
    });

    it('ignores an answer for another event or one that arrives after the room changed', async () => {
      let release: (value: unknown) => void = () => undefined;
      const flavour = vi.fn().mockReturnValue(new Promise((resolve) => (release = resolve)));
      const choose = vi.fn().mockResolvedValue(serverEvent);
      const { result, rerender } = setup({ choose, flavour });
      await waitFor(() => expect(flavour).toHaveBeenCalled());
      rerender({
        childId: 'child-1',
        ageBand: 'PATHFINDER',
        roomId: 'great-library',
        api: { choose: vi.fn().mockRejectedValue(new ApiError('network', {})), flavour },
      });
      release({ eventId: 'quill-hums-in-hall', line: aiLine, source: 'AI' });
      await Promise.resolve();
      await waitFor(() => expect(result.current?.source).toBe('LOCAL'));
      expect(result.current?.lines).not.toContain(aiLine);
    });
  });
});
