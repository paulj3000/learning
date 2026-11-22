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

function setup(
  api: CastleDirectorApi | null,
  over: Partial<Parameters<typeof useCastleDirector>[0]> = {},
) {
  return renderHook((props: Parameters<typeof useCastleDirector>[0]) => useCastleDirector(props), {
    initialProps: {
      childId: 'child-1',
      ageBand: 'PATHFINDER' as const,
      roomId: 'story-hall',
      api,
      ...over,
    },
  });
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
});
