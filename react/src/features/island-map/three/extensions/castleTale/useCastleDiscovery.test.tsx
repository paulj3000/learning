import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CastleRoomsApi } from '../../../../../api/play/castleRoomsApi';
import { useCastleDiscovery } from './useCastleDiscovery';

const fakeApi = (saved: string[] = []) => {
  const list = vi.fn().mockResolvedValue(saved);
  const record = vi
    .fn()
    .mockImplementation((roomId: string) => Promise.resolve({ roomId, newlyDiscovered: true }));
  return { api: { list, record } as CastleRoomsApi, list, record };
};

const render = (api: CastleRoomsApi | null, initialRoom?: string) =>
  renderHook(({ roomId }) => useCastleDiscovery({ childId: 'child-1', roomId, api }), {
    initialProps: { roomId: initialRoom as string | undefined },
  });

describe('useCastleDiscovery', () => {
  it('starts with nothing discovered and reads the saved list once', async () => {
    const { api, list } = fakeApi(['entry-hall', 'story-hall']);
    const { result } = render(api);
    expect(result.current.discovered.size).toBe(0);
    await waitFor(() =>
      expect([...result.current.discovered].sort()).toEqual(['entry-hall', 'story-hall']),
    );
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('marks the room the child is in, and records it once', async () => {
    const { api, record } = fakeApi();
    const { result } = render(api, 'story-hall');
    await waitFor(() => expect(record).toHaveBeenCalledWith('story-hall'));
    expect(result.current.discovered.has('story-hall')).toBe(true);
    expect(record).toHaveBeenCalledTimes(1);
  });

  it('records each new room as the child walks into it, not the same one twice', async () => {
    const { api, record } = fakeApi();
    const { result, rerender } = render(api, 'entry-hall');
    await waitFor(() => expect(record).toHaveBeenCalledTimes(1));
    rerender({ roomId: 'entry-hall' });
    rerender({ roomId: 'story-hall' });
    await waitFor(() => expect(record).toHaveBeenCalledTimes(2));
    rerender({ roomId: 'entry-hall' });
    expect(record).toHaveBeenCalledTimes(2);
    expect([...result.current.discovered].sort()).toEqual(['entry-hall', 'story-hall']);
  });

  it('does not record a room the server already has', async () => {
    const { api, record } = fakeApi(['story-hall']);
    render(api, 'story-hall');
    await waitFor(() => expect(api.list).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });
    expect(record).not.toHaveBeenCalledWith('story-hall');
  });

  it('keeps the room marked for the visit when the server refuses, and says nothing', async () => {
    const record = vi.fn().mockRejectedValue(new Error('not_found'));
    const api = { list: vi.fn().mockResolvedValue([]), record } as unknown as CastleRoomsApi;
    const { result } = render(api, 'secret-chamber');
    await waitFor(() => expect(record).toHaveBeenCalled());
    expect(result.current.discovered.has('secret-chamber')).toBe(true);
  });

  it('tries a refused room again on the next arrival, not in a loop', async () => {
    const record = vi
      .fn()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue({ roomId: 'story-hall', newlyDiscovered: true });
    const api = { list: vi.fn().mockResolvedValue([]), record } as unknown as CastleRoomsApi;
    const { rerender } = render(api, 'story-hall');
    await waitFor(() => expect(record).toHaveBeenCalledTimes(1));
    rerender({ roomId: 'entry-hall' });
    await waitFor(() => expect(record).toHaveBeenCalledTimes(2));
    rerender({ roomId: 'story-hall' });
    await waitFor(() => expect(record).toHaveBeenCalledTimes(3));
    expect(record).toHaveBeenNthCalledWith(3, 'story-hall');
  });

  it('survives a failed read of the saved list', async () => {
    const api = {
      list: vi.fn().mockRejectedValue(new Error('offline')),
      record: vi.fn().mockResolvedValue({ roomId: 'entry-hall', newlyDiscovered: true }),
    } as unknown as CastleRoomsApi;
    const { result } = render(api, 'entry-hall');
    await waitFor(() => expect(result.current.discovered.has('entry-hall')).toBe(true));
  });

  it('works with no Django API at all: the map still marks the visit, and nothing is saved', async () => {
    const { result, rerender } = render(null, 'entry-hall');
    expect(result.current.discovered.has('entry-hall')).toBe(true);
    rerender({ roomId: 'story-hall' });
    expect([...result.current.discovered].sort()).toEqual(['entry-hall', 'story-hall']);
  });

  it('ignores an outcome that arrives after the child has moved on or the guide has closed', async () => {
    let finish: (value: unknown) => void = () => undefined;
    const record = vi.fn().mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const api = { list: vi.fn().mockResolvedValue([]), record } as unknown as CastleRoomsApi;
    const { result, unmount } = render(api, 'story-hall');
    await waitFor(() => expect(record).toHaveBeenCalled());
    unmount();
    await act(async () => {
      finish({ roomId: 'story-hall', newlyDiscovered: true });
      await Promise.resolve();
    });
    expect(result.current.discovered.has('story-hall')).toBe(true);
  });
});
